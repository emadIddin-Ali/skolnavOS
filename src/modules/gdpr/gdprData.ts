import type { GdprRequest, SupportSession } from '@/data/schema'
import type { Classification } from '@/core/domain/classification'
import type { Tone } from '@/ui'

/**
 * Presentations- och referensdata för GDPR-centret. Ingen mutation – bara
 * etiketter, statusflöde och ett behandlingsregister (RoPA) som visas native.
 */

export type GdprType = GdprRequest['type']
export type GdprStatus = GdprRequest['status']

// ---- Typ av begäran (den registrerades rättigheter) ----
export const GDPR_TYPE_LABEL: Record<GdprType, string> = {
  registerutdrag: 'Registerutdrag',
  radering: 'Radering',
  rättelse: 'Rättelse',
  begränsning: 'Begränsning',
  dataportabilitet: 'Dataportabilitet',
}

export const GDPR_TYPE_META: Record<GdprType, { tone: Tone; icon: string; article: string; desc: string }> = {
  registerutdrag: { tone: 'info', icon: 'FileText', article: 'Art. 15', desc: 'Rätt till tillgång – ett utdrag över vilka uppgifter som behandlas.' },
  radering: { tone: 'danger', icon: 'Trash2', article: 'Art. 17', desc: 'Rätt till radering – «rätten att bli bortglömd».' },
  rättelse: { tone: 'warning', icon: 'PencilLine', article: 'Art. 16', desc: 'Rätt till rättelse av felaktiga eller ofullständiga uppgifter.' },
  begränsning: { tone: 'warning', icon: 'CircleSlash', article: 'Art. 18', desc: 'Rätt till begränsning av behandlingen.' },
  dataportabilitet: { tone: 'primary', icon: 'FileOutput', article: 'Art. 20', desc: 'Rätt att få ut och överföra sina uppgifter.' },
}

// ---- Status i handläggningsflödet ----
export const GDPR_STATUS_LABEL: Record<GdprStatus, string> = {
  mottagen: 'Mottagen',
  under_granskning: 'Under granskning',
  kraver_verifiering: 'Kräver verifiering',
  godkand: 'Godkänd',
  avslagen: 'Avslagen',
  fardigstalld: 'Färdigställd',
  arkiverad: 'Arkiverad',
}

export const GDPR_STATUS_META: Record<GdprStatus, { tone: Tone; icon: string }> = {
  mottagen: { tone: 'info', icon: 'Inbox' },
  under_granskning: { tone: 'primary', icon: 'Search' },
  kraver_verifiering: { tone: 'warning', icon: 'Fingerprint' },
  godkand: { tone: 'success', icon: 'CircleCheck' },
  avslagen: { tone: 'danger', icon: 'CircleX' },
  fardigstalld: { tone: 'success', icon: 'CheckCheck' },
  arkiverad: { tone: 'neutral', icon: 'Archive' },
}

/** Vilka statusar en handläggare får flytta en begäran till härnäst. */
export const GDPR_NEXT_STATUS: Record<GdprStatus, GdprStatus[]> = {
  mottagen: ['under_granskning', 'avslagen'],
  under_granskning: ['kraver_verifiering', 'godkand', 'avslagen'],
  kraver_verifiering: ['godkand', 'avslagen'],
  godkand: ['fardigstalld'],
  fardigstalld: ['arkiverad'],
  avslagen: ['arkiverad'],
  arkiverad: [],
}

/** Linjärt happy-path-flöde för stegindikatorn. */
export const GDPR_FLOW: { key: GdprStatus; label: string }[] = [
  { key: 'mottagen', label: 'Mottagen' },
  { key: 'under_granskning', label: 'Granskning' },
  { key: 'kraver_verifiering', label: 'Verifiering' },
  { key: 'godkand', label: 'Godkänd' },
  { key: 'fardigstalld', label: 'Färdigställd' },
  { key: 'arkiverad', label: 'Arkiverad' },
]

/** Statusar där en begäran fortfarande är öppen och kräver handläggning. */
export const OPEN_STATUSES: GdprStatus[] = ['mottagen', 'under_granskning', 'kraver_verifiering', 'godkand']

export function isOpenStatus(status: GdprStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

// ---- Supportsessioner (åtkomstlogg) ----
export const SUPPORT_STATUS_LABEL: Record<SupportSession['status'], string> = {
  begärd: 'Begärd',
  aktiv: 'Aktiv',
  avslutad: 'Avslutad',
  nekad: 'Nekad',
}

export const SUPPORT_STATUS_META: Record<SupportSession['status'], { tone: Tone; icon: string }> = {
  begärd: { tone: 'warning', icon: 'Clock' },
  aktiv: { tone: 'success', icon: 'ShieldCheck' },
  avslutad: { tone: 'neutral', icon: 'CircleCheck' },
  nekad: { tone: 'danger', icon: 'CircleX' },
}

// ---- Behandlingsregister (Art. 30 – register över behandlingar) ----
export interface ProcessingRecord {
  id: string
  category: string
  legalBasis: string
  purpose: string
  retention: string
  classification: Classification
}

export const PROCESSING_REGISTER: ProcessingRecord[] = [
  {
    id: 'pr-elevadmin',
    category: 'Elev- och barnuppgifter',
    legalBasis: 'Rättslig förpliktelse (skollagen) · Myndighetsutövning',
    purpose: 'Elevadministration, inskrivning, placering och betyg.',
    retention: 'Gallras 3 år efter avslutad skolgång',
    classification: 3,
  },
  {
    id: 'pr-vardnad',
    category: 'Vårdnadshavare & kontaktuppgifter',
    legalBasis: 'Rättslig förpliktelse · Avtal',
    purpose: 'Kommunikation, frånvaro, hämtning och samtycken.',
    retention: 'Gallras 3 år efter avslutad relation',
    classification: 3,
  },
  {
    id: 'pr-narvaro',
    category: 'Närvaro & frånvaro',
    legalBasis: 'Rättslig förpliktelse (skollagen)',
    purpose: 'Uppföljning av skolplikt och frånvarorapportering.',
    retention: 'Gallras efter läsårets slut + 36 månader',
    classification: 3,
  },
  {
    id: 'pr-halsa',
    category: 'Elevhälsa & specialkost',
    legalBasis: 'Allmänt intresse · Samtycke (art. 9 – känsliga uppgifter)',
    purpose: 'Trygg skolmiljö, medicinska åtgärder och anpassad kost.',
    retention: 'Gallras 5 år (elevhälsojournal enligt patientdatalag)',
    classification: 4,
  },
  {
    id: 'pr-incident',
    category: 'Incidenter & åtgärdsprogram',
    legalBasis: 'Rättslig förpliktelse · Allmänt intresse',
    purpose: 'Dokumentation av tillbud, kränkningar och stödinsatser.',
    retention: 'Gallras 5 år efter avslutat ärende',
    classification: 4,
  },
  {
    id: 'pr-skyddad',
    category: 'Skyddad identitet',
    legalBasis: 'Rättslig förpliktelse · Skydd av grundläggande intressen',
    purpose: 'Hantering av elever med skyddade personuppgifter.',
    retention: 'Gallras enligt särskilt gallringsbeslut',
    classification: 5,
  },
  {
    id: 'pr-logg',
    category: 'Åtkomst- & säkerhetsloggar',
    legalBasis: 'Rättslig förpliktelse · Berättigat intresse',
    purpose: 'Spårbarhet, säkerhetsövervakning och GDPR-ansvar.',
    retention: 'Gallras efter 24 månader',
    classification: 6,
  },
  {
    id: 'pr-larresurs',
    category: 'Digitala lärresurser',
    legalBasis: 'Allmänt intresse · Samtycke',
    purpose: 'Konton och behandling i lärverktyg och lärplattform.',
    retention: 'Gallras vid avslutat läsår',
    classification: 2,
  },
]
