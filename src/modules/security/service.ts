import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import { createReport } from '@/core/export/reports'
import type { SecurityEvent, Incident, ReportJob } from '@/data/schema'
import { fmtDate } from '@/lib/format'
import { EVENT_ACTION_META, SECURITY_EVENT_META, type EventActionKind } from './meta'

/**
 * Tjänstelager för Säkerhetscentret. Behörighetsmotorn är auktoritativ:
 * VARJE mutation går via authorize(principal, action, resource) och loggas i
 * granskningsloggen (klass 6, säkerhetsdata). UI:t döljer knappar för UX men
 * kontrollen sker alltid här – inte bara i vyn.
 */

/** Utför en radåtgärd på en säkerhetshändelse (granska/incident/verifiering/blockera/åtgärdad). */
export function actOnSecurityEvent(
  principal: Principal,
  eventId: string,
  kind: EventActionKind,
): SecurityEvent {
  const event = db.data.securityEvents.find((e) => e.id === eventId)
  if (!event) throw new Error('Säkerhetshändelsen kunde inte hittas.')

  // Auktoritativ kontroll (kastar ForbiddenError som vyn fångar).
  authorize(principal, 'update', 'security', { organizationId: event.organizationId })

  const meta = EVENT_ACTION_META[kind]

  // Åtgärdsspecifika sidoeffekter.
  if (kind === 'incident') createIncidentFromEvent(principal, event)
  if (kind === 'blockera') blockUser(event)
  if (kind === 'verifiering') requireReverification(event)

  const previous = event.resolved
  if (meta.resolves) event.resolved = true

  logAudit(actorFromPrincipal(principal), {
    action: meta.auditAction,
    resource: 'security',
    targetId: event.id,
    targetLabel: `${SECURITY_EVENT_META[event.type].label} · ${event.description}`,
    previousValue: previous ? 'Åtgärdad' : 'Öppen',
    newValue: meta.resolves ? 'Åtgärdad' : 'Granskad',
    reason: meta.label,
    riskLevel: meta.risk,
  })

  return event
}

function createIncidentFromEvent(principal: Principal, event: SecurityEvent) {
  const now = new Date().toISOString()
  const incident: Incident = {
    id: nextId('inc'),
    title: `Säkerhetsincident: ${SECURITY_EVENT_META[event.type].label}`,
    studentId: null,
    category: 'övrigt',
    severity: event.riskLevel === 'kritisk' ? 'allvarlig' : event.riskLevel === 'hög' ? 'hög' : 'medel',
    status: 'öppen',
    description: `Skapad från säkerhetshändelse ${event.id}: ${event.description}`,
    reportedBy: principal.userId,
    occurredAt: event.at,
    organizationId: event.organizationId,
    schoolId: null,
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
}

function blockUser(event: SecurityEvent) {
  if (event.userId) {
    const user = db.data.users.find((u) => u.id === event.userId)
    if (user) user.status = 'last'
  }
  db.data.securityEvents.unshift({
    id: nextId('sec'),
    organizationId: event.organizationId,
    type: 'account_lock',
    userId: event.userId,
    description: 'Konto spärrat efter säkerhetsåtgärd',
    riskLevel: 'hög',
    ip: event.ip,
    device: event.device,
    resolved: true,
    at: new Date().toISOString(),
  })
}

function requireReverification(event: SecurityEvent) {
  if (!event.userId) return
  // Aldrig känsligt innehåll i notiskroppen.
  sendNotification({
    userId: event.userId,
    organizationId: event.organizationId,
    title: 'Verifiering krävs',
    body: 'Av säkerhetsskäl behöver du bekräfta din identitet vid nästa inloggning.',
    category: 'sakerhet',
    channel: 'app',
    urgent: true,
    classification: 3,
  })
}

/** Rotera eller återkalla en API-nyckel. Loggas som key.rotation / key.revoke. */
export function authorizeKeyAction(
  principal: Principal,
  keyName: string,
  action: 'rotera' | 'aterkalla',
): void {
  authorize(principal, 'update', 'security', { organizationId: principal.organizationId })
  logAudit(actorFromPrincipal(principal), {
    action: action === 'aterkalla' ? 'key.revoke' : 'key.rotation',
    resource: 'security',
    targetLabel: keyName,
    newValue: action === 'aterkalla' ? 'Återkallad' : 'Roterad',
    riskLevel: 'hög',
  })
}

/** Rotera signeringshemlighet för en webhook. */
export function authorizeWebhookRotation(principal: Principal, endpoint: string): void {
  authorize(principal, 'update', 'security', { organizationId: principal.organizationId })
  logAudit(actorFromPrincipal(principal), {
    action: 'key.rotation',
    resource: 'security',
    targetLabel: `Webhook · ${endpoint}`,
    newValue: 'Signeringshemlighet roterad',
    riskLevel: 'hög',
  })
}

/** Avsluta en aktiv session/enhet. */
export function authorizeSessionRevoke(principal: Principal, deviceLabel: string): void {
  authorize(principal, 'update', 'security', { organizationId: principal.organizationId })
  logAudit(actorFromPrincipal(principal), {
    action: 'session.revoke',
    resource: 'security',
    targetLabel: deviceLabel,
    newValue: 'Session avslutad',
    riskLevel: 'medel',
  })
}

/**
 * Exportera säkerhetsrapport som ett rate-limitat bakgrundsjobb.
 * Klass 6 (säkerhetsdata) – aldrig bulkexport av skyddad data.
 */
export function exportSecurityReport(principal: Principal): ReportJob {
  return createReport(principal, {
    type: 'security',
    title: `Säkerhetsrapport ${fmtDate(new Date())}`,
    format: 'pdf',
    reason: 'Säkerhetsgranskning',
    schoolId: principal.schoolIds[0] ?? null,
    classification: 6,
    bulk: false,
  })
}
