import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { listIntegrations, testConnection } from '@/core/integrations/registry'

/**
 * Tjänstelager för systemhälsa. Auktoriserar via behörighetsmotorn och
 * respekterar kvoter innan integrationer testas.
 */

export interface HealthCheckResult {
  total: number
  ok: number
  failures: { name: string; message: string }[]
}

/** Kör anslutningstest mot alla aktiva integrationer. */
export async function runHealthCheck(principal: Principal): Promise<HealthCheckResult> {
  // Auktoritativ kontroll: läsa systemhälsa.
  authorize(principal, 'read', 'system_health', {
    organizationId: principal.organizationId,
  })

  // Kostnads- och missbruksskydd.
  const rl = checkRateLimit('integration.sync', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const targets = listIntegrations(principal.organizationId).filter(
    (i) => i.status === 'aktiv' || i.status === 'testad',
  )

  let ok = 0
  const failures: HealthCheckResult['failures'] = []
  for (const integration of targets) {
    const result = await testConnection(integration.id)
    if (result.ok) ok += 1
    else failures.push({ name: integration.name, message: result.message })
  }

  logAudit(actorFromPrincipal(principal), {
    action: 'system_health.check',
    resource: 'system_health',
    targetLabel: 'Manuell hälsokontroll',
    newValue: `${ok} av ${targets.length} integrationer OK`,
    riskLevel: 'låg',
  })

  return { total: targets.length, ok, failures }
}
