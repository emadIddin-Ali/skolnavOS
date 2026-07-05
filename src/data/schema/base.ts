import { z } from 'zod'

/**
 * Gemensamma fält och byggblock för alla entiteter.
 * Känsliga tabeller bär tenant/skola, spårning, klassificering, källa,
 * version och gallring – förberett för en riktig backend (Postgres/Supabase).
 */

export const zId = z.string().min(1)
export const zIso = z.string() // ISO-datum/tid som sträng

/** Multi-tenant + spårning. Blandas in i känsliga entiteter. */
export const auditableFields = {
  organizationId: zId,
  schoolId: zId.nullish(),
  createdBy: zId.nullish(),
  updatedBy: zId.nullish(),
  createdAt: zIso,
  updatedAt: zIso,
  deletedAt: zIso.nullable().default(null),
}

/** Datastyrning: klassificering, källsystem, version, sync. */
export const governedFields = {
  dataClassification: z.number().int().min(1).max(6).default(3),
  sourceSystem: z.string().default('skolnav'),
  externalId: z.string().nullable().default(null),
  version: z.number().int().default(1),
  lastSyncedAt: zIso.nullable().default(null),
  retentionMonths: z.number().int().nullable().default(null),
}

/** Fullständig känslig entitet: audit + governance. */
export const sensitiveBase = { ...auditableFields, ...governedFields }

export const zLevel = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])

/** Hjälpare: bygg ett schema med känslig bas. */
export function sensitive<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...sensitiveBase, ...shape })
}
