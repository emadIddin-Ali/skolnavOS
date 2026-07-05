import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import type { ConsentRequest, ConsentResponse } from '@/data/schema'

/**
 * Tjänstelager för samtycken. Auktoriserar via behörighetsmotorn (som bl.a.
 * kontrollerar vårdnadshavarens per-barn-behörighet signConsents), muterar
 * store:t, loggar och notifierar. UI:t fångar ForbiddenError/RateLimitedError.
 */

export const CONSENT_STATUS_LABEL: Record<ConsentRequest['status'], string> = {
  utkast: 'Utkast',
  utskickad: 'Utskickad',
  delvis: 'Delvis signerad',
  signerad: 'Signerad',
  avböjd: 'Avböjd',
  utgången: 'Utgången',
}

export const CONSENT_METHOD_LABEL: Record<ConsentResponse['method'], string> = {
  app: 'App',
  'e-legitimation': 'E-legitimation',
  manuell: 'Manuell',
}

export const CONSENT_DECISION_LABEL: Record<ConsentResponse['decision'], string> = {
  godkänt: 'Godkänt',
  avböjt: 'Avböjt',
  väntar: 'Väntar',
}

export interface CreateConsentInput {
  templateId: string
  studentIds: string[]
  /** ISO-datum för förfallodag. */
  dueAt: string
}

/** Skapa samtyckesförfrågningar för en eller flera elever (t.ex. hel klass). */
export function createConsentRequests(
  principal: Principal,
  input: CreateConsentInput,
): ConsentRequest[] {
  const template = db.data.consentTemplates.find((t) => t.id === input.templateId)
  if (!template) throw new Error('Samtyckesmallen kunde inte hittas.')
  if (input.studentIds.length === 0) throw new Error('Minst en elev måste väljas.')

  const students = input.studentIds
    .map((id) => db.data.students.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
  if (students.length === 0) throw new Error('Eleverna kunde inte hittas.')

  // Auktorisera per elev INNAN något skapas – allt eller inget.
  for (const student of students) {
    authorize(principal, 'create', 'consent', {
      organizationId: student.organizationId,
      schoolId: student.schoolId,
      classId: student.classId,
      studentId: student.id,
      protectedIdentity: student.protectedIdentity,
    })
  }

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const created: ConsentRequest[] = []
  for (const student of students) {
    const request: ConsentRequest = {
      id: nextId('cr'),
      templateId: template.id,
      title: template.title,
      studentId: student.id,
      dueAt: input.dueAt,
      status: 'utskickad',
      respondedCount: 0,
      requiredCount: template.requiresBothGuardians ? 2 : 1,
      organizationId: student.organizationId,
      schoolId: student.schoolId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dataClassification: 3,
      sourceSystem: 'skolnav',
      externalId: null,
      version: 1,
      lastSyncedAt: null,
      retentionMonths: 36,
      createdBy: principal.userId,
      updatedBy: principal.userId,
    }
    db.data.consentRequests.unshift(request)
    created.push(request)

    // Notis till barnets vårdnadshavare – inget känsligt i notiskroppen.
    const guardianIds = db.data.relations
      .filter((r) => r.studentId === student.id)
      .map((r) => r.guardianUserId)
    for (const guardianId of new Set(guardianIds)) {
      sendNotification({
        userId: guardianId,
        organizationId: student.organizationId,
        title: 'Nytt samtycke att signera',
        body: `«${template.title}» väntar på ditt svar. Logga in för att signera.`,
        category: 'samtycke',
        channel: 'app',
        classification: 3,
      })
    }
  }

  logAudit(actorFromPrincipal(principal, students[0].schoolId), {
    action: 'consent.create',
    resource: 'consent',
    targetId: created[0]?.id ?? null,
    targetLabel: `Samtycke · ${template.title} (${created.length} ${created.length === 1 ? 'elev' : 'elever'})`,
    newValue: CONSENT_STATUS_LABEL.utskickad,
    riskLevel: 'låg',
  })

  return created
}

/** Vårdnadshavare signerar (godkänner/avböjer) ett samtycke. */
export function signConsent(
  principal: Principal,
  requestId: string,
  decision: 'godkänt' | 'avböjt',
): ConsentResponse {
  const request = db.data.consentRequests.find((r) => r.id === requestId)
  if (!request) throw new Error('Samtyckesförfrågan kunde inte hittas.')
  const student = db.data.students.find((s) => s.id === request.studentId)

  // Motorn kontrollerar relation + per-barn-behörigheten signConsents.
  authorize(principal, 'sign', 'consent', {
    organizationId: request.organizationId,
    schoolId: request.schoolId,
    studentId: request.studentId,
    protectedIdentity: student?.protectedIdentity,
  })

  const already = db.data.consentResponses.find(
    (r) => r.requestId === request.id && r.guardianUserId === principal.userId,
  )
  if (already) throw new Error('Du har redan besvarat det här samtycket.')
  if (request.status === 'signerad' || request.status === 'avböjd' || request.status === 'utgången') {
    throw new Error('Samtycket är redan avgjort och kan inte signeras.')
  }

  const now = new Date().toISOString()
  const response: ConsentResponse = {
    id: nextId('cres'),
    requestId: request.id,
    guardianUserId: principal.userId,
    decision,
    signedAt: now,
    method: 'app',
  }
  db.data.consentResponses.unshift(response)

  const previous = request.status
  request.respondedCount = db.data.consentResponses.filter(
    (r) => r.requestId === request.id,
  ).length
  request.status =
    decision === 'avböjt'
      ? 'avböjd'
      : request.respondedCount >= request.requiredCount
        ? 'signerad'
        : 'delvis'
  request.updatedAt = now
  request.updatedBy = principal.userId
  request.version += 1

  logAudit(actorFromPrincipal(principal, request.schoolId), {
    action: 'consent.sign',
    resource: 'consent',
    targetId: request.id,
    targetLabel: `Samtycke · ${request.title}`,
    previousValue: CONSENT_STATUS_LABEL[previous],
    newValue: `${CONSENT_DECISION_LABEL[decision]} → ${CONSENT_STATUS_LABEL[request.status]}`,
    riskLevel: 'låg',
  })

  return response
}
