import { z } from 'zod'
import { zId, zIso, sensitiveBase } from './base'

export const schoolTypeEnum = z.enum(['forskola', 'grundskola', 'gymnasium', 'vux'])
export type SchoolType = z.infer<typeof schoolTypeEnum>

export const SCHOOL_TYPE_LABEL: Record<SchoolType, string> = {
  forskola: 'Förskola',
  grundskola: 'Grundskola',
  gymnasium: 'Gymnasium',
  vux: 'Vuxenutbildning',
}

export const organizationSchema = z.object({
  id: zId,
  name: z.string(),
  orgNumber: z.string(),
  kind: z.enum(['kommun', 'friskola', 'koncern']),
  createdAt: zIso,
  licenseTier: z.enum(['bas', 'standard', 'plus', 'koncern']).default('standard'),
})
export type Organization = z.infer<typeof organizationSchema>

export const schoolSchema = z.object({
  id: zId,
  organizationId: zId,
  name: z.string(),
  type: schoolTypeEnum,
  municipality: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  principalUserId: zId.optional(),
  studentCount: z.number().int().default(0),
  createdAt: zIso,
})
export type School = z.infer<typeof schoolSchema>

export const schoolYearSchema = z.object({
  id: zId,
  organizationId: zId,
  label: z.string(), // "2025/2026"
  startsOn: zIso,
  endsOn: zIso,
  current: z.boolean().default(false),
})
export type SchoolYear = z.infer<typeof schoolYearSchema>

export const termSchema = z.object({
  id: zId,
  schoolYearId: zId,
  label: z.string(), // "Höstterminen 2025"
  startsOn: zIso,
  endsOn: zIso,
  current: z.boolean().default(false),
})
export type Term = z.infer<typeof termSchema>

export const userSchema = z.object({
  id: zId,
  name: z.string(),
  email: z.string().email(),
  personnummer: z.string().optional(),
  phone: z.string().optional(),
  avatarColor: z.string().default('#1f4e79'),
  /** Skyddad identitet – förstklassig egenskap. */
  protectedIdentity: z.boolean().default(false),
  mfaEnabled: z.boolean().default(false),
  status: z.enum(['aktiv', 'inbjuden', 'inaktiv', 'last']).default('aktiv'),
  lastLoginAt: zIso.nullable().default(null),
  createdAt: zIso,
})
export type User = z.infer<typeof userSchema>

/** Koppling användare ↔ roll ↔ räckvidd (skola/klass/kurs). Grunden för RBAC. */
export const membershipSchema = z.object({
  id: zId,
  userId: zId,
  organizationId: zId,
  role: z.string(), // RoleKey
  schoolId: zId.nullable().default(null),
  /** Begränsning till specifika klasser/kurser/elever (ABAC). */
  classIds: z.array(zId).default([]),
  courseIds: z.array(zId).default([]),
  /** Tillfällig behörighet (vikarie) – går ut. */
  validUntil: zIso.nullable().default(null),
  createdAt: zIso,
})
export type Membership = z.infer<typeof membershipSchema>

export const licenseSchema = z.object({
  id: zId,
  organizationId: zId,
  module: z.string(),
  seats: z.number().int(),
  seatsUsed: z.number().int(),
  status: z.enum(['aktiv', 'provperiod', 'utgången', 'pausad', 'kommande']),
  renewsOn: zIso.nullable().default(null),
})
export type License = z.infer<typeof licenseSchema>

export const featureFlagSchema = z.object({
  key: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  scope: z.enum(['plattform', 'organisation', 'skola']).default('organisation'),
})
export type FeatureFlag = z.infer<typeof featureFlagSchema>

export const membershipFull = z.object({ ...sensitiveBase }) // reserverad för framtida utökning
