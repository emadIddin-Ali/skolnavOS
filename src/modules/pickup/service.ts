import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { sendNotification } from '@/core/notifications/notifications'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { PickupAuthorization } from '@/data/schema'

/**
 * Tjänstelager för hämtning. Auktoriserar ALLTID via behörighetsmotorn innan
 * store:t rörs – inklusive vårdnadshavarens per-barn-behörighet «pickup» och
 * skyddad identitet. Kastar ForbiddenError/RateLimitedError som vyn fångar.
 */

export interface AddPickupInput {
  studentId: string
  personName: string
  relation: string
  note: string
}

/** Lägg till en hämtberättigad person för ett barn. */
export function addPickupAuthorization(
  principal: Principal,
  input: AddPickupInput,
): PickupAuthorization {
  const student = db.data.students.find((s) => s.id === input.studentId)
  if (!student) throw new Error('Barnet kunde inte hittas.')

  authorize(principal, 'create', 'pickup', {
    organizationId: student.organizationId,
    schoolId: student.schoolId,
    classId: student.classId,
    studentId: student.id,
    protectedIdentity: student.protectedIdentity,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const auth: PickupAuthorization = {
    id: nextId('pick'),
    studentId: student.id,
    personName: input.personName.trim(),
    relation: input.relation.trim(),
    authorized: true,
    note: input.note.trim(),
    addedByUserId: principal.userId,
    organizationId: student.organizationId,
    schoolId: student.schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: student.protectedIdentity ? 5 : 3,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: 36,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.pickups.unshift(auth)

  // Notis till mentor/ansvarig pedagog – aldrig känsligt innehåll i kroppen.
  const cls = student.classId ? db.data.classes.find((c) => c.id === student.classId) : undefined
  if (cls?.mentorUserId && cls.mentorUserId !== principal.userId) {
    sendNotification({
      userId: cls.mentorUserId,
      organizationId: student.organizationId,
      title: 'Ny hämtberättigad person',
      body: 'En hämtberättigad person har lagts till för ett barn i din grupp. Logga in för detaljer.',
      category: 'meddelande',
      channel: 'app',
      classification: 3,
    })
  }

  logAudit(actorFromPrincipal(principal, student.schoolId), {
    action: 'pickup.create',
    resource: 'pickup',
    targetId: auth.id,
    targetLabel: `Hämtbehörig · ${auth.personName} (${auth.relation})`,
    newValue: 'Hämtbehörig',
    riskLevel: 'medel',
  })
  return auth
}

/** Återkalla hämtbehörighet (soft delete via authorized = false). */
export function revokePickupAuthorization(
  principal: Principal,
  pickupId: string,
): PickupAuthorization {
  const auth = db.data.pickups.find((p) => p.id === pickupId)
  if (!auth) throw new Error('Posten kunde inte hittas.')
  const student = db.data.students.find((s) => s.id === auth.studentId)

  authorize(principal, 'update', 'pickup', {
    organizationId: auth.organizationId,
    schoolId: auth.schoolId,
    classId: student?.classId,
    studentId: auth.studentId,
    protectedIdentity: student?.protectedIdentity,
  })

  auth.authorized = false
  auth.updatedAt = new Date().toISOString()
  auth.updatedBy = principal.userId
  auth.version += 1

  logAudit(actorFromPrincipal(principal, auth.schoolId), {
    action: 'pickup.revoke',
    resource: 'pickup',
    targetId: auth.id,
    targetLabel: `Hämtbehörig · ${auth.personName} (${auth.relation})`,
    previousValue: 'Hämtbehörig',
    newValue: 'Återkallad',
    riskLevel: 'medel',
  })
  return auth
}
