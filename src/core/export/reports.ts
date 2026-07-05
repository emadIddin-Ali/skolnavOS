import { db, nextId } from '@/data/db/store'
import type { ReportJob } from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { Classification } from '@/core/domain/classification'

/**
 * Rapporter/exporter som säkra, rate-limitade bakgrundsjobb. Inga stora
 * synkrona exporter. Skyddad identitet filtreras bort. PDF via Gotenberg-
 * adapter, CSV/JSON/ICS via exportlagret – allt visas native på svenska.
 */

export interface CreateReportInput {
  type: string
  title: string
  format: ReportJob['format']
  reason?: string
  schoolId?: string | null
  classification?: Classification
  bulk?: boolean
  rowEstimate?: number
}

export function listReports(organizationId: string): ReportJob[] {
  return db.data.reports.filter((r) => r.organizationId === organizationId)
}

export function createReport(principal: Principal, input: CreateReportInput): ReportJob {
  // Auktorisering (auktoritativt – inte bara dolt i UI)
  authorize(principal, 'export', 'export', {
    organizationId: principal.organizationId,
    schoolId: input.schoolId ?? undefined,
    dataClassification: input.classification,
    bulk: input.bulk,
  })

  // Kostnadsskydd
  const rl = checkRateLimit('export', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const job: ReportJob = {
    id: nextId('rep'),
    type: input.type,
    title: input.title,
    format: input.format,
    status: 'köad',
    progress: 0,
    requestedBy: principal.userId,
    requestedAt: new Date().toISOString(),
    reason: input.reason ?? '',
    expiresAt: null,
    rowCount: input.rowEstimate ?? 0,
    protectedFiltered: true,
    organizationId: principal.organizationId,
    schoolId: input.schoolId ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    dataClassification: input.classification ?? 3,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: null,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.reports.unshift(job)

  logAudit(actorFromPrincipal(principal, input.schoolId), {
    action: 'export.create',
    resource: 'export',
    targetId: job.id,
    targetLabel: input.title,
    reason: input.reason,
    riskLevel: input.classification && input.classification >= 4 ? 'hög' : 'medel',
  })

  // Simulerad bakgrundsbearbetning (idempotent stegning)
  advanceJob(job.id)
  return job
}

function advanceJob(id: string) {
  const tick = () => {
    const job = db.data.reports.find((r) => r.id === id)
    if (!job || job.status === 'klar' || job.status === 'misslyckad') return
    job.status = 'bearbetar'
    job.progress = Math.min(100, job.progress + 25)
    if (job.progress >= 100) {
      job.status = 'klar'
      job.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
      job.rowCount = job.rowCount || 120
      return
    }
    setTimeout(tick, 500)
  }
  setTimeout(tick, 500)
}
