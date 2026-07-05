import { authorize, can, type Principal } from '@/core/permissions/engine'
import { actorFromPrincipal, logAudit } from '@/core/audit/audit'
import { db } from '@/data/db/store'
import type { FeatureFlag, NotificationChannel, NotificationPreference } from '@/data/schema'
import { CATEGORY_ORDER, type NotificationCategory } from '@/modules/notifications/meta'

/**
 * Tjänstelager för inställningar: notispreferenser (upsert per kategori),
 * MFA-loggning och skolans funktionsflaggor. Alla mutationer auktoriseras
 * innan db.data rörs.
 */

/** Kanaler som kan väljas per kategori. */
export const PREF_CHANNELS: NotificationChannel[] = ['app', 'push', 'epost', 'digest']

export type ChannelSelection = Record<NotificationCategory, NotificationChannel[]>

export interface PreferenceDraft {
  channels: ChannelSelection
  quietStart: string | null
  quietEnd: string | null
}

/** Simulerad nätverkslatens för realistiska spartillstånd. */
export function wait(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Seedet saknar preferens-tabellen – den skapas vid första användningen. */
interface PrefsCarrier {
  notificationPreferences?: NotificationPreference[]
}

function prefTable(): NotificationPreference[] {
  const data = db.data as typeof db.data & PrefsCarrier
  if (!data.notificationPreferences) data.notificationPreferences = []
  return data.notificationPreferences
}

const DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel[]> = {
  franvaro: ['app', 'push'],
  meddelande: ['app', 'push'],
  samtycke: ['app', 'epost'],
  schema: ['app'],
  sakerhet: ['app', 'push', 'epost'],
  system: ['app'],
  rapport: ['app', 'digest'],
}

/** Läser sparade preferenser för användaren, med rimliga standardval. */
export function getPreferenceDraft(userId: string): PreferenceDraft {
  const rows = prefTable().filter((p) => p.userId === userId)
  const channels = {} as ChannelSelection
  for (const cat of CATEGORY_ORDER) {
    const row = rows.find((r) => r.category === cat)
    channels[cat] = row
      ? row.channels.filter((c) => PREF_CHANNELS.includes(c))
      : [...DEFAULT_CHANNELS[cat]]
  }
  const withQuiet = rows.find((r) => r.quietHoursStart)
  return {
    channels,
    quietStart: withQuiet?.quietHoursStart ?? null,
    quietEnd: withQuiet?.quietHoursEnd ?? null,
  }
}

/** Sparar preferenser: upsert per kategori i db.data.notificationPreferences. */
export function savePreferences(principal: Principal, draft: PreferenceDraft): void {
  authorize(principal, 'update', 'settings', {
    organizationId: principal.organizationId,
    ownerUserId: principal.userId,
  })
  const table = prefTable()
  for (const cat of CATEGORY_ORDER) {
    const channels = [...draft.channels[cat]]
    const existing = table.find((p) => p.userId === principal.userId && p.category === cat)
    if (existing) {
      existing.channels = channels
      existing.digest = channels.includes('digest')
      existing.quietHoursStart = draft.quietStart
      existing.quietHoursEnd = draft.quietEnd
    } else {
      table.push({
        userId: principal.userId,
        category: cat,
        channels,
        digest: channels.includes('digest'),
        quietHoursStart: draft.quietStart,
        quietHoursEnd: draft.quietEnd,
      })
    }
  }
  logAudit(actorFromPrincipal(principal), {
    action: 'settings.notifications.update',
    resource: 'settings',
    targetLabel: 'Notisinställningar',
  })
}

/** Loggar MFA-växling för sessionen (själva växlingen sker i sessionen). */
export function recordMfaChange(principal: Principal, satisfied: boolean): void {
  authorize(principal, 'update', 'settings', {
    organizationId: principal.organizationId,
    ownerUserId: principal.userId,
  })
  logAudit(actorFromPrincipal(principal), {
    action: satisfied ? 'settings.mfa.verify' : 'settings.mfa.reset',
    resource: 'settings',
    targetLabel: 'Tvåfaktorsautentisering (session)',
    riskLevel: satisfied ? 'låg' : 'medel',
  })
}

/** Får principalen hantera skolövergripande inställningar? */
export function canManageSchoolSettings(principal: Principal, schoolId: string): boolean {
  if (can(principal, 'admin', 'settings', { schoolId }).allowed) return true
  return can(principal, 'update', 'school', {
    organizationId: principal.organizationId,
    schoolId,
  }).allowed
}

/** Slår av/på en funktionsflagga för skolan (t.ex. svep-närvaro). */
export function toggleFeatureFlag(principal: Principal, key: string, schoolId: string): FeatureFlag {
  if (!can(principal, 'admin', 'settings', { schoolId }).allowed) {
    authorize(principal, 'update', 'school', {
      organizationId: principal.organizationId,
      schoolId,
    })
  }
  const flag = db.data.featureFlags.find((f) => f.key === key)
  if (!flag) throw new Error('Funktionen kunde inte hittas.')
  const previous = flag.enabled
  flag.enabled = !flag.enabled
  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'settings.feature_flag.toggle',
    resource: 'settings',
    targetId: flag.key,
    targetLabel: flag.label,
    previousValue: previous ? 'på' : 'av',
    newValue: flag.enabled ? 'på' : 'av',
    riskLevel: 'medel',
  })
  return flag
}
