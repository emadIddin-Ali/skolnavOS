import { db, nextId } from '@/data/db/store'
import type { AuditLog } from '@/data/schema'
import type { Principal } from '@/core/permissions/engine'

/**
 * Central granskningslogg. Alla känsliga åtgärder ska logga via denna tjänst.
 * I produktion skrivs detta till en append-only-tabell (klass 6, säkerhetsdata)
 * och vidare till observerbarhet (OpenObserve-adapter).
 */

export interface AuditInput {
  action: string
  resource: string
  targetId?: string | null
  targetLabel?: string
  previousValue?: string | null
  newValue?: string | null
  reason?: string | null
  riskLevel?: AuditLog['riskLevel']
}

/** Session-kontext som fylls i från aktuell inloggning. */
export interface AuditActor {
  userId: string | null
  role: string
  organizationId: string
  schoolId?: string | null
  ip?: string | null
  sessionId?: string | null
  device?: string | null
}

export function actorFromPrincipal(p: Principal, schoolId?: string | null): AuditActor {
  return {
    userId: p.userId,
    role: p.role,
    organizationId: p.organizationId,
    schoolId: schoolId ?? p.schoolIds[0] ?? null,
    ip: '192.168.1.50',
    sessionId: `sess-${p.userId}`,
    device: typeof navigator !== 'undefined' ? shortenUA(navigator.userAgent) : 'server',
  }
}

function shortenUA(ua: string): string {
  if (/iPad|iPhone/.test(ua)) return 'Safari/iOS'
  if (/Android/.test(ua)) return 'Chrome/Android'
  if (/Edg/.test(ua)) return 'Edge/Win'
  if (/Firefox/.test(ua)) return 'Firefox'
  if (/Chrome/.test(ua)) return 'Chrome'
  return 'Okänd enhet'
}

export function logAudit(actor: AuditActor, input: AuditInput): AuditLog {
  const entry: AuditLog = {
    id: nextId('aud'),
    organizationId: actor.organizationId,
    schoolId: actor.schoolId ?? null,
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: input.action,
    resource: input.resource,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? '',
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
    ip: actor.ip ?? null,
    sessionId: actor.sessionId ?? null,
    device: actor.device ?? null,
    correlationId: nextId('corr'),
    riskLevel: input.riskLevel ?? 'låg',
    at: new Date().toISOString(),
  }
  db.data.auditLogs.unshift(entry)
  return entry
}

export function queryAuditLogs(filter: {
  organizationId: string
  schoolId?: string | null
  resource?: string
  riskLevel?: AuditLog['riskLevel']
  actorUserId?: string
  search?: string
}): AuditLog[] {
  return db.data.auditLogs.filter((l) => {
    if (l.organizationId !== filter.organizationId) return false
    if (filter.schoolId && l.schoolId !== filter.schoolId) return false
    if (filter.resource && l.resource !== filter.resource) return false
    if (filter.riskLevel && l.riskLevel !== filter.riskLevel) return false
    if (filter.actorUserId && l.actorUserId !== filter.actorUserId) return false
    if (filter.search) {
      const q = filter.search.toLowerCase()
      if (!`${l.action} ${l.targetLabel} ${l.actorRole}`.toLowerCase().includes(q)) return false
    }
    return true
  })
}
