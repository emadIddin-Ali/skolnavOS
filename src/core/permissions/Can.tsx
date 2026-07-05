import { usePermission } from './usePermission'
import type { PermissionAction, ResourceKey } from '@/core/domain/permissions'
import type { Target } from './engine'

/**
 * Deklarativ behörighetsgrind för UX. OBS: detta döljer bara UI – den
 * auktoritativa kontrollen sker alltid i tjänstelagret via authorize().
 */
export function Can({
  action,
  resource,
  target,
  fallback = null,
  children,
}: {
  action: PermissionAction
  resource: ResourceKey
  target?: Target
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const decision = usePermission(action, resource, target)
  return <>{decision.allowed ? children : fallback}</>
}
