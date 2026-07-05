import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Button, Badge, StatusBadge, ClassificationBadge,
  Avatar, Modal, StepIndicator, TextInput, Select, Icon,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db } from '@/data/db/store'
import type { Incident, Student } from '@/data/schema'
import { fmtDateTime, fmtRelative, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  INCIDENT_CATEGORY_LABEL, INCIDENT_SEVERITY_LABEL, INCIDENT_STATUS_LABEL,
  createIncident, advanceIncidentStatus, nextIncidentStatus, getStatusHistory,
  type CreateIncidentInput,
} from './service'

// ---- Presentationskartor ----
const CATEGORY_META: Record<Incident['category'], { tone: Tone; icon: string }> = {
  tillbud: { tone: 'info', icon: 'TriangleAlert' },
  olycka: { tone: 'warning', icon: 'Activity' },
  konflikt: { tone: 'accent', icon: 'Users' },
  kränkning: { tone: 'danger', icon: 'ShieldX' },
  skada: { tone: 'warning', icon: 'Wrench' },
  övrigt: { tone: 'neutral', icon: 'Info' },
}

const SEVERITY_META: Record<Incident['severity'], { tone: Tone; icon: string }> = {
  låg: { tone: 'neutral', icon: 'Minus' },
  medel: { tone: 'info', icon: 'Info' },
  hög: { tone: 'warning', icon: 'TriangleAlert' },
  allvarlig: { tone: 'danger', icon: 'Siren' },
}

const STATUS_META: Record<Incident['status'], { tone: Tone; icon: string }> = {
  öppen: { tone: 'danger', icon: 'CircleDashed' },
  under_utredning: { tone: 'warning', icon: 'Search' },
  åtgärdad: { tone: 'success', icon: 'CircleCheck' },
  avslutad: { tone: 'neutral', icon: 'Check' },
}

/** Knapptext för nästa steg i statusflödet. */
const ADVANCE_LABEL: Partial<Record<Incident['status'], { label: string; icon: string }>> = {
  under_utredning: { label: 'Starta utredning', icon: 'Search' },
  åtgärdad: { label: 'Markera åtgärdad', icon: 'CircleCheck' },
  avslutad: { label: 'Avsluta ärende', icon: 'Archive' },
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface Row {
  id: string
  incident: Incident
  student?: Student
  masked: boolean
  studentLabel: string | null
  reporterLabel: string
}

export function IncidentsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'incident')
  const canCreate = usePermission('create', 'incident').allowed

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    wait(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const isGuardian = principal.role === 'vardnadshavare'

  const rows = useMemo<Row[]>(() => {
    void refresh
    const users = db.data.users
    return db.data.incidents
      .map<Row | null>((incident) => {
        const student = incident.studentId
          ? db.data.students.find((s) => s.id === incident.studentId)
          : undefined
        // Vårdnadshavare ser endast incidenter som rör egna barn.
        if (isGuardian && (!incident.studentId || !principal.guardianStudentIds.includes(incident.studentId))) {
          return null
        }
        const decision = can(principal, 'read', 'incident', {
          organizationId: incident.organizationId,
          schoolId: incident.schoolId,
          classId: student?.classId,
          studentId: incident.studentId,
          protectedIdentity: student?.protectedIdentity,
          dataClassification: 4,
        })
        if (!decision.allowed) return null
        const masked = Boolean(decision.masked)
        const fullName = student ? `${student.firstName} ${student.lastName}` : null
        const reporter = users.find((u) => u.id === incident.reportedBy)
        return {
          id: incident.id,
          incident,
          student,
          masked,
          studentLabel: fullName ? (masked ? maskName(fullName) : fullName) : null,
          reporterLabel:
            incident.reportedBy === principal.userId ? 'Du' : reporter?.name ?? 'Okänd',
        }
      })
      .filter((r): r is Row => r !== null)
      .sort(
        (a, b) =>
          new Date(b.incident.occurredAt).getTime() - new Date(a.incident.occurredAt).getTime(),
      )
  }, [principal, refresh, isGuardian])

  const stats = useMemo(() => {
    let open = 0
    let investigating = 0
    let severe = 0
    for (const r of rows) {
      if (r.incident.status === 'öppen') open += 1
      if (r.incident.status === 'under_utredning') investigating += 1
      if (r.incident.severity === 'allvarlig') severe += 1
    }
    return { open, investigating, severe }
  }, [rows])

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Incidenter" icon="Siren" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const columns: Column<Row>[] = [
    {
      key: 'title',
      header: 'Titel',
      render: (r) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="font-medium text-ink truncate">{r.incident.title}</div>
          <div className="text-2xs text-ink-subtle md:hidden">{fmtRelative(r.incident.occurredAt)}</div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Kategori',
      hideOnMobile: true,
      render: (r) => (
        <Badge tone={CATEGORY_META[r.incident.category].tone} icon={CATEGORY_META[r.incident.category].icon}>
          {INCIDENT_CATEGORY_LABEL[r.incident.category]}
        </Badge>
      ),
    },
    {
      key: 'severity',
      header: 'Allvar',
      render: (r) => (
        <StatusBadge
          tone={SEVERITY_META[r.incident.severity].tone}
          icon={SEVERITY_META[r.incident.severity].icon}
          label={INCIDENT_SEVERITY_LABEL[r.incident.severity]}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge
          tone={STATUS_META[r.incident.status].tone}
          icon={STATUS_META[r.incident.status].icon}
          label={INCIDENT_STATUS_LABEL[r.incident.status]}
        />
      ),
    },
    {
      key: 'student',
      header: 'Elev',
      hideOnMobile: true,
      render: (r) =>
        r.studentLabel ? (
          <div className="flex items-center gap-2">
            <Avatar name={r.studentLabel} color={r.student?.photoColor} size="sm" protected={r.masked} />
            <span className="text-ink truncate">{r.studentLabel}</span>
            {r.masked && (
              <span title="Skyddad identitet – maskerad">
                <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
              </span>
            )}
          </div>
        ) : (
          <span className="text-ink-subtle">Ej elevspecifik</span>
        ),
    },
    {
      key: 'reporter',
      header: 'Rapporterad av',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.reporterLabel}</span>,
    },
    {
      key: 'time',
      header: 'Tid',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted whitespace-nowrap">{fmtRelative(r.incident.occurredAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Incidenter"
        icon="Siren"
        subtitle={
          isGuardian
            ? 'Incidenter som rör dina barn.'
            : 'Rapportera, utred och följ upp händelser. Känsliga uppgifter loggas.'
        }
        actions={
          canCreate ? (
            <Button icon="Plus" onClick={() => setCreateOpen(true)}>
              Ny incident
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Öppna"
          value={stats.open}
          icon="CircleDashed"
          tone={stats.open ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Under utredning"
          value={stats.investigating}
          icon="Search"
          tone={stats.investigating ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Allvarliga"
          value={stats.severe}
          icon="Siren"
          tone={stats.severe ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        {loading ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="Siren"
            title="Inga incidenter i din räckvidd"
            description={
              isGuardian
                ? 'Incidenter som rör dina barn visas här när skolan registrerar dem.'
                : 'Rapporterade händelser visas här för utredning och uppföljning.'
            }
            actionLabel={canCreate ? 'Ny incident' : undefined}
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setSelectedId(r.id)}
            caption="Incidenter"
          />
        )}
      </Card>

      {createOpen && (
        <CreateIncidentModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            bump()
          }}
        />
      )}

      {selected && (
        <IncidentDetailModal row={selected} onClose={() => setSelectedId(null)} onChanged={bump} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Ny incident – trestegsflöde
// ---------------------------------------------------------------------------

const CREATE_STEPS = [{ label: 'Händelse' }, { label: 'Berörd' }, { label: 'Bedömning' }]

function CreateIncidentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const principal = usePrincipal()
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [studentId, setStudentId] = useState('')
  const [category, setCategory] = useState<Incident['category']>('tillbud')
  const [severity, setSeverity] = useState<Incident['severity']>('medel')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligibleStudents = useMemo(
    () =>
      db.data.students
        .filter((s) => s.status === 'inskriven')
        .filter(
          (s) =>
            can(principal, 'create', 'incident', {
              organizationId: s.organizationId,
              schoolId: s.schoolId,
              classId: s.classId,
              studentId: s.id,
              protectedIdentity: s.protectedIdentity,
            }).allowed,
        )
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'sv')),
    [principal],
  )

  const titleValid = title.trim().length >= 4
  const descriptionValid = description.trim().length >= 10
  const canNext = step === 0 ? titleValid && descriptionValid : true

  async function submit() {
    setError(null)
    setSaving(true)
    try {
      await wait(300)
      const input: CreateIncidentInput = {
        title,
        description,
        category,
        severity,
        studentId: studentId || null,
      }
      createIncident(principal, input)
      toast.success('Incident rapporterad', 'Rektor har notifierats.')
      onCreated()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('För många åtgärder', e.message)
      else setError(e instanceof Error ? e.message : 'Incidenten kunde inte sparas just nu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny incident"
      description="Beskriv händelsen, koppla ev. berörd elev och gör en bedömning."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon="ChevronLeft"
            disabled={saving}
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
          >
            {step === 0 ? 'Avbryt' : 'Tillbaka'}
          </Button>
          {step < 2 ? (
            <Button
              iconRight="ChevronRight"
              disabled={!canNext}
              title={!canNext ? 'Fyll i titel och beskrivning' : undefined}
              onClick={() => setStep((s) => s + 1)}
            >
              Nästa
            </Button>
          ) : (
            <Button icon="Send" loading={saving} onClick={submit}>
              {saving ? 'Sparar…' : 'Rapportera incident'}
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

      {/* Steg 1: Händelse */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Titel <span className="text-danger">*</span>
            </label>
            <TextInput
              value={title}
              placeholder="T.ex. Fallolycka på skolgården"
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
            {title.length > 0 && !titleValid && (
              <p className="mt-1 text-2xs text-danger">Titeln behöver minst 4 tecken.</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Beskrivning <span className="text-danger">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="Vad hände, var och när? Vilka åtgärder vidtogs direkt?"
              className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            {description.length > 0 && !descriptionValid && (
              <p className="mt-1 text-2xs text-danger">Beskriv händelsen (minst 10 tecken).</p>
            )}
          </div>
        </div>
      )}

      {/* Steg 2: Berörd elev */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Koppla en berörd elev om händelsen gäller en specifik elev. Lämna tomt för händelser av
            allmän karaktär.
          </p>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Ej elevspecifik</option>
            {eligibleStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.protectedIdentity && !principal.protectedClearance
                  ? maskName(`${s.firstName} ${s.lastName}`)
                  : `${s.lastName}, ${s.firstName}`}{' '}
                · {s.gradeLabel}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Steg 3: Bedömning + sammanfattning */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Kategori</label>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as Incident['category'])}
              >
                {(Object.keys(INCIDENT_CATEGORY_LABEL) as Incident['category'][]).map((c) => (
                  <option key={c} value={c}>
                    {INCIDENT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Allvarsgrad</label>
              <Select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Incident['severity'])}
              >
                {(Object.keys(INCIDENT_SEVERITY_LABEL) as Incident['severity'][]).map((s) => (
                  <option key={s} value={s}>
                    {INCIDENT_SEVERITY_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {severity === 'allvarlig' && (
            <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              <Icon name="Siren" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Allvarlig händelse – rektor notifieras omgående med hög prioritet.</span>
            </div>
          )}

          <dl className="divide-y divide-border rounded-field border border-border">
            <InfoRow label="Titel" value={title.trim() || '—'} />
            <InfoRow
              label="Berörd elev"
              value={
                studentId
                  ? (() => {
                      const s = eligibleStudents.find((x) => x.id === studentId)
                      if (!s) return '—'
                      const name = `${s.firstName} ${s.lastName}`
                      return s.protectedIdentity && !principal.protectedClearance
                        ? maskName(name)
                        : name
                    })()
                  : 'Ej elevspecifik'
              }
            />
            <InfoRow label="Kategori" value={INCIDENT_CATEGORY_LABEL[category]} />
            <InfoRow label="Allvarsgrad" value={INCIDENT_SEVERITY_LABEL[severity]} />
          </dl>
          <p className="text-2xs text-ink-subtle">
            Incidenten registreras som öppen, loggas i granskningsloggen och rektor notifieras.
          </p>
        </div>
      )}
    </Modal>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="font-medium text-ink text-right">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalj + statusflöde med tidslinje
// ---------------------------------------------------------------------------

function IncidentDetailModal({
  row,
  onClose,
  onChanged,
}: {
  row: Row
  onClose: () => void
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const [busy, setBusy] = useState(false)
  const [, forceRender] = useReducer((x) => x + 1, 0)
  const inc = row.incident

  const canAdvance = can(principal, 'update', 'incident', {
    organizationId: inc.organizationId,
    schoolId: inc.schoolId,
    classId: row.student?.classId,
    studentId: inc.studentId,
    protectedIdentity: row.student?.protectedIdentity,
    dataClassification: 4,
  }).allowed

  const next = nextIncidentStatus(inc.status)
  const history = getStatusHistory(inc)

  async function advance() {
    if (!next) return
    setBusy(true)
    try {
      await wait(260)
      advanceIncidentStatus(principal, inc.id)
      toast.success(
        'Status uppdaterad',
        `Incidenten är nu «${INCIDENT_STATUS_LABEL[inc.status]}».`,
      )
      onChanged()
      forceRender()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte uppdatera', 'Statusändringen gick inte att spara just nu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={inc.title}
      description={`Rapporterad av ${row.reporterLabel} · ${fmtDateTime(inc.occurredAt)}`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Stäng
          </Button>
          {canAdvance && next ? (
            <Button
              icon={ADVANCE_LABEL[next]?.icon}
              loading={busy}
              onClick={advance}
            >
              {ADVANCE_LABEL[next]?.label ?? 'Nästa steg'}
            </Button>
          ) : canAdvance ? (
            <Badge tone="neutral" icon="Check">
              Ärendet är avslutat
            </Badge>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {row.masked && (
          <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Skyddad identitet – namnet är maskerat. Behandla uppgiften varsamt.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_META[inc.category].tone} icon={CATEGORY_META[inc.category].icon}>
            {INCIDENT_CATEGORY_LABEL[inc.category]}
          </Badge>
          <StatusBadge
            tone={SEVERITY_META[inc.severity].tone}
            icon={SEVERITY_META[inc.severity].icon}
            label={INCIDENT_SEVERITY_LABEL[inc.severity]}
          />
          <StatusBadge
            tone={STATUS_META[inc.status].tone}
            icon={STATUS_META[inc.status].icon}
            label={INCIDENT_STATUS_LABEL[inc.status]}
          />
          <ClassificationBadge level={4} />
        </div>

        <dl className="divide-y divide-border rounded-field border border-border">
          <InfoRow label="Berörd elev" value={row.studentLabel ?? 'Ej elevspecifik'} />
          <InfoRow label="Rapporterad av" value={row.reporterLabel} />
          <InfoRow label="Tidpunkt" value={fmtDateTime(inc.occurredAt)} />
        </dl>

        <div className="rounded-field border border-border bg-surface-2 p-3">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Beskrivning</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">
            {inc.description || 'Ingen beskrivning angiven.'}
          </p>
        </div>

        {/* Tidslinje över statushistorik */}
        <div>
          <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Statushistorik
          </p>
          <ol className="space-y-0">
            {history.map((entry, i) => {
              const meta = STATUS_META[entry.status]
              const byUser = entry.byUserId
                ? db.data.users.find((u) => u.id === entry.byUserId)
                : undefined
              const last = i === history.length - 1
              return (
                <li key={`${entry.status}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {!last && (
                    <span
                      className="absolute left-[13px] top-7 bottom-0 w-px bg-border"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      'z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-surface',
                      last ? 'border-primary text-primary' : 'border-border text-ink-subtle',
                    )}
                  >
                    <Icon name={meta.icon} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-sm font-medium', last ? 'text-ink' : 'text-ink-muted')}>
                        {INCIDENT_STATUS_LABEL[entry.status]}
                      </span>
                      {last && <Badge tone={meta.tone}>Nuvarande</Badge>}
                    </div>
                    <div className="text-2xs text-ink-subtle">
                      {fmtDateTime(entry.at)}
                      {byUser ? ` · ${entry.byUserId === principal.userId ? 'Du' : byUser.name}` : ''}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </Modal>
  )
}
