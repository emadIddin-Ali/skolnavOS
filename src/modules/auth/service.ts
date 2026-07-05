import { db } from '@/data/db/store'
import { logAudit } from '@/core/audit/audit'
import { checkRateLimit } from '@/core/rate-limit/rateLimit'
import { ROLES, type RoleKey } from '@/core/domain/roles'

/**
 * Autentiseringstjänst (demo). Före inloggning finns ingen principal – därför
 * loggas endast lyckade inloggningar (med den identitet som just etablerats).
 * Misslyckade försök räknas mot brute force-skyddet men avslöjar aldrig om
 * ett konto finns.
 */

const ORG_ID = 'org-lund'
const LOGIN_SCOPE = 'ip:demo'

export const LOCKOUT_MESSAGE = 'För många försök. Vänta en stund och försök igen.'

/** Enkel men rimlig e-postkontroll för formulärvalidering. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Simulerad nätverkslatens för autentiseringsanrop. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type LoginMethod = 'losenord' | 'demokonto'

export type LoginAttemptResult =
  | { ok: true; role: RoleKey }
  | { ok: false; lockedOut: boolean; error: string; remaining: number }

/**
 * Prövar e-post + lösenord. Varje anrop registreras mot brute force-skyddet
 * (5 försök per 15 min). Lösenordet 'fel123' demonstrerar felaktiga uppgifter.
 */
export function attemptEmailLogin(email: string, password: string): LoginAttemptResult {
  const rl = checkRateLimit('login', LOGIN_SCOPE, ORG_ID)
  if (!rl.allowed) {
    return { ok: false, lockedOut: true, error: LOCKOUT_MESSAGE, remaining: 0 }
  }
  if (password === 'fel123') {
    return { ok: false, lockedOut: false, error: 'Fel e-post eller lösenord.', remaining: rl.remaining }
  }
  const value = email.trim().toLowerCase()
  const role: RoleKey = value.includes('elev')
    ? 'elev_grund'
    : value.includes('gmail')
      ? 'vardnadshavare'
      : 'rektor'
  return { ok: true, role }
}

/** Kontrollerar spärrläget utan att registrera ett nytt försök. */
export function isLoginBlocked(): boolean {
  return !checkRateLimit('login', LOGIN_SCOPE, ORG_ID, { record: false }).allowed
}

/** Granskningslogg efter lyckad inloggning – identiteten är nu etablerad. */
export function auditLogin(role: RoleKey, method: LoginMethod, mfaUsed: boolean): void {
  const account = db.data.demoAccounts.find((a) => a.role === role)
  logAudit(
    {
      userId: account?.userId ?? null,
      role,
      organizationId: account?.organizationId ?? ORG_ID,
      schoolId: account?.schoolIds[0] ?? null,
      ip: '192.168.1.50',
      sessionId: account ? `sess-${account.userId}` : null,
      device: typeof navigator !== 'undefined' && /Mobi/i.test(navigator.userAgent) ? 'Mobil webbläsare' : 'Webbläsare',
    },
    {
      action: 'auth.login',
      resource: 'session',
      targetLabel: ROLES[role].label,
      newValue: method === 'losenord' ? 'E-post och lösenord' : 'Demokonto',
      reason: mfaUsed ? 'Stark autentisering (MFA) genomförd' : null,
      riskLevel: 'låg',
    },
  )
}

/** Verifierar engångskod (demo: 123456). */
export function verifyMfaCode(code: string): boolean {
  return code === '123456'
}

export interface LinkRequestResult {
  ok: boolean
  message: string
}

/** Återställningslänk – bekräftar aldrig om adressen finns registrerad. */
export function requestPasswordReset(): LinkRequestResult {
  const rl = checkRateLimit('password_reset', LOGIN_SCOPE, ORG_ID)
  if (!rl.allowed) {
    return { ok: false, message: rl.message ?? 'För många förfrågningar. Vänta en stund och försök igen.' }
  }
  return { ok: true, message: 'Om kontot finns skickas en länk inom kort.' }
}

/** Magisk inloggningslänk – bekräftar aldrig om adressen finns registrerad. */
export function requestMagicLink(): LinkRequestResult {
  const rl = checkRateLimit('invitation', LOGIN_SCOPE, ORG_ID)
  if (!rl.allowed) {
    return { ok: false, message: rl.message ?? 'För många förfrågningar. Vänta en stund och försök igen.' }
  }
  return { ok: true, message: 'Länk skickad om kontot finns.' }
}
