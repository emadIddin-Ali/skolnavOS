import type { Tone } from '@/ui'
import type { SecurityEvent, RateLimitState } from '@/data/schema'

/**
 * Presentationskartor för Säkerhetscentret: etiketter, formella ikoner och
 * färgtoner. Håller själva UI:t (SecurityPage) och tjänstelagret (service)
 * konsekventa utan att duplicera texter.
 */

export type RiskLevel = SecurityEvent['riskLevel']
export type SecurityEventType = SecurityEvent['type']

export const RISK_META: Record<RiskLevel, { tone: Tone; label: string; icon: string }> = {
  låg: { tone: 'info', label: 'Låg', icon: 'Info' },
  medel: { tone: 'warning', label: 'Medel', icon: 'TriangleAlert' },
  hög: { tone: 'danger', label: 'Hög', icon: 'ShieldAlert' },
  kritisk: { tone: 'danger', label: 'Kritisk', icon: 'Siren' },
}

export const SECURITY_EVENT_META: Record<SecurityEventType, { label: string; icon: string }> = {
  login_success: { label: 'Lyckad inloggning', icon: 'LogIn' },
  login_fail: { label: 'Misslyckad inloggning', icon: 'ShieldX' },
  new_device: { label: 'Ny enhet', icon: 'Smartphone' },
  suspicious: { label: 'Misstänkt aktivitet', icon: 'ShieldAlert' },
  rate_limit: { label: 'Gräns nådd', icon: 'Gauge' },
  permission_change: { label: 'Behörighetsändring', icon: 'KeyRound' },
  role_change: { label: 'Rolländring', icon: 'UserCog' },
  export: { label: 'Dataexport', icon: 'Download' },
  mfa_change: { label: 'MFA-ändring', icon: 'ShieldCheck' },
  key_rotation: { label: 'Nyckelrotation', icon: 'RefreshCw' },
  account_lock: { label: 'Konto låst', icon: 'Lock' },
}

export const RATE_STATE_TONE: Record<RateLimitState, Tone> = {
  normal: 'success',
  narmar_grans: 'warning',
  begransad: 'warning',
  blockerad: 'danger',
  kraver_verifiering: 'warning',
  eskalerad: 'danger',
}

/** Radåtgärder på en säkerhetshändelse. Alla auktoriseras mot 'update','security'. */
export type EventActionKind = 'granska' | 'incident' | 'verifiering' | 'blockera' | 'atgardad'

export interface EventActionMeta {
  label: string
  icon: string
  /** Åtgärdsnamn i granskningsloggen. */
  auditAction: string
  risk: RiskLevel
  /** Markerar händelsen som åtgärdad (resolved). */
  resolves: boolean
  danger?: boolean
  /** Bekräftelsetext efter genomförd åtgärd. */
  done: string
}

export const EVENT_ACTION_META: Record<EventActionKind, EventActionMeta> = {
  granska: {
    label: 'Granska',
    icon: 'ScanEye',
    auditAction: 'security.review',
    risk: 'medel',
    resolves: false,
    done: 'Händelsen granskad och loggad.',
  },
  incident: {
    label: 'Skapa incident',
    icon: 'ShieldAlert',
    auditAction: 'security.incident',
    risk: 'hög',
    resolves: true,
    done: 'Incident skapad och händelsen markerad som åtgärdad.',
  },
  verifiering: {
    label: 'Kräv verifiering',
    icon: 'ShieldCheck',
    auditAction: 'security.require_verification',
    risk: 'hög',
    resolves: true,
    done: 'Ny verifiering krävs vid nästa inloggning.',
  },
  blockera: {
    label: 'Blockera användare',
    icon: 'UserX',
    auditAction: 'security.block_user',
    risk: 'kritisk',
    resolves: true,
    danger: true,
    done: 'Användaren blockerad och kontot låst.',
  },
  atgardad: {
    label: 'Markera åtgärdad',
    icon: 'CheckCircle2',
    auditAction: 'security.review',
    risk: 'hög',
    resolves: true,
    done: 'Händelsen markerad som åtgärdad.',
  },
}

export const EVENT_ACTION_ORDER: EventActionKind[] = [
  'granska',
  'incident',
  'verifiering',
  'blockera',
  'atgardad',
]
