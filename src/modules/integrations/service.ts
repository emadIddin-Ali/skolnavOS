import type { Integration, IntegrationStatus } from '@/data/schema'
import { INTEGRATION_STATUS_LABEL } from '@/data/schema'
import { authorize, ForbiddenError, type Principal } from '@/core/permissions/engine'
import { setIntegrationStatus, testConnection } from '@/core/integrations/registry'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'

/**
 * Lokalt tjänstelager för integrationscentret. Alla skrivåtgärder auktoriseras
 * via behörighetsmotorn (authorize) INNAN store:t rörs, och känsliga ändringar
 * revideras i granskningsloggen. UI:t förlitar sig aldrig enbart på dolda
 * knappar – kontrollen sker här.
 */

export interface ActionResult {
  ok: boolean
  message: string
}

function guardUpdate(principal: Principal): ActionResult | null {
  try {
    authorize(principal, 'update', 'integration', { organizationId: principal.organizationId })
    return null
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message }
    throw e
  }
}

/** Ändrar driftstatus (aktivera/pausa/slutför konfiguration). */
export function changeStatus(
  principal: Principal,
  integration: Integration,
  next: IntegrationStatus,
): ActionResult {
  const denied = guardUpdate(principal)
  if (denied) return denied

  const previous = integration.status
  if (previous === next) return { ok: true, message: `${integration.name} är redan ${INTEGRATION_STATUS_LABEL[next].toLowerCase()}.` }

  setIntegrationStatus(integration.id, next)

  logAudit(actorFromPrincipal(principal), {
    action: 'integration.configure',
    resource: 'integration',
    targetId: integration.id,
    targetLabel: integration.name,
    previousValue: INTEGRATION_STATUS_LABEL[previous],
    newValue: INTEGRATION_STATUS_LABEL[next],
    riskLevel: 'medel',
  })

  return { ok: true, message: `${integration.name}: status ändrad till ${INTEGRATION_STATUS_LABEL[next].toLowerCase()}.` }
}

/** Sparar konfiguration utan att ändra status (för integrationer i drift). */
export function saveConfiguration(principal: Principal, integration: Integration): ActionResult {
  const denied = guardUpdate(principal)
  if (denied) return denied

  logAudit(actorFromPrincipal(principal), {
    action: 'integration.configure',
    resource: 'integration',
    targetId: integration.id,
    targetLabel: integration.name,
    newValue: 'Konfiguration uppdaterad',
    riskLevel: 'låg',
  })

  return { ok: true, message: 'Konfigurationen sparades.' }
}

/** Testar anslutningen och uppdaterar körningshistoriken via registret. */
export async function runTest(principal: Principal, integration: Integration): Promise<ActionResult> {
  const denied = guardUpdate(principal)
  if (denied) return denied

  const result = await testConnection(integration.id)

  logAudit(actorFromPrincipal(principal), {
    action: 'integration.configure',
    resource: 'integration',
    targetId: integration.id,
    targetLabel: integration.name,
    newValue: result.ok ? 'Anslutningstest lyckades' : `Anslutningstest misslyckades: ${result.message}`,
    riskLevel: 'låg',
  })

  return result
}
