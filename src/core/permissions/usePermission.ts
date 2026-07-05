import { useMemo } from 'react'
import { useSession } from '@/core/state/session'
import { buildPrincipal } from '@/core/state/principal'
import { can, type Decision, type Principal, type Target } from './engine'
import type { PermissionAction, ResourceKey } from '@/core/domain/permissions'

/** Aktuell principal baserat på session + demo-inloggning. */
export function usePrincipal(): Principal {
  const role = useSession((s) => s.role)
  const schoolId = useSession((s) => s.schoolId)
  const mfaSatisfied = useSession((s) => s.mfaSatisfied)
  const supportActive = useSession((s) => s.supportActive)
  const breakGlass = useSession((s) => s.breakGlass)
  return useMemo(
    () => buildPrincipal({ role, schoolId, mfaSatisfied, supportActive, breakGlass }),
    [role, schoolId, mfaSatisfied, supportActive, breakGlass],
  )
}

/** Fullständigt beslut (med maskering, loggkrav m.m.). */
export function usePermission(
  action: PermissionAction,
  resource: ResourceKey,
  target?: Target,
): Decision {
  const principal = usePrincipal()
  return useMemo(
    () => can(principal, action, resource, target),
    // target är oftast ett litet objekt; serialisera för stabil memo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [principal, action, resource, JSON.stringify(target ?? {})],
  )
}

/** Bekvämlighet: bara boolean. */
export function useCan(
  action: PermissionAction,
  resource: ResourceKey,
  target?: Target,
): boolean {
  return usePermission(action, resource, target).allowed
}
