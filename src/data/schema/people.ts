import { z } from 'zod'
import { zId, zIso, sensitiveBase, zLevel } from './base'

/** Elev/barn. Personuppgift (klass 3) eller skyddad (klass 5). */
export const studentSchema = z.object({
  ...sensitiveBase,
  id: zId,
  schoolId: zId, // elever tillhör alltid en skola
  userId: zId.nullable().default(null),
  firstName: z.string(),
  lastName: z.string(),
  personnummer: z.string(),
  birthDate: zIso,
  schoolType: z.enum(['forskola', 'grundskola', 'gymnasium', 'vux']),
  gradeLabel: z.string(), // "Åk 4", "NA22a", "Avdelning Solen"
  classId: zId.nullable().default(null),
  photoColor: z.string().default('#1f4e79'),
  protectedIdentity: z.boolean().default(false),
  status: z.enum(['inskriven', 'ansökt', 'utskriven', 'vilande']).default('inskriven'),
  /** Snabbflaggor som visas på närvarokort. */
  hasAllergyFlag: z.boolean().default(false),
  hasPickupNote: z.boolean().default(false),
})
export type Student = z.infer<typeof studentSchema>

export const staffProfileSchema = z.object({
  ...sensitiveBase,
  id: zId,
  userId: zId,
  title: z.string(), // "Lärare, matematik"
  employmentType: z.enum(['tillsvidare', 'visstid', 'vikarie', 'timanställd']),
  department: z.string().optional(),
  subjects: z.array(z.string()).default([]),
  active: z.boolean().default(true),
})
export type StaffProfile = z.infer<typeof staffProfileSchema>

export const guardianProfileSchema = z.object({
  ...sensitiveBase,
  id: zId,
  userId: zId,
  phone: z.string().optional(),
  preferredChannel: z.enum(['app', 'epost', 'sms']).default('app'),
  verified: z.boolean().default(false),
})
export type GuardianProfile = z.infer<typeof guardianProfileSchema>

/** Relationstyper vårdnadshavare ↔ barn. */
export const relationTypeEnum = z.enum([
  'vardnadshavare',
  'kontaktperson',
  'nodkontakt',
  'hamtbehorig',
  'begransad_kontakt',
  'endast_information',
  'ej_hamtbehorig',
  'skyddad_restriktion',
])
export type RelationType = z.infer<typeof relationTypeEnum>

export const RELATION_TYPE_LABEL: Record<RelationType, string> = {
  vardnadshavare: 'Vårdnadshavare',
  kontaktperson: 'Kontaktperson',
  nodkontakt: 'Nödkontakt',
  hamtbehorig: 'Hämtbehörig',
  begransad_kontakt: 'Begränsad kontakt',
  endast_information: 'Endast information',
  ej_hamtbehorig: 'Ej hämtbehörig',
  skyddad_restriktion: 'Skyddad / restriktion',
}

/** Per-barn-behörigheter för en vårdnadshavare. */
export const guardianPermissionsSchema = z.object({
  viewSchedule: z.boolean().default(true),
  reportAbsence: z.boolean().default(true),
  chatWithStaff: z.boolean().default(true),
  signConsents: z.boolean().default(true),
  viewDocumentation: z.boolean().default(true),
  viewDocuments: z.boolean().default(true),
  updateContact: z.boolean().default(true),
  pickup: z.boolean().default(true),
  urgentNotifications: z.boolean().default(true),
  viewAssessments: z.boolean().default(false),
  viewIncidents: z.boolean().default(false),
})
export type GuardianPermissions = z.infer<typeof guardianPermissionsSchema>

/** Relation vårdnadshavare↔barn med egna behörigheter (relationbaserad ABAC). */
export const guardianStudentRelationSchema = z.object({
  ...sensitiveBase,
  id: zId,
  guardianUserId: zId,
  studentId: zId,
  relationType: relationTypeEnum,
  permissions: guardianPermissionsSchema,
  /** Delad vårdnad / konflikt-markering. */
  sharedCustody: z.boolean().default(false),
  conflictNote: z.string().nullable().default(null),
  verifiedAt: zIso.nullable().default(null),
  dataClassification: zLevel.default(3),
})
export type GuardianStudentRelation = z.infer<typeof guardianStudentRelationSchema>
