import { useEffect, useReducer, useState } from 'react'
import {
  Button, Card, CardHeader, CardBody, Badge, StatusBadge, StatCard,
  ProgressRing, StepIndicator, TextInput, Select, Modal, PageHeader, SectionTitle,
  DataTable, DeniedState, Icon,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { useSession } from '@/core/state/session'
import { db } from '@/data/db/store'
import { SCHOOL_TYPE_LABEL, type SupportSession } from '@/data/schema'
import { RESOURCE_LABEL, type ResourceKey } from '@/core/domain/permissions'
import { fmtDateTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  requestSupportAccess, activateBreakGlass, endSupportSession, canSelfApprove,
  type Outcome,
} from './service'

/** Moduler som kan ingå i en supportsessions räckvidd. */
const MODULE_OPTIONS: ResourceKey[] = [
  'student', 'guardian', 'attendance', 'absence', 'health', 'incident',
  'documentation', 'assessment', 'file', 'consent', 'import', 'integration', 'system_health',
]

const DURATIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 timme' },
  { hours: 4, label: '4 timmar' },
  { hours: 24, label: '24 timmar' },
]

const STATUS_LABEL: Record<SupportSession['status'], string> = {
  aktiv: 'Aktiv',
  begärd: 'Väntar på godkännande',
  avslutad: 'Avslutad',
  nekad: 'Nekad',
}

function statusTone(status: SupportSession['status']): Tone {
  switch (status) {
    case 'aktiv': return 'success'
    case 'begärd': return 'warning'
    case 'nekad': return 'danger'
    default: return 'neutral'
  }
}

function userName(id: string | null): string {
  if (!id) return '—'
  return db.data.users.find((u) => u.id === id)?.name ?? id
}

function scopeLabel(schoolId: string | null): string {
  if (!schoolId) return 'Hela organisationen'
  return db.data.schools.find((s) => s.id === schoolId)?.name ?? schoolId
}

function moduleLabels(modules: string[]): string[] {
  if (modules.length === 0) return ['Alla moduler i räckvidd']
  return modules.map((m) => RESOURCE_LABEL[m as ResourceKey] ?? m)
}

/** Kvarvarande giltighetstid för en aktiv session. */
function remaining(session: SupportSession): { pct: number; text: string; expired: boolean } {
  if (!session.startedAt || !session.expiresAt) return { pct: 0, text: 'Okänd', expired: false }
  const start = Date.parse(session.startedAt)
  const end = Date.parse(session.expiresAt)
  const now = Date.now()
  const total = Math.max(1, end - start)
  const left = end - now
  if (left <= 0) return { pct: 0, text: 'Utgången', expired: true }
  const mins = Math.round(left / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const text = h > 0 ? `${h} tim ${m} min kvar` : `${m} min kvar`
  return { pct: Math.max(0, Math.min(100, (left / total) * 100)), text, expired: false }
}

type Notice = { tone: Tone; icon: string; text: string }

function noticeFor(outcome: Outcome, breakGlass = false): Notice {
  if (!outcome.ok) return { tone: 'danger', icon: 'ShieldAlert', text: outcome.error }
  if (breakGlass) {
    return { tone: 'danger', icon: 'Siren', text: 'Nödåtkomst aktiverad. All aktivitet loggas med kritisk risknivå.' }
  }
  if (outcome.status === 'aktiv') {
    return { tone: 'success', icon: 'ShieldCheck', text: 'Supportåtkomst aktiverad. Sessionen är tidsbegränsad och loggas.' }
  }
  return { tone: 'info', icon: 'Clock', text: 'Begäran skickad. Åtkomst öppnas först efter godkännande.' }
}

export function SupportPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'support_access')
  const canCreate = usePermission('create', 'support_access').allowed
  const supportActive = useSession((s) => s.supportActive)
  const breakGlassFlag = useSession((s) => s.breakGlass)
  const setSupportActive = useSession((s) => s.setSupportActive)
  const setBreakGlass = useSession((s) => s.setBreakGlass)

  const [, force] = useReducer((x: number) => x + 1, 0)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Begär-flöde (wizard)
  const [requestOpen, setRequestOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [schoolId, setSchoolId] = useState('')
  const [reason, setReason] = useState('')
  const [modules, setModules] = useState<string[]>([])
  const [durationHours, setDurationHours] = useState(4)

  // Break-glass
  const [glassOpen, setGlassOpen] = useState(false)
  const [glassReason, setGlassReason] = useState('')

  const readAllowed = readDecision.allowed

  // Härled sessioner ur datalagret.
  const orgSessions = db.data.supportSessions.filter((s) => s.organizationId === principal.organizationId)
  const myActiveSessions = orgSessions.filter((s) => s.status === 'aktiv' && s.supportUserId === principal.userId)
  const activeSession = myActiveSessions[0]
  const myPending = orgSessions.filter((s) => s.status === 'begärd' && s.supportUserId === principal.userId)
  const excluded = new Set([...myActiveSessions.map((s) => s.id), ...myPending.map((s) => s.id)])
  const history = orgSessions.filter((s) => !excluded.has(s.id))

  const orgSchools = db.data.schools.filter((s) => s.organizationId === principal.organizationId)

  // Håll behörighetsmotorn synkad med den aktiva sessionen.
  useEffect(() => {
    if (!readAllowed) return
    const isActive = !!activeSession
    if (isActive !== supportActive) setSupportActive(isActive)
    const isGlass = !!activeSession?.breakGlass
    if (isGlass !== breakGlassFlag) setBreakGlass(isGlass)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.breakGlass, supportActive, breakGlassFlag, readAllowed])

  if (!readAllowed) {
    return (
      <>
        <PageHeader title="Supportåtkomst" icon="LifeBuoy" subtitle="Kontrollerad, tidsbegränsad åtkomst till persondata" />
        <Card><DeniedState reason={readDecision.reason} /></Card>
      </>
    )
  }

  const selfApprove = canSelfApprove(principal)

  function openRequest() {
    setStep(0)
    setSchoolId('')
    setReason('')
    setModules([])
    setDurationHours(4)
    setRequestOpen(true)
  }

  function toggleModule(m: string) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  function submitRequest() {
    const outcome = requestSupportAccess(principal, {
      schoolId: schoolId || null,
      reason,
      modules,
      durationHours,
    })
    setNotice(noticeFor(outcome))
    if (outcome.ok) {
      if (outcome.status === 'aktiv') setSupportActive(true)
      setRequestOpen(false)
    }
    force()
  }

  function confirmBreakGlass() {
    const outcome = activateBreakGlass(principal, { schoolId: schoolId || null, reason: glassReason })
    setNotice(noticeFor(outcome, true))
    if (outcome.ok) {
      setSupportActive(true)
      setBreakGlass(true)
      setGlassOpen(false)
      setGlassReason('')
    }
    force()
  }

  function end(session: SupportSession) {
    const wasActive = session.status === 'aktiv'
    const outcome = endSupportSession(principal, session)
    if (outcome.ok) {
      // Koppla från motorn endast om detta var användarens sista aktiva session.
      if (wasActive && !myActiveSessions.some((s) => s.id !== session.id)) {
        setSupportActive(false)
        if (session.breakGlass) setBreakGlass(false)
      }
      setNotice({
        tone: 'neutral',
        icon: 'ShieldOff',
        text: wasActive ? 'Sessionen är avslutad och avregistrerad.' : 'Begäran återkallad.',
      })
    } else {
      setNotice({ tone: 'danger', icon: 'ShieldAlert', text: outcome.error })
    }
    force()
  }

  const activeCount = orgSessions.filter((s) => s.status === 'aktiv').length
  const pendingCount = orgSessions.filter((s) => s.status === 'begärd').length
  const glassCount = orgSessions.filter((s) => s.breakGlass).length
  const actionsSum = orgSessions.reduce((sum, s) => sum + s.actionsLogged, 0)

  const columns: Column<SupportSession>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={statusTone(s.status)} label={STATUS_LABEL[s.status]} />
          {s.breakGlass && <Badge tone="danger" icon="Siren">Nödåtkomst</Badge>}
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Räckvidd',
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{scopeLabel(s.schoolId)}</p>
          <p className="truncate text-2xs text-ink-subtle">{moduleLabels(s.modules).join(', ')}</p>
        </div>
      ),
    },
    { key: 'reason', header: 'Anledning', hideOnMobile: true, render: (s) => <span className="line-clamp-2 max-w-[22rem] text-ink-muted">{s.reason}</span> },
    { key: 'approvedBy', header: 'Godkänd av', hideOnMobile: true, render: (s) => <span className="text-ink-muted">{userName(s.approvedBy)}</span> },
    { key: 'user', header: 'Användare', hideOnMobile: true, render: (s) => <span className="text-ink-muted">{userName(s.supportUserId)}</span> },
    { key: 'actions', header: 'Loggat', align: 'right', render: (s) => <span className="tabular-nums font-medium text-ink">{s.actionsLogged}</span> },
    {
      key: 'period',
      header: 'Period',
      hideOnMobile: true,
      render: (s) => (
        <span className="whitespace-nowrap text-2xs text-ink-subtle">
          {s.startedAt ? fmtDateTime(s.startedAt) : 'Ej startad'}
          {s.expiresAt ? ` – ${fmtTime(s.expiresAt)}` : ''}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Supportåtkomst"
        icon="LifeBuoy"
        subtitle="Kontrollerad, tidsbegränsad åtkomst till persondata – ingen fri sökning, allt loggas"
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon="Siren" onClick={() => { setSchoolId(''); setGlassReason(''); setGlassOpen(true) }}>
                Nödåtkomst
              </Button>
              <Button size="sm" icon="ShieldPlus" onClick={openRequest}>
                Begär supportåtkomst
              </Button>
            </div>
          ) : undefined
        }
      />

      {notice && (
        <div
          className="mb-4 flex items-start gap-3 rounded-card border px-4 py-3"
          style={{
            backgroundColor: `rgb(var(--c-${notice.tone === 'neutral' ? 'ink-subtle' : notice.tone}) / 0.10)`,
            borderColor: `rgb(var(--c-${notice.tone === 'neutral' ? 'ink-subtle' : notice.tone}) / 0.25)`,
          }}
          role="status"
        >
          <Icon name={notice.icon} className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `rgb(var(--c-${notice.tone === 'neutral' ? 'ink-subtle' : notice.tone}))` }} />
          <p className="flex-1 text-sm text-ink">{notice.text}</p>
          <button onClick={() => setNotice(null)} className="text-ink-subtle hover:text-ink" aria-label="Stäng">
            <Icon name="X" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Nyckeltal */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aktiva sessioner" value={activeCount} icon="ShieldCheck" tone={activeCount ? 'success' : 'neutral'} />
        <StatCard label="Väntar på godkännande" value={pendingCount} icon="Clock" tone={pendingCount ? 'warning' : 'neutral'} />
        <StatCard label="Loggade åtgärder" value={actionsSum} icon="ScrollText" tone="primary" hint="Total spårning" />
        <StatCard label="Nödåtkomster" value={glassCount} icon="Siren" tone={glassCount ? 'danger' : 'neutral'} />
      </div>

      {/* Aktiv session */}
      {activeSession ? (
        <ActiveSessionCard session={activeSession} onEnd={() => end(activeSession)} canEnd={canCreate} />
      ) : (
        <Card className="mb-6">
          <CardBody className="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-panel bg-primary-soft text-primary">
                <Icon name="ShieldCheck" className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-ink">Ingen aktiv supportsession</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Persondata nås endast via en godkänd, tidsbegränsad session. Begär åtkomst för det du behöver felsöka.
                </p>
              </div>
            </div>
            {canCreate && <Button icon="ShieldPlus" onClick={openRequest}>Begär supportåtkomst</Button>}
          </CardBody>
        </Card>
      )}

      {/* Väntande begäranden */}
      {myPending.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Väntar på godkännande</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {myPending.map((s) => (
              <Card key={s.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="warning" label="Väntar på godkännande" />
                      {s.breakGlass && <Badge tone="danger" icon="Siren">Nödåtkomst</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-ink">{s.reason}</p>
                    <p className="mt-1 text-2xs text-ink-subtle">{scopeLabel(s.schoolId)} · {moduleLabels(s.modules).join(', ')}</p>
                  </div>
                  {canCreate && (
                    <Button variant="ghost" size="sm" icon="X" onClick={() => end(s)}>Återkalla</Button>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Historik */}
      <Card>
        <CardHeader
          title="Sessionshistorik"
          icon="History"
          subtitle="Tidigare och pågående sessioner i organisationen"
        />
        <CardBody className="px-0 pb-0">
          <DataTable
            columns={columns}
            rows={history}
            caption="Historik över supportsessioner"
            emptyTitle="Inga tidigare sessioner"
            emptyDescription="Sessioner visas här när de skapats."
          />
        </CardBody>
      </Card>

      {/* Integritetsnot */}
      <p className="mt-4 flex items-center gap-2 text-2xs text-ink-subtle">
        <Icon name="Lock" className="h-3.5 w-3.5" />
        Supportåtkomst ger aldrig fri sökning i elevdata. Åtkomsten är avgränsad till valda moduler, tidsbegränsad och fullständigt granskningsloggad.
      </p>

      {/* Begär-flöde */}
      <RequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        step={step}
        setStep={setStep}
        schoolId={schoolId}
        setSchoolId={setSchoolId}
        reason={reason}
        setReason={setReason}
        modules={modules}
        toggleModule={toggleModule}
        durationHours={durationHours}
        setDurationHours={setDurationHours}
        orgSchools={orgSchools}
        selfApprove={selfApprove}
        onSubmit={submitRequest}
      />

      {/* Break-glass */}
      <Modal
        open={glassOpen}
        onClose={() => setGlassOpen(false)}
        title="Aktivera nödåtkomst"
        description="Break-glass kringgår godkännande vid akut läge"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGlassOpen(false)}>Avbryt</Button>
            <Button variant="danger" icon="Siren" disabled={glassReason.trim().length < 5} onClick={confirmBreakGlass}>
              Aktivera nödåtkomst
            </Button>
          </>
        }
      >
        <div className="space-y-4 py-1">
          <div className="flex items-start gap-3 rounded-card border border-danger/25 bg-danger-soft px-4 py-3">
            <Icon name="TriangleAlert" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <p className="text-sm text-ink">
              Nödåtkomst ska endast användas vid akut behov. Åtkomsten aktiveras direkt utan förhandsgodkännande,
              är giltig i 1 timme och <span className="font-semibold">varje åtgärd loggas med kritisk risknivå</span> och granskas i efterhand.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Motivering (obligatorisk)</span>
            <TextInput
              placeholder="Beskriv det akuta behovet…"
              value={glassReason}
              onChange={(e) => setGlassReason(e.target.value)}
            />
            <span className="mt-1 block text-2xs text-ink-subtle">Minst 5 tecken. Motiveringen sparas i granskningsloggen.</span>
          </label>
        </div>
      </Modal>
    </>
  )
}

/** Framträdande kort för den aktiva sessionen. */
function ActiveSessionCard({
  session, onEnd, canEnd,
}: {
  session: SupportSession
  onEnd: () => void
  canEnd: boolean
}) {
  const rem = remaining(session)
  const ringTone: Tone = session.breakGlass ? 'danger' : rem.pct < 20 ? 'warning' : 'success'

  return (
    <Card className={cn('mb-6 overflow-hidden', session.breakGlass ? 'border-danger/40' : 'border-success/40')}>
      <div className={cn('h-1 w-full', session.breakGlass ? 'bg-danger' : 'bg-success')} aria-hidden />
      <CardBody className="pt-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <ProgressRing value={rem.pct} tone={ringTone} size={64} stroke={6} label={<Icon name={session.breakGlass ? 'Siren' : 'ShieldCheck'} className="h-5 w-5" />} sublabel="kvar" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', session.breakGlass ? 'bg-danger' : 'bg-success')} />
                  <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', session.breakGlass ? 'bg-danger' : 'bg-success')} />
                </span>
                <h2 className="text-lg font-semibold text-ink">
                  {session.breakGlass ? 'Nödåtkomst aktiv' : 'Aktiv supportsession'}
                </h2>
                {session.breakGlass && <Badge tone="danger" icon="Siren">Break-glass</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-muted">{session.reason}</p>
            </div>
          </div>
          {canEnd && (
            <Button variant="danger" icon="ShieldOff" onClick={onEnd} className="shrink-0">
              Avsluta session
            </Button>
          )}
        </div>

        <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field icon="CalendarClock" label="Giltig till">
            <span className={cn(rem.expired && 'text-danger')}>
              {session.expiresAt ? fmtDateTime(session.expiresAt) : '—'}
            </span>
            <span className="block text-2xs text-ink-subtle">{rem.text}</span>
          </Field>
          <Field icon="UserCheck" label="Godkänd av">
            {session.breakGlass ? <span className="text-danger">Ingen (nödläge)</span> : userName(session.approvedBy)}
          </Field>
          <Field icon="Building2" label="Räckvidd">
            {scopeLabel(session.schoolId)}
          </Field>
          <Field icon="ScrollText" label="Loggade åtgärder">
            <span className="tabular-nums">{session.actionsLogged}</span>
          </Field>
        </dl>

        <div className="mt-4">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Moduler i räckvidd</p>
          <div className="flex flex-wrap gap-1.5">
            {moduleLabels(session.modules).map((m) => (
              <Badge key={m} tone={session.breakGlass ? 'danger' : 'primary'} icon="Boxes">{m}</Badge>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function Field({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  )
}

/** Flerstegsflöde för att begära supportåtkomst. */
function RequestModal({
  open, onClose, step, setStep, schoolId, setSchoolId, reason, setReason,
  modules, toggleModule, durationHours, setDurationHours, orgSchools, selfApprove, onSubmit,
}: {
  open: boolean
  onClose: () => void
  step: number
  setStep: (n: number) => void
  schoolId: string
  setSchoolId: (v: string) => void
  reason: string
  setReason: (v: string) => void
  modules: string[]
  toggleModule: (m: string) => void
  durationHours: number
  setDurationHours: (n: number) => void
  orgSchools: { id: string; name: string; type: keyof typeof SCHOOL_TYPE_LABEL }[]
  selfApprove: boolean
  onSubmit: () => void
}) {
  const steps = [{ label: 'Skola' }, { label: 'Anledning' }, { label: 'Moduler' }, { label: 'Tidsgräns' }]
  const canNext =
    step === 1 ? reason.trim().length >= 5 : step === 2 ? modules.length >= 1 : true
  const isLast = step === steps.length - 1

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Begär supportåtkomst"
      description="Strukturerad, tidsbegränsad åtkomst – aldrig fri sökning"
      size="lg"
      footer={
        <>
          {step > 0 ? (
            <Button variant="ghost" icon="ChevronLeft" onClick={() => setStep(step - 1)}>Tillbaka</Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          )}
          {isLast ? (
            <Button icon={selfApprove ? 'ShieldCheck' : 'Send'} onClick={onSubmit} disabled={!canNext}>
              {selfApprove ? 'Aktivera åtkomst' : 'Skicka begäran'}
            </Button>
          ) : (
            <Button iconRight="ChevronRight" onClick={() => setStep(step + 1)} disabled={!canNext}>Nästa</Button>
          )}
        </>
      }
    >
      <div className="py-1">
        <div className="mb-5">
          <StepIndicator steps={steps} current={step} />
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Välj vilken skola åtkomsten gäller. Väljs ingen skola gäller åtkomsten hela organisationen.</p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Skola / räckvidd</span>
              <Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
                <option value="">Hela organisationen</option>
                {orgSchools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {SCHOOL_TYPE_LABEL[s.type]}</option>
                ))}
              </Select>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Anledningen sparas i granskningsloggen och visas för den som godkänner.</p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Anledning (obligatorisk)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="T.ex. Felsökning av importfel för vårdnadshavare i klass 4A…"
                className="w-full rounded-field border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <span className="mt-1 block text-2xs text-ink-subtle">Minst 5 tecken. Var konkret om vad som ska felsökas.</span>
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Välj endast de moduler du behöver. Åtkomsten begränsas till dessa – inget annat.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULE_OPTIONS.map((m) => {
                const active = modules.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    onClick={() => toggleModule(m)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-field border px-3 py-2.5 text-left text-sm transition-colors',
                      active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border', active ? 'border-transparent bg-primary text-primary-fg' : 'border-border-strong text-transparent')}>
                      <Icon name="Check" className="h-3 w-3" />
                    </span>
                    <span className="flex-1">{RESOURCE_LABEL[m]}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-2xs text-ink-subtle">{modules.length} moduler valda</p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">Åtkomsten avslutas automatiskt när tiden löpt ut. Välj kortast möjliga tid.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {DURATIONS.map((d) => {
                const active = durationHours === d.hours
                return (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setDurationHours(d.hours)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-field border px-3 py-4 transition-colors',
                      active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink hover:bg-surface-2',
                    )}
                  >
                    <Icon name="Clock" className="h-5 w-5" />
                    <span className="text-sm font-medium">{d.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="rounded-card border border-border bg-surface-2 p-4">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Sammanfattning</p>
              <dl className="space-y-1 text-sm">
                <SummaryRow label="Räckvidd" value={schoolId ? (orgSchools.find((s) => s.id === schoolId)?.name ?? schoolId) : 'Hela organisationen'} />
                <SummaryRow label="Moduler" value={modules.length ? modules.map((m) => RESOURCE_LABEL[m as ResourceKey] ?? m).join(', ') : '—'} />
                <SummaryRow label="Tidsgräns" value={DURATIONS.find((d) => d.hours === durationHours)?.label ?? '—'} />
                <SummaryRow label="Godkännande" value={selfApprove ? 'Självgodkänns (administrativ behörighet)' : 'Kräver godkännande'} />
              </dl>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  )
}
