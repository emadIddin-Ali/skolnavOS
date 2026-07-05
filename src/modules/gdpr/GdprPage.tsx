import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, Tabs, Button, Badge, StatusBadge,
  ClassificationBadge, Avatar, Modal, StepIndicator, TextInput, Select, DataTable,
  ProgressBar, SectionTitle, EmptyState, DeniedState, LoadingRows, Icon,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, latency } from '@/data/db/store'
import type { GdprRequest, Student, ReportStatus, IntegrationStatus } from '@/data/schema'
import { INTEGRATION_STATUS_LABEL } from '@/data/schema'
import { fmtDate, fmtDateLong, fmtRelative, fmtDateTime, maskName } from '@/lib/format'
import {
  GDPR_TYPE_LABEL, GDPR_TYPE_META, GDPR_STATUS_LABEL, GDPR_STATUS_META, GDPR_NEXT_STATUS,
  GDPR_FLOW, PROCESSING_REGISTER, SUPPORT_STATUS_LABEL, SUPPORT_STATUS_META, isOpenStatus,
  type GdprType, type GdprStatus,
} from './gdprData'
import {
  listGdprRequests, createGdprRequest, advanceGdprStatus, createGdprExport,
  reportForRequest, listGdprExports, type CreateGdprInput,
} from './gdprService'

type TabKey = 'begaranden' | 'register' | 'underbitraden' | 'atkomst'

const REPORT_STATUS_META: Record<ReportStatus, { tone: Tone; label: string }> = {
  köad: { tone: 'neutral', label: 'Köad' },
  bearbetar: { tone: 'info', label: 'Bearbetar' },
  klar: { tone: 'success', label: 'Klar' },
  misslyckad: { tone: 'danger', label: 'Misslyckad' },
  utgången: { tone: 'neutral', label: 'Utgången' },
}

const INT_TONE: Record<IntegrationStatus, Tone> = {
  aktiv: 'success',
  inaktiv: 'neutral',
  kraver_nyckel: 'warning',
  kraver_avtal: 'warning',
  kraver_konfiguration: 'warning',
  testad: 'info',
  fel: 'danger',
  pausad: 'neutral',
  kommande: 'neutral',
}

/** Dagar kvar till förfallodatum (negativt = försenat). */
function daysLeft(dueAt: string): number {
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000)
}

interface Row {
  id: string
  request: GdprRequest
  student?: Student
  masked: boolean
  subjectLabel: string
  handlerLabel: string
  left: number
}

export function GdprPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'gdpr')
  const canCreate = useCan('create', 'gdpr')
  const canUpdate = useCan('update', 'gdpr')
  const canExport = useCan('export', 'export')

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('begaranden')
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [newOpen, setNewOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    latency(220).then(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  // Behörighetsfiltrerad lista: org-filtrerad + radnivå-scope prövas mot motorn.
  const rows = useMemo<Row[]>(() => {
    void refresh
    const users = db.data.users
    return listGdprRequests(principal.organizationId)
      .map<Row | null>((request) => {
        const decision = can(principal, 'read', 'gdpr', {
          organizationId: request.organizationId,
          schoolId: request.schoolId,
        })
        if (!decision.allowed) return null
        const student = request.subjectStudentId
          ? db.data.students.find((s) => s.id === request.subjectStudentId)
          : undefined
        const masked = Boolean(student?.protectedIdentity && !principal.protectedClearance)
        const handler = request.handledBy ? users.find((u) => u.id === request.handledBy) : undefined
        return {
          id: request.id,
          request,
          student,
          masked,
          subjectLabel: masked ? maskName(request.subjectName) : request.subjectName,
          handlerLabel: handler ? (handler.id === principal.userId ? 'Du' : handler.name) : 'Ej tilldelad',
          left: daysLeft(request.dueAt),
        }
      })
      .filter((r): r is Row => r !== null)
  }, [principal, refresh])

  // Håll exportförloppet levande medan jobb bearbetas.
  useEffect(() => {
    void refresh
    const active = listGdprExports(principal.organizationId).some(
      (j) => j.status === 'köad' || j.status === 'bearbetar',
    )
    if (!active) return
    const t = setInterval(bump, 500)
    return () => clearInterval(t)
  }, [principal.organizationId, refresh])

  const kpi = useMemo(() => {
    let open = 0
    let dueSoon = 0
    let done = 0
    for (const r of rows) {
      if (isOpenStatus(r.request.status)) {
        open += 1
        if (r.left <= 30) dueSoon += 1
      }
      if (r.request.status === 'fardigstalld') done += 1
    }
    return { open, dueSoon, done }
  }, [rows])

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined
  const exports = useMemo(() => {
    void refresh
    return listGdprExports(principal.organizationId)
  }, [principal.organizationId, refresh])

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="GDPR & dataskydd" icon="ShieldCheck" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const tabs: { value: TabKey; label: string; icon: string; count?: number }[] = [
    { value: 'begaranden', label: 'Begäranden', icon: 'Inbox', count: rows.length },
    { value: 'register', label: 'Behandlingsregister', icon: 'BookLock', count: PROCESSING_REGISTER.length },
    { value: 'underbitraden', label: 'Underbiträden', icon: 'Network' },
    { value: 'atkomst', label: 'Åtkomst & logg', icon: 'ScrollText' },
  ]

  return (
    <>
      <PageHeader
        title="GDPR & dataskydd"
        icon="ShieldCheck"
        subtitle="Registrerades rättigheter, behandlingsregister och spårbar åtkomst."
        actions={
          canCreate ? (
            <Button icon="Plus" onClick={() => setNewOpen(true)}>
              Ny begäran
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Öppna begäranden"
          value={kpi.open}
          icon="FolderOpen"
          tone={kpi.open ? 'primary' : 'neutral'}
          hint="Kräver handläggning"
        />
        <StatCard
          label="Förfaller inom 30 dagar"
          value={kpi.dueSoon}
          icon="CalendarClock"
          tone={kpi.dueSoon ? 'warning' : 'neutral'}
          hint="Lagstadgad svarstid: 1 månad"
        />
        <StatCard
          label="Färdigställda"
          value={kpi.done}
          icon="CheckCheck"
          tone={kpi.done ? 'success' : 'neutral'}
          hint="Avslutade denna period"
        />
      </div>

      <div className="mb-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'begaranden' && (
        <RequestsTab
          rows={rows}
          loading={loading}
          canCreate={canCreate}
          exports={exports}
          onNew={() => setNewOpen(true)}
          onOpen={(id) => setSelectedId(id)}
        />
      )}
      {tab === 'register' && <RegisterTab />}
      {tab === 'underbitraden' && <SubprocessorsTab organizationId={principal.organizationId} />}
      {tab === 'atkomst' && <AccessLogTab organizationId={principal.organizationId} />}

      {newOpen && (
        <NewRequestModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            bump()
            setNewOpen(false)
          }}
        />
      )}

      {selected && (
        <RequestDetailModal
          row={selected}
          canUpdate={canUpdate}
          canExport={canExport}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Flik: Begäranden
// ---------------------------------------------------------------------------

function DueBadge({ left, status }: { left: number; status: GdprStatus }) {
  if (!isOpenStatus(status)) return <span className="text-2xs text-ink-subtle">—</span>
  if (left < 0) return <Badge tone="danger" icon="TriangleAlert">{Math.abs(left)} d försenad</Badge>
  if (left <= 7) return <Badge tone="warning" icon="Clock">{left} d kvar</Badge>
  return <span className="text-2xs text-ink-muted tabular-nums">{left} d kvar</span>
}

function RequestsTab({
  rows,
  loading,
  canCreate,
  exports,
  onNew,
  onOpen,
}: {
  rows: Row[]
  loading: boolean
  canCreate: boolean
  exports: ReturnType<typeof listGdprExports>
  onNew: () => void
  onOpen: (id: string) => void
}) {
  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: 'Typ',
      render: (r) => (
        <Badge tone={GDPR_TYPE_META[r.request.type].tone} icon={GDPR_TYPE_META[r.request.type].icon}>
          {GDPR_TYPE_LABEL[r.request.type]}
        </Badge>
      ),
    },
    {
      key: 'subject',
      header: 'Berörd',
      render: (r) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-ink truncate">{r.subjectLabel}</span>
          {r.masked && (
            <span title="Skyddad identitet – maskerad">
              <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning shrink-0" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge
          tone={GDPR_STATUS_META[r.request.status].tone}
          icon={GDPR_STATUS_META[r.request.status].icon}
          label={GDPR_STATUS_LABEL[r.request.status]}
        />
      ),
    },
    {
      key: 'due',
      header: 'Förfaller',
      render: (r) => (
        <div>
          <div className="text-ink tabular-nums">{fmtDate(r.request.dueAt)}</div>
          <div className="mt-0.5"><DueBadge left={r.left} status={r.request.status} /></div>
        </div>
      ),
    },
    {
      key: 'handler',
      header: 'Handläggare',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.handlerLabel}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <Card>
        {loading ? (
          <LoadingRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="ShieldCheck"
            title="Inga registrerade begäranden"
            description="Begäranden om registerutdrag, radering och rättelse visas här för handläggning."
            actionLabel={canCreate ? 'Ny begäran' : undefined}
            onAction={canCreate ? onNew : undefined}
          />
        ) : (
          <DataTable columns={columns} rows={rows} onRowClick={(r) => onOpen(r.id)} caption="GDPR-begäranden" />
        )}
      </Card>

      {exports.length > 0 && (
        <Card>
          <CardHeader
            title="Registerutdrag & dataexport"
            icon="FileOutput"
            subtitle="Säkra exportjobb – skyddade uppgifter filtreras bort automatiskt."
          />
          <CardBody className="space-y-3">
            {exports.map((job) => (
              <div key={job.id} className="rounded-field border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name="FileText" className="h-4 w-4 text-ink-subtle shrink-0" />
                    <span className="text-sm font-medium text-ink truncate">{job.title}</span>
                    <ClassificationBadge level={4} showLabel={false} />
                  </div>
                  <StatusBadge
                    tone={REPORT_STATUS_META[job.status].tone}
                    label={REPORT_STATUS_META[job.status].label}
                  />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar
                    value={job.progress}
                    tone={job.status === 'klar' ? 'success' : 'primary'}
                    showValue
                    className="flex-1"
                  />
                  <span className="text-2xs text-ink-subtle uppercase tracking-wide">{job.format}</span>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ny begäran (StepIndicator: typ → berörd → grund → skicka)
// ---------------------------------------------------------------------------

const NEW_STEPS = [{ label: 'Typ' }, { label: 'Berörd person' }, { label: 'Grund' }, { label: 'Skicka' }]

const LEGAL_BASES = [
  'Rättslig förpliktelse (skollagen)',
  'Myndighetsutövning / allmänt intresse',
  'Avtal',
  'Samtycke',
  'Berättigat intresse',
]

const TYPE_ORDER: GdprType[] = ['registerutdrag', 'radering', 'rättelse', 'begränsning', 'dataportabilitet']

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const principal = usePrincipal()
  const [step, setStep] = useState(0)
  const [type, setType] = useState<GdprType>('registerutdrag')
  const [subjectName, setSubjectName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [legalBasis, setLegalBasis] = useState(LEGAL_BASES[0])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Elever inom principalens räckvidd (för koppling av begäran).
  const scopedStudents = useMemo(
    () =>
      db.data.students.filter((s) =>
        can(principal, 'read', 'student', {
          organizationId: s.organizationId,
          schoolId: s.schoolId,
          classId: s.classId,
          studentId: s.id,
          protectedIdentity: s.protectedIdentity,
        }).allowed,
      ),
    [principal],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as Student[]
    return scopedStudents
      .filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q))
      .slice(0, 6)
  }, [scopedStudents, query])

  const selectedStudent = studentId ? scopedStudents.find((s) => s.id === studentId) : undefined
  const canNext = (step === 0 && !!type) || (step === 1 && subjectName.trim().length > 1) || step === 2 || step === 3

  function pickStudent(s: Student) {
    const masked = s.protectedIdentity && !principal.protectedClearance
    setStudentId(s.id)
    setSubjectName(masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`)
    setQuery('')
  }

  function submit() {
    setError(null)
    const input: CreateGdprInput = {
      type,
      subjectName,
      subjectStudentId: studentId,
      schoolId: selectedStudent?.schoolId ?? principal.schoolIds[0] ?? null,
      reason: `${legalBasis}${note.trim() ? ` – ${note.trim()}` : ''}`,
    }
    try {
      createGdprRequest(principal, input)
      setDone(true)
    } catch (e) {
      if (e instanceof ForbiddenError || e instanceof RateLimitedError) setError(e.message)
      else setError('Begäran kunde inte registreras just nu. Försök igen om en stund.')
    }
  }

  if (done) {
    return (
      <Modal open onClose={onCreated} title="Begäran registrerad" footer={<Button onClick={onCreated}>Klar</Button>}>
        <div className="flex flex-col items-center py-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-success-soft text-success">
            <Icon name="ShieldCheck" className="h-7 w-7" />
          </span>
          <h3 className="mt-4 font-semibold text-ink">Begäran är mottagen</h3>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            {GDPR_TYPE_LABEL[type]} för {subjectName || 'den registrerade'} har registrerats. Svarstiden är en
            månad och ärendet syns nu i handläggningskön.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny GDPR-begäran"
      description="Registrera en begäran om den registrerades rättigheter."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" icon="ChevronLeft" onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}>
            {step === 0 ? 'Avbryt' : 'Tillbaka'}
          </Button>
          {step < 3 ? (
            <Button iconRight="ChevronRight" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Nästa
            </Button>
          ) : (
            <Button icon="Send" onClick={submit}>
              Registrera begäran
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={NEW_STEPS} current={step} />
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
          <p className="text-sm text-ink-muted">Vilken rättighet gäller begäran?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPE_ORDER.map((t) => {
              const meta = GDPR_TYPE_META[t]
              const active = t === type
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
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
                    <Icon name={meta.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ink">{GDPR_TYPE_LABEL[t]}</span>
                      <span className="text-2xs text-ink-subtle">{meta.article}</span>
                    </span>
                    <span className="mt-0.5 block text-2xs text-ink-subtle">{meta.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Steg 2: Berörd person */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Berörd person</label>
            <TextInput
              value={subjectName}
              icon="User"
              placeholder="Namn på den registrerade"
              onChange={(e) => {
                setSubjectName(e.target.value)
                setStudentId(null)
              }}
            />
            <p className="mt-1 text-2xs text-ink-subtle">Ange namn, eller koppla till en elev nedan.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Koppla till elev <span className="text-ink-subtle">(valfritt)</span>
            </label>
            <TextInput
              value={query}
              icon="Search"
              placeholder="Sök elev inom din behörighet"
              onChange={(e) => setQuery(e.target.value)}
            />
            {matches.length > 0 && (
              <div className="mt-2 space-y-1">
                {matches.map((s) => {
                  const masked = s.protectedIdentity && !principal.protectedClearance
                  const name = masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`
                  return (
                    <button
                      key={s.id}
                      onClick={() => pickStudent(s)}
                      className="flex w-full items-center gap-2.5 rounded-field border border-border p-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <Avatar name={name} color={s.photoColor} size="sm" protected={masked} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink truncate">{name}</span>
                        <span className="block text-2xs text-ink-subtle">{s.gradeLabel}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedStudent && (
              <div className="mt-2 flex items-center gap-2 rounded-field border border-primary/30 bg-primary-soft px-3 py-2 text-sm text-primary">
                <Icon name="Link2" className="h-4 w-4 shrink-0" />
                <span className="flex-1">Kopplad till {subjectName}</span>
                <button
                  onClick={() => {
                    setStudentId(null)
                    setSubjectName('')
                  }}
                  className="text-2xs underline"
                >
                  Ta bort
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Steg 3: Grund */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Rättslig grund för behandlingen</label>
            <Select value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)}>
              {LEGAL_BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Anteckning <span className="text-ink-subtle">(valfritt)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="T.ex. hur den registrerade identifierats eller vilka system som berörs."
              className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          </div>
        </div>
      )}

      {/* Steg 4: Skicka */}
      {step === 3 && (
        <div className="space-y-4">
          <dl className="divide-y divide-border rounded-field border border-border">
            <SummaryRow label="Typ" value={`${GDPR_TYPE_LABEL[type]} · ${GDPR_TYPE_META[type].article}`} />
            <SummaryRow label="Berörd person" value={subjectName || '—'} />
            <SummaryRow label="Rättslig grund" value={legalBasis} />
            <SummaryRow label="Svarstid" value="Senast om 30 dagar" />
          </dl>
          <p className="text-2xs text-ink-subtle">
            Begäran registreras med dataklassificering 4 (känslig) och loggas i granskningsloggen.
          </p>
        </div>
      )}
    </Modal>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="font-medium text-ink text-right">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalj + statusflöde
// ---------------------------------------------------------------------------

function statusVariant(status: GdprStatus): 'primary' | 'secondary' | 'danger' {
  if (status === 'avslagen') return 'danger'
  if (status === 'godkand' || status === 'fardigstalld' || status === 'under_granskning') return 'primary'
  return 'secondary'
}

function RequestDetailModal({
  row,
  canUpdate,
  canExport,
  onClose,
  onChanged,
}: {
  row: Row
  canUpdate: boolean
  canExport: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const r = row.request
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [, bumpLocal] = useReducer((x) => x + 1, 0)

  const meta = GDPR_TYPE_META[r.type]
  const flowIndex = GDPR_FLOW.findIndex((f) => f.key === r.status)
  const nextStates = GDPR_NEXT_STATUS[r.status]
  const report = reportForRequest(r.id)
  const school = r.schoolId ? db.data.schools.find((s) => s.id === r.schoolId) : undefined
  const isExportType = r.type === 'registerutdrag' || r.type === 'dataportabilitet'

  function act(next: GdprStatus) {
    setError(null)
    setBusy(next)
    try {
      advanceGdprStatus(principal, r.id, next, note)
      setNote('')
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError || e instanceof RateLimitedError) setError(e.message)
      else setError('Statusen kunde inte uppdateras just nu.')
    } finally {
      setBusy(null)
    }
  }

  function runExport() {
    setError(null)
    setBusy('export')
    try {
      createGdprExport(principal, r)
      bumpLocal()
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError || e instanceof RateLimitedError) setError(e.message)
      else setError('Exportjobbet kunde inte startas just nu.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${GDPR_TYPE_LABEL[r.type]} · ${meta.article}`}
      description={row.subjectLabel}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Stäng
        </Button>
      }
    >
      <div className="space-y-4">
        {row.masked && (
          <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Skyddad identitet – namnet är maskerat och export av uppgifterna är spärrad.</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={GDPR_STATUS_META[r.status].tone}
            icon={GDPR_STATUS_META[r.status].icon}
            label={GDPR_STATUS_LABEL[r.status]}
          />
          <ClassificationBadge level={4} />
          <DueBadge left={row.left} status={r.status} />
        </div>

        <p className="text-sm text-ink-muted">{meta.desc}</p>

        {/* Statusflöde */}
        {r.status === 'avslagen' ? (
          <div className="flex items-center gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="CircleX" className="h-4 w-4 shrink-0" />
            <span>Begäran är avslagen. Den registrerade har informerats om skälen.</span>
          </div>
        ) : (
          <div className="rounded-field border border-border p-3">
            <StepIndicator steps={GDPR_FLOW.map((f) => ({ label: f.label }))} current={Math.max(0, flowIndex)} />
          </div>
        )}

        <dl className="divide-y divide-border rounded-field border border-border">
          <SummaryRow label="Berörd person" value={row.subjectLabel} />
          <SummaryRow label="Registrerad" value={fmtDateLong(r.requestedAt)} />
          <SummaryRow label="Förfaller" value={fmtDateLong(r.dueAt)} />
          <SummaryRow label="Skola" value={school?.name ?? 'Hela organisationen'} />
          <SummaryRow label="Handläggare" value={row.handlerLabel} />
        </dl>

        {/* Export / registerutdrag */}
        {isExportType && (
          <div className="rounded-field border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon name="FileOutput" className="h-4 w-4 text-ink-subtle" />
                <span className="text-sm font-medium text-ink">
                  {r.type === 'dataportabilitet' ? 'Dataexport (portabilitet)' : 'Registerutdrag'}
                </span>
              </div>
              {canExport && !report && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="Download"
                  loading={busy === 'export'}
                  disabled={row.masked || busy !== null}
                  onClick={runExport}
                >
                  Skapa export
                </Button>
              )}
            </div>
            {report ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-2xs text-ink-subtle">{report.title}</span>
                  <StatusBadge
                    tone={REPORT_STATUS_META[report.status].tone}
                    label={REPORT_STATUS_META[report.status].label}
                  />
                </div>
                <ProgressBar
                  value={report.progress}
                  tone={report.status === 'klar' ? 'success' : 'primary'}
                  showValue
                />
                <p className="mt-1.5 text-2xs text-ink-subtle">
                  Skyddade uppgifter filtreras bort. Format: {report.format.toUpperCase()}.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-2xs text-ink-subtle">
                {row.masked
                  ? 'Export är spärrad för skyddad identitet.'
                  : canExport
                    ? 'Starta ett säkert exportjobb – uppgifterna sammanställs i bakgrunden.'
                    : 'Du saknar behörighet att skapa export.'}
              </p>
            )}
          </div>
        )}

        {/* Handläggning */}
        {canUpdate && nextStates.length > 0 && (
          <div className="rounded-field border border-border p-3">
            <SectionTitle>Handläggning</SectionTitle>
            <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Anteckning (loggas)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={400}
              placeholder="Motivering till beslutet – syns i granskningsloggen."
              className="mb-3 w-full rounded-field border border-border bg-surface p-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            <div className="flex flex-wrap gap-2">
              {nextStates.map((ns) => (
                <Button
                  key={ns}
                  size="sm"
                  variant={statusVariant(ns)}
                  icon={GDPR_STATUS_META[ns].icon}
                  loading={busy === ns}
                  disabled={busy !== null}
                  onClick={() => act(ns)}
                >
                  {GDPR_STATUS_LABEL[ns]}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!canUpdate && (
          <p className="text-2xs text-ink-subtle">
            Du har läsbehörighet till detta ärende. Handläggning kräver utökad behörighet.
          </p>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Flik: Behandlingsregister (Art. 30)
// ---------------------------------------------------------------------------

function RegisterTab() {
  return (
    <Card>
      <CardHeader
        title="Behandlingsregister"
        icon="BookLock"
        subtitle="Register över behandlingar (art. 30) – kategori, rättslig grund, ändamål och gallring."
      />
      <CardBody>
        <div className="grid gap-3 md:grid-cols-2">
          {PROCESSING_REGISTER.map((p) => (
            <div key={p.id} className="rounded-field border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-ink">{p.category}</h4>
                <ClassificationBadge level={p.classification} />
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <RegisterField icon="Scale" label="Rättslig grund" value={p.legalBasis} />
                <RegisterField icon="Target" label="Ändamål" value={p.purpose} />
                <RegisterField icon="Timer" label="Lagring / gallring" value={p.retention} />
              </dl>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function RegisterField({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
      <div className="min-w-0">
        <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
        <dd className="text-ink">{value}</dd>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flik: Underbiträden (härledda från integrationer)
// ---------------------------------------------------------------------------

function SubprocessorsTab({ organizationId }: { organizationId: string }) {
  const subs = db.data.integrations.filter((i) => i.organizationId === organizationId)
  return (
    <Card>
      <CardHeader
        title="Personuppgiftsbiträden & underbiträden"
        icon="Network"
        subtitle="Tjänster som behandlar personuppgifter för organisationens räkning."
      />
      <CardBody>
        {subs.length === 0 ? (
          <EmptyState icon="Network" title="Inga registrerade underbiträden" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {subs.map((i) => (
              <div key={i.id} className="rounded-field border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                      <Icon name="Server" className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{i.name}</p>
                      <p className="text-2xs text-ink-subtle">{i.vendorHint}</p>
                    </div>
                  </div>
                  <StatusBadge tone={INT_TONE[i.status]} label={INTEGRATION_STATUS_LABEL[i.status]} />
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  <RegisterField icon="Database" label="Behandlade uppgifter" value={i.dataTouched || '—'} />
                  {i.privacyNote && <RegisterField icon="ShieldCheck" label="Dataskydd" value={i.privacyNote} />}
                </dl>
                {i.lastSyncAt && (
                  <p className="mt-2 text-2xs text-ink-subtle">Senaste behandling: {fmtRelative(i.lastSyncAt)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Flik: Åtkomst & logg
// ---------------------------------------------------------------------------

const GDPR_LOG_RESOURCES = ['gdpr', 'consent', 'export']
const RISK_TONE: Record<string, Tone> = { låg: 'neutral', medel: 'info', hög: 'warning', kritisk: 'danger' }

function AccessLogTab({ organizationId }: { organizationId: string }) {
  const sessions = db.data.supportSessions.filter((s) => s.organizationId === organizationId)
  const users = db.data.users
  const logs = db.data.auditLogs
    .filter((l) => l.organizationId === organizationId && GDPR_LOG_RESOURCES.includes(l.resource))
    .slice(0, 12)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Supportåtkomst"
          icon="LifeBuoy"
          subtitle="Kontrollerad, tidsbegränsad åtkomst från systemroller."
        />
        <CardBody className="space-y-3">
          {sessions.length === 0 ? (
            <EmptyState icon="LifeBuoy" title="Ingen supportåtkomst registrerad" />
          ) : (
            sessions.map((s) => {
              const u = users.find((x) => x.id === s.supportUserId)
              const approver = s.approvedBy ? users.find((x) => x.id === s.approvedBy) : undefined
              return (
                <div key={s.id} className="rounded-field border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={u?.name ?? 'Support'} color={u?.avatarColor} size="sm" />
                      <span className="text-sm font-medium text-ink truncate">{u?.name ?? 'Supportanvändare'}</span>
                      {s.breakGlass && <Badge tone="danger" icon="Siren">Break-glass</Badge>}
                    </div>
                    <StatusBadge
                      tone={SUPPORT_STATUS_META[s.status].tone}
                      icon={SUPPORT_STATUS_META[s.status].icon}
                      label={SUPPORT_STATUS_LABEL[s.status]}
                    />
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">{s.reason}</p>
                  {s.modules.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.modules.map((m) => (
                        <Badge key={m} tone="neutral">{m}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-subtle">
                    {s.startedAt && <span>Start: {fmtDateTime(s.startedAt)}</span>}
                    {s.expiresAt && <span>Går ut: {fmtDateTime(s.expiresAt)}</span>}
                    <span>{s.actionsLogged} loggade åtgärder</span>
                    {approver && <span>Godkänd av {approver.name}</span>}
                  </div>
                </div>
              )
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="GDPR-relaterad granskningslogg"
          icon="ScrollText"
          subtitle="Åtgärder på GDPR, samtycken och exporter."
        />
        <CardBody className="space-y-2">
          {logs.length === 0 ? (
            <EmptyState icon="ScrollText" title="Inga loggposter än" />
          ) : (
            logs.map((l) => {
              const actor = l.actorUserId ? users.find((u) => u.id === l.actorUserId) : undefined
              return (
                <div key={l.id} className="flex items-start gap-3 rounded-field border border-border p-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                    <Icon name="FileClock" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-2xs text-ink">{l.action}</span>
                      <Badge tone={RISK_TONE[l.riskLevel] ?? 'neutral'}>{l.riskLevel}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted truncate">{l.targetLabel || '—'}</p>
                    <p className="text-2xs text-ink-subtle">
                      {actor?.name ?? l.actorRole} · {fmtRelative(l.at)}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </CardBody>
      </Card>
    </div>
  )
}
