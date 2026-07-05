import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Button, Badge, StatusBadge,
  ClassificationBadge, ProgressBar, Modal, StepIndicator, Select, Icon,
  DeniedState, EmptyState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId, latency } from '@/data/db/store'
import type { ReportJob, ReportStatus } from '@/data/schema'
import { createReport, listReports } from '@/core/export/reports'
import { fmtDate, fmtDateLong, fmtNumber, fmtRelative } from '@/lib/format'
import {
  REPORT_TYPES, reportTypeLabel, reportTypeIcon, toClassification,
  downloadReport, advanceQueuedReports, isExpired, estimateRows,
} from './service'

// ---- Presentationskartor ----

const STATUS_META: Record<ReportStatus, { tone: Tone; icon: string; label: string }> = {
  köad: { tone: 'neutral', icon: 'Clock', label: 'Köad' },
  bearbetar: { tone: 'info', icon: 'Timer', label: 'Bearbetar' },
  klar: { tone: 'success', icon: 'CircleCheck', label: 'Klar' },
  misslyckad: { tone: 'danger', icon: 'CircleX', label: 'Misslyckad' },
  utgången: { tone: 'warning', icon: 'History', label: 'Utgången' },
}

const FORMAT_TONE: Record<ReportJob['format'], Tone> = {
  pdf: 'accent',
  csv: 'success',
  json: 'info',
  xlsx: 'primary',
  ics: 'neutral',
}

/** Visningsstatus: klara jobb vars länk gått ut visas som «utgången». */
function displayStatus(job: ReportJob): ReportStatus {
  if (job.status === 'klar' && isExpired(job)) return 'utgången'
  return job.status
}

export function ReportsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'report')
  const exportDecision = usePermission('export', 'export')

  const [loading, setLoading] = useState(true)
  const [tick, bump] = useReducer((x) => x + 1, 0)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    let alive = true
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Behörighetsfiltrerad lista.
  const jobs = useMemo(() => {
    void tick
    return listReports(principal.organizationId)
      .filter((j) => !j.deletedAt)
      .filter(
        (j) =>
          can(principal, 'read', 'report', {
            organizationId: j.organizationId,
            schoolId: j.schoolId,
          }).allowed,
      )
      .slice()
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  }, [principal, tick])

  // Live-uppdatering medan jobb bearbetas – intervall rensas vid unmount.
  const processing = jobs.some((j) => j.status === 'köad' || j.status === 'bearbetar')
  useEffect(() => {
    if (!processing) return
    const id = window.setInterval(() => {
      advanceQueuedReports(principal.organizationId)
      bump()
    }, 1000)
    return () => window.clearInterval(id)
  }, [processing, principal])

  const stats = useMemo(() => {
    let klar = 0
    let pagaende = 0
    let fel = 0
    for (const j of jobs) {
      const s = displayStatus(j)
      if (s === 'klar') klar += 1
      else if (s === 'köad' || s === 'bearbetar') pagaende += 1
      else if (s === 'misslyckad') fel += 1
    }
    return { klar, pagaende, fel }
  }, [jobs])

  function handleDownload(job: ReportJob) {
    try {
      const res = downloadReport(principal, job.id)
      if (res.pdfFallback) {
        toast.info(
          'PDF-motor (Gotenberg) ej konfigurerad – textversion levererad',
          `Filen ${res.fileName} har laddats ned.`,
        )
      } else {
        toast.success('Nedladdning startad', res.fileName)
      }
      bump()
    } catch (e) {
      if (e instanceof RateLimitedError) toast.warning('För många nedladdningar', e.message)
      else if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte ladda ned', e instanceof Error ? e.message : 'Okänt fel.')
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Rapporter & exporter" icon="FileOutput" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const columns: Column<ReportJob>[] = [
    {
      key: 'title',
      header: 'Rapport',
      render: (j) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
            <Icon name={reportTypeIcon(j.type)} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink truncate">{j.title}</div>
            <div className="text-2xs text-ink-subtle">
              {reportTypeLabel(j.type)}
              {j.rowCount > 0 ? ` · ${fmtNumber(j.rowCount)} rader` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'format',
      header: 'Format',
      hideOnMobile: true,
      render: (j) => <Badge tone={FORMAT_TONE[j.format]}>{j.format.toUpperCase()}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (j) => {
        const s = displayStatus(j)
        if (s === 'köad' || s === 'bearbetar') {
          return (
            <div className="w-36">
              <div className="mb-1 text-2xs font-medium text-ink-muted">{STATUS_META[s].label}</div>
              <ProgressBar value={s === 'köad' ? 4 : j.progress} tone="info" showValue />
            </div>
          )
        }
        return <StatusBadge tone={STATUS_META[s].tone} icon={STATUS_META[s].icon} label={STATUS_META[s].label} />
      },
    },
    {
      key: 'requestedBy',
      header: 'Begärd av',
      hideOnMobile: true,
      render: (j) => (
        <div>
          <div className="text-ink">
            {j.requestedBy === principal.userId
              ? 'Du'
              : byId(db.data.users, j.requestedBy)?.name ?? 'Okänd'}
          </div>
          <div className="text-2xs text-ink-subtle">{fmtRelative(j.requestedAt)}</div>
        </div>
      ),
    },
    {
      key: 'protection',
      header: 'Skydd',
      hideOnMobile: true,
      render: (j) => (
        <div className="flex flex-col items-start gap-1">
          <ClassificationBadge level={toClassification(j.dataClassification)} />
          {j.protectedFiltered && (
            <span title="Skyddade identiteter är bortfiltrerade ur exporten">
              <Badge tone="success" icon="ShieldCheck">Skyddsfiltrerad</Badge>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'expires',
      header: 'Utgår',
      hideOnMobile: true,
      render: (j) =>
        j.expiresAt ? (
          <span className={isExpired(j) ? 'text-warning' : 'text-ink-muted'}>{fmtDate(j.expiresAt)}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (j) => {
        if (displayStatus(j) !== 'klar') return null
        return (
          <span title={exportDecision.allowed ? undefined : exportDecision.reason}>
            <Button
              size="sm"
              variant="secondary"
              icon="Download"
              disabled={!exportDecision.allowed}
              onClick={() => handleDownload(j)}
            >
              Ladda ned
            </Button>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Rapporter & exporter"
        icon="FileOutput"
        subtitle="Säkra bakgrundsjobb – skyddade identiteter filtreras alltid bort."
        actions={
          <span title={exportDecision.allowed ? undefined : exportDecision.reason}>
            <Button icon="Plus" disabled={!exportDecision.allowed} onClick={() => setCreateOpen(true)}>
              Ny rapport
            </Button>
          </span>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Klara rapporter" value={stats.klar} icon="CircleCheck" tone={stats.klar ? 'success' : 'neutral'} />
        <StatCard label="Bearbetas just nu" value={stats.pagaende} icon="Timer" tone={stats.pagaende ? 'info' : 'neutral'} />
        <StatCard label="Misslyckade" value={stats.fel} icon="CircleX" tone={stats.fel ? 'danger' : 'neutral'} />
      </div>

      <Card>
        {loading ? (
          <LoadingRows rows={5} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="FileOutput"
            title="Inga rapporter än"
            description="Beställ en rapport så bearbetas den säkert i bakgrunden."
            actionLabel={exportDecision.allowed ? 'Ny rapport' : undefined}
            onAction={exportDecision.allowed ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <DataTable columns={columns} rows={jobs} caption="Rapporter och exporter" />
        )}
      </Card>

      {createOpen && (
        <NewReportModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Ny rapport – stegvis beställning
// ---------------------------------------------------------------------------

const CREATE_STEPS = [{ label: 'Typ' }, { label: 'Format' }, { label: 'Bekräfta' }]

const FORMAT_OPTIONS: { value: 'pdf' | 'csv' | 'json'; label: string; icon: string; hint: string }[] = [
  { value: 'pdf', label: 'PDF', icon: 'FileText', hint: 'Formell layout via PDF-motor' },
  { value: 'csv', label: 'CSV', icon: 'Grid2x2', hint: 'Öppnas i Excel / kalkylark' },
  { value: 'json', label: 'JSON', icon: 'FileOutput', hint: 'För systemintegration' },
]

function NewReportModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const principal = usePrincipal()
  const [step, setStep] = useState(0)
  const [type, setType] = useState(REPORT_TYPES[0].value)
  const [format, setFormat] = useState<'pdf' | 'csv' | 'json'>('pdf')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = REPORT_TYPES.find((t) => t.value === type) ?? REPORT_TYPES[0]
  const needsReason = meta.classification >= 4
  const reasonOk = !needsReason || reason.trim().length >= 5
  const rowEstimate = estimateRows(meta.value, principal.organizationId)

  const canNext = step === 0 || step === 1 || (step === 2 && reasonOk)

  function submit() {
    if (!reasonOk) return
    setError(null)
    setBusy(true)
    try {
      createReport(principal, {
        type: meta.value,
        title: `${meta.label} – ${fmtDateLong(new Date())}`,
        format,
        reason: reason.trim() || undefined,
        schoolId: principal.schoolIds[0] ?? null,
        classification: meta.classification,
        rowEstimate,
      })
      toast.success('Rapporten är beställd', 'Jobbet bearbetas i bakgrunden – följ förloppet i listan.')
      onCreated()
    } catch (e) {
      if (e instanceof RateLimitedError) {
        toast.warning('Exportgränsen är nådd för idag.')
        setError('Exportgränsen är nådd för idag. Försök igen imorgon.')
      } else if (e instanceof ForbiddenError) {
        toast.error('Åtkomst nekad', e.message)
        setError(e.message)
      } else {
        setError('Rapporten kunde inte skapas just nu. Försök igen om en stund.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny rapport"
      description="Beställ en export – jobbet körs säkert i bakgrunden."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon="ChevronLeft"
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
          >
            {step === 0 ? 'Avbryt' : 'Tillbaka'}
          </Button>
          {step < 2 ? (
            <Button iconRight="ChevronRight" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Nästa
            </Button>
          ) : (
            <Button
              icon="FileOutput"
              loading={busy}
              disabled={!reasonOk || busy}
              title={reasonOk ? undefined : 'Ange en anledning för känsliga rapporttyper.'}
              onClick={submit}
            >
              Beställ rapport
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={CREATE_STEPS} current={step} />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Steg 1: Typ */}
      {step === 0 && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Rapporttyp</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-start gap-3 rounded-field border border-border bg-surface-2 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
              <Icon name={meta.icon} className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{meta.label}</span>
                <ClassificationBadge level={meta.classification} />
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">{meta.description}</p>
              <p className="mt-1 text-2xs text-ink-subtle">
                Uppskattat underlag: {fmtNumber(rowEstimate)} rader.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Steg 2: Format */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Välj leveransformat.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {FORMAT_OPTIONS.map((f) => {
              const active = f.value === format
              return (
                <button
                  key={f.value}
                  onClick={() => setFormat(f.value)}
                  className={
                    'flex flex-col items-center gap-2 rounded-field border p-3 text-center transition-colors ' +
                    (active ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2')
                  }
                >
                  <span
                    className={
                      'grid h-9 w-9 place-items-center rounded-field ' +
                      (active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-muted')
                    }
                  >
                    <Icon name={f.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-xs font-medium text-ink">{f.label}</span>
                  <span className="text-2xs text-ink-subtle">{f.hint}</span>
                </button>
              )
            })}
          </div>
          {format === 'pdf' && (
            <p className="text-2xs text-ink-subtle">
              PDF genereras normalt via skolans PDF-motor. I demomiljön levereras en textversion.
            </p>
          )}
        </div>
      )}

      {/* Steg 3: Anledning + bekräfta */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Anledning{' '}
              {needsReason ? (
                <span className="text-danger">(obligatorisk för känsliga typer)</span>
              ) : (
                <span className="text-ink-subtle">(valfritt)</span>
              )}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="T.ex. uppföljning inför elevhälsomöte."
              className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            {needsReason && !reasonOk && (
              <p className="mt-1 text-2xs text-danger">Ange en anledning (minst 5 tecken) – den loggas i granskningsloggen.</p>
            )}
          </div>
          <dl className="divide-y divide-border rounded-field border border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Typ</dt>
              <dd className="font-medium text-ink">{meta.label}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Format</dt>
              <dd className="font-medium text-ink">{format.toUpperCase()}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Klassificering</dt>
              <dd><ClassificationBadge level={meta.classification} /></dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Underlag</dt>
              <dd className="font-medium text-ink">{fmtNumber(rowEstimate)} rader</dd>
            </div>
          </dl>
          <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
            <Icon name="ShieldCheck" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            Skyddade identiteter filtreras alltid bort ur exporter. Beställningen loggas i granskningsloggen.
          </p>
        </div>
      )}
    </Modal>
  )
}
