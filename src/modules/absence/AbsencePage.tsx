import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Tabs, Button, Badge, StatusBadge,
  Avatar, Modal, StepIndicator, TextInput, Segmented, Icon,
  EmptyState, DeniedState, LoadingRows,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, latency } from '@/data/db/store'
import type { AbsenceReport, AbsenceReason, AbsenceStatus, Student } from '@/data/schema'
import { ABSENCE_REASON_LABEL, ABSENCE_STATUS_LABEL } from '@/data/schema'
import { fmtDate, fmtDateLong, maskName } from '@/lib/format'
import { createAbsenceReport, updateAbsenceStatus, type CreateAbsenceInput } from './service'

// ---- Presentationskartor (färg + ikon per orsak/status) ----
const REASON_META: Record<AbsenceReason, { tone: Tone; icon: string }> = {
  sjuk: { tone: 'info', icon: 'Thermometer' },
  ledig: { tone: 'neutral', icon: 'Plane' },
  sen: { tone: 'warning', icon: 'Clock' },
  lakarbesok: { tone: 'primary', icon: 'Stethoscope' },
  tandlakare: { tone: 'primary', icon: 'Smile' },
  okand: { tone: 'danger', icon: 'HelpCircle' },
  annan: { tone: 'neutral', icon: 'MoreHorizontal' },
}

const STATUS_META: Record<AbsenceStatus, { tone: Tone; icon: string }> = {
  inskickad: { tone: 'info', icon: 'Send' },
  bekraftad: { tone: 'success', icon: 'CheckCircle2' },
  avslagen: { tone: 'danger', icon: 'XCircle' },
  kraver_atgard: { tone: 'warning', icon: 'TriangleAlert' },
}

/** Orsaker en vårdnadshavare får välja (okänd frånvaro sätts bara av skolan). */
const GUARDIAN_REASONS: AbsenceReason[] = ['sjuk', 'ledig', 'sen', 'lakarbesok', 'tandlakare', 'annan']

type TabKey = 'alla' | AbsenceStatus
const TAB_ORDER: TabKey[] = ['alla', 'inskickad', 'bekraftad', 'kraver_atgard', 'avslagen']
const TAB_LABEL: Record<TabKey, string> = {
  alla: 'Alla',
  inskickad: ABSENCE_STATUS_LABEL.inskickad,
  bekraftad: ABSENCE_STATUS_LABEL.bekraftad,
  kraver_atgard: ABSENCE_STATUS_LABEL.kraver_atgard,
  avslagen: ABSENCE_STATUS_LABEL.avslagen,
}

interface Row {
  /** = report.id, krävs av DataTable. */
  id: string
  report: AbsenceReport
  student?: Student
  masked: boolean
  studentLabel: string
  gradeLabel: string
  reporterLabel: string
}

function timeLabel(r: AbsenceReport): string {
  if (r.fullDay) return 'Heldag'
  if (r.fromTime && r.toTime) return `${r.fromTime}–${r.toTime}`
  if (r.fromTime) return `Från ${r.fromTime}`
  return 'Del av dag'
}

export function AbsencePage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'absence')
  const canCreate = usePermission('create', 'absence').allowed
  const canUpdate = usePermission('update', 'absence').allowed

  const isGuardian = principal.role === 'vardnadshavare'
  const canReport = isGuardian && canCreate
  const canHandle = !isGuardian && canUpdate

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('alla')
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [reportOpen, setReportOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Behörighetsfiltrerad lista: varje rad prövas mot motorn.
  const rows = useMemo<Row[]>(() => {
    void refresh
    const users = db.data.users
    return db.data.absences
      .map<Row | null>((report) => {
        const student = db.data.students.find((s) => s.id === report.studentId)
        const decision = can(principal, 'read', 'absence', {
          organizationId: report.organizationId,
          schoolId: report.schoolId,
          classId: student?.classId,
          studentId: report.studentId,
          protectedIdentity: student?.protectedIdentity,
        })
        if (!decision.allowed) return null
        const fullName = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
        const masked = Boolean(decision.masked)
        const reporter = users.find((u) => u.id === report.reportedByUserId)
        return {
          id: report.id,
          report,
          student,
          masked,
          studentLabel: masked ? maskName(fullName) : fullName,
          gradeLabel: student?.gradeLabel ?? '',
          reporterLabel:
            report.reportedByUserId === principal.userId ? 'Du' : reporter?.name ?? 'Okänd',
        }
      })
      .filter((r): r is Row => r !== null)
      .sort((a, b) => new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime())
  }, [principal, refresh])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { alla: rows.length, inskickad: 0, bekraftad: 0, kraver_atgard: 0, avslagen: 0 }
    for (const r of rows) c[r.report.status] += 1
    return c
  }, [rows])

  const visible = useMemo(
    () => (tab === 'alla' ? rows : rows.filter((r) => r.report.status === tab)),
    [rows, tab],
  )

  // Sammanfattning (inom behörighetsfiltrerad räckvidd).
  const today = fmtDate(new Date())
  const stats = useMemo(() => {
    let todaySubmitted = 0
    let needsAction = 0
    let unknown = 0
    for (const r of rows) {
      if (r.report.status === 'inskickad' && fmtDate(r.report.date) === today) todaySubmitted += 1
      if (r.report.status === 'kraver_atgard') needsAction += 1
      if (r.report.reason === 'okand') unknown += 1
    }
    return { todaySubmitted, needsAction, unknown }
  }, [rows, today])

  const kids = useMemo(
    () => db.data.students.filter((s) => principal.guardianStudentIds.includes(s.id)),
    [principal],
  )

  const selected = selectedId ? rows.find((r) => r.report.id === selectedId) : undefined

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Frånvaro" icon="CalendarX" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const columns: Column<Row>[] = [
    {
      key: 'student',
      header: 'Elev',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar
            name={r.studentLabel}
            color={r.student?.photoColor}
            size="sm"
            protected={r.masked}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-ink truncate">{r.studentLabel}</span>
              {r.masked && (
                <span title="Skyddad identitet – maskerad">
                  <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
                </span>
              )}
            </div>
            {r.gradeLabel && <div className="text-2xs text-ink-subtle">{r.gradeLabel}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Orsak',
      render: (r) => (
        <Badge tone={REASON_META[r.report.reason].tone} icon={REASON_META[r.report.reason].icon}>
          {ABSENCE_REASON_LABEL[r.report.reason]}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: 'Datum / tid',
      hideOnMobile: true,
      render: (r) => (
        <div>
          <div className="text-ink">{fmtDate(r.report.date)}</div>
          <div className="text-2xs text-ink-subtle">{timeLabel(r.report)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge
          tone={STATUS_META[r.report.status].tone}
          icon={STATUS_META[r.report.status].icon}
          label={ABSENCE_STATUS_LABEL[r.report.status]}
        />
      ),
    },
    {
      key: 'reporter',
      header: 'Inrapporterad av',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.reporterLabel}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Frånvaro"
        icon="CalendarX"
        subtitle={
          isGuardian
            ? 'Anmäl frånvaro för dina barn och följ status.'
            : 'Inkomna frånvaroanmälningar – bekräfta, avslå eller markera för åtgärd.'
        }
        actions={
          canReport ? (
            <Button icon="CalendarX" onClick={() => setReportOpen(true)}>
              Anmäl frånvaro
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Inskickade idag"
          value={stats.todaySubmitted}
          icon="Send"
          tone={stats.todaySubmitted ? 'info' : 'neutral'}
        />
        <StatCard
          label="Kräver åtgärd"
          value={stats.needsAction}
          icon="TriangleAlert"
          tone={stats.needsAction ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Okänd frånvaro"
          value={stats.unknown}
          icon="HelpCircle"
          tone={stats.unknown ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        <div className="px-2 pt-1 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={TAB_ORDER.map((key) => ({ value: key, label: TAB_LABEL[key], count: counts[key] }))}
          />
        </div>
        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="CalendarCheck"
            title={
              tab === 'alla'
                ? isGuardian
                  ? 'Inga frånvaroanmälningar än'
                  : 'Inga inkomna anmälningar'
                : `Inga anmälningar med status «${TAB_LABEL[tab]}»`
            }
            description={
              isGuardian
                ? 'När du anmäler frånvaro visas den här och skickas till mentor.'
                : 'Anmälningar från vårdnadshavare landar här för handläggning.'
            }
            actionLabel={canReport && tab === 'alla' ? 'Anmäl frånvaro' : undefined}
            onAction={canReport && tab === 'alla' ? () => setReportOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            onRowClick={(r) => setSelectedId(r.report.id)}
            caption="Frånvaroanmälningar"
          />
        )}
      </Card>

      {reportOpen && (
        <ReportAbsenceModal
          kids={kids}
          onClose={() => setReportOpen(false)}
          onSubmitted={() => {
            bump()
            setReportOpen(false)
          }}
        />
      )}

      {selected && (
        <AbsenceDetailModal
          row={selected}
          canHandle={canHandle}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Anmälningsflöde (vårdnadshavare)
// ---------------------------------------------------------------------------

const REPORT_STEPS = [
  { label: 'Barn' },
  { label: 'Orsak' },
  { label: 'Omfattning' },
  { label: 'Bekräfta' },
]

function ReportAbsenceModal({
  kids,
  onClose,
  onSubmitted,
}: {
  kids: Student[]
  onClose: () => void
  onSubmitted: () => void
}) {
  const principal = usePrincipal()
  const [step, setStep] = useState(0)
  const [studentId, setStudentId] = useState<string>(kids[0]?.id ?? '')
  const [reason, setReason] = useState<AbsenceReason>('sjuk')
  const [fullDay, setFullDay] = useState(true)
  const [date, setDate] = useState(fmtDate(new Date()))
  const [fromTime, setFromTime] = useState('08:15')
  const [toTime, setToTime] = useState('12:00')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const student = kids.find((k) => k.id === studentId)

  const canNext =
    (step === 0 && !!student) ||
    (step === 1 && !!reason) ||
    (step === 2 && !!date && (fullDay || (fromTime < toTime))) ||
    step === 3

  function submit() {
    setError(null)
    const input: CreateAbsenceInput = {
      studentId,
      reason,
      fullDay,
      fromTime: fullDay ? null : fromTime,
      toTime: fullDay ? null : toTime,
      date: new Date(date).toISOString(),
      comment,
    }
    try {
      createAbsenceReport(principal, input)
      setDone(true)
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof RateLimitedError) setError(e.message)
      else setError('Anmälan kunde inte skickas just nu. Försök igen om en stund.')
    }
  }

  if (done) {
    return (
      <Modal
        open
        onClose={onSubmitted}
        title="Frånvaro anmäld"
        footer={<Button onClick={onSubmitted}>Klar</Button>}
      >
        <div className="flex flex-col items-center py-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-success-soft text-success">
            <Icon name="CheckCircle2" className="h-7 w-7" />
          </span>
          <h3 className="mt-4 font-semibold text-ink">Tack, anmälan är mottagen</h3>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            {student ? `${student.firstName} ${student.lastName}` : 'Barnet'} är anmäld{' '}
            {fmtDateLong(new Date(date))}. Mentor har notifierats.
          </p>
        </div>
      </Modal>
    )
  }

  const noKids = kids.length === 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Anmäl frånvaro"
      description="Fyll i uppgifterna – anmälan skickas direkt till skolan."
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
          {step < 3 ? (
            <Button iconRight="ChevronRight" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Nästa
            </Button>
          ) : (
            <Button icon="Send" disabled={noKids} onClick={submit}>
              Skicka anmälan
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={REPORT_STEPS} current={step} />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {noKids && (
        <div className="rounded-field border border-border bg-surface-2 p-4 text-sm text-ink-muted">
          Inga barn är kopplade till ditt konto. Kontakta skolan för att koppla vårdnadshavarskap.
        </div>
      )}

      {/* Steg 1: Välj barn */}
      {step === 0 && !noKids && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">Vilket barn gäller anmälan?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {kids.map((k) => {
              const active = k.id === studentId
              const school = db.data.schools.find((s) => s.id === k.schoolId)
              return (
                <button
                  key={k.id}
                  onClick={() => setStudentId(k.id)}
                  className={
                    'flex items-center gap-3 rounded-field border p-3 text-left transition-colors ' +
                    (active
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-surface hover:bg-surface-2')
                  }
                >
                  <Avatar name={`${k.firstName} ${k.lastName}`} color={k.photoColor} />
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate">
                      {k.firstName} {k.lastName}
                    </div>
                    <div className="text-2xs text-ink-subtle truncate">
                      {k.gradeLabel} · {school?.name}
                    </div>
                  </div>
                  {active && <Icon name="Check" className="ml-auto h-4 w-4 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Steg 2: Orsak */}
      {step === 1 && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">Ange orsak till frånvaron.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {GUARDIAN_REASONS.map((rk) => {
              const active = rk === reason
              const meta = REASON_META[rk]
              return (
                <button
                  key={rk}
                  onClick={() => setReason(rk)}
                  className={
                    'flex flex-col items-center gap-2 rounded-field border p-3 text-center transition-colors ' +
                    (active
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-surface hover:bg-surface-2')
                  }
                >
                  <span
                    className={
                      'grid h-9 w-9 place-items-center rounded-field ' +
                      (active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-muted')
                    }
                  >
                    <Icon name={meta.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-xs font-medium text-ink">{ABSENCE_REASON_LABEL[rk]}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Steg 3: Omfattning */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Datum</label>
            <TextInput
              type="date"
              value={date}
              icon="Calendar"
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Omfattning</label>
            <Segmented
              value={fullDay ? 'heldag' : 'del'}
              onChange={(v) => setFullDay(v === 'heldag')}
              options={[
                { value: 'heldag', label: 'Heldag', icon: 'Sun' },
                { value: 'del', label: 'Tidsintervall', icon: 'Clock' },
              ]}
            />
          </div>
          {!fullDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Från</label>
                <TextInput type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Till</label>
                <TextInput type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
              </div>
            </div>
          )}
          {!fullDay && fromTime >= toTime && (
            <p className="text-2xs text-danger">Sluttiden måste vara efter starttiden.</p>
          )}
        </div>
      )}

      {/* Steg 4: Kommentar + bekräfta */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Kommentar <span className="text-ink-subtle">(valfritt)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="T.ex. återkommer imorgon."
              className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          </div>
          <dl className="divide-y divide-border rounded-field border border-border">
            <SummaryRow label="Barn" value={student ? `${student.firstName} ${student.lastName}` : '—'} />
            <SummaryRow label="Orsak" value={ABSENCE_REASON_LABEL[reason]} />
            <SummaryRow label="Datum" value={fmtDateLong(new Date(date))} />
            <SummaryRow
              label="Omfattning"
              value={fullDay ? 'Heldag' : `${fromTime}–${toTime}`}
            />
          </dl>
          <p className="text-2xs text-ink-subtle">
            Anmälan skickas till mentor och registreras i skolans system.
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
// Detalj + handläggning
// ---------------------------------------------------------------------------

function AbsenceDetailModal({
  row,
  canHandle,
  onClose,
  onChanged,
}: {
  row: Row
  canHandle: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<AbsenceStatus | null>(null)
  const r = row.report
  const handler = r.handledBy ? db.data.users.find((u) => u.id === r.handledBy) : undefined

  function act(status: AbsenceStatus) {
    setError(null)
    setBusy(status)
    try {
      updateAbsenceStatus(principal, r.id, status)
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else setError('Det gick inte att uppdatera anmälan just nu.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Frånvaroanmälan"
      description={`${row.studentLabel}${row.gradeLabel ? ` · ${row.gradeLabel}` : ''}`}
      footer={
        canHandle ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              icon="TriangleAlert"
              loading={busy === 'kraver_atgard'}
              disabled={r.status === 'kraver_atgard' || busy !== null}
              onClick={() => act('kraver_atgard')}
            >
              Kräver åtgärd
            </Button>
            <Button
              variant="danger"
              icon="XCircle"
              loading={busy === 'avslagen'}
              disabled={r.status === 'avslagen' || busy !== null}
              onClick={() => act('avslagen')}
            >
              Avslå
            </Button>
            <Button
              icon="CheckCircle2"
              loading={busy === 'bekraftad'}
              disabled={r.status === 'bekraftad' || busy !== null}
              onClick={() => act('bekraftad')}
            >
              Bekräfta
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Stäng
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {row.masked && (
          <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Skyddad identitet – namnet är maskerat. Behandla uppgiften varsamt.</span>
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
            tone={STATUS_META[r.status].tone}
            icon={STATUS_META[r.status].icon}
            label={ABSENCE_STATUS_LABEL[r.status]}
          />
          <Badge tone={REASON_META[r.reason].tone} icon={REASON_META[r.reason].icon}>
            {ABSENCE_REASON_LABEL[r.reason]}
          </Badge>
        </div>

        <dl className="divide-y divide-border rounded-field border border-border">
          <SummaryRow label="Datum" value={fmtDateLong(new Date(r.date))} />
          <SummaryRow label="Omfattning" value={timeLabel(r)} />
          <SummaryRow label="Inrapporterad av" value={row.reporterLabel} />
          {handler && <SummaryRow label="Handlagd av" value={handler.name} />}
        </dl>

        {r.comment ? (
          <div className="rounded-field border border-border bg-surface-2 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Kommentar</p>
            <p className="mt-1 text-sm text-ink">{r.comment}</p>
          </div>
        ) : (
          <p className="text-2xs text-ink-subtle">Ingen kommentar angiven.</p>
        )}
      </div>
    </Modal>
  )
}
