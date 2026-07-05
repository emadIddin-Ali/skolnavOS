import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Tabs, Button, Badge, StatusBadge,
  Avatar, Modal, TextInput, Select, Segmented, Icon, ProgressBar,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { Assignment, Submission, Course, Student } from '@/data/schema'
import { fmtDate, fmtDateLong, maskName } from '@/lib/format'
import {
  createAssignment, updateAssignmentStatus, gradeSubmission, submitAssignment,
  type CreateAssignmentInput,
} from './service'

// ---- Presentationskartor ----
const ASG_STATUS_META: Record<Assignment['status'], { label: string; tone: Tone; icon: string }> = {
  utkast: { label: 'Utkast', tone: 'neutral', icon: 'PencilLine' },
  publicerad: { label: 'Aktiv', tone: 'info', icon: 'BookOpen' },
  stängd: { label: 'Stängd', tone: 'neutral', icon: 'Lock' },
}

const SUB_STATUS_META: Record<Submission['status'], { label: string; tone: Tone; icon: string }> = {
  ej_inlämnad: { label: 'Ej inlämnad', tone: 'neutral', icon: 'Circle' },
  inlämnad: { label: 'Inlämnad', tone: 'info', icon: 'Send' },
  sen: { label: 'Sen inlämning', tone: 'warning', icon: 'Clock' },
  bedömd: { label: 'Bedömd', tone: 'success', icon: 'CircleCheck' },
}

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const

/** Deadline-nedräkning: dagar kvar, röd om passerad. */
function deadlineInfo(dueAt: string): { label: string; overdue: boolean } {
  const ms = new Date(dueAt).getTime() - Date.now()
  if (ms < 0) {
    const d = Math.floor(-ms / 86_400_000)
    return {
      label: d === 0 ? 'Passerad idag' : d === 1 ? 'Passerad för 1 dag sedan' : `Passerad för ${d} dagar sedan`,
      overdue: true,
    }
  }
  if (fmtDate(dueAt) === fmtDate(new Date())) return { label: 'Idag', overdue: false }
  const d = Math.ceil(ms / 86_400_000)
  return { label: d === 1 ? 'Imorgon' : `${d} dagar kvar`, overdue: false }
}

function courseLabel(course?: Course): string {
  return course ? `${course.code} · ${course.name}` : 'Utan kurs'
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="font-medium text-ink text-right">{value}</dd>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidkomponent – väljer vy efter roll
// ---------------------------------------------------------------------------

export function AssignmentsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'assignment')
  const isStudent = Boolean(principal.ownStudentId)

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Uppgifter" icon="ClipboardList" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  return isStudent ? <StudentAssignments /> : <TeacherAssignments />
}

// ---------------------------------------------------------------------------
// Lärarvy
// ---------------------------------------------------------------------------

interface TeacherRow {
  id: string
  assignment: Assignment
  course?: Course
  total: number
  submitted: number
  graded: number
}

const TEACHER_TABS: Assignment['status'][] = ['publicerad', 'stängd', 'utkast']
const TEACHER_TAB_LABEL: Record<Assignment['status'], string> = {
  publicerad: 'Aktiva',
  stängd: 'Stängda',
  utkast: 'Utkast',
}

function TeacherAssignments() {
  const principal = usePrincipal()
  const canCreate = usePermission('create', 'assignment').allowed
  const canUpdate = usePermission('update', 'assignment').allowed

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Assignment['status']>('publicerad')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  // Egna uppgifter först; annars alla inom behörighetsräckvidden (via motorn).
  const rows = useMemo<TeacherRow[]>(() => {
    void refresh
    const all = db.data.assignments.filter((a) => !a.deletedAt)
    const mine = all.filter((a) => a.teacherUserId === principal.userId)
    const pool = mine.length > 0 ? mine : all
    return pool
      .filter(
        (a) =>
          can(principal, 'read', 'assignment', {
            organizationId: a.organizationId,
            schoolId: a.schoolId,
            courseId: a.courseId,
            classId: a.classId,
          }).allowed,
      )
      .map<TeacherRow>((a) => {
        const course = byId(db.data.courses, a.courseId)
        const subs = db.data.submissions.filter((s) => s.assignmentId === a.id)
        const total = subs.length > 0 ? subs.length : course?.studentCount ?? 0
        const submitted =
          subs.length > 0 ? subs.filter((s) => s.status !== 'ej_inlämnad').length : a.submissionsCount
        const graded = subs.length > 0 ? subs.filter((s) => s.status === 'bedömd').length : a.gradedCount
        return { id: a.id, assignment: a, course, total, submitted, graded }
      })
      .sort((x, y) => new Date(x.assignment.dueAt).getTime() - new Date(y.assignment.dueAt).getTime())
  }, [principal, refresh])

  const counts = useMemo(() => {
    const c: Record<Assignment['status'], number> = { publicerad: 0, stängd: 0, utkast: 0 }
    for (const r of rows) c[r.assignment.status] += 1
    return c
  }, [rows])

  const visible = useMemo(() => rows.filter((r) => r.assignment.status === tab), [rows, tab])

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.assignment.status === 'publicerad')
    const toGrade = active.reduce((sum, r) => sum + Math.max(0, r.submitted - r.graded), 0)
    const overdue = active.filter((r) => deadlineInfo(r.assignment.dueAt).overdue).length
    return { active: active.length, toGrade, overdue }
  }, [rows])

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  const columns: Column<TeacherRow>[] = [
    {
      key: 'title',
      header: 'Uppgift',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-ink truncate">{r.assignment.title}</div>
          <div className="text-2xs text-ink-subtle truncate">{courseLabel(r.course)}</div>
        </div>
      ),
    },
    {
      key: 'deadline',
      header: 'Deadline',
      render: (r) => {
        const info = deadlineInfo(r.assignment.dueAt)
        return (
          <div>
            <div className="text-ink">{fmtDate(r.assignment.dueAt)}</div>
            {r.assignment.status === 'publicerad' && (
              <div className={info.overdue ? 'text-2xs font-medium text-danger' : 'text-2xs text-ink-subtle'}>
                {info.label}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'submitted',
      header: 'Inlämnat',
      render: (r) => (
        <div className="w-32">
          <ProgressBar value={r.total > 0 ? (r.submitted / r.total) * 100 : 0} tone="info" />
          <div className="mt-0.5 text-2xs text-ink-subtle tabular-nums">
            {r.submitted}/{r.total}
          </div>
        </div>
      ),
    },
    {
      key: 'graded',
      header: 'Bedömt',
      hideOnMobile: true,
      render: (r) => (
        <div className="w-32">
          <ProgressBar value={r.submitted > 0 ? (r.graded / r.submitted) * 100 : 0} tone="success" />
          <div className="mt-0.5 text-2xs text-ink-subtle tabular-nums">
            {r.graded}/{r.submitted}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (r) => {
        const meta = ASG_STATUS_META[r.assignment.status]
        return <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Uppgifter"
        icon="ClipboardList"
        subtitle="Skapa uppgifter, följ inlämningar och bedöm elevernas arbete."
        actions={
          canCreate ? (
            <Button icon="Plus" onClick={() => setCreateOpen(true)}>
              Ny uppgift
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Aktiva uppgifter" value={stats.active} icon="BookOpen" tone={stats.active ? 'info' : 'neutral'} />
        <StatCard label="Att bedöma" value={stats.toGrade} icon="PenLine" tone={stats.toGrade ? 'warning' : 'neutral'} />
        <StatCard label="Passerad deadline" value={stats.overdue} icon="CalendarClock" tone={stats.overdue ? 'danger' : 'neutral'} />
      </div>

      <Card>
        <div className="px-2 pt-1 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={TEACHER_TABS.map((key) => ({ value: key, label: TEACHER_TAB_LABEL[key], count: counts[key] }))}
          />
        </div>
        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="ClipboardList"
            title={`Inga uppgifter under «${TEACHER_TAB_LABEL[tab]}»`}
            description="Skapade uppgifter sorteras efter deadline och visas här."
            actionLabel={canCreate && tab === 'publicerad' ? 'Ny uppgift' : undefined}
            onAction={canCreate && tab === 'publicerad' ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            onRowClick={(r) => setSelectedId(r.id)}
            caption="Uppgifter"
          />
        )}
      </Card>

      {createOpen && (
        <CreateAssignmentModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            bump()
            setCreateOpen(false)
          }}
        />
      )}

      {selected && (
        <TeacherAssignmentModal
          row={selected}
          canUpdate={canUpdate}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Skapa uppgift (lärare)
// ---------------------------------------------------------------------------

function CreateAssignmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const principal = usePrincipal()
  const courses = useMemo(
    () =>
      db.data.courses
        .filter(
          (c) =>
            can(principal, 'create', 'assignment', {
              organizationId: c.organizationId,
              schoolId: c.schoolId,
              courseId: c.id,
            }).allowed,
        )
        .sort((a, b) => {
          const aMine = a.teacherUserId === principal.userId ? 0 : 1
          const bMine = b.teacherUserId === principal.userId ? 0 : 1
          return aMine - bMine || a.code.localeCompare(b.code, 'sv')
        }),
    [principal],
  )

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<'publicerad' | 'utkast'>('publicerad')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const today = fmtDate(new Date())

  function validate(): string | null {
    if (!title.trim()) return 'Ange en titel för uppgiften.'
    if (!courseId) return 'Välj vilken kurs uppgiften tillhör.'
    if (!date) return 'Ange en deadline.'
    if (date < today) return 'Deadline kan inte vara ett passerat datum.'
    return null
  }

  function submit() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSaving(true)
    const input: CreateAssignmentInput = {
      title,
      description,
      courseId,
      dueAt: new Date(`${date}T23:59:00`).toISOString(),
      status,
    }
    // Kort fördröjning för realistisk sparupplevelse.
    setTimeout(() => {
      try {
        const created = createAssignment(principal, input)
        toast.success(
          status === 'utkast' ? 'Utkast sparat' : 'Uppgift publicerad',
          `«${created.title}» · deadline ${fmtDateLong(created.dueAt)}.`,
        )
        onCreated()
      } catch (e) {
        setSaving(false)
        if (e instanceof ForbiddenError) setError(e.message)
        else if (e instanceof RateLimitedError) setError(e.message)
        else setError('Uppgiften kunde inte sparas just nu. Försök igen om en stund.')
      }
    }, 250)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny uppgift"
      description="Uppgiften kopplas till en kurs och blir synlig för eleverna vid publicering."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon={status === 'utkast' ? 'Save' : 'Send'} loading={saving} onClick={submit}>
            {status === 'utkast' ? 'Spara utkast' : 'Publicera uppgift'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <InlineError message={error} />}

        {courses.length === 0 ? (
          <div className="rounded-field border border-border bg-surface-2 p-4 text-sm text-ink-muted">
            Du har inga kurser inom din behörighet. Kontakta skoladministratören.
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Titel</label>
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="T.ex. Laboration 3 – syror och baser"
                maxLength={120}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">
                Beskrivning <span className="text-ink-subtle">(valfritt)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Instruktioner, omfattning och bedömningskriterier."
                className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Kurs</label>
                <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Deadline</label>
                <TextInput type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Publicering</label>
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'publicerad', label: 'Publicera direkt', icon: 'Send' },
                  { value: 'utkast', label: 'Spara som utkast', icon: 'PencilLine' },
                ]}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Detalj + bedömning (lärare)
// ---------------------------------------------------------------------------

interface SubRow {
  sub: Submission
  student?: Student
  masked: boolean
  label: string
}

function TeacherAssignmentModal({
  row,
  canUpdate,
  onClose,
  onChanged,
}: {
  row: TeacherRow
  canUpdate: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [grades, setGrades] = useState<Record<string, string>>({})

  const a = row.assignment

  // Läses direkt från store varje render – hålls färsk efter mutationer.
  const subRows: SubRow[] = db.data.submissions
    .filter((s) => s.assignmentId === a.id)
    .map((s) => {
      const student = byId(db.data.students, s.studentId)
      const name = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
      const masked = Boolean(student?.protectedIdentity) && !principal.protectedClearance
      return { sub: s, student, masked, label: masked ? maskName(name) : name }
    })
    .sort((x, y) => x.label.localeCompare(y.label, 'sv'))

  const anyMasked = subRows.some((r) => r.masked)
  const info = deadlineInfo(a.dueAt)
  const statusMeta = ASG_STATUS_META[a.status]

  function handle(fn: () => void) {
    setError(null)
    try {
      fn()
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError) {
        setError(e.message)
        toast.error('Åtkomst nekad', e.message)
      } else if (e instanceof RateLimitedError) {
        setError(e.message)
        toast.warning('Tillfälligt begränsad', e.message)
      } else {
        setError('Åtgärden kunde inte genomföras just nu.')
      }
    }
  }

  function grade(subId: string) {
    const g = grades[subId]
    if (!g) return
    setBusyId(subId)
    handle(() => {
      gradeSubmission(principal, subId, g)
      toast.success('Bedömning sparad', `Betyg ${g} registrerat.`)
    })
    setBusyId(null)
  }

  function setStatus(status: Assignment['status'], label: string) {
    setStatusBusy(true)
    handle(() => {
      updateAssignmentStatus(principal, a.id, status)
      toast.success(label)
    })
    setStatusBusy(false)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={a.title}
      description={courseLabel(row.course)}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Stäng
          </Button>
          {canUpdate && a.status === 'utkast' && (
            <Button icon="Send" loading={statusBusy} onClick={() => setStatus('publicerad', 'Uppgiften är publicerad')}>
              Publicera
            </Button>
          )}
          {canUpdate && a.status === 'publicerad' && (
            <Button
              variant="secondary"
              icon="Lock"
              loading={statusBusy}
              onClick={() => setStatus('stängd', 'Uppgiften är stängd')}
            >
              Stäng uppgift
            </Button>
          )}
          {canUpdate && a.status === 'stängd' && (
            <Button
              variant="secondary"
              icon="RotateCcw"
              loading={statusBusy}
              onClick={() => setStatus('publicerad', 'Uppgiften är öppnad igen')}
            >
              Öppna igen
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {anyMasked && (
          <div className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Skyddad identitet – vissa namn är maskerade. Behandla uppgifterna varsamt.</span>
          </div>
        )}
        {error && <InlineError message={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={statusMeta.tone} icon={statusMeta.icon} label={statusMeta.label} />
          <Badge tone={info.overdue ? 'danger' : 'neutral'} icon="CalendarClock">
            {fmtDateLong(a.dueAt)}
            {a.status === 'publicerad' ? ` · ${info.label}` : ''}
          </Badge>
        </div>

        {a.description ? (
          <div className="rounded-field border border-border bg-surface-2 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Beskrivning</p>
            <p className="mt-1 text-sm text-ink">{a.description}</p>
          </div>
        ) : (
          <p className="text-2xs text-ink-subtle">Ingen beskrivning angiven.</p>
        )}

        <dl className="divide-y divide-border rounded-field border border-border">
          <SummaryRow label="Inlämnade" value={`${row.submitted} av ${row.total}`} />
          <SummaryRow label="Bedömda" value={`${row.graded} av ${row.submitted}`} />
        </dl>

        <div>
          <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Inlämningar</p>
          {subRows.length === 0 ? (
            <div className="rounded-field border border-border bg-surface-2 p-4 text-sm text-ink-muted">
              Inga inlämningar registrerade än. Elevernas inlämningar visas här när de kommer in.
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-field border border-border">
              {subRows.map((r) => {
                const meta = SUB_STATUS_META[r.sub.status]
                const gradable = canUpdate && (r.sub.status === 'inlämnad' || r.sub.status === 'sen')
                return (
                  <li key={r.sub.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <Avatar name={r.label} color={r.student?.photoColor} size="sm" protected={r.masked} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink">{r.label}</span>
                        {r.masked && (
                          <span title="Skyddad identitet – maskerad">
                            <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
                          </span>
                        )}
                      </div>
                      {r.student?.gradeLabel && (
                        <div className="text-2xs text-ink-subtle">{r.student.gradeLabel}</div>
                      )}
                    </div>
                    <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
                    {r.sub.status === 'bedömd' && r.sub.grade && (
                      <Badge tone={['A', 'B', 'C'].includes(r.sub.grade) ? 'success' : r.sub.grade === 'F' ? 'danger' : 'warning'}>
                        {r.sub.grade}
                      </Badge>
                    )}
                    {gradable && (
                      <div className="flex items-center gap-2">
                        <Select
                          value={grades[r.sub.id] ?? ''}
                          onChange={(e) => setGrades((g) => ({ ...g, [r.sub.id]: e.target.value }))}
                          className="w-24"
                          aria-label={`Betyg för ${r.label}`}
                        >
                          <option value="" disabled>
                            Betyg
                          </option>
                          {GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          icon="Check"
                          loading={busyId === r.sub.id}
                          disabled={!grades[r.sub.id] || busyId !== null}
                          title={!grades[r.sub.id] ? 'Välj betyg först' : undefined}
                          onClick={() => grade(r.sub.id)}
                        >
                          Markera bedömd
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Elevvy
// ---------------------------------------------------------------------------

interface StudentRow {
  id: string
  submission: Submission
  assignment: Assignment
  course?: Course
}

type StudentTab = 'alla' | 'att_gora' | 'inlamnade' | 'bedomda'
const STUDENT_TABS: StudentTab[] = ['alla', 'att_gora', 'inlamnade', 'bedomda']
const STUDENT_TAB_LABEL: Record<StudentTab, string> = {
  alla: 'Alla',
  att_gora: 'Att lämna in',
  inlamnade: 'Inlämnade',
  bedomda: 'Bedömda',
}

function studentTabOf(s: Submission['status']): Exclude<StudentTab, 'alla'> {
  if (s === 'ej_inlämnad') return 'att_gora'
  if (s === 'bedömd') return 'bedomda'
  return 'inlamnade'
}

function StudentAssignments() {
  const principal = usePrincipal()
  const canSubmit = usePermission('update', 'assignment', {
    studentId: principal.ownStudentId ?? undefined,
  }).allowed

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<StudentTab>('alla')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  const rows = useMemo<StudentRow[]>(() => {
    void refresh
    return db.data.submissions
      .filter((s) => s.studentId === principal.ownStudentId)
      .map<StudentRow | null>((s) => {
        const assignment = byId(db.data.assignments, s.assignmentId)
        if (!assignment || assignment.deletedAt || assignment.status === 'utkast') return null
        return { id: s.id, submission: s, assignment, course: byId(db.data.courses, assignment.courseId) }
      })
      .filter((r): r is StudentRow => r !== null)
      .sort((x, y) => new Date(x.assignment.dueAt).getTime() - new Date(y.assignment.dueAt).getTime())
  }, [principal, refresh])

  const counts = useMemo(() => {
    const c: Record<StudentTab, number> = { alla: rows.length, att_gora: 0, inlamnade: 0, bedomda: 0 }
    for (const r of rows) c[studentTabOf(r.submission.status)] += 1
    return c
  }, [rows])

  const visible = useMemo(
    () => (tab === 'alla' ? rows : rows.filter((r) => studentTabOf(r.submission.status) === tab)),
    [rows, tab],
  )

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  const columns: Column<StudentRow>[] = [
    {
      key: 'title',
      header: 'Uppgift',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-ink truncate">{r.assignment.title}</div>
          <div className="text-2xs text-ink-subtle truncate">{courseLabel(r.course)}</div>
        </div>
      ),
    },
    {
      key: 'deadline',
      header: 'Deadline',
      render: (r) => {
        const info = deadlineInfo(r.assignment.dueAt)
        const highlight = info.overdue && r.submission.status === 'ej_inlämnad'
        return (
          <div>
            <div className="text-ink">{fmtDate(r.assignment.dueAt)}</div>
            <div className={highlight ? 'text-2xs font-medium text-danger' : 'text-2xs text-ink-subtle'}>
              {info.label}
            </div>
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const meta = SUB_STATUS_META[r.submission.status]
        return <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
      },
    },
    {
      key: 'grade',
      header: 'Betyg',
      hideOnMobile: true,
      render: (r) =>
        r.submission.grade ? (
          <Badge tone={['A', 'B', 'C'].includes(r.submission.grade) ? 'success' : r.submission.grade === 'F' ? 'danger' : 'warning'}>
            {r.submission.grade}
          </Badge>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Uppgifter"
        icon="ClipboardList"
        subtitle="Dina inlämningar – håll koll på deadlines och resultat."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Att lämna in" value={counts.att_gora} icon="CalendarClock" tone={counts.att_gora ? 'warning' : 'neutral'} />
        <StatCard label="Inlämnade" value={counts.inlamnade} icon="Send" tone={counts.inlamnade ? 'info' : 'neutral'} />
        <StatCard label="Bedömda" value={counts.bedomda} icon="CircleCheck" tone={counts.bedomda ? 'success' : 'neutral'} />
      </div>

      <Card>
        <div className="px-2 pt-1 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={STUDENT_TABS.map((key) => ({ value: key, label: STUDENT_TAB_LABEL[key], count: counts[key] }))}
          />
        </div>
        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="ClipboardCheck"
            title={tab === 'alla' ? 'Inga uppgifter än' : `Inget under «${STUDENT_TAB_LABEL[tab]}»`}
            description="När dina lärare publicerar uppgifter visas de här."
          />
        ) : (
          <DataTable columns={columns} rows={visible} onRowClick={(r) => setSelectedId(r.id)} caption="Mina inlämningar" />
        )}
      </Card>

      {selected && (
        <StudentAssignmentModal
          row={selected}
          canSubmit={canSubmit}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

function StudentAssignmentModal({
  row,
  canSubmit,
  onClose,
  onChanged,
}: {
  row: StudentRow
  canSubmit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const a = row.assignment
  const s = row.submission
  const meta = SUB_STATUS_META[s.status]
  const info = deadlineInfo(a.dueAt)
  const submittable = s.status === 'ej_inlämnad' && a.status === 'publicerad'

  function submit() {
    setError(null)
    setBusy(true)
    try {
      const updated = submitAssignment(principal, s.id)
      toast.success(
        'Uppgift inlämnad',
        updated.status === 'sen' ? 'Inlämningen registrerades efter deadline och markeras som sen.' : `«${a.title}» är inlämnad.`,
      )
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof RateLimitedError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
      else setError('Inlämningen kunde inte registreras just nu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={a.title}
      description={courseLabel(row.course)}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Stäng
          </Button>
          {submittable &&
            (canSubmit ? (
              <Button icon="Send" loading={busy} onClick={submit}>
                Lämna in
              </Button>
            ) : (
              <Button
                icon="Send"
                disabled
                title="Din roll kan inte lämna in digitalt – lämna in till din lärare."
              >
                Lämna in
              </Button>
            ))}
        </div>
      }
    >
      <div className="space-y-4">
        {error && <InlineError message={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
          {s.grade && (
            <Badge tone={['A', 'B', 'C'].includes(s.grade) ? 'success' : s.grade === 'F' ? 'danger' : 'warning'}>
              Betyg {s.grade}
            </Badge>
          )}
        </div>

        {a.description ? (
          <div className="rounded-field border border-border bg-surface-2 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Beskrivning</p>
            <p className="mt-1 text-sm text-ink">{a.description}</p>
          </div>
        ) : (
          <p className="text-2xs text-ink-subtle">Ingen beskrivning angiven.</p>
        )}

        <dl className="divide-y divide-border rounded-field border border-border">
          <SummaryRow
            label="Deadline"
            value={
              <span className={info.overdue && s.status === 'ej_inlämnad' ? 'text-danger' : undefined}>
                {fmtDateLong(a.dueAt)} · {info.label}
              </span>
            }
          />
          {s.submittedAt && <SummaryRow label="Inlämnad" value={fmtDateLong(s.submittedAt)} />}
        </dl>
      </div>
    </Modal>
  )
}
