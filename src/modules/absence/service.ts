import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { sendNotification } from '@/core/notifications/notifications'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { AbsenceReport, AbsenceReason, AbsenceStatus } from '@/data/schema'
import { ABSENCE_REASON_LABEL, ABSENCE_STATUS_LABEL } from '@/data/schema'

/**
 * Tjänstelager för frånvaro. Auktoriserar ALLTID via behörighetsmotorn innan
 * store:t rörs – UI:t är bara ett skal. Kastar ForbiddenError/RateLimitedError
 * som vyn fångar och visar som svensk mikrocopy.
 */

export interface CreateAbsenceInput {
  studentId: string
  reason: AbsenceReason
  fullDay: boolean
  fromTime: string | null
  toTime: string | null
  /** ISO-datum för frånvarodagen. */
  date: string
  comment: string
}

/** Skapa en frånvaroanmälan (vårdnadshavare). */
export function createAbsenceReport(principal: Principal, input: CreateAbsenceInput): AbsenceReport {
  const student = db.data.students.find((s) => s.id === input.studentId)
  if (!student) throw new Error('Barnet kunde inte hittas.')

  // Auktoritativ kontroll. Motorn hanterar relation + per-barn-behörigheten
  // reportAbsence och kastar ForbiddenError vid nekad åtkomst.
  authorize(principal, 'create', 'absence', {
    organizationId: student.organizationId,
    schoolId: student.schoolId,
    studentId: student.id,
    classId: student.classId,
    protectedIdentity: student.protectedIdentity,
  })

  // Kostnads- och missbruksskydd.
  const rl = checkRateLimit('absence.report', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const report: AbsenceReport = {
    id: nextId('abs'),
    studentId: student.id,
    reportedByUserId: principal.userId,
    reason: input.reason,
    status: 'inskickad',
    fullDay: input.fullDay,
    fromTime: input.fullDay ? null : input.fromTime,
    toTime: input.fullDay ? null : input.toTime,
    date: input.date,
    comment: input.comment.trim(),
    handledBy: null,
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
  db.data.absences.unshift(report)

  // Notis till mentor – aldrig känsligt innehåll i notiskroppen.
  const cls = student.classId ? db.data.classes.find((c) => c.id === student.classId) : undefined
  const mentorId = cls?.mentorUserId
  if (mentorId) {
    sendNotification({
      userId: mentorId,
      organizationId: student.organizationId,
      title: 'Ny frånvaroanmälan',
      body: `En vårdnadshavare har anmält frånvaro (${ABSENCE_REASON_LABEL[input.reason].toLowerCase()}).`,
      category: 'franvaro',
      channel: 'app',
      classification: 3,
    })
  }

  logAudit(actorFromPrincipal(principal, student.schoolId), {
    action: 'absence.create',
    resource: 'absence',
    targetId: report.id,
    targetLabel: `Frånvaroanmälan · ${ABSENCE_REASON_LABEL[input.reason]}`,
    newValue: ABSENCE_STATUS_LABEL.inskickad,
    riskLevel: 'låg',
  })

  return report
}

/** Personal/ledning ändrar status på en anmälan (bekräfta/avslå/kräver åtgärd). */
export function updateAbsenceStatus(
  principal: Principal,
  absenceId: string,
  status: AbsenceStatus,
): AbsenceReport {
  const report = db.data.absences.find((a) => a.id === absenceId)
  if (!report) throw new Error('Anmälan kunde inte hittas.')
  const student = db.data.students.find((s) => s.id === report.studentId)

  authorize(principal, 'update', 'absence', {
    organizationId: report.organizationId,
    schoolId: report.schoolId,
    studentId: report.studentId,
    classId: student?.classId,
    protectedIdentity: student?.protectedIdentity,
  })

  const previous = report.status
  report.status = status
  report.handledBy = principal.userId
  report.updatedBy = principal.userId
  report.updatedAt = new Date().toISOString()
  report.version += 1

  logAudit(actorFromPrincipal(principal, report.schoolId), {
    action: 'absence.update',
    resource: 'absence',
    targetId: report.id,
    targetLabel: `Frånvaro · ${ABSENCE_STATUS_LABEL[status]}`,
    previousValue: ABSENCE_STATUS_LABEL[previous],
    newValue: ABSENCE_STATUS_LABEL[status],
    riskLevel: status === 'kraver_atgard' ? 'medel' : 'låg',
  })

  // Informera inrapporterande vårdnadshavare om beslutet.
  sendNotification({
    userId: report.reportedByUserId,
    organizationId: report.organizationId,
    title: `Frånvaro ${ABSENCE_STATUS_LABEL[status].toLowerCase()}`,
    body: 'Skolan har hanterat din frånvaroanmälan. Logga in för detaljer.',
    category: 'franvaro',
    channel: 'app',
    classification: 3,
  })

  return report
}
