import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, DataTable, Button, Badge, StatusBadge,
  Avatar, StatCard, ProgressBar, Icon, EmptyState, DeniedState, LoadingRows,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can } from '@/core/permissions/engine'
import { db, byId } from '@/data/db/store'
import type { Assessment, Assignment, Student, User } from '@/data/schema'
import { fmtDate, maskName } from '@/lib/format'

/**
 * Kursdetalj (/kurser/:id). Uppgifter och bedömningar visas endast för roller
 * med läsbehörighet till respektive resurs; elevnamn maskeras vid skyddad
 * identitet utan klarering.
 */

const ASSIGNMENT_STATUS_META: Record<Assignment['status'], { label: string; tone: Tone }> = {
  utkast: { label: 'Utkast', tone: 'neutral' },
  publicerad: { label: 'Publicerad', tone: 'success' },
  stängd: { label: 'Stängd', tone: 'neutral' },
}

const ASSESSMENT_TYPE_LABEL: Record<Assessment['type'], string> = {
  omdöme: 'Omdöme',
  terminsbetyg: 'Terminsbetyg',
  slutbetyg: 'Slutbetyg',
  prov: 'Prov',
}

const GRADE_TONE: Record<Assessment['grade'], Tone> = {
  A: 'success',
  B: 'success',
  C: 'info',
  D: 'info',
  E: 'warning',
  F: 'danger',
  '-': 'neutral',
}

interface AssessmentRow {
  id: string
  assessment: Assessment
  student?: Student
  masked: boolean
  name: string
  assessor: string
}

interface ParticipantRow {
  id: string
  student: Student
  masked: boolean
  name: string
}

export function CourseDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const principal = usePrincipal()
  const course = byId(db.data.courses, id)

  const target = course
    ? { organizationId: course.organizationId, schoolId: course.schoolId, courseId: course.id }
    : undefined
  const readDecision = usePermission('read', 'course', target)
  const assignmentDecision = usePermission('read', 'assignment', target)
  const assessmentDecision = usePermission('read', 'assessment', target)

  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 200)
    return () => clearTimeout(t)
  }, [])

  const assignments = useMemo<Assignment[]>(() => {
    if (!course) return []
    return db.data.assignments
      .filter((a) => a.courseId === course.id)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  }, [course])

  const assessmentRows = useMemo<AssessmentRow[]>(() => {
    if (!course || !assessmentDecision.allowed) return []
    return db.data.assessments
      .filter((a) => a.courseId === course.id)
      .map<AssessmentRow | null>((a) => {
        const student = byId(db.data.students, a.studentId)
        const decision = can(principal, 'read', 'assessment', {
          organizationId: course.organizationId,
          schoolId: course.schoolId,
          courseId: course.id,
          studentId: a.studentId,
          classId: student?.classId,
          protectedIdentity: student?.protectedIdentity,
        })
        if (!decision.allowed) return null
        const full = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
        const masked =
          Boolean(decision.masked) ||
          Boolean(student?.protectedIdentity && !principal.protectedClearance)
        return {
          id: a.id,
          assessment: a,
          student,
          masked,
          name: masked ? maskName(full) : full,
          assessor: byId(db.data.users, a.assessedBy)?.name ?? 'Okänd',
        }
      })
      .filter((r): r is AssessmentRow => r !== null)
      .sort((a, b) => b.assessment.assessedAt.localeCompare(a.assessment.assessedAt))
  }, [course, principal, assessmentDecision.allowed])

  const participants = useMemo<ParticipantRow[]>(() => {
    if (!course) return []
    const studentIds = new Set(
      db.data.enrollments.filter((e) => e.courseId === course.id).map((e) => e.studentId),
    )
    return db.data.students
      .filter((s) => studentIds.has(s.id))
      .map((s) => {
        const masked = s.protectedIdentity && !principal.protectedClearance
        const full = `${s.firstName} ${s.lastName}`
        return { id: s.id, student: s, masked, name: masked ? maskName(full) : full }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }, [course, principal])

  const school = course ? byId(db.data.schools, course.schoolId) : undefined
  const teacher = course?.teacherUserId ? byId(db.data.users, course.teacherUserId) : undefined
  const term = course?.termId ? byId(db.data.terms, course.termId) : undefined

  if (!course) {
    return (
      <>
        <PageHeader title="Kursen hittades inte" icon="SearchX" />
        <Card>
          <CardBody className="flex flex-col items-center py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-ink-subtle">
              <Icon name="SearchX" className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-semibold text-ink">Kursen finns inte</h3>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              Kursen kan ha avslutats eller flyttats till en annan termin.
            </p>
            <Button className="mt-5" variant="secondary" icon="ArrowLeft" onClick={() => navigate('/kurser')}>
              Till kurslistan
            </Button>
          </CardBody>
        </Card>
      </>
    )
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Kursdetalj" icon="BookOpen" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const totalStudents = Math.max(course.studentCount, 1)
  const hasMaskedAssessments = assessmentRows.some((r) => r.masked)

  const assignmentColumns: Column<Assignment>[] = [
    {
      key: 'title',
      header: 'Uppgift',
      render: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{a.title}</div>
          <div className="text-2xs text-ink-subtle">Inlämning senast {fmtDate(a.dueAt)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => {
        const m = ASSIGNMENT_STATUS_META[a.status]
        return <StatusBadge tone={m.tone} label={m.label} />
      },
    },
    {
      key: 'submitted',
      header: 'Inlämnat',
      hideOnMobile: true,
      render: (a) => (
        <div className="w-36">
          <ProgressBar value={(a.submissionsCount / totalStudents) * 100} tone="info" />
          <div className="mt-0.5 text-2xs tabular-nums text-ink-subtle">
            {a.submissionsCount} av {course.studentCount}
          </div>
        </div>
      ),
    },
    {
      key: 'graded',
      header: 'Bedömt',
      hideOnMobile: true,
      render: (a) => (
        <div className="w-36">
          <ProgressBar
            value={(a.gradedCount / Math.max(a.submissionsCount, 1)) * 100}
            tone="success"
          />
          <div className="mt-0.5 text-2xs tabular-nums text-ink-subtle">
            {a.gradedCount} av {a.submissionsCount}
          </div>
        </div>
      ),
    },
  ]

  const assessmentColumns: Column<AssessmentRow>[] = [
    {
      key: 'student',
      header: 'Elev',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} color={r.student?.photoColor} size="sm" protected={r.masked} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{r.name}</span>
              {r.masked && (
                <span title="Skyddad identitet – maskerad">
                  <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
                </span>
              )}
            </div>
            {r.student && <div className="text-2xs text-ink-subtle">{r.student.gradeLabel}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'grade',
      header: 'Betyg',
      render: (r) => (
        <Badge tone={GRADE_TONE[r.assessment.grade]} className="font-semibold">
          {r.assessment.grade}
        </Badge>
      ),
    },
    {
      key: 'type',
      header: 'Typ',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{ASSESSMENT_TYPE_LABEL[r.assessment.type]}</span>,
    },
    {
      key: 'date',
      header: 'Bedömd',
      render: (r) => <span className="tabular-nums text-ink-muted">{fmtDate(r.assessment.assessedAt)}</span>,
    },
    {
      key: 'assessor',
      header: 'Bedömd av',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.assessor}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={course.name}
        icon="BookOpen"
        subtitle={`${course.code} · ${school?.name ?? 'Okänd skola'}`}
        breadcrumbs={[{ label: 'Kurser' }, { label: course.code }]}
        actions={
          <Button variant="secondary" icon="ArrowLeft" onClick={() => navigate('/kurser')}>
            Till kurslistan
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TeacherCard user={teacher} />
        <StatCard label="Poäng" value={course.points} icon="GraduationCap" tone="primary" />
        <StatCard label="Elever" value={course.studentCount} icon="Users" tone="info" />
        <StatCard
          label="Termin"
          value={<span className="text-base">{term?.label ?? 'Ej angiven'}</span>}
          icon="CalendarDays"
          tone="neutral"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 self-start">
          <CardHeader
            icon="ClipboardList"
            title="Uppgifter i kursen"
            subtitle={assignmentDecision.allowed ? `${assignments.length} uppgifter med inlämnings- och bedömningsläge.` : undefined}
          />
          {!assignmentDecision.allowed ? (
            <DeniedState reason={assignmentDecision.reason} />
          ) : loading ? (
            <LoadingRows rows={4} />
          ) : (
            <DataTable
              columns={assignmentColumns}
              rows={assignments}
              caption={`Uppgifter i ${course.code}`}
              emptyTitle="Inga uppgifter i kursen"
              emptyDescription="Uppgifter som läraren publicerar visas här."
            />
          )}
        </Card>

        <Card className="self-start">
          <CardHeader icon="Users" title="Deltagare" subtitle={`${course.studentCount} elever i kursen.`} />
          {loading ? (
            <LoadingRows rows={4} />
          ) : participants.length === 0 ? (
            <EmptyState
              icon="Users"
              title="Deltagarlista kopplas via inskrivningar"
              description={`Kursen har ${course.studentCount} elever. När inskrivningarna är kopplade visas namnlistan här.`}
            />
          ) : (
            <CardBody className="space-y-0.5 pt-0">
              {participants.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/elever/${p.id}`)}
                  className="flex w-full items-center gap-2.5 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Avatar name={p.name} color={p.student.photoColor} size="sm" protected={p.masked} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.name}</span>
                  {p.masked && <Icon name="ShieldAlert" className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-subtle" />
                </button>
              ))}
            </CardBody>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          icon="BadgeCheck"
          title="Bedömningar"
          subtitle={assessmentDecision.allowed ? `${assessmentRows.length} registrerade bedömningar i kursen.` : undefined}
        />
        {!assessmentDecision.allowed ? (
          <DeniedState reason={assessmentDecision.reason} />
        ) : loading ? (
          <LoadingRows rows={3} />
        ) : (
          <>
            {hasMaskedAssessments && (
              <div className="mx-4 mb-2 flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                <Icon name="ShieldAlert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Vissa elever har skyddad identitet – namn visas maskerade och läsning loggas.</span>
              </div>
            )}
            <DataTable
              columns={assessmentColumns}
              rows={assessmentRows}
              caption={`Bedömningar i ${course.code}`}
              emptyTitle="Inga bedömningar än"
              emptyDescription="Betyg och omdömen i kursen visas här när de registreras."
            />
          </>
        )}
      </Card>
    </>
  )
}

/** Kompakt lärarvy i statistikraden. */
function TeacherCard({ user }: { user?: User }) {
  const title = user ? db.data.staff.find((s) => s.userId === user.id)?.title : undefined
  return (
    <Card className="flex items-center gap-3 p-4">
      {user ? (
        <Avatar name={user.name} color={user.avatarColor} />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-subtle">
          <Icon name="User" className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Kursansvarig</div>
        <div className="truncate text-sm font-medium text-ink">{user?.name ?? 'Ingen lärare tilldelad'}</div>
        {title && <div className="truncate text-2xs text-ink-subtle">{title}</div>}
      </div>
    </Card>
  )
}
