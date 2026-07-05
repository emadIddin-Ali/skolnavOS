import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import type { Incident, AuditLog } from '@/data/schema'

/**
 * Tjänstelager för incidenter (klass 4). Auktoriserar via behörighetsmotorn,
 * skriver granskningslogg med risknivå efter allvarsgrad och notifierar rektor
 * vid nya incidenter. Statushistoriken hålls lokalt (demo) per incident.
 */

export const INCIDENT_CATEGORY_LABEL: Record<Incident['category'], string> = {
  tillbud: 'Tillbud',
  olycka: 'Olycka',
  konflikt: 'Konflikt',
  kränkning: 'Kränkning',
  skada: 'Skada',
  övrigt: 'Övrigt',
}

export const INCIDENT_SEVERITY_LABEL: Record<Incident['severity'], string> = {
  låg: 'Låg',
  medel: 'Medel',
  hög: 'Hög',
  allvarlig: 'Allvarlig',
}

export const INCIDENT_STATUS_LABEL: Record<Incident['status'], string> = {
  öppen: 'Öppen',
  under_utredning: 'Under utredning',
  åtgärdad: 'Åtgärdad',
  avslutad: 'Avslutad',
}

export const INCIDENT_STATUS_ORDER: Incident['status'][] = [
  'öppen',
  'under_utredning',
  'åtgärdad',
  'avslutad',
]

/** Nästa steg i statusflödet (endast framåt), eller null vid avslutad. */
export function nextIncidentStatus(status: Incident['status']): Incident['status'] | null {
  const idx = INCIDENT_STATUS_ORDER.indexOf(status)
  return idx >= 0 && idx < INCIDENT_STATUS_ORDER.length - 1 ? INCIDENT_STATUS_ORDER[idx + 1] : null
}

function riskForSeverity(severity: Incident['severity']): AuditLog['riskLevel'] {
  switch (severity) {
    case 'allvarlig':
      return 'hög'
    case 'hög':
      return 'hög'
    case 'medel':
      return 'medel'
    default:
      return 'låg'
  }
}

// ---- Statushistorik (lokal state i demo – i produktion en egen tabell) ----

export interface StatusHistoryEntry {
  status: Incident['status']
  at: string
  byUserId: string | null
}

const statusHistory = new Map<string, StatusHistoryEntry[]>()

/** Historik för en incident. Syntetiseras för seedade poster vid första läsning. */
export function getStatusHistory(incident: Incident): StatusHistoryEntry[] {
  let history = statusHistory.get(incident.id)
  if (!history) {
    const currentIdx = Math.max(0, INCIDENT_STATUS_ORDER.indexOf(incident.status))
    const start = new Date(incident.occurredAt).getTime()
    const end = new Date(incident.updatedAt).getTime()
    const step = currentIdx > 0 ? Math.max(0, end - start) / currentIdx : 0
    history = INCIDENT_STATUS_ORDER.slice(0, currentIdx + 1).map((status, i) => ({
      status,
      at: new Date(start + step * i).toISOString(),
      byUserId: i === 0 ? incident.reportedBy : null,
    }))
    statusHistory.set(incident.id, history)
  }
  return history
}

// ---- Mutationer ----

export interface CreateIncidentInput {
  title: string
  description: string
  category: Incident['category']
  severity: Incident['severity']
  /** null = ej elevspecifik händelse. */
  studentId: string | null
}

export function createIncident(principal: Principal, input: CreateIncidentInput): Incident {
  const student = input.studentId
    ? db.data.students.find((s) => s.id === input.studentId)
    : undefined
  const schoolId = student?.schoolId ?? principal.schoolIds[0] ?? null

  authorize(principal, 'create', 'incident', {
    organizationId: principal.organizationId,
    schoolId,
    classId: student?.classId,
    studentId: student?.id,
    protectedIdentity: student?.protectedIdentity,
    dataClassification: 4,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const incident: Incident = {
    id: nextId('inc'),
    title: input.title.trim(),
    studentId: student?.id ?? null,
    category: input.category,
    severity: input.severity,
    status: 'öppen',
    description: input.description.trim(),
    reportedBy: principal.userId,
    occurredAt: now,
    organizationId: principal.organizationId,
    schoolId,
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
  db.data.incidents.unshift(incident)
  statusHistory.set(incident.id, [{ status: 'öppen', at: now, byUserId: principal.userId }])

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'incident.create',
    resource: 'incident',
    targetId: incident.id,
    targetLabel: `Incident · ${incident.title}`,
    newValue: `${INCIDENT_CATEGORY_LABEL[incident.category]} · ${INCIDENT_SEVERITY_LABEL[incident.severity]}`,
    riskLevel: riskForSeverity(incident.severity),
  })

  // Rektor informeras alltid – aldrig känsligt innehåll i notiskroppen.
  sendNotification({
    userId: 'u-rektor',
    organizationId: principal.organizationId,
    title: 'Ny incident rapporterad',
    body: `En incident (${INCIDENT_SEVERITY_LABEL[incident.severity].toLowerCase()} allvarsgrad) har rapporterats. Logga in för detaljer.`,
    category: 'sakerhet',
    channel: 'app',
    urgent: incident.severity === 'allvarlig',
    classification: 3,
  })

  return incident
}

/** Flytta incidenten ett steg framåt i statusflödet. */
export function advanceIncidentStatus(principal: Principal, incidentId: string): Incident {
  const incident = db.data.incidents.find((i) => i.id === incidentId)
  if (!incident) throw new Error('Incidenten kunde inte hittas.')
  const next = nextIncidentStatus(incident.status)
  if (!next) throw new Error('Incidenten är redan avslutad.')
  const student = incident.studentId
    ? db.data.students.find((s) => s.id === incident.studentId)
    : undefined

  authorize(principal, 'update', 'incident', {
    organizationId: incident.organizationId,
    schoolId: incident.schoolId,
    classId: student?.classId,
    studentId: incident.studentId,
    protectedIdentity: student?.protectedIdentity,
    dataClassification: 4,
  })

  const previous = incident.status
  const now = new Date().toISOString()
  const history = getStatusHistory(incident) // init före mutation så historiken blir korrekt
  incident.status = next
  incident.updatedAt = now
  incident.updatedBy = principal.userId
  incident.version += 1
  history.push({ status: next, at: now, byUserId: principal.userId })

  logAudit(actorFromPrincipal(principal, incident.schoolId), {
    action: 'incident.status',
    resource: 'incident',
    targetId: incident.id,
    targetLabel: `Incident · ${incident.title}`,
    previousValue: INCIDENT_STATUS_LABEL[previous],
    newValue: INCIDENT_STATUS_LABEL[next],
    riskLevel: riskForSeverity(incident.severity),
  })

  return incident
}
