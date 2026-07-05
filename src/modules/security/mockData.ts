/**
 * Trovärdig demodata för aktiva sessioner, API-nycklar och webhooks. Detta är
 * säkerhetsdata som i produktion skulle komma från identitets-/nyckeltjänsten;
 * här hålls den i modulens eget tillstånd så vyn kan demonstrera rotation,
 * återkallelse och sessionsavslut utan att röra det delade store:t.
 */

export interface DeviceSession {
  id: string
  device: string
  platform: string
  ip: string
  location: string
  lastActiveAt: string
  current: boolean
  trusted: boolean
  icon: string
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  environment: 'live' | 'test'
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  status: 'aktiv' | 'aterkallad'
}

export interface WebhookEndpoint {
  id: string
  url: string
  signatureStatus: 'verifierad' | 'saknar_hemlighet' | 'fel'
  events: string[]
  lastDeliveryAt: string | null
  secretRotatedAt: string
}

function minsAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 3_600_000).toISOString()
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

const HEX = '0123456789abcdef'
function randHex(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += HEX[Math.floor(Math.random() * HEX.length)]
  return s
}

/** Ny maskerad nyckelprefix efter rotation (samma miljö, ny svans). */
export function rotatedPrefix(environment: 'live' | 'test'): string {
  return `sk_${environment}_••••${randHex(4)}`
}

export function initialSessions(): DeviceSession[] {
  return [
    {
      id: 'sess-1',
      device: 'MacBook Pro',
      platform: 'macOS 14 · Chrome',
      ip: '192.168.1.50',
      location: 'Lund, Sverige',
      lastActiveAt: minsAgo(1),
      current: true,
      trusted: true,
      icon: 'Laptop',
    },
    {
      id: 'sess-2',
      device: 'iPhone 15',
      platform: 'iOS 17 · Safari',
      ip: '192.168.1.22',
      location: 'Lund, Sverige',
      lastActiveAt: minsAgo(9),
      current: false,
      trusted: true,
      icon: 'Smartphone',
    },
    {
      id: 'sess-3',
      device: 'iPad Air',
      platform: 'iPadOS 17 · Safari',
      ip: '192.168.1.31',
      location: 'Lund, Sverige',
      lastActiveAt: hoursAgo(3),
      current: false,
      trusted: true,
      icon: 'Tablet',
    },
    {
      id: 'sess-4',
      device: 'Windows-dator',
      platform: 'Windows 11 · Edge',
      ip: '83.209.12.4',
      location: 'Malmö, Sverige',
      lastActiveAt: daysAgo(1),
      current: false,
      trusted: false,
      icon: 'Monitor',
    },
  ]
}

export function initialApiKeys(): ApiKey[] {
  return [
    {
      id: 'key-1',
      name: 'Elevregister-synk (SIS)',
      prefix: 'sk_live_••••4f2a',
      environment: 'live',
      scopes: ['läs:elever', 'skriv:närvaro'],
      createdAt: daysAgo(210),
      lastUsedAt: minsAgo(4),
      status: 'aktiv',
    },
    {
      id: 'key-2',
      name: 'Skolverket-integration',
      prefix: 'sk_live_••••9c1d',
      environment: 'live',
      scopes: ['läs:betyg', 'läs:elever'],
      createdAt: daysAgo(96),
      lastUsedAt: hoursAgo(2),
      status: 'aktiv',
    },
    {
      id: 'key-3',
      name: 'Rapportexport (BI)',
      prefix: 'sk_test_••••2b77',
      environment: 'test',
      scopes: ['läs:rapporter'],
      createdAt: daysAgo(28),
      lastUsedAt: daysAgo(1),
      status: 'aktiv',
    },
    {
      id: 'key-4',
      name: 'Äldre nyckel (under avveckling)',
      prefix: 'sk_live_••••0a3e',
      environment: 'live',
      scopes: ['läs:elever'],
      createdAt: daysAgo(412),
      lastUsedAt: daysAgo(63),
      status: 'aktiv',
    },
  ]
}

export function initialWebhooks(): WebhookEndpoint[] {
  return [
    {
      id: 'wh-1',
      url: 'https://sis.lund.se/webhooks/skolnav',
      signatureStatus: 'verifierad',
      events: ['elev.uppdaterad', 'narvaro.registrerad'],
      lastDeliveryAt: minsAgo(12),
      secretRotatedAt: daysAgo(45),
    },
    {
      id: 'wh-2',
      url: 'https://bi.lund.se/ingest/skolnav',
      signatureStatus: 'saknar_hemlighet',
      events: ['rapport.klar'],
      lastDeliveryAt: null,
      secretRotatedAt: daysAgo(0),
    },
  ]
}

/** Ålder i dagar för en ISO-tidsstämpel. */
export function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
