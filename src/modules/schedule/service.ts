import { authorize, type Principal } from '@/core/permissions/engine'
import { createReport } from '@/core/export/reports'
import type { ReportJob } from '@/data/schema'

/**
 * Tjänstelager för schemamodulen. Kalenderexport (ICS) körs som ett säkert,
 * rate-limitat bakgrundsjobb via rapporttjänsten. Auktorisering sker ALLTID
 * via behörighetsmotorn innan något jobb skapas – UI:t är bara ett skal.
 * Kastar ForbiddenError/RateLimitedError som vyn fångar och visar på svenska.
 */

export interface ExportScheduleInput {
  /** T.ex. "vecka 27". */
  weekLabel: string
  /** Vald klass/kurs/barn – används i granskningsspåret. */
  scopeLabel: string
  schoolId: string | null
  eventCount: number
}

/** Skapar ett ICS-rapportjobb för aktuell veckovy. */
export function exportWeekSchedule(principal: Principal, input: ExportScheduleInput): ReportJob {
  // Auktoritativ kontroll (rapporttjänsten kontrollerar också, men tjänste-
  // lagret ska aldrig lita på att UI:t redan har filtrerat).
  authorize(principal, 'export', 'export', {
    organizationId: principal.organizationId,
    schoolId: input.schoolId ?? undefined,
    dataClassification: 2,
  })

  // createReport auktoriserar, tillämpar rate limit och skriver auditlogg.
  return createReport(principal, {
    type: 'schedule',
    format: 'ics',
    title: `Schema – ${input.weekLabel}`,
    classification: 2,
    schoolId: input.schoolId,
    reason: `Kalenderexport (${input.scopeLabel})`,
    rowEstimate: input.eventCount,
  })
}
