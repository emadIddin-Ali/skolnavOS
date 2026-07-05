import type { Integration, IntegrationRun, IntegrationStatus } from '@/data/schema'
import type { Tone } from '@/ui'

/** Kategori för en integration (union från schemat). */
export type IntegrationCategory = Integration['category']

/** Statusgrupper för filtrering och sammanfattning. */
export type StatusGroup = 'alla' | 'aktiv' | 'atgard' | 'vilande'

/** Färgton per status (aldrig enbart färg – alltid text i brickan). */
export const STATUS_TONE: Record<IntegrationStatus, Tone> = {
  aktiv: 'success',
  testad: 'success',
  fel: 'danger',
  kraver_nyckel: 'warning',
  kraver_avtal: 'warning',
  kraver_konfiguration: 'warning',
  inaktiv: 'neutral',
  pausad: 'neutral',
  kommande: 'info',
}

/** Formell ikon per status. */
export const STATUS_ICON: Record<IntegrationStatus, string> = {
  aktiv: 'CheckCircle2',
  testad: 'BadgeCheck',
  fel: 'TriangleAlert',
  kraver_nyckel: 'KeyRound',
  kraver_avtal: 'ScrollText',
  kraver_konfiguration: 'Settings2',
  inaktiv: 'Power',
  pausad: 'Pause',
  kommande: 'Clock',
}

/** Ikon + svensk etikett per kategori. */
export const CATEGORY_META: Record<IntegrationCategory, { icon: string; label: string }> = {
  notis: { icon: 'Bell', label: 'Notiser' },
  pdf: { icon: 'FileText', label: 'PDF-generering' },
  signering: { icon: 'FileSignature', label: 'Signering' },
  sok: { icon: 'Search', label: 'Sök' },
  analys: { icon: 'BarChart3', label: 'Analys' },
  logg: { icon: 'ScrollText', label: 'Loggar' },
  monitor: { icon: 'Activity', label: 'Övervakning' },
  karta: { icon: 'Map', label: 'Kartor' },
  editor: { icon: 'PenLine', label: 'Redigering' },
  mote: { icon: 'Video', label: 'Möten' },
  identitet: { icon: 'Fingerprint', label: 'E-legitimation' },
  lagring: { icon: 'Database', label: 'Lagring' },
  import_export: { icon: 'ArrowLeftRight', label: 'Import & export' },
  skanning: { icon: 'ScanLine', label: 'Filskanning' },
  ki: { icon: 'Sparkles', label: 'AI-stöd' },
}

/** Ton + etikett för en körnings status. */
export const RUN_TONE: Record<IntegrationRun['status'], Tone> = {
  ok: 'success',
  fel: 'danger',
  partiell: 'warning',
  pausad: 'neutral',
}

export const RUN_LABEL: Record<IntegrationRun['status'], string> = {
  ok: 'Lyckades',
  fel: 'Fel',
  partiell: 'Delvis',
  pausad: 'Pausad',
}

/** Är integrationen i drift (levererar live)? */
export function isOperational(status: IntegrationStatus): boolean {
  return status === 'aktiv' || status === 'testad'
}

/** Kräver integrationen en åtgärd (saknad nyckel/avtal/konfiguration eller fel)? */
export function needsAction(status: IntegrationStatus): boolean {
  return status === 'fel' || status.startsWith('kraver_')
}

/** Grupp för statusfiltret. */
export function groupOf(status: IntegrationStatus): Exclude<StatusGroup, 'alla'> {
  if (isOperational(status)) return 'aktiv'
  if (needsAction(status)) return 'atgard'
  return 'vilande'
}

/** Exakt vad som saknas – native svensk setup-status. */
export function missingRequirement(i: Integration): string | null {
  switch (i.status) {
    case 'kraver_nyckel':
      return 'API-nyckel saknas'
    case 'kraver_avtal':
      return 'Avtal med leverantören saknas'
    case 'kraver_konfiguration':
      return 'Konfigurationen är ofullständig'
    case 'fel':
      return i.lastError ?? 'Ett fel har uppstått vid senaste körningen'
    default:
      return null
  }
}

/** Andel av dagskvoten som förbrukats (0 om ingen kvot). */
export function usageRatio(i: Integration): number | null {
  if (i.quotaDay == null || i.quotaDay <= 0) return null
  return Math.min(100, Math.round((i.usageDay / i.quotaDay) * 100))
}

/** Ton för användningsmätaren. */
export function usageTone(ratio: number): Tone {
  if (ratio >= 90) return 'danger'
  if (ratio >= 75) return 'warning'
  return 'primary'
}
