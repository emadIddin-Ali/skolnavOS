import { db } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { School } from '@/data/schema'

/**
 * Tjänstelager för skolvyn. Auktoriserar ALLTID via behörighetsmotorn
 * innan store:t muteras.
 */

export interface UpdateSchoolInput {
  name: string
  address: string
}

/** Uppdatera skolans grunduppgifter (rektor/huvudman). */
export function updateSchoolInfo(principal: Principal, schoolId: string, input: UpdateSchoolInput): School {
  const school = db.data.schools.find((s) => s.id === schoolId)
  if (!school) throw new Error('Skolan kunde inte hittas.')

  // Auktoritativ kontroll: redigera skola inom rätt organisation/skol-scope.
  authorize(principal, 'update', 'school', {
    organizationId: school.organizationId,
    schoolId: school.id,
  })

  const name = input.name.trim()
  const address = input.address.trim()
  if (!name) throw new Error('Skolans namn måste anges.')
  if (!address) throw new Error('Adress måste anges.')

  const previous = `${school.name} · ${school.address}`
  school.name = name
  school.address = address

  logAudit(actorFromPrincipal(principal, school.id), {
    action: 'school.update',
    resource: 'school',
    targetId: school.id,
    targetLabel: school.name,
    previousValue: previous,
    newValue: `${name} · ${address}`,
    riskLevel: 'låg',
  })

  return school
}
