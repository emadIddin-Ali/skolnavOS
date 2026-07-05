import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { HealthRecord } from '@/data/schema'

/**
 * Tjänstelager för hälsa & specialkost (klass 4). Auktoriserar ALLTID via
 * behörighetsmotorn innan store:t rörs och skriver granskningslogg på varje
 * åtgärd – även läsning, eftersom hälsodata är känslig.
 */

export const HEALTH_KIND_LABEL: Record<HealthRecord['kind'], string> = {
  allergi: 'Allergi',
  specialkost: 'Specialkost',
  medicinsk: 'Medicinsk',
  annat: 'Annat',
}

export const HEALTH_SEVERITY_LABEL: Record<HealthRecord['severity'], string> = {
  låg: 'Låg',
  medel: 'Medel',
  hög: 'Hög',
  kritisk: 'Kritisk',
}

export interface HealthInput {
  studentId: string
  kind: HealthRecord['kind']
  label: string
  severity: HealthRecord['severity']
  instructions: string
}

function studentOrThrow(studentId: string) {
  const student = db.data.students.find((s) => s.id === studentId)
  if (!student) throw new Error('Eleven kunde inte hittas.')
  return student
}

/** Skapa hälsopost (skolsköterska m.fl. med create-behörighet). */
export function createHealthRecord(principal: Principal, input: HealthInput): HealthRecord {
  const student = studentOrThrow(input.studentId)

  authorize(principal, 'create', 'health', {
    organizationId: student.organizationId,
    schoolId: student.schoolId,
    classId: student.classId,
    studentId: student.id,
    protectedIdentity: student.protectedIdentity,
    dataClassification: 4,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const record: HealthRecord = {
    id: nextId('hlt'),
    studentId: student.id,
    kind: input.kind,
    label: input.label.trim(),
    severity: input.severity,
    instructions: input.instructions.trim(),
    organizationId: student.organizationId,
    schoolId: student.schoolId,
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
  db.data.health.unshift(record)

  logAudit(actorFromPrincipal(principal, student.schoolId), {
    action: 'health.create',
    resource: 'health',
    targetId: record.id,
    targetLabel: `Hälsopost · ${record.label}`,
    newValue: `${HEALTH_KIND_LABEL[record.kind]} · ${HEALTH_SEVERITY_LABEL[record.severity]}`,
    riskLevel: 'medel',
  })

  return record
}

/** Uppdatera en egen hälsopost. */
export function updateHealthRecord(
  principal: Principal,
  recordId: string,
  input: HealthInput,
): HealthRecord {
  const record = db.data.health.find((h) => h.id === recordId)
  if (!record) throw new Error('Hälsoposten kunde inte hittas.')
  const student = studentOrThrow(input.studentId)

  authorize(principal, 'update', 'health', {
    organizationId: record.organizationId,
    schoolId: record.schoolId,
    studentId: record.studentId,
    ownerUserId: record.createdBy,
    protectedIdentity: student.protectedIdentity,
    dataClassification: 4,
  })

  const previous = `${HEALTH_KIND_LABEL[record.kind]} · ${HEALTH_SEVERITY_LABEL[record.severity]}`
  record.kind = input.kind
  record.label = input.label.trim()
  record.severity = input.severity
  record.instructions = input.instructions.trim()
  record.updatedAt = new Date().toISOString()
  record.updatedBy = principal.userId
  record.version += 1

  logAudit(actorFromPrincipal(principal, record.schoolId), {
    action: 'health.update',
    resource: 'health',
    targetId: record.id,
    targetLabel: `Hälsopost · ${record.label}`,
    previousValue: previous,
    newValue: `${HEALTH_KIND_LABEL[record.kind]} · ${HEALTH_SEVERITY_LABEL[record.severity]}`,
    riskLevel: 'medel',
  })

  return record
}

/** Ta bort en egen hälsopost. */
export function deleteHealthRecord(principal: Principal, recordId: string): void {
  const record = db.data.health.find((h) => h.id === recordId)
  if (!record) throw new Error('Hälsoposten kunde inte hittas.')
  const student = db.data.students.find((s) => s.id === record.studentId)

  authorize(principal, 'delete', 'health', {
    organizationId: record.organizationId,
    schoolId: record.schoolId,
    studentId: record.studentId,
    ownerUserId: record.createdBy,
    protectedIdentity: student?.protectedIdentity,
    dataClassification: 4,
  })

  db.data.health = db.data.health.filter((h) => h.id !== recordId)

  logAudit(actorFromPrincipal(principal, record.schoolId), {
    action: 'health.delete',
    resource: 'health',
    targetId: record.id,
    targetLabel: `Hälsopost · ${record.label}`,
    previousValue: `${HEALTH_KIND_LABEL[record.kind]} · ${HEALTH_SEVERITY_LABEL[record.severity]}`,
    riskLevel: 'medel',
  })
}

/** Läsning av hälsolistan revideras (klass 4 – logRead). */
export function logHealthListAccess(principal: Principal, rowCount: number): void {
  logAudit(actorFromPrincipal(principal), {
    action: 'health.read',
    resource: 'health',
    targetLabel: `Läste hälsolista (${rowCount} poster)`,
    riskLevel: 'medel',
  })
}
