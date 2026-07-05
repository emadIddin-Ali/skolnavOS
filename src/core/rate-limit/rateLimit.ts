import { db, nextId } from '@/data/db/store'
import type { RateLimitState } from '@/data/schema'

/**
 * Kostnads- och missbruksskydd. Räknar åtgärder per dimension och scope i
 * glidande fönster. Ger användarvänliga svenska tillstånd i stället för hårda
 * fel. I produktion backas detta av Redis/Valkey.
 */

export interface RateLimitRule {
  dimension: string
  limit: number
  windowMs: number
  windowLabel: string
}

export const RATE_LIMITS: Record<string, RateLimitRule> = {
  'login': { dimension: 'login', limit: 5, windowMs: 15 * 60_000, windowLabel: 'per 15 min' },
  'password_reset': { dimension: 'password_reset', limit: 3, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'invitation': { dimension: 'invitation', limit: 50, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'message.send': { dimension: 'message.send', limit: 50, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'announcement': { dimension: 'announcement', limit: 10, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'file.upload': { dimension: 'file.upload', limit: 100, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'file.download': { dimension: 'file.download', limit: 300, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'export': { dimension: 'export', limit: 50, windowMs: 24 * 60 * 60_000, windowLabel: 'per dag' },
  'pdf': { dimension: 'pdf', limit: 100, windowMs: 24 * 60 * 60_000, windowLabel: 'per dag' },
  'search': { dimension: 'search', limit: 120, windowMs: 60_000, windowLabel: 'per minut' },
  'attendance.correct': { dimension: 'attendance.correct', limit: 200, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'absence.report': { dimension: 'absence.report', limit: 20, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'notification.send': { dimension: 'notification.send', limit: 500, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'integration.sync': { dimension: 'integration.sync', limit: 60, windowMs: 60 * 60_000, windowLabel: 'per timme' },
  'api': { dimension: 'api', limit: 1000, windowMs: 60 * 60_000, windowLabel: 'per timme' },
}

interface Bucket {
  count: number
  resetAt: number
}
const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  state: RateLimitState
  allowed: boolean
  remaining: number
  limit: number
  message: string | null
  windowLabel: string
}

const MESSAGES: Partial<Record<RateLimitState, string | null>> = {
  narmar_grans: null,
  begransad: 'Åtgärden är tillfälligt begränsad. Vänta en stund.',
  blockerad: 'För många försök. Vänta en stund och försök igen.',
  kraver_verifiering: 'Åtgärden kräver ny verifiering.',
  eskalerad: 'Gränsen är nådd och har eskalerats till administratör.',
}

export function checkRateLimit(
  dimension: string,
  scope: string,
  organizationId: string,
  opts: { record?: boolean } = {},
): RateLimitResult {
  const rule = RATE_LIMITS[dimension]
  if (!rule) {
    return { state: 'normal', allowed: true, remaining: Infinity, limit: Infinity, message: null, windowLabel: '' }
  }
  const key = `${dimension}:${scope}`
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + rule.windowMs }
    buckets.set(key, bucket)
  }
  if (opts.record !== false) bucket.count += 1

  const ratio = bucket.count / rule.limit
  let state: RateLimitState = 'normal'
  if (bucket.count > rule.limit * 2) state = 'eskalerad'
  else if (bucket.count > rule.limit) state = dimension === 'login' ? 'blockerad' : 'begransad'
  else if (ratio >= 0.85) state = 'narmar_grans'

  const allowed = bucket.count <= rule.limit
  const result: RateLimitResult = {
    state,
    allowed,
    remaining: Math.max(0, rule.limit - bucket.count),
    limit: rule.limit,
    message: allowed && state !== 'begransad' ? null : (MESSAGES[state] ?? null),
    windowLabel: rule.windowLabel,
  }

  if (!allowed || state === 'narmar_grans') {
    db.data.rateLimitEvents.unshift({
      id: nextId('rl'),
      organizationId,
      dimension,
      scope,
      state,
      count: bucket.count,
      limit: rule.limit,
      windowLabel: rule.windowLabel,
      at: new Date().toISOString(),
    })
  }
  return result
}

/** Klass som UI kan fånga. */
export class RateLimitedError extends Error {
  result: RateLimitResult
  constructor(result: RateLimitResult) {
    super(result.message ?? 'Gränsen är nådd.')
    this.name = 'RateLimitedError'
    this.result = result
  }
}
