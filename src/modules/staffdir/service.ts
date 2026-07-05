import { db, byId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { StaffProfile, User } from '@/data/schema'

/**
 * Tjänstelager för personalkatalogen. Auktoriserar ALLTID via
 * behörighetsmotorn innan store:t muteras och loggar varje förändring i
 * granskningsloggen. Kastar ForbiddenError som vyn fångar och visar.
 */

export interface UpdateStaffProfileInput {
  title: string
  subjects: string[]
}

function findStaff(userId: string): { user: User; profile: StaffProfile } {
  const user = byId(db.data.users, userId)
  const profile = db.data.staff.find((s) => s.userId === userId)
  if (!user || !profile) throw new Error('Personalprofilen kunde inte hittas.')
  return { user, profile }
}

/** Uppdatera titel och ämnen på en personalprofil. */
export function updateStaffProfile(
  principal: Principal,
  userId: string,
  input: UpdateStaffProfileInput,
): StaffProfile {
  const { user, profile } = findStaff(userId)

  authorize(principal, 'update', 'staff', {
    organizationId: profile.organizationId,
    schoolId: profile.schoolId ?? null,
    protectedIdentity: user.protectedIdentity,
  })

  const title = input.title.trim()
  if (!title) throw new Error('Ange en titel innan du sparar.')

  const summarize = (t: string, subjects: string[]) =>
    `${t} · ${subjects.join(', ') || 'inga ämnen'}`
  const previous = summarize(profile.title, profile.subjects)

  profile.title = title
  profile.subjects = [...input.subjects]
  profile.updatedAt = new Date().toISOString()
  profile.updatedBy = principal.userId
  profile.version += 1

  logAudit(actorFromPrincipal(principal, profile.schoolId ?? null), {
    action: 'staff.update',
    resource: 'staff',
    targetId: profile.id,
    targetLabel: `Personalprofil · ${user.name}`,
    previousValue: previous,
    newValue: summarize(profile.title, profile.subjects),
    riskLevel: 'låg',
  })

  return profile
}

/** Avaktivera eller återaktivera ett personalkonto. */
export function setStaffAccountStatus(
  principal: Principal,
  userId: string,
  status: 'aktiv' | 'inaktiv',
): User {
  const { user, profile } = findStaff(userId)

  authorize(principal, 'update', 'staff', {
    organizationId: profile.organizationId,
    schoolId: profile.schoolId ?? null,
    protectedIdentity: user.protectedIdentity,
  })

  const previous = user.status
  user.status = status
  profile.active = status === 'aktiv'
  profile.updatedAt = new Date().toISOString()
  profile.updatedBy = principal.userId
  profile.version += 1

  logAudit(actorFromPrincipal(principal, profile.schoolId ?? null), {
    action: status === 'inaktiv' ? 'staff.deactivate' : 'staff.activate',
    resource: 'staff',
    targetId: user.id,
    targetLabel: `Konto · ${user.name}`,
    previousValue: previous,
    newValue: status,
    riskLevel: status === 'inaktiv' ? 'hög' : 'medel',
  })

  return user
}
