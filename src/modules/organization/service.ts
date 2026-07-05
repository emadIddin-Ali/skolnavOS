import { db } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { FeatureFlag } from '@/data/schema'

/**
 * Tjänstelager för organisationsvyn. Auktoriserar ALLTID via
 * behörighetsmotorn innan store:t muteras.
 */

/** Slå på/av en funktionsflagga för organisationen. */
export function setFeatureFlag(principal: Principal, key: string, enabled: boolean): FeatureFlag {
  const flag = db.data.featureFlags.find((f) => f.key === key)
  if (!flag) throw new Error('Funktionsflaggan kunde inte hittas.')

  // Auktoritativ kontroll: administrera organisationen.
  authorize(principal, 'admin', 'organization', {
    organizationId: principal.organizationId,
  })

  const previous = flag.enabled
  flag.enabled = enabled

  logAudit(actorFromPrincipal(principal), {
    action: 'feature_flag.update',
    resource: 'feature_flag',
    targetId: flag.key,
    targetLabel: flag.label,
    previousValue: previous ? 'På' : 'Av',
    newValue: enabled ? 'På' : 'Av',
    riskLevel: 'medel',
  })

  return flag
}
