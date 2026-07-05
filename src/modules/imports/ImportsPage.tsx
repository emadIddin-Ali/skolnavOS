import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Button, Badge, StatusBadge,
  ProgressBar, Modal, StepIndicator, Icon,
  DeniedState, EmptyState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId, latency } from '@/data/db/store'
import type { ImportJob } from '@/data/schema'
import { fmtRelative } from '@/lib/format'
import {
  IMPORT_TYPES, importTypeMeta, importTypeLabel,
  parseCsvForImport, createImportJob, setImportRunning, finalizeImport,
  errorRowsFor, downloadErrorReport,
  type ImportTypeKey, type ImportOutcomePlan, type CsvPreview,
} from './service'

// ---- Presentationskartor ----

const STATUS_META: Record<ImportJob['status'], { tone: Tone; icon: string; label: string }> = {
  validerar: { tone: 'info', icon: 'ScanLine', label: 'Validerar' },
  redo: { tone: 'primary', icon: 'CircleCheck', label: 'Redo' },
  kör: { tone: 'info', icon: 'RefreshCw', label: 'Kör' },
  klar: { tone: 'success', icon: 'CircleCheck', label: 'Klar' },
  delvis: { tone: 'warning', icon: 'TriangleAlert', label: 'Delvis klar' },
  misslyckad: { tone: 'danger', icon: 'CircleX', label: 'Misslyckad' },
}

const RUNNING: ImportJob['status'][] = ['validerar', 'redo', 'kör']

export function ImportsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'import')
  const createDecision = usePermission('create', 'import')

  const [loading, setLoading] = useState(true)
  const [tick, bump] = useReducer((x) => x + 1, 0)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Simulerade bearbetningssteg – alla timers rensas vid unmount.
  const timersRef = useRef<number[]>([])
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current = []
    }
  }, [])

  useEffect(() => {
    let alive = true
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const jobs = useMemo(() => {
    void tick
    return db.data.imports
      .filter((j) => !j.deletedAt && j.organizationId === principal.organizationId)
      .filter(
        (j) =>
          can(principal, 'read', 'import', {
            organizationId: j.organizationId,
            schoolId: j.schoolId,
          }).allowed,
      )
      .slice()
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  }, [principal, tick])

  const stats = useMemo(() => {
    let okRows = 0
    let failedRows = 0
    let running = 0
    for (const j of jobs) {
      okRows += j.ok
      failedRows += j.failed
      if (RUNNING.includes(j.status)) running += 1
    }
    return { okRows, failedRows, running }
  }, [jobs])

  /** Kör «validerar» → «kör» → slutstatus med 800 ms-steg. */
  function simulate(jobId: string, plan: ImportOutcomePlan) {
    timersRef.current.push(
      window.setTimeout(() => {
        setImportRunning(jobId)
        bump()
      }, 800),
    )
    timersRef.current.push(
      window.setTimeout(() => {
        const job = finalizeImport(principal, jobId, plan)
        if (job) {
          if (job.status === 'klar') {
            toast.success('Importen är klar', `${job.ok} rader importerades utan fel.`)
          } else if (job.status === 'delvis') {
            toast.warning('Importen slutfördes delvis', `${job.failed} av ${job.total} rader kunde inte importeras.`)
          } else {
            toast.error(
              'Importen misslyckades',
              plan.total === 0
                ? 'Filen innehåller inga datarader.'
                : `Kolumnrubriker saknas: ${plan.missingHeaders.join(', ')}.`,
            )
          }
        }
        bump()
      }, 1600),
    )
  }

  const selected = selectedId ? jobs.find((j) => j.id === selectedId) : undefined

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Importer" icon="Upload" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const columns: Column<ImportJob>[] = [
    {
      key: 'file',
      header: 'Fil',
      render: (j) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
            <Icon name={importTypeMeta(j.type)?.icon ?? 'FileText'} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink truncate">{j.fileName}</div>
            <div className="text-2xs text-ink-subtle">{importTypeLabel(j.type)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (j) => (
        <StatusBadge tone={STATUS_META[j.status].tone} icon={STATUS_META[j.status].icon} label={STATUS_META[j.status].label} />
      ),
    },
    {
      key: 'result',
      header: 'Resultat',
      render: (j) => {
        if (RUNNING.includes(j.status)) {
          return (
            <div className="w-36">
              <ProgressBar value={j.status === 'validerar' ? 30 : j.status === 'redo' ? 55 : 80} tone="info" />
              <div className="mt-1 text-2xs text-ink-subtle">Bearbetar {j.total} rader …</div>
            </div>
          )
        }
        const pct = j.total > 0 ? (j.ok / j.total) * 100 : 0
        return (
          <div className="w-36">
            <ProgressBar value={pct} tone={j.failed > 0 ? (j.ok > 0 ? 'warning' : 'danger') : 'success'} />
            <div className="mt-1 text-2xs text-ink-subtle tabular-nums">
              {j.ok} ok · {j.failed} fel av {j.total}
            </div>
          </div>
        )
      },
    },
    {
      key: 'requestedBy',
      header: 'Begärd av',
      hideOnMobile: true,
      render: (j) => (
        <div>
          <div className="text-ink">
            {j.requestedBy === principal.userId ? 'Du' : byId(db.data.users, j.requestedBy)?.name ?? 'Okänd'}
          </div>
          <div className="text-2xs text-ink-subtle">{fmtRelative(j.requestedAt)}</div>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Importer"
        icon="Upload"
        subtitle="Läs in elever, vårdnadshavare, personal och schema från CSV-filer."
        actions={
          <span title={createDecision.allowed ? undefined : createDecision.reason}>
            <Button icon="Upload" disabled={!createDecision.allowed} onClick={() => setWizardOpen(true)}>
              Ny import
            </Button>
          </span>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Importerade rader" value={stats.okRows} icon="CircleCheck" tone={stats.okRows ? 'success' : 'neutral'} />
        <StatCard label="Felrader" value={stats.failedRows} icon="TriangleAlert" tone={stats.failedRows ? 'warning' : 'neutral'} />
        <StatCard label="Pågående jobb" value={stats.running} icon="RefreshCw" tone={stats.running ? 'info' : 'neutral'} />
      </div>

      <Card>
        {loading ? (
          <LoadingRows rows={4} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="Upload"
            title="Inga importer än"
            description="Starta en import för att läsa in data från en CSV-fil."
            actionLabel={createDecision.allowed ? 'Ny import' : undefined}
            onAction={createDecision.allowed ? () => setWizardOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={jobs}
            onRowClick={(j) => setSelectedId(j.id)}
            caption="Importjobb"
          />
        )}
      </Card>

      {wizardOpen && (
        <ImportWizard
          onClose={() => setWizardOpen(false)}
          onStarted={(jobId, plan) => {
            setWizardOpen(false)
            bump()
            simulate(jobId, plan)
          }}
        />
      )}

      {selected && (
        <ImportDetailModal job={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Guidad import (typ → fil → bekräfta)
// ---------------------------------------------------------------------------

const WIZARD_STEPS = [{ label: 'Typ' }, { label: 'Fil' }, { label: 'Bekräfta' }]

function ImportWizard({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (jobId: string, plan: ImportOutcomePlan) => void
}) {
  const principal = usePrincipal()
  const [step, setStep] = useState(0)
  const [type, setType] = useState<ImportTypeKey>('students')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rawText, setRawText] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = importTypeMeta(type) ?? IMPORT_TYPES[0]
  const preview: CsvPreview | null = useMemo(
    () => (rawText != null ? parseCsvForImport(rawText, type) : null),
    [rawText, type],
  )

  const canNext =
    (step === 0) ||
    (step === 1 && preview != null && !fileError && !reading)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileError(null)
    setRawText(null)
    setFileName(f.name)
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setFileError('Endast CSV-filer (.csv) kan importeras.')
      return
    }
    setReading(true)
    const reader = new FileReader()
    reader.onload = () => {
      setReading(false)
      setRawText(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      setReading(false)
      setFileError('Filen kunde inte läsas. Försök igen.')
    }
    reader.readAsText(f, 'utf-8')
  }

  function submit() {
    if (!preview || !fileName) return
    setError(null)
    setBusy(true)
    try {
      const job = createImportJob(principal, { type, fileName, total: preview.totalRows })
      toast.info('Importen har startats', `${fileName} valideras och bearbetas nu.`)
      onStarted(job.id, {
        missingHeaders: preview.missingHeaders,
        errorRows: preview.errorRows,
        total: preview.totalRows,
      })
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof RateLimitedError) setError(e.message)
      else setError('Importen kunde inte startas just nu. Försök igen om en stund.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny import"
      description="Läs in data från en CSV-fil – varje rad valideras innan den skrivs."
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
            <span title={step === 1 && !canNext ? 'Välj en giltig CSV-fil först.' : undefined}>
              <Button iconRight="ChevronRight" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                Nästa
              </Button>
            </span>
          ) : (
            <Button icon="Upload" loading={busy} disabled={busy || !preview} onClick={submit}>
              Starta import
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={WIZARD_STEPS} current={step} />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Steg 1: Typ */}
      {step === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">Vad ska importeras?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {IMPORT_TYPES.map((t) => {
              const active = t.value === type
              return (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={
                    'flex items-start gap-3 rounded-field border p-3 text-left transition-colors ' +
                    (active ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2')
                  }
                >
                  <span
                    className={
                      'grid h-9 w-9 shrink-0 place-items-center rounded-field ' +
                      (active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-muted')
                    }
                  >
                    <Icon name={t.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{t.label}</span>
                    <span className="block text-2xs text-ink-subtle">{t.description}</span>
                  </span>
                  {active && <Icon name="Check" className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Steg 2: Fil + förhandsgranskning */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-field border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center transition-colors hover:bg-surface">
              <Icon name="Upload" className="h-6 w-6 text-ink-subtle" />
              <span className="text-sm font-medium text-ink">
                {fileName ? fileName : 'Välj CSV-fil'}
              </span>
              <span className="text-2xs text-ink-subtle">
                Förväntade kolumner: {meta.headers.join(' · ')}
              </span>
              <input type="file" accept=".csv" className="sr-only" onChange={onFileChange} />
            </label>
          </div>

          {fileError && (
            <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {reading && <p className="text-sm text-ink-muted">Läser filen …</p>}

          {preview && !fileError && (
            <>
              {preview.missingHeaders.length > 0 ? (
                <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                  <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Kolumnrubriker saknas: <strong>{preview.missingHeaders.join(', ')}</strong>.
                    Importen kommer att misslyckas om du fortsätter.
                  </span>
                </div>
              ) : preview.errorRows.length > 0 ? (
                <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {preview.errorRows.length} av {preview.totalRows} rader har problem (t.ex. tom
                    e-postadress) och kommer att hoppas över.
                  </span>
                </div>
              ) : preview.totalRows === 0 ? (
                <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                  <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Filen innehåller inga datarader.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-field border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
                  <Icon name="CircleCheck" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Alla obligatoriska kolumner finns. {preview.totalRows} datarader hittades.
                  </span>
                </div>
              )}

              {preview.headers.length > 0 && (
                <div>
                  <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Förhandsgranskning (första {Math.min(5, preview.rows.length)} raderna)
                  </p>
                  <div className="overflow-x-auto rounded-field border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-2 text-left">
                          {preview.headers.map((h, i) => (
                            <th key={i} className="whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                              {h || '—'}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r, ri) => (
                          <tr key={ri} className="border-b border-border/70 last:border-0">
                            {preview.headers.map((_, ci) => (
                              <td key={ci} className="whitespace-nowrap px-3 py-1.5 text-ink">
                                {r[ci] || <span className="text-danger">tom</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Steg 3: Bekräfta */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <dl className="divide-y divide-border rounded-field border border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Typ</dt>
              <dd className="font-medium text-ink">{meta.label}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Fil</dt>
              <dd className="font-medium text-ink truncate">{fileName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Datarader</dt>
              <dd className="font-medium text-ink tabular-nums">{preview.totalRows}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Förväntat resultat</dt>
              <dd>
                {preview.missingHeaders.length > 0 || preview.totalRows === 0 ? (
                  <Badge tone="danger" icon="CircleX">Misslyckas</Badge>
                ) : preview.errorRows.length > 0 ? (
                  <Badge tone="warning" icon="TriangleAlert">
                    Delvis – {preview.errorRows.length} felrader
                  </Badge>
                ) : (
                  <Badge tone="success" icon="CircleCheck">Alla rader ok</Badge>
                )}
              </dd>
            </div>
          </dl>
          <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
            <Icon name="ShieldCheck" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            Importen körs som bakgrundsjobb och loggas i granskningsloggen. Felrader kan laddas ned
            som felrapport efteråt.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Detaljvy per importjobb
// ---------------------------------------------------------------------------

function ImportDetailModal({ job, onClose }: { job: ImportJob; onClose: () => void }) {
  const principal = usePrincipal()
  const errors = errorRowsFor(job)
  const running = RUNNING.includes(job.status)
  const pct = job.total > 0 ? (job.ok / job.total) * 100 : 0

  function handleErrorReport() {
    try {
      const fileName = downloadErrorReport(principal, job.id)
      toast.success('Felrapport nedladdad', fileName)
    } catch (e) {
      if (e instanceof RateLimitedError) toast.warning('För många nedladdningar', e.message)
      else if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte ladda ned felrapporten', e instanceof Error ? e.message : undefined)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={job.fileName}
      description={`${importTypeLabel(job.type)} · begärd ${fmtRelative(job.requestedAt)}`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {job.failed > 0 && !running && (
            <Button variant="secondary" icon="Download" onClick={handleErrorReport}>
              Ladda ned felrapport
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Stäng
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={STATUS_META[job.status].tone}
            icon={STATUS_META[job.status].icon}
            label={STATUS_META[job.status].label}
          />
          <Badge tone="neutral" icon="FileText">{importTypeLabel(job.type)}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-field border border-border bg-surface-2 p-3 text-center">
            <div className="text-lg font-semibold tabular-nums text-ink">{job.total}</div>
            <div className="text-2xs text-ink-subtle">Rader totalt</div>
          </div>
          <div className="rounded-field border border-border bg-surface-2 p-3 text-center">
            <div className="text-lg font-semibold tabular-nums text-success">{job.ok}</div>
            <div className="text-2xs text-ink-subtle">Importerade</div>
          </div>
          <div className="rounded-field border border-border bg-surface-2 p-3 text-center">
            <div className="text-lg font-semibold tabular-nums text-danger">{job.failed}</div>
            <div className="text-2xs text-ink-subtle">Felrader</div>
          </div>
        </div>

        {running ? (
          <div>
            <ProgressBar value={job.status === 'validerar' ? 30 : job.status === 'redo' ? 55 : 80} tone="info" />
            <p className="mt-1.5 text-2xs text-ink-subtle">Jobbet bearbetas …</p>
          </div>
        ) : (
          <ProgressBar
            value={pct}
            tone={job.failed > 0 ? (job.ok > 0 ? 'warning' : 'danger') : 'success'}
            showValue
          />
        )}

        {!running && errors.length > 0 && (
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
              Felrader
            </p>
            <ul className="divide-y divide-border rounded-field border border-border">
              {errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span className="text-ink">
                    <span className="font-medium">Rad {e.row}:</span> {e.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!running && errors.length === 0 && (
          <p className="text-sm text-ink-muted">Alla rader importerades utan anmärkning.</p>
        )}
      </div>
    </Modal>
  )
}
