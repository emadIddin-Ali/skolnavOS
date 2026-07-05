import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, DataTable, Tabs, Button,
  Badge, Avatar, Modal, Select, ClassificationBadge, Icon,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { Assessment, Course, Student } from '@/data/schema'
import { fmtDate, fmtDateLong, maskName } from '@/lib/format'
import { createAssessment, requestAssessmentExport, type CreateAssessmentInput } from './service'

// ---- Presentationskartor ----
const GRADE_TONE: Record<Assessment['grade'], Tone> = {
  A: 'success',
  B: 'success',
  C: 'success',
  D: 'warning',
  E: 'warning',
  F: 'danger',
  '-': 'neutral',
}

const TYPE_LABEL: Record<Assessment['type'], string> = {
  omdöme: 'Omdöme',
  terminsbetyg: 'Terminsbetyg',
  slutbetyg: 'Slutbetyg',
  prov: 'Prov',
}

const TYPE_ICON: Record<Assessment['type'], string> = {
  omdöme: 'MessageSquare',
  terminsbetyg: 'GraduationCap',
  slutbetyg: 'BadgeCheck',
  prov: 'NotebookPen',
}

function GradeBadge({ grade }: { grade: Assessment['grade'] }) {
  return <Badge tone={GRADE_TONE[grade]}>{grade === '-' ? 'Ej satt' : grade}</Badge>
}

function courseLabel(course?: Course, subjectCode?: string): string {
  if (course) return `${course.code} · ${course.name}`
  return subjectCode ?? 'Okänd kurs'
}

// ---------------------------------------------------------------------------
// Sidkomponent – väljer vy efter roll
// ---------------------------------------------------------------------------

export function AssessmentsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'assessment')

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Bedömning & resultat" icon="GraduationCap" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  if (principal.role === 'vardnadshavare') return <GuardianAssessments />
  if (principal.ownStudentId) return <StudentAssessments />
  return <StaffAssessments />
}

// ---------------------------------------------------------------------------
// Personalvy (lärare/rektor m.fl.)
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string
  assessment: Assessment
  student?: Student
  course?: Course
  masked: boolean
  studentLabel: string
  assessorLabel: string
}

type TypeTab = 'alla' | Assessment['type']
const TYPE_TABS: TypeTab[] = ['alla', 'omdöme', 'terminsbetyg', 'slutbetyg', 'prov']

function StaffAssessments() {
  const principal = usePrincipal()
  const canCreate = usePermission('create', 'assessment').allowed
  const exportDecision = usePermission('export', 'export')

  const [loading, setLoading] = useState(true)
  const [typeTab, setTypeTab] = useState<TypeTab>('alla')
  const [courseFilter, setCourseFilter] = useState('alla')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  // Varje rad prövas mot behörighetsmotorn (scope, tenant, skyddad identitet).
  const rows = useMemo<StaffRow[]>(() => {
    void refresh
    return db.data.assessments
      .filter((a) => !a.deletedAt)
      .map<StaffRow | null>((a) => {
        const student = byId(db.data.students, a.studentId)
        const decision = can(principal, 'read', 'assessment', {
          organizationId: a.organizationId,
          schoolId: a.schoolId,
          courseId: a.courseId,
          classId: student?.classId,
          studentId: a.studentId,
          protectedIdentity: student?.protectedIdentity,
          dataClassification: 4,
        })
        if (!decision.allowed) return null
        const course = byId(db.data.courses, a.courseId)
        const name = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
        const masked = Boolean(decision.masked)
        const assessor = byId(db.data.users, a.assessedBy)
        return {
          id: a.id,
          assessment: a,
          student,
          course,
          masked,
          studentLabel: masked ? maskName(name) : name,
          assessorLabel: a.assessedBy === principal.userId ? 'Du' : assessor?.name ?? 'Okänd',
        }
      })
      .filter((r): r is StaffRow => r !== null)
      .sort((x, y) => new Date(y.assessment.assessedAt).getTime() - new Date(x.assessment.assessedAt).getTime())
  }, [principal, refresh])

  const counts = useMemo(() => {
    const c: Record<TypeTab, number> = { alla: rows.length, omdöme: 0, terminsbetyg: 0, slutbetyg: 0, prov: 0 }
    for (const r of rows) c[r.assessment.type] += 1
    return c
  }, [rows])

  const courseOptions = useMemo(() => {
    const seen = new Map<string, Course>()
    for (const r of rows) if (r.course && !seen.has(r.course.id)) seen.set(r.course.id, r.course)
    return Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code, 'sv'))
  }, [rows])

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (typeTab === 'alla' || r.assessment.type === typeTab) &&
          (courseFilter === 'alla' || r.assessment.courseId === courseFilter),
      ),
    [rows, typeTab, courseFilter],
  )

  const stats = useMemo(() => {
    const failed = rows.filter((r) => r.assessment.grade === 'F').length
    const finals = rows.filter((r) => r.assessment.type === 'terminsbetyg' || r.assessment.type === 'slutbetyg').length
    return { total: rows.length, finals, failed }
  }, [rows])

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  function doExport(bulk: boolean) {
    try {
      const job = requestAssessmentExport(principal, { bulk, rowEstimate: visible.length })
      toast.success('Export beställd', `«${job.title}» bearbetas och visas under Rapporter.`)
    } catch (e) {
      if (e instanceof ForbiddenError) {
        if (e.code === 'bulk_export_blocked') {
          toast.warning('Bulkexport blockerad', e.message)
        } else {
          toast.error('Export nekad', e.message)
        }
      } else if (e instanceof RateLimitedError) {
        toast.warning('Tillfälligt begränsad', e.message)
      } else {
        toast.error('Exporten kunde inte startas', 'Försök igen om en stund.')
      }
    }
  }

  const columns: Column<StaffRow>[] = [
    {
      key: 'student',
      header: 'Elev',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.studentLabel} color={r.student?.photoColor} size="sm" protected={r.masked} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{r.studentLabel}</span>
              {r.masked && (
                <span title="Skyddad identitet – maskerad">
                  <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
                </span>
              )}
            </div>
            {r.student?.gradeLabel && <div className="text-2xs text-ink-subtle">{r.student.gradeLabel}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'course',
      header: 'Kurs / ämne',
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{r.course?.name ?? r.assessment.subjectCode}</div>
          {r.course && <div className="text-2xs text-ink-subtle">{r.course.code}</div>}
        </div>
      ),
    },
    {
      key: 'grade',
      header: 'Betyg',
      render: (r) => <GradeBadge grade={r.assessment.grade} />,
    },
    {
      key: 'type',
      header: 'Typ',
      hideOnMobile: true,
      render: (r) => (
        <Badge tone="neutral" icon={TYPE_ICON[r.assessment.type]}>
          {TYPE_LABEL[r.assessment.type]}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: 'Datum',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{fmtDate(r.assessment.assessedAt)}</span>,
    },
    {
      key: 'assessor',
      header: 'Bedömare',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.assessorLabel}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Bedömning & resultat"
        icon="GraduationCap"
        subtitle="Betyg, omdömen och provresultat inom din behörighet. Känslig skoldata – åtkomst loggas."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon="FileOutput"
              disabled={!exportDecision.allowed}
              title={!exportDecision.allowed ? exportDecision.reason : 'Exportera aktuellt urval som PDF'}
              onClick={() => doExport(false)}
            >
              Exportera
            </Button>
            <Button
              variant="secondary"
              icon="Database"
              disabled={!exportDecision.allowed}
              title={!exportDecision.allowed ? exportDecision.reason : 'Bulkexport prövas mot dataskyddsreglerna'}
              onClick={() => doExport(true)}
            >
              Bulkexport
            </Button>
            {canCreate && (
              <Button icon="Plus" onClick={() => setCreateOpen(true)}>
                Ny bedömning
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Bedömningar" value={stats.total} icon="GraduationCap" tone={stats.total ? 'primary' : 'neutral'} />
        <StatCard label="Termins- & slutbetyg" value={stats.finals} icon="BadgeCheck" tone={stats.finals ? 'info' : 'neutral'} />
        <StatCard label="Underkända (F)" value={stats.failed} icon="TriangleAlert" tone={stats.failed ? 'danger' : 'neutral'} />
      </div>

      <Card>
        <div className="flex flex-col gap-2 px-2 pt-1 sm:px-4 md:flex-row md:items-end md:justify-between">
          <Tabs
            className="min-w-0 flex-1"
            value={typeTab}
            onChange={setTypeTab}
            tabs={TYPE_TABS.map((key) => ({
              value: key,
              label: key === 'alla' ? 'Alla' : TYPE_LABEL[key],
              count: counts[key],
            }))}
          />
          <div className="pb-2 md:w-64">
            <Select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} aria-label="Filtrera på kurs">
              <option value="alla">Alla kurser</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="GraduationCap"
            title="Inga bedömningar att visa"
            description="Bedömningar inom din behörighet visas här. Justera filtren eller registrera en ny bedömning."
            actionLabel={canCreate ? 'Ny bedömning' : undefined}
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <DataTable columns={columns} rows={visible} onRowClick={(r) => setSelectedId(r.id)} caption="Bedömningar" />
        )}
      </Card>

      {createOpen && (
        <CreateAssessmentModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            bump()
            setCreateOpen(false)
          }}
        />
      )}

      {selected && <AssessmentDetailModal row={selected} onClose={() => setSelectedId(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Detalj (läsvy)
// ---------------------------------------------------------------------------

function AssessmentDetailModal({ row, onClose }: { row: StaffRow; onClose: () => void }) {
  const a = row.assessment
  return (
    <Modal
      open
      onClose={onClose}
      title="Bedömning"
      description={`${row.studentLabel}${row.student?.gradeLabel ? ` · ${row.student.gradeLabel}` : ''}`}
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
            <span>Skyddad identitet – namnet är maskerat. Behandla uppgiften varsamt.</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <GradeBadge grade={a.grade} />
          <Badge tone="neutral" icon={TYPE_ICON[a.type]}>
            {TYPE_LABEL[a.type]}
          </Badge>
          <ClassificationBadge level={4} />
        </div>
        <dl className="divide-y divide-border rounded-field border border-border">
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <dt className="text-ink-subtle">Kurs</dt>
            <dd className="text-right font-medium text-ink">{courseLabel(row.course, a.subjectCode)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <dt className="text-ink-subtle">Datum</dt>
            <dd className="text-right font-medium text-ink">{fmtDateLong(a.assessedAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <dt className="text-ink-subtle">Bedömare</dt>
            <dd className="text-right font-medium text-ink">{row.assessorLabel}</dd>
          </div>
        </dl>
        {a.comment ? (
          <div className="rounded-field border border-border bg-surface-2 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Kommentar</p>
            <p className="mt-1 text-sm text-ink">{a.comment}</p>
          </div>
        ) : (
          <p className="text-2xs text-ink-subtle">Ingen kommentar angiven.</p>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Ny bedömning (lärare/rektor)
// ---------------------------------------------------------------------------

function CreateAssessmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const principal = usePrincipal()

  const courses = useMemo(
    () =>
      db.data.courses
        .filter(
          (c) =>
            can(principal, 'create', 'assessment', {
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

  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [studentId, setStudentId] = useState('')
  const [grade, setGrade] = useState<Assessment['grade'] | ''>('')
  const [type, setType] = useState<Assessment['type']>('omdöme')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const course = courses.find((c) => c.id === courseId)

  // Elever i den valda kursens skola (motorn gör den auktoritativa prövningen).
  const students = useMemo(
    () =>
      course
        ? db.data.students
            .filter((s) => s.schoolId === course.schoolId && s.status === 'inskriven' && !s.deletedAt)
            .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'sv'))
        : [],
    [course],
  )

  function studentOptionLabel(s: Student): string {
    const name = `${s.firstName} ${s.lastName}`
    if (s.protectedIdentity && !principal.protectedClearance) return `${maskName(name)} (skyddad) · ${s.gradeLabel}`
    return `${name} · ${s.gradeLabel}`
  }

  function validate(): string | null {
    if (!courseId) return 'Välj kurs.'
    if (!studentId) return 'Välj elev.'
    if (!grade) return 'Välj betyg.'
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
    const input: CreateAssessmentInput = {
      studentId,
      courseId,
      grade: grade as Assessment['grade'],
      type,
      comment,
    }
    setTimeout(() => {
      try {
        createAssessment(principal, input)
        toast.success('Bedömning sparad', `${TYPE_LABEL[type]} med betyg ${grade} har registrerats.`)
        onCreated()
      } catch (e) {
        setSaving(false)
        if (e instanceof ForbiddenError) setError(e.message)
        else if (e instanceof RateLimitedError) setError(e.message)
        else if (e instanceof Error) setError(e.message)
        else setError('Bedömningen kunde inte sparas just nu.')
      }
    }, 250)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny bedömning"
      description="Registrera betyg, omdöme eller provresultat för en elev."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon="Check" loading={saving} onClick={submit} disabled={courses.length === 0}>
            Spara bedömning
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

        <div className="flex items-start gap-2 rounded-field border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          <ClassificationBadge level={4} />
          <span className="mt-0.5">Bedömningar är känslig skoldata. Registreringen granskningsloggas.</span>
        </div>

        {courses.length === 0 ? (
          <div className="rounded-field border border-border bg-surface-2 p-4 text-sm text-ink-muted">
            Du har inga kurser inom din behörighet att registrera bedömningar för.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Kurs</label>
                <Select
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value)
                    setStudentId('')
                  }}
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Elev</label>
                <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  <option value="" disabled>
                    Välj elev
                  </option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {studentOptionLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Betyg</label>
                <Select value={grade} onChange={(e) => setGrade(e.target.value as Assessment['grade'])}>
                  <option value="" disabled>
                    Välj betyg
                  </option>
                  {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Typ</label>
                <Select value={type} onChange={(e) => setType(e.target.value as Assessment['type'])}>
                  {(Object.keys(TYPE_LABEL) as Assessment['type'][]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">
                Kommentar <span className="text-ink-subtle">(valfritt)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="T.ex. utvecklas väl mot kunskapskraven."
                className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Elevvy – egna resultat som kort per kurs
// ---------------------------------------------------------------------------

interface CourseGroup {
  key: string
  title: string
  subtitle: string
  items: Assessment[]
}

function StudentAssessments() {
  const principal = usePrincipal()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  const groups = useMemo<CourseGroup[]>(() => {
    const own = db.data.assessments.filter(
      (a) =>
        !a.deletedAt &&
        a.studentId === principal.ownStudentId &&
        can(principal, 'read', 'assessment', {
          organizationId: a.organizationId,
          schoolId: a.schoolId,
          studentId: a.studentId,
          dataClassification: 4,
        }).allowed,
    )
    const map = new Map<string, CourseGroup>()
    for (const a of own) {
      const course = byId(db.data.courses, a.courseId)
      const key = a.courseId ?? `subj-${a.subjectCode}`
      let group = map.get(key)
      if (!group) {
        group = {
          key,
          title: course?.name ?? a.subjectCode,
          subtitle: course ? `${course.code} · ${course.points} poäng` : 'Ämnesbedömning',
          items: [],
        }
        map.set(key, group)
      }
      group.items.push(a)
    }
    const list = Array.from(map.values())
    for (const g of list) g.items.sort((x, y) => new Date(y.assessedAt).getTime() - new Date(x.assessedAt).getTime())
    return list.sort((a, b) => a.title.localeCompare(b.title, 'sv'))
  }, [principal])

  const totals = useMemo(() => {
    const all = groups.flatMap((g) => g.items)
    const latest = all.reduce<string | null>(
      (acc, a) => (acc === null || a.assessedAt > acc ? a.assessedAt : acc),
      null,
    )
    return { count: all.length, courses: groups.length, latest }
  }, [groups])

  return (
    <>
      <PageHeader
        title="Bedömning & resultat"
        icon="GraduationCap"
        subtitle="Dina betyg och omdömen per kurs."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Bedömningar" value={totals.count} icon="GraduationCap" tone={totals.count ? 'primary' : 'neutral'} />
        <StatCard label="Kurser" value={totals.courses} icon="BookOpen" tone={totals.courses ? 'info' : 'neutral'} />
        <StatCard
          label="Senaste bedömning"
          value={totals.latest ? fmtDate(totals.latest) : '—'}
          icon="CalendarCheck"
          tone="neutral"
        />
      </div>

      {loading ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="GraduationCap"
            title="Inga resultat publicerade än"
            description="När dina lärare registrerar betyg eller omdömen visas de här."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.key}>
              <CardHeader
                title={g.title}
                subtitle={g.subtitle}
                icon="BookOpen"
                action={<GradeBadge grade={g.items[0].grade} />}
              />
              <CardBody>
                <ul className="divide-y divide-border">
                  {g.items.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                        <Icon name={TYPE_ICON[a.type]} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">{TYPE_LABEL[a.type]}</div>
                        <div className="text-2xs text-ink-subtle">
                          {fmtDateLong(a.assessedAt)}
                          {a.comment ? ` · ${a.comment}` : ''}
                        </div>
                      </div>
                      <GradeBadge grade={a.grade} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Vårdnadshavarvy – barns resultat endast med viewAssessments
// ---------------------------------------------------------------------------

function GuardianAssessments() {
  const principal = usePrincipal()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  const kids = useMemo(
    () => db.data.students.filter((s) => principal.guardianStudentIds.includes(s.id)),
    [principal],
  )

  return (
    <>
      <PageHeader
        title="Bedömning & resultat"
        icon="GraduationCap"
        subtitle="Dina barns betyg och omdömen – visas enligt din relations behörighet."
      />

      {loading ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : kids.length === 0 ? (
        <Card>
          <EmptyState
            icon="Users"
            title="Inga barn kopplade"
            description="Inga barn är kopplade till ditt konto. Kontakta skolan för att koppla vårdnadshavarskap."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {kids.map((kid) => (
            <GuardianKidCard key={kid.id} kid={kid} />
          ))}
        </div>
      )}
    </>
  )
}

function GuardianKidCard({ kid }: { kid: Student }) {
  const principal = usePrincipal()
  const name = `${kid.firstName} ${kid.lastName}`
  const masked = kid.protectedIdentity && !principal.protectedClearance
  const label = masked ? maskName(name) : name

  // Kräver uttrycklig relations-behörighet «viewAssessments» + motorns beslut.
  const relationAllows = principal.guardianPermsByStudent[kid.id]?.viewAssessments === true
  const decision = can(principal, 'read', 'assessment', {
    organizationId: kid.organizationId,
    schoolId: kid.schoolId,
    studentId: kid.id,
    protectedIdentity: kid.protectedIdentity,
    dataClassification: 4,
  })

  const items = useMemo(
    () =>
      db.data.assessments
        .filter((a) => !a.deletedAt && a.studentId === kid.id)
        .sort((x, y) => new Date(y.assessedAt).getTime() - new Date(x.assessedAt).getTime()),
    [kid.id],
  )

  return (
    <Card>
      <CardHeader
        title={label}
        subtitle={kid.gradeLabel}
        action={masked ? <Badge tone="warning" icon="ShieldAlert">Skyddad identitet</Badge> : undefined}
      />
      {!relationAllows || !decision.allowed ? (
        <DeniedState
          reason={
            decision.allowed
              ? `Din relation till ${kid.firstName} omfattar inte betyg och omdömen. Kontakta skolan om du behöver den behörigheten.`
              : decision.reason
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="GraduationCap"
          title="Inga resultat publicerade än"
          description={`När skolan registrerar betyg eller omdömen för ${kid.firstName} visas de här.`}
        />
      ) : (
        <CardBody>
          <ul className="divide-y divide-border">
            {items.map((a) => {
              const course = byId(db.data.courses, a.courseId)
              return (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                    <Icon name={TYPE_ICON[a.type]} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{courseLabel(course, a.subjectCode)}</div>
                    <div className="text-2xs text-ink-subtle">
                      {TYPE_LABEL[a.type]} · {fmtDateLong(a.assessedAt)}
                    </div>
                  </div>
                  <GradeBadge grade={a.grade} />
                </li>
              )
            })}
          </ul>
        </CardBody>
      )}
    </Card>
  )
}
