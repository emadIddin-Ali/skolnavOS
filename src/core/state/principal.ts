import { db } from '@/data/db/store'
import type { Principal } from '@/core/permissions/engine'
import type { RoleKey } from '@/core/domain/roles'
import type { GuardianPermissions } from '@/data/schema'

export interface SessionSnapshot {
  role: RoleKey
  schoolId: string
  mfaSatisfied: boolean
  supportActive: boolean
  breakGlass: boolean
}

/**
 * Bygger en Principal (för behörighetsmotorn) från aktuell demo-inloggning och
 * sessionsläge. I produktion kommer detta från JWT/DB-medlemskap, inte seed.
 */
export function buildPrincipal(s: SessionSnapshot): Principal {
  const account =
    db.data.demoAccounts.find((a) => a.role === s.role) ?? db.data.demoAccounts[0]

  const guardianPermsByStudent: Record<string, GuardianPermissions> = {}
  if (s.role === 'vardnadshavare') {
    db.data.relations
      .filter((r) => r.guardianUserId === account.userId)
      .forEach((r) => (guardianPermsByStudent[r.studentId] = r.permissions))
  }

  const supportSession =
    (s.role === 'superadmin' || s.role === 'it_support') && s.supportActive
      ? {
          active: true,
          modules: db.data.supportSessions.find((x) => x.status === 'aktiv')?.modules ?? [],
          schoolId: db.data.supportSessions.find((x) => x.status === 'aktiv')?.schoolId ?? null,
          expiresAt: db.data.supportSessions.find((x) => x.status === 'aktiv')?.expiresAt ?? null,
        }
      : null

  return {
    userId: account.userId,
    role: account.role,
    organizationId: account.organizationId,
    schoolIds: account.schoolIds,
    classIds: account.classIds,
    courseIds: account.courseIds,
    guardianStudentIds: account.guardianStudentIds,
    guardianPermsByStudent,
    ownStudentId: account.ownStudentId ?? null,
    validUntil: account.validUntil ?? null,
    protectedClearance: account.protectedClearance,
    supportSession,
    breakGlass: s.breakGlass,
    mfaSatisfied: s.mfaSatisfied,
    now: new Date().toISOString(),
  }
}
