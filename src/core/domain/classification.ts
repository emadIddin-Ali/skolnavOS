/**
 * Dataklassificering. Nivån styr synlighet, loggning, export, gallring,
 * kryptering, sök, notiser, filåtkomst, supportåtkomst och delning till
 * integrationer.
 */
export type Classification = 1 | 2 | 3 | 4 | 5 | 6

export interface ClassificationMeta {
  level: Classification
  label: string
  short: string
  description: string
  /** Tailwind-nyckel class-1..6 */
  tone: string
  /** Får exporteras i bulk? */
  bulkExport: boolean
  /** Loggas åtkomst (läsning) särskilt? */
  logRead: boolean
  /** Får visas i push/e-post-innehåll? */
  allowInNotificationBody: boolean
  /** Får indexeras i sök? */
  searchable: boolean
  /** Standardgallring i månader (null = enligt gallringsbeslut). */
  retentionMonths: number | null
}

export const CLASSIFICATIONS: Record<Classification, ClassificationMeta> = {
  1: {
    level: 1,
    label: 'Publik data',
    short: 'Publik',
    description: 'Öppen information utan skyddsbehov.',
    tone: 'class-1',
    bulkExport: true,
    logRead: false,
    allowInNotificationBody: true,
    searchable: true,
    retentionMonths: null,
  },
  2: {
    level: 2,
    label: 'Intern skoldata',
    short: 'Intern',
    description: 'Intern verksamhetsdata utan personuppgifter.',
    tone: 'class-2',
    bulkExport: true,
    logRead: false,
    allowInNotificationBody: true,
    searchable: true,
    retentionMonths: null,
  },
  3: {
    level: 3,
    label: 'Personuppgifter',
    short: 'Personuppgift',
    description: 'Identifierbara personuppgifter enligt GDPR.',
    tone: 'class-3',
    bulkExport: true,
    logRead: false,
    allowInNotificationBody: false,
    searchable: true,
    retentionMonths: 36,
  },
  4: {
    level: 4,
    label: 'Känslig/skyddsvärd skoldata',
    short: 'Känslig',
    description: 'Elevhälsa, åtgärder, incidenter och liknande skyddsvärd data.',
    tone: 'class-4',
    bulkExport: false,
    logRead: true,
    allowInNotificationBody: false,
    searchable: true,
    retentionMonths: 60,
  },
  5: {
    level: 5,
    label: 'Särskilt skyddad data',
    short: 'Särskilt skyddad',
    description: 'Skyddad identitet och särskilt integritetskänsliga uppgifter.',
    tone: 'class-5',
    bulkExport: false,
    logRead: true,
    allowInNotificationBody: false,
    searchable: false,
    retentionMonths: 60,
  },
  6: {
    level: 6,
    label: 'Säkerhetsdata',
    short: 'Säkerhet',
    description: 'Nycklar, loggar och säkerhetshändelser.',
    tone: 'class-6',
    bulkExport: false,
    logRead: true,
    allowInNotificationBody: false,
    searchable: false,
    retentionMonths: 24,
  },
}

export function classificationMeta(level: Classification): ClassificationMeta {
  return CLASSIFICATIONS[level]
}
