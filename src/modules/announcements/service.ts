import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { sendNotification } from '@/core/notifications/notifications'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { Announcement } from '@/data/schema'

/**
 * Tjänstelager för anslag. Auktoriserar ALLTID via behörighetsmotorn innan
 * store:t rörs. Läsning är målgruppsstyrd (anslag är öppen information,
 * klass 1) – publicering, arkivering och bekräftelser går via tjänsterna här.
 */

export type Audience = Announcement['audience']

export const AUDIENCE_LABEL: Record<Audience, string> = {
  skola: 'Hela skolan',
  klass: 'Klass',
  personal: 'Personal',
  vardnadshavare: 'Vårdnadshavare',
  organisation: 'Organisation',
}

/** Målgruppsstyrd synlighet: vem ser ett anslag? */
export function visibleFor(principal: Principal, a: Announcement): boolean {
  if (a.organizationId !== principal.organizationId) return false
  const isStudent = principal.role === 'elev_grund' || principal.role === 'elev_gy'
  const isGuardian = principal.role === 'vardnadshavare'
  if (a.audience === 'personal' && (isStudent || isGuardian)) return false
  if (a.audience === 'vardnadshavare' && isStudent) return false
  if (
    a.audience !== 'organisation' &&
    a.schoolId &&
    principal.schoolIds.length > 0 &&
    !principal.schoolIds.includes(a.schoolId)
  ) {
    return false
  }
  return true
}

/** Schemalagt anslag som ännu inte gått ut till läsarna. */
export function isScheduled(a: Announcement, nowIso: string = new Date().toISOString()): boolean {
  return Boolean(a.scheduledFor && a.scheduledFor > nowIso)
}

// ---------------------------------------------------------------------------
// Läsbekräftelser (lokalt tillstånd – i produktion en egen tabell)
// ---------------------------------------------------------------------------

const confirmations = new Map<string, Set<string>>()

function bucketFor(a: Announcement): Set<string> {
  const existing = confirmations.get(a.id)
  if (existing) return existing
  const set = new Set<string>()
  // Seedade anslag med bekräftelsekrav har redan mottagna bekräftelser i
  // demon; nyskapade anslag börjar på noll. Demo-vårdnadshavaren utesluts så
  // att bekräftelseflödet kan provas.
  if (a.confirmationsRequired && a.createdBy == null) {
    const demoGuardianId = db.data.demoAccounts.find((d) => d.role === 'vardnadshavare')?.userId
    db.data.relations
      .filter((r) => r.guardianUserId !== demoGuardianId && (!a.schoolId || r.schoolId === a.schoolId))
      .slice(0, 12)
      .forEach((r) => set.add(r.guardianUserId))
  }
  confirmations.set(a.id, set)
  return set
}

export function confirmationCount(a: Announcement): number {
  return bucketFor(a).size
}

export function hasConfirmed(a: Announcement, userId: string): boolean {
  return bucketFor(a).has(userId)
}

/** Läsare (elev/vårdnadshavare) bekräftar att ett anslag är läst. */
export function confirmAnnouncementRead(principal: Principal, announcementId: string): number {
  const a = db.data.announcements.find((x) => x.id === announcementId && !x.deletedAt)
  if (!a) throw new Error('Anslaget kunde inte hittas.')
  if (!a.confirmationsRequired) throw new Error('Anslaget kräver ingen bekräftelse.')

  const set = bucketFor(a)
  set.add(principal.userId)

  logAudit(actorFromPrincipal(principal, a.schoolId), {
    action: 'announcement.confirm',
    resource: 'announcement',
    targetId: a.id,
    targetLabel: a.title,
    newValue: 'Läst och bekräftad',
    riskLevel: 'låg',
  })
  return set.size
}

// ---------------------------------------------------------------------------
// Publicering och arkivering
// ---------------------------------------------------------------------------

export interface CreateAnnouncementInput {
  title: string
  body: string
  audience: Audience
  urgent: boolean
  confirmationsRequired: boolean
  /** ISO-tid för schemalagd publicering, annars null. */
  scheduledFor: string | null
}

/** En representativ mottagare notifieras i demon (i produktion: hela målgruppen). */
function representativeRecipient(
  audience: Audience,
  schoolId: string | null,
  excludeUserId: string,
): string | null {
  if (audience === 'personal') {
    const cls = db.data.classes.find(
      (c) => (!schoolId || c.schoolId === schoolId) && c.mentorUserId && c.mentorUserId !== excludeUserId,
    )
    return cls?.mentorUserId ?? null
  }
  const rel = db.data.relations.find(
    (r) => (!schoolId || r.schoolId === schoolId) && r.guardianUserId !== excludeUserId,
  )
  return rel?.guardianUserId ?? null
}

export function createAnnouncement(principal: Principal, input: CreateAnnouncementInput): Announcement {
  const schoolId = input.audience === 'organisation' ? null : principal.schoolIds[0] ?? null

  // Auktoritativ kontroll – kastar ForbiddenError vid nekad åtkomst.
  authorize(principal, 'create', 'announcement', {
    organizationId: principal.organizationId,
    schoolId,
  })

  // Kostnads- och missbruksskydd.
  const rl = checkRateLimit('announcement', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const announcement: Announcement = {
    id: nextId('ann'),
    title: input.title.trim(),
    body: input.body.trim(),
    audience: input.audience,
    urgent: input.urgent,
    publishedBy: principal.userId,
    publishedAt: now,
    scheduledFor: input.scheduledFor,
    confirmationsRequired: input.confirmationsRequired,
    organizationId: principal.organizationId,
    schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: 1,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: null,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.announcements.unshift(announcement)

  // Notis skickas endast vid direkt publicering – aldrig känsligt innehåll i kroppen.
  if (!input.scheduledFor) {
    const recipientId = representativeRecipient(input.audience, schoolId, principal.userId)
    if (recipientId) {
      sendNotification({
        userId: recipientId,
        organizationId: principal.organizationId,
        title: input.urgent ? `Viktigt anslag: ${announcement.title}` : `Nytt anslag: ${announcement.title}`,
        body: 'Ett nytt anslag har publicerats. Logga in för att läsa.',
        category: 'meddelande',
        channel: input.urgent ? 'push' : 'app',
        urgent: input.urgent,
        requiresConfirmation: input.confirmationsRequired,
        classification: 1,
      })
    }
  }

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'announcement.create',
    resource: 'announcement',
    targetId: announcement.id,
    targetLabel: announcement.title,
    newValue: input.scheduledFor ? 'Schemalagd' : 'Publicerad',
    riskLevel: 'låg',
  })

  return announcement
}

/** Arkivera (mjuk borttagning) – döljs för alla läsare, kvar för revision. */
export function archiveAnnouncement(principal: Principal, announcementId: string): Announcement {
  const a = db.data.announcements.find((x) => x.id === announcementId && !x.deletedAt)
  if (!a) throw new Error('Anslaget kunde inte hittas.')

  authorize(principal, 'delete', 'announcement', {
    organizationId: a.organizationId,
    schoolId: a.schoolId ?? null,
  })

  const now = new Date().toISOString()
  a.deletedAt = now
  a.updatedAt = now
  a.updatedBy = principal.userId
  a.version += 1

  logAudit(actorFromPrincipal(principal, a.schoolId), {
    action: 'announcement.archive',
    resource: 'announcement',
    targetId: a.id,
    targetLabel: a.title,
    previousValue: 'Publicerad',
    newValue: 'Arkiverad',
    riskLevel: 'låg',
  })

  return a
}
