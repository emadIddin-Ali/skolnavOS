import { db, nextId } from '@/data/db/store'
import type { GdprRequest, ReportJob } from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import { createReport } from '@/core/export/reports'
import { GDPR_STATUS_LABEL, GDPR_TYPE_LABEL, type GdprStatus, type GdprType } from './gdprData'

/**
 * Tjänstelager för GDPR-begäranden. Behörighetsmotorn är auktoritativ: varje
 * mutation går via authorize() (inte bara dolda knappar) och känsliga åtgärder
 * loggas i granskningsloggen. Store:t (in-memory-backend) muteras direkt.
 */

/** Org-filtrerad lista, nyast först. Radnivå-scope prövas i vyn per rad. */
export function listGdprRequests(organizationId: string): GdprRequest[] {
  return db.data.gdprRequests
    .filter((r) => r.organizationId === organizationId)
    .slice()
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
}

export interface CreateGdprInput {
  type: GdprType
  subjectName: string
  subjectStudentId: string | null
  schoolId: string | null
  /** Rättslig grund / motivering. */
  reason: string
}

/** Registrera en ny begäran från en registrerad. Lagstadgad svarstid: 1 månad. */
export function createGdprRequest(principal: Principal, input: CreateGdprInput): GdprRequest {
  authorize(principal, 'create', 'gdpr', {
    organizationId: principal.organizationId,
    schoolId: input.schoolId ?? undefined,
  })

  const now = new Date()
  const due = new Date(now)
  due.setDate(due.getDate() + 30) // GDPR: svar inom en månad

  const request: GdprRequest = {
    id: nextId('gdpr'),
    type: input.type,
    subjectName: input.subjectName.trim() || 'Registrerad (ej namngiven)',
    subjectStudentId: input.subjectStudentId,
    status: 'mottagen',
    requestedAt: now.toISOString(),
    dueAt: due.toISOString(),
    handledBy: null,
    organizationId: principal.organizationId,
    schoolId: input.schoolId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null,
    dataClassification: 4,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: 60,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.gdprRequests.unshift(request)

  logAudit(actorFromPrincipal(principal, input.schoolId), {
    action: 'gdpr.create',
    resource: 'gdpr',
    targetId: request.id,
    targetLabel: `${GDPR_TYPE_LABEL[input.type]} · ${request.subjectName}`,
    newValue: GDPR_STATUS_LABEL.mottagen,
    reason: input.reason.trim() || null,
    riskLevel: 'medel',
  })

  return request
}

/** Flytta en begäran framåt i handläggningsflödet. */
export function advanceGdprStatus(
  principal: Principal,
  requestId: string,
  next: GdprStatus,
  reason?: string,
): GdprRequest {
  const request = db.data.gdprRequests.find((r) => r.id === requestId)
  if (!request) throw new Error('Begäran kunde inte hittas.')

  authorize(principal, 'update', 'gdpr', {
    organizationId: request.organizationId,
    schoolId: request.schoolId,
  })

  const previous = request.status
  request.status = next
  request.handledBy = principal.userId
  request.updatedBy = principal.userId
  request.updatedAt = new Date().toISOString()
  request.version += 1

  logAudit(actorFromPrincipal(principal, request.schoolId), {
    action: 'gdpr.update',
    resource: 'gdpr',
    targetId: request.id,
    targetLabel: `${GDPR_TYPE_LABEL[request.type]} · ${request.subjectName}`,
    previousValue: GDPR_STATUS_LABEL[previous],
    newValue: GDPR_STATUS_LABEL[next],
    reason: reason?.trim() || null,
    riskLevel: next === 'avslagen' || request.type === 'radering' ? 'hög' : 'medel',
  })

  // Notifiera dataskyddssamordnare om slutförd handläggning (aldrig känsligt innehåll).
  if (next === 'fardigstalld' || next === 'avslagen') {
    const dpo = db.data.users.find((u) => u.id === 'u-huvudman')
    if (dpo) {
      sendNotification({
        userId: dpo.id,
        organizationId: request.organizationId,
        title: `GDPR-begäran ${GDPR_STATUS_LABEL[next].toLowerCase()}`,
        body: 'En begäran om dataskyddsrättigheter har handlagts. Logga in för detaljer.',
        category: 'system',
        channel: 'app',
        classification: 4,
      })
    }
  }

  return request
}

/** Koppling begäran → skapat exportjobb (håller i minnet under sessionen). */
const exportByRequest = new Map<string, string>()

export function reportForRequest(requestId: string): ReportJob | undefined {
  const reportId = exportByRequest.get(requestId)
  if (!reportId) return undefined
  return db.data.reports.find((r) => r.id === reportId)
}

/**
 * Skapa registerutdrag/dataportabilitet som ett säkert exportjobb (klass 4).
 * Går via createReport() som auktoriserar, rate-limitar och filtrerar bort
 * skyddade uppgifter. Ingen bulkexport av skyddad data.
 */
export function createGdprExport(principal: Principal, request: GdprRequest): ReportJob {
  const job = createReport(principal, {
    type: 'gdpr_export',
    title: `${GDPR_TYPE_LABEL[request.type]} – ${request.subjectName}`,
    format: request.type === 'dataportabilitet' ? 'json' : 'pdf',
    reason: `GDPR-begäran ${request.id}`,
    schoolId: request.schoolId,
    classification: 4,
    bulk: false,
  })
  exportByRequest.set(request.id, job.id)

  logAudit(actorFromPrincipal(principal, request.schoolId), {
    action: 'gdpr.export',
    resource: 'gdpr',
    targetId: request.id,
    targetLabel: `Registerutdrag · ${request.subjectName}`,
    newValue: job.title,
    riskLevel: 'hög',
  })

  return job
}

/** Org-filtrerade exportjobb kopplade till GDPR (registerutdrag m.m.). */
export function listGdprExports(organizationId: string): ReportJob[] {
  return db.data.reports.filter((r) => r.organizationId === organizationId && r.type === 'gdpr_export')
}
