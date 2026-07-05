import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import type { Assignment, Submission } from '@/data/schema'
import { maskName } from '@/lib/format'

/**
 * Tjänstelager för uppgifter och inlämningar. Auktoriserar ALLTID via
 * behörighetsmotorn innan store:t rörs. Kastar ForbiddenError/RateLimitedError
 * som vyn fångar och visar som svensk mikrocopy.
 */

export interface CreateAssignmentInput {
  title: string
  description: string
  courseId: string
  /** ISO-tidpunkt för deadline. */
  dueAt: string
  status: 'utkast' | 'publicerad'
}

/** Skapa en ny uppgift (lärare). */
export function createAssignment(principal: Principal, input: CreateAssignmentInput): Assignment {
  const course = db.data.courses.find((c) => c.id === input.courseId)
  if (!course) throw new Error('Kursen kunde inte hittas.')

  authorize(principal, 'create', 'assignment', {
    organizationId: course.organizationId,
    schoolId: course.schoolId,
    courseId: course.id,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const assignment: Assignment = {
    id: nextId('asg'),
    title: input.title.trim(),
    description: input.description.trim(),
    classId: null,
    courseId: course.id,
    teacherUserId: principal.userId,
    dueAt: input.dueAt,
    status: input.status,
    submissionsCount: 0,
    gradedCount: 0,
    organizationId: course.organizationId,
    schoolId: course.schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: 2,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: null,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.assignments.unshift(assignment)

  logAudit(actorFromPrincipal(principal, course.schoolId), {
    action: 'assignment.create',
    resource: 'assignment',
    targetId: assignment.id,
    targetLabel: `${assignment.title} · ${course.code}`,
    newValue: input.status === 'utkast' ? 'Utkast' : 'Publicerad',
    riskLevel: 'låg',
  })

  return assignment
}

/** Ändra status på en uppgift (publicera/stäng/öppna igen). */
export function updateAssignmentStatus(
  principal: Principal,
  assignmentId: string,
  status: Assignment['status'],
): Assignment {
  const assignment = db.data.assignments.find((a) => a.id === assignmentId)
  if (!assignment) throw new Error('Uppgiften kunde inte hittas.')

  authorize(principal, 'update', 'assignment', {
    organizationId: assignment.organizationId,
    schoolId: assignment.schoolId,
    courseId: assignment.courseId,
    classId: assignment.classId,
  })

  const STATUS_LABEL: Record<Assignment['status'], string> = {
    utkast: 'Utkast',
    publicerad: 'Publicerad',
    stängd: 'Stängd',
  }
  const previous = assignment.status
  assignment.status = status
  assignment.updatedAt = new Date().toISOString()
  assignment.updatedBy = principal.userId
  assignment.version += 1

  logAudit(actorFromPrincipal(principal, assignment.schoolId), {
    action: 'assignment.update',
    resource: 'assignment',
    targetId: assignment.id,
    targetLabel: assignment.title,
    previousValue: STATUS_LABEL[previous],
    newValue: STATUS_LABEL[status],
    riskLevel: 'låg',
  })

  return assignment
}

/** Lärare bedömer en inlämning: status «bedömd» + betyg. */
export function gradeSubmission(
  principal: Principal,
  submissionId: string,
  grade: string,
): Submission {
  const submission = db.data.submissions.find((s) => s.id === submissionId)
  if (!submission) throw new Error('Inlämningen kunde inte hittas.')
  const assignment = db.data.assignments.find((a) => a.id === submission.assignmentId)
  if (!assignment) throw new Error('Uppgiften kunde inte hittas.')
  const student = db.data.students.find((s) => s.id === submission.studentId)

  authorize(principal, 'update', 'assignment', {
    organizationId: assignment.organizationId,
    schoolId: assignment.schoolId,
    courseId: assignment.courseId,
    classId: student?.classId,
    protectedIdentity: student?.protectedIdentity,
  })

  submission.status = 'bedömd'
  submission.grade = grade
  assignment.gradedCount = db.data.submissions.filter(
    (s) => s.assignmentId === assignment.id && s.status === 'bedömd',
  ).length
  assignment.updatedAt = new Date().toISOString()
  assignment.updatedBy = principal.userId
  assignment.version += 1

  const studentLabel = student
    ? student.protectedIdentity
      ? maskName(`${student.firstName} ${student.lastName}`)
      : `${student.firstName} ${student.lastName}`
    : 'Okänd elev'

  logAudit(actorFromPrincipal(principal, assignment.schoolId), {
    action: 'assignment.grade',
    resource: 'assignment',
    targetId: submission.id,
    targetLabel: `${assignment.title} · ${studentLabel}`,
    newValue: `Bedömd (${grade})`,
    riskLevel: 'medel',
  })

  // Notis till eleven – aldrig betyg i notiskroppen.
  if (student?.userId) {
    sendNotification({
      userId: student.userId,
      organizationId: assignment.organizationId,
      title: 'Uppgift bedömd',
      body: `«${assignment.title}» har bedömts. Logga in för att se resultatet.`,
      category: 'meddelande',
      channel: 'app',
      classification: 3,
    })
  }

  return submission
}

/** Elev lämnar in en uppgift (markeras «sen» efter deadline). */
export function submitAssignment(principal: Principal, submissionId: string): Submission {
  const submission = db.data.submissions.find((s) => s.id === submissionId)
  if (!submission) throw new Error('Inlämningen kunde inte hittas.')
  const assignment = db.data.assignments.find((a) => a.id === submission.assignmentId)
  if (!assignment) throw new Error('Uppgiften kunde inte hittas.')
  if (submission.status !== 'ej_inlämnad') throw new Error('Uppgiften är redan inlämnad.')
  if (assignment.status === 'stängd') throw new Error('Uppgiften är stängd för inlämning.')

  authorize(principal, 'update', 'assignment', {
    organizationId: assignment.organizationId,
    schoolId: assignment.schoolId,
    studentId: submission.studentId,
  })

  const now = new Date()
  submission.status = now.toISOString() > assignment.dueAt ? 'sen' : 'inlämnad'
  submission.submittedAt = now.toISOString()
  assignment.submissionsCount = db.data.submissions.filter(
    (s) => s.assignmentId === assignment.id && s.status !== 'ej_inlämnad',
  ).length
  assignment.updatedAt = now.toISOString()
  assignment.version += 1

  logAudit(actorFromPrincipal(principal, assignment.schoolId), {
    action: 'assignment.submit',
    resource: 'assignment',
    targetId: submission.id,
    targetLabel: assignment.title,
    newValue: submission.status === 'sen' ? 'Sen inlämning' : 'Inlämnad',
    riskLevel: 'låg',
  })

  // Notis till läraren.
  sendNotification({
    userId: assignment.teacherUserId,
    organizationId: assignment.organizationId,
    title: 'Ny inlämning',
    body: `En elev har lämnat in «${assignment.title}».`,
    category: 'meddelande',
    channel: 'app',
    classification: 3,
  })

  return submission
}
