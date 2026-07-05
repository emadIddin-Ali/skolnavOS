import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, DataTable, Button, Badge, StatusBadge, ClassificationBadge,
  Avatar, Modal, TextInput, Select, Icon, EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db } from '@/data/db/store'
import type { HealthRecord, Student } from '@/data/schema'
import { fmtDate, maskName } from '@/lib/format'
import {
  HEALTH_KIND_LABEL, HEALTH_SEVERITY_LABEL,
  createHealthRecord, updateHealthRecord, deleteHealthRecord, logHealthListAccess,
  type HealthInput,
} from './service'

// ---- Presentationskartor ----
const KIND_META: Record<HealthRecord['kind'], { tone: Tone; icon: string }> = {
  allergi: { tone: 'warning', icon: 'Wheat' },
  specialkost: { tone: 'info', icon: 'UtensilsCrossed' },
  medicinsk: { tone: 'primary', icon: 'Stethoscope' },
  annat: { tone: 'neutral', icon: 'Info' },
}

const SEVERITY_META: Record<HealthRecord['severity'], { tone: Tone; icon: string }> = {
  låg: { tone: 'neutral', icon: 'Minus' },
  medel: { tone: 'info', icon: 'Info' },
  hög: { tone: 'warning', icon: 'TriangleAlert' },
  kritisk: { tone: 'danger', icon: 'Siren' },
}

const SEVERITY_ORDER: HealthRecord['severity'][] = ['kritisk', 'hög', 'medel', 'låg']

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface Row {
  id: string
  record: HealthRecord
  student?: Student
  masked: boolean
  studentLabel: string
  gradeLabel: string
}

export function HealthPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'health')
  const canCreate = usePermission('create', 'health').allowed
  const canUpdate = usePermission('update', 'health').allowed
  const canDelete = usePermission('delete', 'health').allowed

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

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

  // Behörighetsfiltrerad lista: varje rad prövas mot motorn.
  const rows = useMemo<Row[]>(() => {
    void refresh
    return db.data.health
      .map<Row | null>((record) => {
        const student = db.data.students.find((s) => s.id === record.studentId)
        const decision = can(principal, 'read', 'health', {
          organizationId: record.organizationId,
          schoolId: record.schoolId,
          classId: student?.classId,
          studentId: record.studentId,
          protectedIdentity: student?.protectedIdentity,
          dataClassification: 4,
        })
        if (!decision.allowed) return null
        const fullName = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
        const masked = Boolean(decision.masked)
        return {
          id: record.id,
          record,
          student,
          masked,
          studentLabel: masked ? maskName(fullName) : fullName,
          gradeLabel: student?.gradeLabel ?? '',
        }
      })
      .filter((r): r is Row => r !== null)
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.record.severity) - SEVERITY_ORDER.indexOf(b.record.severity),
      )
  }, [principal, refresh])

  // Känslig läsning revideras – en loggpost per sidbesök.
  useEffect(() => {
    if (!loading && readDecision.allowed) logHealthListAccess(principal, rows.length)
    // Endast vid inläsning – inte vid varje mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, readDecision.allowed])

  const critical = useMemo(() => rows.filter((r) => r.record.severity === 'kritisk'), [rows])

  const detail = detailId ? rows.find((r) => r.id === detailId) : undefined
  const editing = editId ? rows.find((r) => r.id === editId) : undefined
  const deleting = deleteId ? rows.find((r) => r.id === deleteId) : undefined

  const ownsRow = (r: Row) => r.record.createdBy === principal.userId

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Hälsa & specialkost" icon="Stethoscope" />
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
          <Avatar name={r.studentLabel} color={r.student?.photoColor} size="sm" protected={r.masked} />
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
      key: 'kind',
      header: 'Typ',
      render: (r) => (
        <Badge tone={KIND_META[r.record.kind].tone} icon={KIND_META[r.record.kind].icon}>
          {HEALTH_KIND_LABEL[r.record.kind]}
        </Badge>
      ),
    },
    {
      key: 'label',
      header: 'Etikett',
      render: (r) => <span className="font-medium text-ink">{r.record.label}</span>,
    },
    {
      key: 'severity',
      header: 'Allvarsgrad',
      render: (r) => (
        <StatusBadge
          tone={SEVERITY_META[r.record.severity].tone}
          icon={SEVERITY_META[r.record.severity].icon}
          label={HEALTH_SEVERITY_LABEL[r.record.severity]}
        />
      ),
    },
    {
      key: 'instructions',
      header: 'Instruktioner',
      hideOnMobile: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="max-w-[260px] truncate text-ink-muted">
            {r.record.instructions || '—'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon="Eye"
            onClick={() => setDetailId(r.id)}
          >
            Visa
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Hälsa & specialkost"
        icon="Stethoscope"
        subtitle="Allergier, specialkost och medicinska behov för elever i din räckvidd."
        actions={
          canCreate ? (
            <Button icon="Plus" onClick={() => setFormOpen(true)}>
              Ny post
            </Button>
          ) : undefined
        }
      />

      {/* Varningsbanner – känslig data */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-danger/30 bg-danger-soft px-4 py-3">
        <Icon name="ShieldAlert" className="h-5 w-5 shrink-0 text-danger" />
        <p className="text-sm font-medium text-danger">Känslig hälsodata – åtkomst loggas.</p>
        <ClassificationBadge level={4} />
      </div>

      {/* Kritiska allergier/behov */}
      {!loading && critical.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-danger">
            Kritiska hälsobehov ({critical.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {critical.map((r) => (
              <Card key={r.id} className="border-danger/40 border-l-4 border-l-danger">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-danger-soft text-danger">
                        <Icon name="Siren" className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink truncate">{r.record.label}</div>
                        <div className="text-2xs text-ink-subtle truncate">
                          {r.studentLabel}
                          {r.gradeLabel ? ` · ${r.gradeLabel}` : ''}
                        </div>
                      </div>
                    </div>
                    <Badge tone="danger" icon="Siren">Kritisk</Badge>
                  </div>
                  <p className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">
                    <span className="font-semibold">Åtgärd: </span>
                    {r.record.instructions || 'Se elevens åtgärdsplan hos skolsköterskan.'}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card>
        {loading ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="Stethoscope"
            title="Inga hälsoposter i din räckvidd"
            description="Poster om allergi, specialkost och medicinska behov visas här."
            actionLabel={canCreate ? 'Ny post' : undefined}
            onAction={canCreate ? () => setFormOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetailId(r.id)}
            caption="Hälsoposter"
          />
        )}
      </Card>

      {(formOpen || editing) && (
        <HealthFormModal
          existing={editing}
          onClose={() => {
            setFormOpen(false)
            setEditId(null)
          }}
          onSaved={() => {
            setFormOpen(false)
            setEditId(null)
            bump()
          }}
        />
      )}

      {detail && (
        <Modal
          open
          onClose={() => setDetailId(null)}
          title={detail.record.label}
          description={`${detail.studentLabel}${detail.gradeLabel ? ` · ${detail.gradeLabel}` : ''}`}
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {ownsRow(detail) && canDelete && (
                  <Button
                    variant="danger"
                    icon="Trash2"
                    onClick={() => {
                      setDeleteId(detail.id)
                      setDetailId(null)
                    }}
                  >
                    Ta bort
                  </Button>
                )}
                {ownsRow(detail) && canUpdate && (
                  <Button
                    variant="secondary"
                    icon="PenLine"
                    onClick={() => {
                      setEditId(detail.id)
                      setDetailId(null)
                    }}
                  >
                    Redigera
                  </Button>
                )}
              </div>
              <Button variant="secondary" onClick={() => setDetailId(null)}>
                Stäng
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {detail.masked && (
              <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Skyddad identitet – namnet är maskerat. Behandla uppgiften varsamt.</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_META[detail.record.kind].tone} icon={KIND_META[detail.record.kind].icon}>
                {HEALTH_KIND_LABEL[detail.record.kind]}
              </Badge>
              <StatusBadge
                tone={SEVERITY_META[detail.record.severity].tone}
                icon={SEVERITY_META[detail.record.severity].icon}
                label={HEALTH_SEVERITY_LABEL[detail.record.severity]}
              />
              <ClassificationBadge level={4} />
            </div>
            <div className="rounded-field border border-border bg-surface-2 p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                Instruktioner
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">
                {detail.record.instructions || 'Inga instruktioner angivna.'}
              </p>
            </div>
            <p className="text-2xs text-ink-subtle">
              Registrerad {fmtDate(detail.record.createdAt)} · senast ändrad{' '}
              {fmtDate(detail.record.updatedAt)}
            </p>
          </div>
        </Modal>
      )}

      {deleting && (
        <DeleteHealthModal
          row={deleting}
          onClose={() => setDeleteId(null)}
          onDeleted={() => {
            setDeleteId(null)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Formulär: ny/redigera hälsopost
// ---------------------------------------------------------------------------

function HealthFormModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: Row
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const isEdit = Boolean(existing)

  // Elever inom räckvidden där posten faktiskt får skapas.
  const eligibleStudents = useMemo(
    () =>
      db.data.students
        .filter((s) => s.status === 'inskriven')
        .filter(
          (s) =>
            can(principal, isEdit ? 'update' : 'create', 'health', {
              organizationId: s.organizationId,
              schoolId: s.schoolId,
              classId: s.classId,
              studentId: s.id,
              protectedIdentity: s.protectedIdentity,
            }).allowed,
        )
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'sv')),
    [principal, isEdit],
  )

  const [studentId, setStudentId] = useState(existing?.record.studentId ?? eligibleStudents[0]?.id ?? '')
  const [kind, setKind] = useState<HealthRecord['kind']>(existing?.record.kind ?? 'allergi')
  const [label, setLabel] = useState(existing?.record.label ?? '')
  const [severity, setSeverity] = useState<HealthRecord['severity']>(
    existing?.record.severity ?? 'medel',
  )
  const [instructions, setInstructions] = useState(existing?.record.instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const labelValid = label.trim().length >= 2
  const instructionsValid = instructions.trim().length >= 5
  const valid = Boolean(studentId) && labelValid && instructionsValid

  async function submit() {
    setTouched(true)
    setError(null)
    if (!valid) return
    setSaving(true)
    try {
      await wait(280)
      const input: HealthInput = {
        studentId,
        kind,
        label,
        severity,
        instructions,
      }
      if (existing) {
        updateHealthRecord(principal, existing.record.id, input)
        toast.success('Hälsopost uppdaterad', `«${label.trim()}» har sparats.`)
      } else {
        createHealthRecord(principal, input)
        toast.success('Hälsopost skapad', `«${label.trim()}» har registrerats.`)
      }
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('För många åtgärder', e.message)
      else setError(e instanceof Error ? e.message : 'Posten kunde inte sparas just nu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Redigera hälsopost' : 'Ny hälsopost'}
      description="Uppgifterna klassificeras som känslig hälsodata (klass 4)."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button
            icon="Save"
            loading={saving}
            disabled={!valid || saving}
            title={!valid ? 'Fyll i elev, etikett och instruktioner' : undefined}
            onClick={submit}
          >
            {saving ? 'Sparar…' : isEdit ? 'Spara ändringar' : 'Spara post'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Elev <span className="text-danger">*</span>
          </label>
          <Select
            value={studentId}
            disabled={isEdit}
            onChange={(e) => setStudentId(e.target.value)}
          >
            {eligibleStudents.length === 0 && <option value="">Inga elever i din räckvidd</option>}
            {eligibleStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.protectedIdentity && !principal.protectedClearance
                  ? maskName(`${s.firstName} ${s.lastName}`)
                  : `${s.lastName}, ${s.firstName}`}{' '}
                · {s.gradeLabel}
              </option>
            ))}
          </Select>
          {isEdit && (
            <p className="mt-1 text-2xs text-ink-subtle">Eleven kan inte ändras på en befintlig post.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Typ</label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as HealthRecord['kind'])}>
              {(Object.keys(HEALTH_KIND_LABEL) as HealthRecord['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {HEALTH_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Allvarsgrad</label>
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as HealthRecord['severity'])}
            >
              {(Object.keys(HEALTH_SEVERITY_LABEL) as HealthRecord['severity'][]).map((s) => (
                <option key={s} value={s}>
                  {HEALTH_SEVERITY_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Etikett <span className="text-danger">*</span>
          </label>
          <TextInput
            value={label}
            placeholder="T.ex. Nötallergi"
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
          {touched && !labelValid && (
            <p className="mt-1 text-2xs text-danger">Ange en etikett (minst 2 tecken).</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Instruktioner <span className="text-danger">*</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder="Vad ska personalen göra? T.ex. var adrenalinpennan finns."
            className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {touched && !instructionsValid && (
            <p className="mt-1 text-2xs text-danger">Beskriv åtgärden (minst 5 tecken).</p>
          )}
        </div>

        {severity === 'kritisk' && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="Siren" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Kritisk allvarsgrad lyfts fram överst för all behörig personal. Säkerställ att
              åtgärdsinstruktionen är komplett.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Borttagning med bekräftelse
// ---------------------------------------------------------------------------

function DeleteHealthModal({
  row,
  onClose,
  onDeleted,
}: {
  row: Row
  onClose: () => void
  onDeleted: () => void
}) {
  const principal = usePrincipal()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await wait(240)
      deleteHealthRecord(principal, row.record.id)
      toast.success('Hälsopost borttagen', `«${row.record.label}» har tagits bort.`)
      onDeleted()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte ta bort', 'Posten kunde inte tas bort just nu.')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ta bort hälsopost?"
      description={`«${row.record.label}» för ${row.studentLabel} tas bort permanent.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Avbryt
          </Button>
          <Button variant="danger" icon="Trash2" loading={busy} onClick={confirm}>
            Ta bort
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        Åtgärden loggas i granskningsloggen. Kontrollera att informationen inte längre behövs för
        elevens säkerhet.
      </p>
    </Modal>
  )
}
