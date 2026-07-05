import { authorize, type Principal, type Target } from '@/core/permissions/engine'
import { actorFromPrincipal, logAudit } from '@/core/audit/audit'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, nextId } from '@/data/db/store'
import type { User } from '@/data/schema'

/**
 * Tjänstelager för Min profil: kontaktuppgifter, lösenordsbyte och enhets-
 * sessioner. Auktoriseras alltid mot "egen"-scope innan något muteras.
 */

function ownTarget(principal: Principal): Target {
  return { organizationId: principal.organizationId, ownerUserId: principal.userId }
}

/** Simulerad nätverkslatens för realistiska spartillstånd. */
export function wait(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Kontaktuppgifter
// ---------------------------------------------------------------------------

export interface ContactInput {
  email: string
  phone: string
}

export function updateContact(principal: Principal, input: ContactInput): User {
  authorize(principal, 'update', 'settings', ownTarget(principal))
  const user = db.data.users.find((u) => u.id === principal.userId)
  if (!user) throw new Error('Användaren kunde inte hittas.')
  const before = `${user.email}${user.phone ? ` · ${user.phone}` : ''}`
  user.email = input.email.trim()
  user.phone = input.phone.trim() || undefined
  const after = `${user.email}${user.phone ? ` · ${user.phone}` : ''}`
  logAudit(actorFromPrincipal(principal), {
    action: 'profile.update',
    resource: 'settings',
    targetId: user.id,
    targetLabel: 'Kontaktuppgifter',
    previousValue: before,
    newValue: after,
  })
  return user
}

// ---------------------------------------------------------------------------
// Lösenordsbyte (simulerat – lösenord lämnar aldrig klienten)
// ---------------------------------------------------------------------------

export function changePassword(principal: Principal): void {
  const rl = checkRateLimit('password_reset', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)
  authorize(principal, 'update', 'settings', ownTarget(principal))
  logAudit(actorFromPrincipal(principal), {
    action: 'password.change',
    resource: 'settings',
    targetId: principal.userId,
    targetLabel: 'Lösenordsbyte',
    riskLevel: 'medel',
  })
}

// ---------------------------------------------------------------------------
// Enhetssessioner (simulerade per användare, lever under demosessionen)
// ---------------------------------------------------------------------------

export interface DeviceSession {
  id: string
  device: string
  icon: string
  location: string
  lastActiveAt: string
  current: boolean
}

const sessionsByUser = new Map<string, DeviceSession[]>()

function currentDeviceLabel(): { device: string; icon: string } {
  if (typeof navigator === 'undefined') return { device: 'Den här enheten', icon: 'Monitor' }
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return { device: 'Safari på iPad', icon: 'Tablet' }
  if (/iPhone/.test(ua)) return { device: 'Safari på iPhone', icon: 'Smartphone' }
  if (/Android/.test(ua)) return { device: 'Chrome på Android', icon: 'Smartphone' }
  if (/Edg/.test(ua)) return { device: 'Edge på Windows', icon: 'Monitor' }
  if (/Firefox/.test(ua)) return { device: 'Firefox', icon: 'Monitor' }
  if (/Macintosh/.test(ua)) return { device: 'Safari på Mac', icon: 'Laptop' }
  return { device: 'Chrome på Windows', icon: 'Monitor' }
}

export function listSessions(userId: string): DeviceSession[] {
  let list = sessionsByUser.get(userId)
  if (!list) {
    const now = Date.now()
    const device = currentDeviceLabel()
    list = [
      {
        id: nextId('sess'),
        ...device,
        location: 'Lund, Sverige',
        lastActiveAt: new Date(now).toISOString(),
        current: true,
      },
      {
        id: nextId('sess'),
        device: 'Skolnav-appen på iPhone',
        icon: 'Smartphone',
        location: 'Lund, Sverige',
        lastActiveAt: new Date(now - 3 * 3_600_000).toISOString(),
        current: false,
      },
      {
        id: nextId('sess'),
        device: 'Chrome på Windows',
        icon: 'Monitor',
        location: 'Malmö, Sverige',
        lastActiveAt: new Date(now - 4 * 86_400_000).toISOString(),
        current: false,
      },
    ]
    sessionsByUser.set(userId, list)
  }
  return list
}

export function endSession(principal: Principal, sessionId: string): DeviceSession {
  authorize(principal, 'update', 'settings', ownTarget(principal))
  const list = sessionsByUser.get(principal.userId) ?? []
  const found = list.find((s) => s.id === sessionId)
  if (!found) throw new Error('Sessionen kunde inte hittas.')
  if (found.current) throw new Error('Den aktiva sessionen avslutas genom att logga ut.')
  sessionsByUser.set(
    principal.userId,
    list.filter((s) => s.id !== sessionId),
  )
  logAudit(actorFromPrincipal(principal), {
    action: 'session.terminate',
    resource: 'settings',
    targetId: sessionId,
    targetLabel: found.device,
    riskLevel: 'medel',
  })
  return found
}
