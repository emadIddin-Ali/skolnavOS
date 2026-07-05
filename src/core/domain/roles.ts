/**
 * Roller i Skolnav OS.
 * Varje roll har ett eget dashboard, egen navigation och egna behörigheter.
 * `category` styr gruppering i UI. `defaultMode` styr vilket globalt läge som
 * väljs när rollen aktiveras. `scopeKind` beskriver rollens naturliga räckvidd.
 */

export type RoleKey =
  | 'superadmin'
  | 'huvudman'
  | 'rektor'
  | 'bitr_rektor'
  | 'skoladmin'
  | 'larare'
  | 'mentor'
  | 'pedagog'
  | 'vikarie'
  | 'elev_grund'
  | 'elev_gy'
  | 'vardnadshavare'
  | 'specialpedagog'
  | 'kurator'
  | 'skolskoterska'
  | 'syv'
  | 'koksansvarig'
  | 'it_support'
  | 'granskare'
  | 'integration_bot'

export type RoleCategory =
  | 'system'
  | 'organisation'
  | 'skolledning'
  | 'personal'
  | 'elevhalsa'
  | 'elev'
  | 'vardnadshavare'

export type AppMode = 'grundskola' | 'gymnasium' | 'admin'

export type ScopeKind =
  | 'plattform'
  | 'organisation'
  | 'skola'
  | 'klass'
  | 'kurs'
  | 'elev'
  | 'egen'
  | 'relation'

export interface RoleMeta {
  key: RoleKey
  label: string
  short: string
  category: RoleCategory
  /** Lucide-ikonnamn (formell SVG). */
  icon: string
  defaultMode: AppMode
  scopeKind: ScopeKind
  description: string
  /** Kräver stark autentisering (MFA) för administrativa åtgärder. */
  requiresMfa: boolean
  /** Är detta en icke-mänsklig aktör (API/integration)? */
  machine?: boolean
}

export const ROLES: Record<RoleKey, RoleMeta> = {
  superadmin: {
    key: 'superadmin',
    label: 'Superadmin',
    short: 'Superadmin',
    category: 'system',
    icon: 'ShieldAlert',
    defaultMode: 'admin',
    scopeKind: 'plattform',
    description: 'Plattformsansvar, systemhälsa, tenant-hantering och supportåtkomst.',
    requiresMfa: true,
  },
  huvudman: {
    key: 'huvudman',
    label: 'Huvudman',
    short: 'Huvudman',
    category: 'organisation',
    icon: 'Building2',
    defaultMode: 'admin',
    scopeKind: 'organisation',
    description: 'Organisationsadministration, skolor, licenser och efterlevnad.',
    requiresMfa: true,
  },
  rektor: {
    key: 'rektor',
    label: 'Rektor',
    short: 'Rektor',
    category: 'skolledning',
    icon: 'GraduationCap',
    defaultMode: 'admin',
    scopeKind: 'skola',
    description: 'Verksamhetsansvar för skolan: personal, elever, rapporter och beslut.',
    requiresMfa: true,
  },
  bitr_rektor: {
    key: 'bitr_rektor',
    label: 'Biträdande rektor',
    short: 'Bitr. rektor',
    category: 'skolledning',
    icon: 'UserCog',
    defaultMode: 'admin',
    scopeKind: 'skola',
    description: 'Stödjer rektor i daglig ledning, schema och uppföljning.',
    requiresMfa: true,
  },
  skoladmin: {
    key: 'skoladmin',
    label: 'Skoladministratör',
    short: 'Administratör',
    category: 'skolledning',
    icon: 'ClipboardList',
    defaultMode: 'admin',
    scopeKind: 'skola',
    description: 'Register, inskrivningar, vårdnadshavare, dokument och import/export.',
    requiresMfa: false,
  },
  larare: {
    key: 'larare',
    label: 'Lärare',
    short: 'Lärare',
    category: 'personal',
    icon: 'BookOpen',
    defaultMode: 'grundskola',
    scopeKind: 'klass',
    description: 'Undervisning, närvaro, uppgifter, bedömning och kommunikation.',
    requiresMfa: false,
  },
  mentor: {
    key: 'mentor',
    label: 'Mentor',
    short: 'Mentor',
    category: 'personal',
    icon: 'Users',
    defaultMode: 'grundskola',
    scopeKind: 'klass',
    description: 'Mentorskap för klass/grupp, helhetsbild, frånvaro och kontakt.',
    requiresMfa: false,
  },
  pedagog: {
    key: 'pedagog',
    label: 'Pedagog',
    short: 'Pedagog',
    category: 'personal',
    icon: 'Blocks',
    defaultMode: 'grundskola',
    scopeKind: 'klass',
    description: 'Förskola/fritids: dokumentation, närvaro, hämtning och samtycken.',
    requiresMfa: false,
  },
  vikarie: {
    key: 'vikarie',
    label: 'Vikarie',
    short: 'Vikarie',
    category: 'personal',
    icon: 'UserPlus',
    defaultMode: 'grundskola',
    scopeKind: 'klass',
    description: 'Tillfällig behörighet med tidsgräns för utsedda grupper.',
    requiresMfa: false,
  },
  elev_grund: {
    key: 'elev_grund',
    label: 'Elev (Årskurs 1–9)',
    short: 'Elev',
    category: 'elev',
    icon: 'Backpack',
    defaultMode: 'grundskola',
    scopeKind: 'egen',
    description: 'Schema, uppgifter, meddelanden och dokument – enkelt och tydligt.',
    requiresMfa: false,
  },
  elev_gy: {
    key: 'elev_gy',
    label: 'Elev (Gymnasium/Vux)',
    short: 'Elev',
    category: 'elev',
    icon: 'Library',
    defaultMode: 'gymnasium',
    scopeKind: 'egen',
    description: 'Kurser, deadlines, resultat, studieplan och närvaro.',
    requiresMfa: false,
  },
  vardnadshavare: {
    key: 'vardnadshavare',
    label: 'Vårdnadshavare',
    short: 'Vårdnadshavare',
    category: 'vardnadshavare',
    icon: 'Heart',
    defaultMode: 'grundskola',
    scopeKind: 'relation',
    description: 'Anmäl frånvaro, se schema, kommunicera och signera samtycken.',
    requiresMfa: false,
  },
  specialpedagog: {
    key: 'specialpedagog',
    label: 'Specialpedagog',
    short: 'Specialpedagog',
    category: 'elevhalsa',
    icon: 'HandHeart',
    defaultMode: 'admin',
    scopeKind: 'elev',
    description: 'Särskilt stöd, åtgärder och känslig dokumentation med strikt åtkomst.',
    requiresMfa: true,
  },
  kurator: {
    key: 'kurator',
    label: 'Kurator',
    short: 'Kurator',
    category: 'elevhalsa',
    icon: 'MessagesSquare',
    defaultMode: 'admin',
    scopeKind: 'elev',
    description: 'Elevhälsosamtal, ärenden och skyddsvärd dokumentation.',
    requiresMfa: true,
  },
  skolskoterska: {
    key: 'skolskoterska',
    label: 'Skolsköterska',
    short: 'Skolsköterska',
    category: 'elevhalsa',
    icon: 'Stethoscope',
    defaultMode: 'admin',
    scopeKind: 'elev',
    description: 'Hälsobesök, allergier, medicinsk info och skyddad journalåtkomst.',
    requiresMfa: true,
  },
  syv: {
    key: 'syv',
    label: 'Studie- och yrkesvägledare',
    short: 'SYV',
    category: 'personal',
    icon: 'Compass',
    defaultMode: 'gymnasium',
    scopeKind: 'skola',
    description: 'Vägledning, studieplaner och uppföljning inför nästa steg.',
    requiresMfa: false,
  },
  koksansvarig: {
    key: 'koksansvarig',
    label: 'Köksansvarig',
    short: 'Kök',
    category: 'personal',
    icon: 'UtensilsCrossed',
    defaultMode: 'admin',
    scopeKind: 'skola',
    description: 'Måltider, specialkost och allergihantering – utan känsliga persondata.',
    requiresMfa: false,
  },
  it_support: {
    key: 'it_support',
    label: 'IT-support',
    short: 'IT-support',
    category: 'system',
    icon: 'LifeBuoy',
    defaultMode: 'admin',
    scopeKind: 'skola',
    description: 'Konton, enheter, integrationer och kontrollerad supportåtkomst.',
    requiresMfa: true,
  },
  granskare: {
    key: 'granskare',
    label: 'Extern granskare',
    short: 'Granskare',
    category: 'system',
    icon: 'ScanEye',
    defaultMode: 'admin',
    scopeKind: 'organisation',
    description: 'Endast läsbehörighet för revision – ingen redigering eller export av persondata.',
    requiresMfa: true,
  },
  integration_bot: {
    key: 'integration_bot',
    label: 'Integration / API-klient',
    short: 'API-klient',
    category: 'system',
    icon: 'Bot',
    defaultMode: 'admin',
    scopeKind: 'organisation',
    description: 'Maskinkonto med nyckel, kvoter och strikt spårning av all trafik.',
    requiresMfa: false,
    machine: true,
  },
}

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[]

export const ROLE_CATEGORY_LABEL: Record<RoleCategory, string> = {
  system: 'System & plattform',
  organisation: 'Organisation',
  skolledning: 'Skolledning',
  personal: 'Personal',
  elevhalsa: 'Elevhälsa',
  elev: 'Elever',
  vardnadshavare: 'Vårdnadshavare',
}

export function roleMeta(key: RoleKey): RoleMeta {
  return ROLES[key]
}
