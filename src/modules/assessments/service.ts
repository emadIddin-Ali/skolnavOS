import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { createReport } from '@/core/export/reports'
import type { Assessment, ReportJob } from '@/data/schema'
import { maskName } from '@/lib/format'

/**
 * Tjänstelager för bedömning & resultat. Betyg är känslig skoldata (klass 4):
 * varje mutation auktoriseras via behörighetsmotorn och loggas i
 * granskningsloggen med förhöjd risknivå.
 */

export interface CreateAssessmentInput {
  studentId: string
  courseId: string
  grade: Assessment['grade']
  type: Assessment['type']
  comment: string
}

/** Registrera en ny bedömning (lärare/rektor). */
export function createAssessment(principal: Principal, input: CreateAssessmentInput): Assessment {
  const student = db.data.students.find((s) => s.id === input.studentId)
  if (!student) throw new Error('Eleven kunde inte hittas.')
  const course = db.data.courses.find((c) => c.id === input.courseId)
  if (!course) throw new Error('Kursen kunde inte hittas.')

  // Auktoritativ kontroll – klass 4-data, skyddad identitet stoppas utan klarering.
  authorize(principal, 'create', 'assessment', {
    organizationId: course.organizationId,
    schoolId: course.schoolId,
    courseId: course.id,
    classId: student.classId,
    studentId: student.id,
    protectedIdentity: student.protectedIdentity,
    dataClassification: 4,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const assessment: Assessment = {
    id: nextId('ass'),
    studentId: student.id,
    courseId: course.id,
    subjectCode: course.code.slice(0, 3),
    grade: input.grade,
    type: input.type,
    comment: input.comment.trim(),
    assessedBy: principal.userId,
    assessedAt: now,
    organizationId: course.organizationId,
    schoolId: course.schoolId,
    createdAt: now,
    updatedAt: now,
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
  db.data.assessments.unshift(assessment)

  const studentLabel = student.protectedIdentity
    ? maskName(`${student.firstName} ${student.lastName}`)
    : `${student.firstName} ${student.lastName}`

  logAudit(actorFromPrincipal(principal, course.schoolId), {
    action: 'assessment.create',
    resource: 'assessment',
    targetId: assessment.id,
    targetLabel: `${studentLabel} · ${course.code}`,
    newValue: `${input.type} · betyg ${input.grade}`,
    riskLevel: 'medel',
  })

  return assessment
}

/**
 * Beställ export av bedömningsdata (klass 4). Bulkexport blockeras av
 * behörighetsmotorn av dataskyddsskäl – felet bubblar upp till vyn.
 */
export function requestAssessmentExport(
  principal: Principal,
  opts: { bulk: boolean; rowEstimate: number },
): ReportJob {
  return createReport(principal, {
    type: 'assessment',
    title: opts.bulk ? 'Bulkexport – samtliga bedömningar' : 'Bedömningsöversikt – urval',
    format: opts.bulk ? 'csv' : 'pdf',
    reason: 'Uppföljning av kunskapsresultat',
    schoolId: principal.schoolIds[0] ?? null,
    classification: 4,
    bulk: opts.bulk,
    rowEstimate: opts.rowEstimate,
  })
}
