import { db, nextId } from '@/data/db/store'
import type { ImportJob } from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'

/**
 * Tjänstelager för importer. Auktoriserar via behörighetsmotorn, validerar
 * CSV-filer mot förväntade kolumnrubriker och håller felrader per jobb så att
 * en felrapport kan laddas ned.
 */

// ---------------------------------------------------------------------------
// Importtyper med förväntade kolumnrubriker
// ---------------------------------------------------------------------------

export type ImportTypeKey = 'students' | 'guardians' | 'staff' | 'schedule'

export interface ImportTypeMeta {
  value: ImportTypeKey
  label: string
  icon: string
  headers: string[]
  description: string
}

export const IMPORT_TYPES: ImportTypeMeta[] = [
  {
    value: 'students',
    label: 'Elever',
    icon: 'GraduationCap',
    headers: ['fornamn', 'efternamn', 'personnummer', 'klass'],
    description: 'Nya eller uppdaterade elever med klassplacering.',
  },
  {
    value: 'guardians',
    label: 'Vårdnadshavare',
    icon: 'Users',
    headers: ['fornamn', 'efternamn', 'epost', 'telefon', 'barn_personnummer'],
    description: 'Vårdnadshavare som kopplas till barn via personnummer.',
  },
  {
    value: 'staff',
    label: 'Personal',
    icon: 'Briefcase',
    headers: ['fornamn', 'efternamn', 'epost', 'titel'],
    description: 'Personal med titel och kontaktuppgifter.',
  },
  {
    value: 'schedule',
    label: 'Schema',
    icon: 'CalendarDays',
    headers: ['klass', 'veckodag', 'starttid', 'sluttid', 'amne', 'sal'],
    description: 'Lektionspass per klass och veckodag.',
  },
]

export function importTypeMeta(type: string): ImportTypeMeta | undefined {
  return IMPORT_TYPES.find((t) => t.value === type)
}

export function importTypeLabel(type: string): string {
  return importTypeMeta(type)?.label ?? type
}

// ---------------------------------------------------------------------------
// CSV-tolkning och validering
// ---------------------------------------------------------------------------

export interface ImportErrorRow {
  row: number
  message: string
}

export interface CsvPreview {
  headers: string[]
  /** Upp till fem datarader för förhandsgranskning. */
  rows: string[][]
  totalRows: number
  missingHeaders: string[]
  errorRows: ImportErrorRow[]
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9åäö_]/g, '')
}

export function parseCsvForImport(text: string, type: ImportTypeKey): CsvPreview {
  const meta = importTypeMeta(type) ?? IMPORT_TYPES[0]
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [], totalRows: 0, missingHeaders: [...meta.headers], errorRows: [] }
  }

  const delim = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(delim).map(normalizeHeader)
  const dataLines = lines.slice(1)
  const rows = dataLines.slice(0, 5).map((l) => l.split(delim).map((c) => c.trim()))
  const missingHeaders = meta.headers.filter((h) => !headers.includes(h))

  const errorRows: ImportErrorRow[] = []
  const epostIdx = headers.indexOf('epost')
  dataLines.forEach((line, i) => {
    const cells = line.split(delim).map((c) => c.trim())
    if (cells.length !== headers.length) {
      errorRows.push({ row: i + 2, message: 'Fel antal kolumner på raden.' })
    } else if (epostIdx >= 0 && !cells[epostIdx]) {
      errorRows.push({ row: i + 2, message: 'E-postadress saknas.' })
    }
  })

  return { headers, rows, totalRows: dataLines.length, missingHeaders, errorRows }
}

// ---------------------------------------------------------------------------
// Jobbhantering
// ---------------------------------------------------------------------------

/** Felrader per jobb (i produktion en egen tabell). */
const errorStore = new Map<string, ImportErrorRow[]>()

/** Trovärdiga felrader för seedade jobb utan sparade detaljer. */
const SYNTH_ERRORS = [
  'E-postadress saknas.',
  'Ogiltigt personnummer för kopplat barn.',
  'Dubblettrad – hoppades över.',
  'Okänd klassbeteckning.',
  'Telefonnummer har fel format.',
]

export function errorRowsFor(job: ImportJob): ImportErrorRow[] {
  const stored = errorStore.get(job.id)
  if (stored) return stored
  const rows: ImportErrorRow[] = []
  for (let i = 0; i < job.failed; i++) {
    rows.push({ row: 7 + i * 13, message: SYNTH_ERRORS[i % SYNTH_ERRORS.length] })
  }
  return rows
}

export function createImportJob(
  principal: Principal,
  input: { type: ImportTypeKey; fileName: string; total: number },
): ImportJob {
  authorize(principal, 'create', 'import', {
    organizationId: principal.organizationId,
    schoolId: principal.schoolIds[0],
  })

  const now = new Date().toISOString()
  const job: ImportJob = {
    id: nextId('imp'),
    type: input.type,
    fileName: input.fileName,
    status: 'validerar',
    total: input.total,
    ok: 0,
    failed: 0,
    requestedBy: principal.userId,
    requestedAt: now,
    organizationId: principal.organizationId,
    schoolId: principal.schoolIds[0] ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: 3,
    sourceSystem: 'csv',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: null,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.imports.unshift(job)

  logAudit(actorFromPrincipal(principal), {
    action: 'import.create',
    resource: 'import',
    targetId: job.id,
    targetLabel: `${importTypeLabel(input.type)} · ${input.fileName}`,
    riskLevel: 'medel',
  })

  return job
}

/** Steget «validerar» → «kör». */
export function setImportRunning(jobId: string): void {
  const job = db.data.imports.find((j) => j.id === jobId)
  if (job && (job.status === 'validerar' || job.status === 'redo')) {
    job.status = 'kör'
    job.updatedAt = new Date().toISOString()
  }
}

export interface ImportOutcomePlan {
  missingHeaders: string[]
  errorRows: ImportErrorRow[]
  total: number
}

/** Avslutar jobbet: klar, delvis eller misslyckad – med felrader. */
export function finalizeImport(
  principal: Principal,
  jobId: string,
  plan: ImportOutcomePlan,
): ImportJob | undefined {
  const job = db.data.imports.find((j) => j.id === jobId)
  if (!job) return undefined

  if (plan.missingHeaders.length > 0 || plan.total === 0) {
    job.status = 'misslyckad'
    job.ok = 0
    job.failed = plan.total
    errorStore.set(job.id, [
      {
        row: 1,
        message:
          plan.total === 0
            ? 'Filen innehåller inga datarader.'
            : `Kolumnrubriker saknas: ${plan.missingHeaders.join(', ')}.`,
      },
    ])
  } else if (plan.errorRows.length > 0) {
    job.status = 'delvis'
    job.failed = plan.errorRows.length
    job.ok = Math.max(0, plan.total - plan.errorRows.length)
    errorStore.set(job.id, plan.errorRows)
  } else {
    job.status = 'klar'
    job.ok = plan.total
    job.failed = 0
    errorStore.set(job.id, [])
  }
  job.updatedAt = new Date().toISOString()
  job.version += 1

  logAudit(actorFromPrincipal(principal), {
    action: 'import.complete',
    resource: 'import',
    targetId: job.id,
    targetLabel: `${job.fileName} · ${job.status}`,
    newValue: `${job.ok} ok / ${job.failed} fel av ${job.total}`,
    riskLevel: job.status === 'misslyckad' ? 'medel' : 'låg',
  })

  return job
}

// ---------------------------------------------------------------------------
// Felrapport (CSV) med skydd mot CSV-injektion
// ---------------------------------------------------------------------------

function guardCell(value: string | number): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadErrorReport(principal: Principal, jobId: string): string {
  const job = db.data.imports.find((j) => j.id === jobId)
  if (!job) throw new Error('Importjobbet kunde inte hittas.')

  authorize(principal, 'read', 'import', {
    organizationId: job.organizationId,
    schoolId: job.schoolId,
  })

  const rl = checkRateLimit('file.download', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const rows = errorRowsFor(job)
  const lines = [
    ['Rad', 'Fel'].map(guardCell).join(';'),
    ...rows.map((r) => [r.row, r.message].map(guardCell).join(';')),
  ]
  const fileName = `felrapport-${job.fileName.replace(/\.csv$/i, '')}.csv`
  downloadBlob(String.fromCharCode(0xfeff) + lines.join('\r\n'), fileName, 'text/csv;charset=utf-8')

  logAudit(actorFromPrincipal(principal), {
    action: 'import.error_report',
    resource: 'import',
    targetId: job.id,
    targetLabel: `Felrapport · ${job.fileName}`,
    riskLevel: 'låg',
  })

  return fileName
}
