import { db, nextId } from '@/data/db/store'
import { can, authorize, ForbiddenError, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { SupportSession } from '@/data/schema'

/**
 * Lokalt tjänstelager för kontrollerad supportåtkomst. All mutation går via
 * behörighetsmotorn (authorize) – UI:t döljer knappar för UX, men detta är den
 * auktoritativa kontrollen. Varje åtgärd granskningsloggas med hög risknivå.
 */

export interface RequestInput {
  schoolId: string | null
  reason: string
  modules: string[]
  durationHours: number
}

export type Outcome =
  | { ok: true; session: SupportSession; status: SupportSession['status'] }
  | { ok: false; error: string }

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

/** Får principalen självgodkänna åtkomst? Kräver administrativ behörighet. */
export function canSelfApprove(principal: Principal): boolean {
  return can(principal, 'admin', 'support_access', {
    organizationId: principal.organizationId,
  }).allowed
}

/**
 * Begär strukturerad supportåtkomst. Självgodkänns direkt (status 'aktiv') om
 * principalen har administrativ behörighet, annars läggs den som 'begärd' och
 * väntar på godkännande.
 */
export function requestSupportAccess(principal: Principal, input: RequestInput): Outcome {
  try {
    authorize(principal, 'create', 'support_access', {
      organizationId: principal.organizationId,
      schoolId: input.schoolId ?? undefined,
    })
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message }
    throw e
  }

  const reason = input.reason.trim()
  if (reason.length < 5) return { ok: false, error: 'Ange en tydlig anledning (minst 5 tecken).' }
  if (input.modules.length === 0) return { ok: false, error: 'Välj minst en modul att få åtkomst till.' }

  const selfApprove = canSelfApprove(principal)
  const nowIso = new Date().toISOString()
  const status: SupportSession['status'] = selfApprove ? 'aktiv' : 'begärd'

  const session: SupportSession = {
    id: nextId('sup'),
    organizationId: principal.organizationId,
    schoolId: input.schoolId,
    supportUserId: principal.userId,
    reason,
    modules: input.modules,
    approvedBy: selfApprove ? principal.userId : null,
    status,
    startedAt: selfApprove ? nowIso : null,
    expiresAt: selfApprove ? isoIn(input.durationHours) : null,
    actionsLogged: 0,
    breakGlass: false,
  }
  db.data.supportSessions.unshift(session)

  logAudit(actorFromPrincipal(principal, input.schoolId), {
    action: 'support.activate',
    resource: 'support_access',
    targetId: session.id,
    targetLabel: `Supportåtkomst · ${input.modules.length} moduler`,
    reason,
    newValue: status,
    riskLevel: 'hög',
  })

  return { ok: true, session, status }
}

/**
 * Break-glass nödåtkomst. Aktiveras direkt utan förhandsgodkännande men med
 * kritisk risknivå och fullständig loggning. Begränsad giltighetstid (1 h).
 */
export function activateBreakGlass(
  principal: Principal,
  input: { schoolId: string | null; reason: string },
): Outcome {
  try {
    authorize(principal, 'create', 'support_access', {
      organizationId: principal.organizationId,
      schoolId: input.schoolId ?? undefined,
    })
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message }
    throw e
  }

  const nowIso = new Date().toISOString()
  const session: SupportSession = {
    id: nextId('sup'),
    organizationId: principal.organizationId,
    schoolId: input.schoolId,
    supportUserId: principal.userId,
    reason: input.reason.trim() || 'Nödåtkomst (break-glass) utan angiven orsak',
    modules: [], // tom = alla moduler i räckvidd
    approvedBy: null,
    status: 'aktiv',
    startedAt: nowIso,
    expiresAt: isoIn(1),
    actionsLogged: 0,
    breakGlass: true,
  }
  db.data.supportSessions.unshift(session)

  logAudit(actorFromPrincipal(principal, input.schoolId), {
    action: 'support.breakglass',
    resource: 'support_access',
    targetId: session.id,
    targetLabel: 'Break-glass nödåtkomst',
    reason: session.reason,
    newValue: 'aktiv',
    riskLevel: 'kritisk',
  })

  return { ok: true, session, status: 'aktiv' }
}

/** Avslutar (eller återkallar) en session. Sätter status 'avslutad'. */
export function endSupportSession(principal: Principal, session: SupportSession): Outcome {
  try {
    authorize(principal, 'update', 'support_access', {
      organizationId: session.organizationId,
      schoolId: session.schoolId ?? undefined,
    })
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message }
    throw e
  }

  const target = db.data.supportSessions.find((s) => s.id === session.id)
  if (!target) return { ok: false, error: 'Sessionen kunde inte hittas.' }

  const previous = target.status
  target.status = 'avslutad'
  const nowIso = new Date().toISOString()
  if (!target.expiresAt || target.expiresAt > nowIso) target.expiresAt = nowIso

  logAudit(actorFromPrincipal(principal, session.schoolId), {
    action: 'support.deactivate',
    resource: 'support_access',
    targetId: target.id,
    targetLabel: session.breakGlass ? 'Break-glass avslutad' : 'Supportåtkomst avslutad',
    previousValue: previous,
    newValue: 'avslutad',
    riskLevel: session.breakGlass ? 'kritisk' : 'hög',
  })

  return { ok: true, session: target, status: 'avslutad' }
}
