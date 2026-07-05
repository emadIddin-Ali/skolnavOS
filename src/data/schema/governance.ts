import { z } from 'zod'
import { zId, zIso, sensitiveBase, zLevel } from './base'

export const fileSchema = z.object({
  ...sensitiveBase,
  id: zId,
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  category: z.enum(['skola', 'elev', 'intern', 'samtycke', 'incident', 'vardnadshavare']),
  studentId: zId.nullable().default(null),
  uploadedBy: zId,
  scanStatus: z.enum(['ej_skannad', 'ren', 'misstänkt', 'väntar']).default('ren'),
  versionCount: z.number().int().default(1),
  guardianVisible: z.boolean().default(false),
  dataClassification: zLevel.default(3),
})
export type StoredFile = z.infer<typeof fileSchema>

export const reportStatusEnum = z.enum(['köad', 'bearbetar', 'klar', 'misslyckad', 'utgången'])
export type ReportStatus = z.infer<typeof reportStatusEnum>

export const reportJobSchema = z.object({
  ...sensitiveBase,
  id: zId,
  type: z.string(), // "attendance", "gdpr_export", ...
  title: z.string(),
  format: z.enum(['pdf', 'csv', 'json', 'xlsx', 'ics']),
  status: reportStatusEnum.default('köad'),
  progress: z.number().int().min(0).max(100).default(0),
  requestedBy: zId,
  requestedAt: zIso,
  reason: z.string().default(''),
  expiresAt: zIso.nullable().default(null),
  rowCount: z.number().int().default(0),
  protectedFiltered: z.boolean().default(false),
})
export type ReportJob = z.infer<typeof reportJobSchema>

export const importJobSchema = z.object({
  ...sensitiveBase,
  id: zId,
  type: z.string(),
  fileName: z.string(),
  status: z.enum(['validerar', 'redo', 'kör', 'klar', 'delvis', 'misslyckad']),
  total: z.number().int().default(0),
  ok: z.number().int().default(0),
  failed: z.number().int().default(0),
  requestedBy: zId,
  requestedAt: zIso,
})
export type ImportJob = z.infer<typeof importJobSchema>

/** Granskningslogg. Säkerhetsdata (klass 6). */
export const auditLogSchema = z.object({
  id: zId,
  organizationId: zId,
  schoolId: zId.nullable().default(null),
  actorUserId: zId.nullable().default(null),
  actorRole: z.string(),
  action: z.string(), // t.ex. "attendance.update"
  resource: z.string(),
  targetId: zId.nullable().default(null),
  targetLabel: z.string().default(''),
  previousValue: z.string().nullable().default(null),
  newValue: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  ip: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  device: z.string().nullable().default(null),
  correlationId: z.string().nullable().default(null),
  riskLevel: z.enum(['låg', 'medel', 'hög', 'kritisk']).default('låg'),
  at: zIso,
})
export type AuditLog = z.infer<typeof auditLogSchema>

export const securityEventSchema = z.object({
  id: zId,
  organizationId: zId,
  type: z.enum([
    'login_success',
    'login_fail',
    'new_device',
    'suspicious',
    'rate_limit',
    'permission_change',
    'role_change',
    'export',
    'mfa_change',
    'key_rotation',
    'account_lock',
  ]),
  userId: zId.nullable().default(null),
  description: z.string(),
  riskLevel: z.enum(['låg', 'medel', 'hög', 'kritisk']).default('låg'),
  ip: z.string().nullable().default(null),
  device: z.string().nullable().default(null),
  resolved: z.boolean().default(false),
  at: zIso,
})
export type SecurityEvent = z.infer<typeof securityEventSchema>

export const gdprRequestSchema = z.object({
  ...sensitiveBase,
  id: zId,
  type: z.enum(['registerutdrag', 'radering', 'rättelse', 'begränsning', 'dataportabilitet']),
  subjectName: z.string(),
  subjectStudentId: zId.nullable().default(null),
  status: z.enum([
    'mottagen',
    'under_granskning',
    'kraver_verifiering',
    'godkand',
    'avslagen',
    'fardigstalld',
    'arkiverad',
  ]).default('mottagen'),
  requestedAt: zIso,
  dueAt: zIso,
  handledBy: zId.nullable().default(null),
  dataClassification: z.literal(4).default(4),
})
export type GdprRequest = z.infer<typeof gdprRequestSchema>

export const supportSessionSchema = z.object({
  id: zId,
  organizationId: zId,
  schoolId: zId.nullable().default(null),
  supportUserId: zId,
  reason: z.string(),
  modules: z.array(z.string()).default([]),
  approvedBy: zId.nullable().default(null),
  status: z.enum(['begärd', 'aktiv', 'avslutad', 'nekad']).default('begärd'),
  startedAt: zIso.nullable().default(null),
  expiresAt: zIso.nullable().default(null),
  actionsLogged: z.number().int().default(0),
  breakGlass: z.boolean().default(false),
})
export type SupportSession = z.infer<typeof supportSessionSchema>

/** Integration – adapter med status, kvoter och spårning. */
export const integrationStatusEnum = z.enum([
  'aktiv',
  'inaktiv',
  'kraver_nyckel',
  'kraver_avtal',
  'kraver_konfiguration',
  'testad',
  'fel',
  'pausad',
  'kommande',
])
export type IntegrationStatus = z.infer<typeof integrationStatusEnum>

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  aktiv: 'Aktiv',
  inaktiv: 'Inaktiv',
  kraver_nyckel: 'Kräver nyckel',
  kraver_avtal: 'Kräver avtal',
  kraver_konfiguration: 'Kräver konfiguration',
  testad: 'Testad',
  fel: 'Fel',
  pausad: 'Pausad',
  kommande: 'Kommande',
}

export const integrationSchema = z.object({
  id: zId,
  organizationId: zId,
  key: z.string(), // "smtp", "gotenberg", "docuseal", ...
  name: z.string(),
  category: z.enum([
    'notis',
    'pdf',
    'signering',
    'sok',
    'analys',
    'logg',
    'monitor',
    'karta',
    'editor',
    'mote',
    'identitet',
    'lagring',
    'import_export',
    'skanning',
    'ki',
  ]),
  status: integrationStatusEnum,
  vendorHint: z.string(), // t.ex. "Gotenberg", "DocuSeal" – syns bara i admin
  lastSyncAt: zIso.nullable().default(null),
  lastError: z.string().nullable().default(null),
  usageDay: z.number().int().default(0),
  usageMonth: z.number().int().default(0),
  quotaDay: z.number().int().nullable().default(null),
  dataTouched: z.string().default(''),
  privacyNote: z.string().default(''),
  fallback: z.string().default(''),
})
export type Integration = z.infer<typeof integrationSchema>

export const integrationRunSchema = z.object({
  id: zId,
  integrationId: zId,
  startedAt: zIso,
  status: z.enum(['ok', 'fel', 'partiell', 'pausad']),
  itemsProcessed: z.number().int().default(0),
  durationMs: z.number().int().default(0),
  message: z.string().default(''),
})
export type IntegrationRun = z.infer<typeof integrationRunSchema>

export const rateLimitStateEnum = z.enum([
  'normal',
  'narmar_grans',
  'begransad',
  'blockerad',
  'kraver_verifiering',
  'eskalerad',
])
export type RateLimitState = z.infer<typeof rateLimitStateEnum>

export const RATE_LIMIT_STATE_LABEL: Record<RateLimitState, string> = {
  normal: 'Normal',
  narmar_grans: 'Närmar sig gräns',
  begransad: 'Begränsad',
  blockerad: 'Blockerad tillfälligt',
  kraver_verifiering: 'Kräver verifiering',
  eskalerad: 'Eskalerad till admin',
}

export const rateLimitEventSchema = z.object({
  id: zId,
  organizationId: zId,
  dimension: z.string(), // "message.send", "export", "login", ...
  scope: z.string(), // "user:123", "ip:.."
  state: rateLimitStateEnum,
  count: z.number().int(),
  limit: z.number().int(),
  windowLabel: z.string(), // "per minut", "per dag"
  at: zIso,
})
export type RateLimitEvent = z.infer<typeof rateLimitEventSchema>
