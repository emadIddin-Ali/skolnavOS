import { z } from 'zod'
import { zId, zIso, sensitiveBase } from './base'

export const departmentSchema = z.object({
  id: zId,
  schoolId: zId,
  name: z.string(),
})
export type Department = z.infer<typeof departmentSchema>

export const classSchema = z.object({
  id: zId,
  organizationId: zId,
  schoolId: zId,
  name: z.string(), // "4A", "NA22a", "Solen"
  gradeLabel: z.string(),
  departmentId: zId.nullable().default(null),
  mentorUserId: zId.nullable().default(null),
  studentCount: z.number().int().default(0),
  schoolYearId: zId,
})
export type SchoolClass = z.infer<typeof classSchema>

export const subjectSchema = z.object({
  id: zId,
  code: z.string(), // "MA", "SV"
  name: z.string(),
})
export type Subject = z.infer<typeof subjectSchema>

export const courseSchema = z.object({
  id: zId,
  organizationId: zId,
  schoolId: zId,
  code: z.string(), // "MATMAT02b"
  name: z.string(),
  points: z.number().int().default(100),
  teacherUserId: zId.nullable().default(null),
  studentCount: z.number().int().default(0),
  termId: zId.nullable().default(null),
})
export type Course = z.infer<typeof courseSchema>

export const roomSchema = z.object({
  id: zId,
  schoolId: zId,
  name: z.string(),
  seats: z.number().int().default(30),
})
export type Room = z.infer<typeof roomSchema>

export const enrollmentSchema = z.object({
  id: zId,
  studentId: zId,
  classId: zId.nullable().default(null),
  courseId: zId.nullable().default(null),
  startedOn: zIso,
})
export type Enrollment = z.infer<typeof enrollmentSchema>

/** Ett schemablock (lektion). */
export const scheduleEventSchema = z.object({
  id: zId,
  schoolId: zId,
  title: z.string(),
  subjectCode: z.string().optional(),
  classId: zId.nullable().default(null),
  courseId: zId.nullable().default(null),
  teacherUserId: zId.nullable().default(null),
  roomId: zId.nullable().default(null),
  /** 0=mån .. 4=fre för veckoschema. */
  weekday: z.number().int().min(0).max(6),
  startsAt: z.string(), // "08:15"
  endsAt: z.string(), // "09:00"
})
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>

export const assignmentSchema = z.object({
  ...sensitiveBase,
  id: zId,
  title: z.string(),
  description: z.string().default(''),
  classId: zId.nullable().default(null),
  courseId: zId.nullable().default(null),
  teacherUserId: zId,
  dueAt: zIso,
  status: z.enum(['utkast', 'publicerad', 'stängd']).default('publicerad'),
  submissionsCount: z.number().int().default(0),
  gradedCount: z.number().int().default(0),
})
export type Assignment = z.infer<typeof assignmentSchema>

export const submissionSchema = z.object({
  id: zId,
  assignmentId: zId,
  studentId: zId,
  submittedAt: zIso.nullable().default(null),
  status: z.enum(['ej_inlämnad', 'inlämnad', 'sen', 'bedömd']).default('ej_inlämnad'),
  grade: z.string().nullable().default(null),
})
export type Submission = z.infer<typeof submissionSchema>

/** Betyg/omdöme. Känslig skoldata (klass 4). */
export const assessmentSchema = z.object({
  ...sensitiveBase,
  id: zId,
  studentId: zId,
  courseId: zId.nullable().default(null),
  subjectCode: z.string(),
  grade: z.enum(['A', 'B', 'C', 'D', 'E', 'F', '-']).default('-'),
  type: z.enum(['omdöme', 'terminsbetyg', 'slutbetyg', 'prov']).default('omdöme'),
  comment: z.string().default(''),
  assessedBy: zId,
  assessedAt: zIso,
  dataClassification: z.literal(4).default(4),
})
export type Assessment = z.infer<typeof assessmentSchema>
