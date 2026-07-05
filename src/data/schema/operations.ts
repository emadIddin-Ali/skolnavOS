import { z } from 'zod'
import { zId, zIso, sensitiveBase } from './base'

/** Närvarostatus. */
export const attendanceStatusEnum = z.enum([
  'narvarande',
  'franvarande',
  'sen',
  'hamtad',
  'ej_markerad',
])
export type AttendanceStatus = z.infer<typeof attendanceStatusEnum>

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  narvarande: 'Närvarande',
  franvarande: 'Frånvarande',
  sen: 'Sen ankomst',
  hamtad: 'Hämtad / gått hem',
  ej_markerad: 'Ej markerad',
}

export const attendanceRecordSchema = z.object({
  ...sensitiveBase,
  id: zId,
  studentId: zId,
  classId: zId.nullable().default(null),
  courseId: zId.nullable().default(null),
  date: zIso, // dagens datum
  status: attendanceStatusEnum,
  markedBy: zId.nullable().default(null),
  markedAt: zIso.nullable().default(null),
  note: z.string().default(''),
  /** Härrör från vårdnadshavares frånvaroanmälan? */
  fromAbsenceReport: z.boolean().default(false),
})
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>

export const absenceReasonEnum = z.enum([
  'sjuk',
  'ledig',
  'sen',
  'lakarbesok',
  'tandlakare',
  'okand',
  'annan',
])
export type AbsenceReason = z.infer<typeof absenceReasonEnum>

export const ABSENCE_REASON_LABEL: Record<AbsenceReason, string> = {
  sjuk: 'Sjuk',
  ledig: 'Ledig',
  sen: 'Sen ankomst',
  lakarbesok: 'Läkarbesök',
  tandlakare: 'Tandläkare',
  okand: 'Okänd frånvaro',
  annan: 'Annan orsak',
}

export const absenceStatusEnum = z.enum(['inskickad', 'bekraftad', 'avslagen', 'kraver_atgard'])
export type AbsenceStatus = z.infer<typeof absenceStatusEnum>

export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = {
  inskickad: 'Inskickad',
  bekraftad: 'Bekräftad',
  avslagen: 'Avslagen',
  kraver_atgard: 'Kräver åtgärd',
}

export const absenceReportSchema = z.object({
  ...sensitiveBase,
  id: zId,
  studentId: zId,
  reportedByUserId: zId,
  reason: absenceReasonEnum,
  status: absenceStatusEnum.default('inskickad'),
  fullDay: z.boolean().default(true),
  fromTime: z.string().nullable().default(null),
  toTime: z.string().nullable().default(null),
  date: zIso,
  comment: z.string().default(''),
  handledBy: zId.nullable().default(null),
})
export type AbsenceReport = z.infer<typeof absenceReportSchema>

export const pickupAuthorizationSchema = z.object({
  ...sensitiveBase,
  id: zId,
  studentId: zId,
  personName: z.string(),
  relation: z.string(),
  authorized: z.boolean().default(true),
  note: z.string().default(''),
  addedByUserId: zId,
})
export type PickupAuthorization = z.infer<typeof pickupAuthorizationSchema>

export const mealPlanSchema = z.object({
  id: zId,
  schoolId: zId,
  date: zIso,
  lunch: z.string(),
  vegetarian: z.string(),
  allergens: z.array(z.string()).default([]),
})
export type MealPlan = z.infer<typeof mealPlanSchema>

/** Allergi/specialkost/medicinsk info – känslig (klass 4). */
export const healthRecordSchema = z.object({
  ...sensitiveBase,
  id: zId,
  studentId: zId,
  kind: z.enum(['allergi', 'specialkost', 'medicinsk', 'annat']),
  label: z.string(),
  severity: z.enum(['låg', 'medel', 'hög', 'kritisk']).default('medel'),
  instructions: z.string().default(''),
  dataClassification: z.literal(4).default(4),
})
export type HealthRecord = z.infer<typeof healthRecordSchema>

export const incidentSchema = z.object({
  ...sensitiveBase,
  id: zId,
  title: z.string(),
  studentId: zId.nullable().default(null),
  category: z.enum(['tillbud', 'olycka', 'konflikt', 'kränkning', 'skada', 'övrigt']),
  severity: z.enum(['låg', 'medel', 'hög', 'allvarlig']).default('medel'),
  status: z.enum(['öppen', 'under_utredning', 'åtgärdad', 'avslutad']).default('öppen'),
  description: z.string().default(''),
  reportedBy: zId,
  occurredAt: zIso,
  dataClassification: z.literal(4).default(4),
})
export type Incident = z.infer<typeof incidentSchema>

export const consentTemplateSchema = z.object({
  id: zId,
  organizationId: zId,
  title: z.string(),
  description: z.string(),
  category: z.enum(['foto', 'utflykt', 'medicin', 'data', 'transport', 'övrigt']),
  requiresBothGuardians: z.boolean().default(false),
})
export type ConsentTemplate = z.infer<typeof consentTemplateSchema>

export const consentRequestSchema = z.object({
  ...sensitiveBase,
  id: zId,
  templateId: zId,
  title: z.string(),
  studentId: zId,
  dueAt: zIso,
  status: z.enum(['utkast', 'utskickad', 'delvis', 'signerad', 'avböjd', 'utgången']).default(
    'utskickad',
  ),
  respondedCount: z.number().int().default(0),
  requiredCount: z.number().int().default(1),
})
export type ConsentRequest = z.infer<typeof consentRequestSchema>

export const consentResponseSchema = z.object({
  id: zId,
  requestId: zId,
  guardianUserId: zId,
  decision: z.enum(['godkänt', 'avböjt', 'väntar']),
  signedAt: zIso.nullable().default(null),
  /** Signeringsmetod via intern signeringsmotor (aldrig extern UI). */
  method: z.enum(['app', 'e-legitimation', 'manuell']).default('app'),
})
export type ConsentResponse = z.infer<typeof consentResponseSchema>
