import { db, byId } from '@/data/db/store'
import type { ReportJob } from '@/data/schema'
import {
  ATTENDANCE_STATUS_LABEL,
  ABSENCE_REASON_LABEL,
  ABSENCE_STATUS_LABEL,
  SCHOOL_TYPE_LABEL,
} from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { fmtDate, fmtDateTime, maskName } from '@/lib/format'

/**
 * Tjänstelager för rapporter & exporter. Auktoriserar via behörighetsmotorn
 * innan data läses ur store:t, respekterar skyddad identitet (filtrering/
 * maskering) och skyddar mot CSV-injektion vid nedladdning.
 */

// ---------------------------------------------------------------------------
// Rapporttyper
// ---------------------------------------------------------------------------

export interface ReportTypeMeta {
  value: string
  label: string
  icon: string
  /** Dataklassificering som styr export- och anledningskrav. */
  classification: 3 | 4 | 6
  description: string
}

export const REPORT_TYPES: ReportTypeMeta[] = [
  {
    value: 'attendance',
    label: 'Närvaro',
    icon: 'ClipboardCheck',
    classification: 3,
    description: 'Dagens närvaromarkeringar per elev och klass.',
  },
  {
    value: 'absence',
    label: 'Frånvaro',
    icon: 'CalendarX',
    classification: 3,
    description: 'Frånvaroanmälningar med orsak, omfattning och status.',
  },
  {
    value: 'students',
    label: 'Elevlista',
    icon: 'Users',
    classification: 3,
    description: 'Inskrivna elever med klass, skolform och status.',
  },
  {
    value: 'meal',
    label: 'Specialkost',
    icon: 'UtensilsCrossed',
    classification: 4,
    description: 'Allergier och specialkost – känslig hälsodata, kräver anledning.',
  },
  {
    value: 'audit',
    label: 'Granskningslogg',
    icon: 'ScrollText',
    classification: 6,
    description: 'Säkerhetslogg över känsliga åtgärder – kräver anledning.',
  },
]

const TYPE_LABEL: Record<string, string> = {
  attendance: 'Närvaro',
  absence: 'Frånvaro',
  students: 'Elevlista',
  meal: 'Specialkost',
  audit: 'Granskningslogg',
  gdpr_export: 'Registerutdrag (GDPR)',
}

export function reportTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? 'Rapport'
}

export function reportTypeIcon(type: string): string {
  return REPORT_TYPES.find((t) => t.value === type)?.icon ?? 'FileText'
}

/** Klampar klassificering till giltig nivå (basfältet är typat som number). */
export function toClassification(n: number): 1 | 2 | 3 | 4 | 5 | 6 {
  const c = Math.min(6, Math.max(1, Math.round(n)))
  return c as 1 | 2 | 3 | 4 | 5 | 6
}

/** Har rapporten passerat sitt utgångsdatum? */
export function isExpired(job: ReportJob): boolean {
  return job.expiresAt != null && new Date().toISOString() > job.expiresAt
}

/** Grov raduppskattning för nya jobb. */
export function estimateRows(type: string, organizationId: string): number {
  const d = db.data
  const today = fmtDate(new Date())
  switch (type) {
    case 'attendance':
      return d.attendance.filter(
        (a) => a.organizationId === organizationId && fmtDate(a.date) === today,
      ).length
    case 'absence':
      return d.absences.filter((a) => a.organizationId === organizationId).length
    case 'students':
      return d.students.filter((s) => s.organizationId === organizationId).length
    case 'meal':
      return d.health.filter((h) => h.organizationId === organizationId).length
    case 'audit':
      return d.auditLogs.filter((l) => l.organizationId === organizationId).length
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Simulerad bakgrundsbearbetning – låter köade/seedade jobb bli klara.
// ---------------------------------------------------------------------------

export function advanceQueuedReports(organizationId: string): void {
  for (const job of db.data.reports) {
    if (job.organizationId !== organizationId) continue
    if (job.status !== 'köad' && job.status !== 'bearbetar') continue
    job.status = 'bearbetar'
    job.progress = Math.min(100, job.progress + 18)
    if (job.progress >= 100) {
      job.status = 'klar'
      job.progress = 100
      job.expiresAt = job.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
      if (!job.rowCount) job.rowCount = Math.max(1, datasetFor(job).rows.length)
    }
    job.updatedAt = new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// Filgenerering (CSV/JSON/text) med skydd mot CSV-injektion
// ---------------------------------------------------------------------------

type Cell = string | number

export interface Dataset {
  headers: string[]
  rows: Cell[][]
}

/** Skyddar mot formelinjektion (=,+,-,@) och citerar celler med avgränsare. */
function guardCell(value: Cell): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCsv(ds: Dataset): string {
  const lines = [ds.headers, ...ds.rows].map((row) => row.map(guardCell).join(';'))
  // BOM (U+FEFF) för korrekt teckenkodning i Excel
  return String.fromCharCode(0xfeff) + lines.join('\r\n')
}

function buildJson(job: ReportJob, ds: Dataset): string {
  const rader = ds.rows.map((row) =>
    Object.fromEntries(ds.headers.map((h, i) => [h, row[i] ?? ''])),
  )
  return JSON.stringify(
    {
      rapport: job.title,
      typ: reportTypeLabel(job.type),
      genererad: new Date().toISOString(),
      skyddsfiltrerad: job.protectedFiltered,
      rader,
    },
    null,
    2,
  )
}

function buildText(job: ReportJob, ds: Dataset): string {
  const head = [
    `SKOLNAV OS – ${job.title}`,
    `Typ: ${reportTypeLabel(job.type)}`,
    `Genererad: ${fmtDateTime(new Date())}`,
    `Skyddsfiltrerad: ${job.protectedFiltered ? 'Ja – skyddade identiteter är borttagna' : 'Nej'}`,
    'Obs: PDF-motorn (Gotenberg) är inte konfigurerad i demomiljön – detta är en textversion.',
    '',
  ]
  const widths = ds.headers.map((h, i) =>
    Math.max(h.length, ...ds.rows.map((r) => String(r[i] ?? '').length), 4),
  )
  const line = (cells: Cell[]) =>
    cells.map((c, i) => String(c ?? '').padEnd(widths[i] + 2)).join('')
  return [
    ...head,
    line(ds.headers),
    widths.map((w) => '-'.repeat(w + 2)).join(''),
    ...ds.rows.map(line),
  ].join('\n')
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

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/å|ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/é/g, 'e')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rapport'
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function studentLabel(id: string | null | undefined): {
  name: string
  gradeLabel: string
  protectedIdentity: boolean
} | null {
  const s = id ? byId(db.data.students, id) : undefined
  if (!s) return null
  const full = `${s.firstName} ${s.lastName}`
  return {
    name: s.protectedIdentity ? maskName(full) : full,
    gradeLabel: s.gradeLabel,
    protectedIdentity: s.protectedIdentity,
  }
}

/** Bygger dataset ur seedad data för respektive jobbtyp. */
export function datasetFor(job: ReportJob): Dataset {
  const d = db.data
  const orgOk = <T extends { organizationId: string; schoolId?: string | null }>(x: T) =>
    x.organizationId === job.organizationId &&
    (!job.schoolId || !x.schoolId || x.schoolId === job.schoolId)

  switch (job.type) {
    case 'attendance': {
      const today = fmtDate(new Date())
      let list = d.attendance.filter(orgOk)
      const todays = list.filter((a) => fmtDate(a.date) === today)
      if (todays.length > 0) list = todays
      const rows: Cell[][] = []
      for (const a of list) {
        const s = studentLabel(a.studentId)
        if (!s) continue
        if (job.protectedFiltered && s.protectedIdentity) continue
        rows.push([fmtDate(a.date), s.name, s.gradeLabel, ATTENDANCE_STATUS_LABEL[a.status], a.note])
      }
      return { headers: ['Datum', 'Elev', 'Klass', 'Status', 'Notering'], rows }
    }
    case 'absence': {
      const rows: Cell[][] = []
      for (const a of d.absences.filter(orgOk)) {
        const s = studentLabel(a.studentId)
        if (!s) continue
        if (job.protectedFiltered && s.protectedIdentity) continue
        rows.push([
          fmtDate(a.date),
          s.name,
          ABSENCE_REASON_LABEL[a.reason],
          ABSENCE_STATUS_LABEL[a.status],
          a.fullDay ? 'Heldag' : `${a.fromTime ?? ''}–${a.toTime ?? ''}`,
        ])
      }
      return { headers: ['Datum', 'Elev', 'Orsak', 'Status', 'Omfattning'], rows }
    }
    case 'students': {
      const rows: Cell[][] = []
      for (const s of d.students.filter(orgOk)) {
        if (job.protectedFiltered && s.protectedIdentity) continue
        const full = `${s.firstName} ${s.lastName}`
        rows.push([
          s.protectedIdentity ? maskName(full) : full,
          s.gradeLabel,
          SCHOOL_TYPE_LABEL[s.schoolType],
          cap(s.status),
        ])
      }
      return { headers: ['Namn', 'Klass/grupp', 'Skolform', 'Status'], rows }
    }
    case 'meal': {
      const rows: Cell[][] = []
      for (const h of d.health.filter(orgOk)) {
        const s = studentLabel(h.studentId)
        if (!s) continue
        if (job.protectedFiltered && s.protectedIdentity) continue
        rows.push([s.name, s.gradeLabel, cap(h.kind), h.label, cap(h.severity), h.instructions])
      }
      return {
        headers: ['Elev', 'Klass', 'Typ', 'Avser', 'Allvarlighetsgrad', 'Instruktion'],
        rows,
      }
    }
    case 'audit': {
      const rows: Cell[][] = d.auditLogs
        .filter((l) => l.organizationId === job.organizationId)
        .map((l) => [fmtDateTime(l.at), l.action, l.resource, l.actorRole, cap(l.riskLevel), l.targetLabel])
      return { headers: ['Tid', 'Åtgärd', 'Resurs', 'Roll', 'Risknivå', 'Objekt'], rows }
    }
    default:
      return {
        headers: ['Fält', 'Värde'],
        rows: [
          ['Rapport', job.title],
          ['Typ', reportTypeLabel(job.type)],
          ['Begärd', fmtDateTime(job.requestedAt)],
          ['Antal rader', job.rowCount],
          ['Skyddsfiltrerad', job.protectedFiltered ? 'Ja' : 'Nej'],
        ],
      }
  }
}

// ---------------------------------------------------------------------------
// Nedladdning av klar rapport
// ---------------------------------------------------------------------------

export interface DownloadResult {
  fileName: string
  /** PDF begärdes men levererades som textversion (ärlig fallback). */
  pdfFallback: boolean
}

export function downloadReport(principal: Principal, jobId: string): DownloadResult {
  const job = db.data.reports.find((r) => r.id === jobId)
  if (!job) throw new Error('Rapporten kunde inte hittas.')
  if (job.status !== 'klar') throw new Error('Rapporten är inte klar än.')
  if (isExpired(job)) throw new Error('Rapporten har gått ut och kan inte längre laddas ned.')

  // Auktoritativ kontroll – inte bara dolt i UI.
  authorize(principal, 'export', 'export', {
    organizationId: job.organizationId,
    schoolId: job.schoolId ?? undefined,
    dataClassification: toClassification(job.dataClassification),
  })

  // Kostnads- och missbruksskydd.
  const rl = checkRateLimit('file.download', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const dataset = datasetFor(job)
  const base = slugify(job.title)
  let fileName: string
  let pdfFallback = false

  if (job.format === 'json') {
    fileName = `${base}.json`
    downloadBlob(buildJson(job, dataset), fileName, 'application/json;charset=utf-8')
  } else if (job.format === 'pdf') {
    fileName = `${base}.txt`
    pdfFallback = true
    downloadBlob(buildText(job, dataset), fileName, 'text/plain;charset=utf-8')
  } else {
    // csv, xlsx och ics levereras som CSV i demomiljön
    fileName = `${base}.csv`
    downloadBlob(buildCsv(dataset), fileName, 'text/csv;charset=utf-8')
  }

  logAudit(actorFromPrincipal(principal, job.schoolId), {
    action: 'export.download',
    resource: 'export',
    targetId: job.id,
    targetLabel: job.title,
    riskLevel: job.dataClassification >= 4 ? 'medel' : 'låg',
  })

  return { fileName, pdfFallback }
}
