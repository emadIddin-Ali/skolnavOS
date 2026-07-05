import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, DataTable, Button, Badge, StatusBadge,
  Avatar, StatCard, Icon, EmptyState, DeniedState, LoadingRows,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { db, byId } from '@/data/db/store'
import type { AttendanceStatus, Student, User } from '@/data/schema'
import { ATTENDANCE_STATUS_LABEL } from '@/data/schema'
import { fmtDate, fmtDateLong, maskName } from '@/lib/format'

/**
 * Klassdetalj (/klasser/:id). Läsning auktoriseras via behörighetsmotorn;
 * skyddad identitet maskeras alltid utan klarering.
 */

const WEEKDAY_LABEL = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag']

const ATT_ORDER: AttendanceStatus[] = ['narvarande', 'sen', 'franvarande', 'hamtad', 'ej_markerad']
const ATT_META: Record<AttendanceStatus, { tone: Tone; cssVar: string }> = {
  narvarande: { tone: 'success', cssVar: '--c-success' },
  sen: { tone: 'warning', cssVar: '--c-warning' },
  franvarande: { tone: 'danger', cssVar: '--c-danger' },
  hamtad: { tone: 'info', cssVar: '--c-info' },
  ej_markerad: { tone: 'neutral', cssVar: '--c-ink-subtle' },
}

const STUDENT_STATUS_META: Record<Student['status'], { label: string; tone: Tone }> = {
  inskriven: { label: 'Inskriven', tone: 'success' },
  ansökt: { label: 'Ansökt', tone: 'info' },
  utskriven: { label: 'Utskriven', tone: 'neutral' },
  vilande: { label: 'Vilande', tone: 'warning' },
}

interface RosterRow {
  id: string
  student: Student
  masked: boolean
  name: string
}

export function ClassDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const principal = usePrincipal()
  const cls = byId(db.data.classes, id)

  const target = cls
    ? { organizationId: cls.organizationId, schoolId: cls.schoolId, classId: cls.id }
    : undefined
  const readDecision = usePermission('read', 'class', target)
  const attendanceDecision = usePermission('read', 'attendance', target)
  const scheduleDecision = usePermission('read', 'schedule', target)
  const canTakeAttendance = useCan('create', 'attendance', target)
  const canMessage = useCan('create', 'message', target)

  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 200)
    return () => clearTimeout(t)
  }, [])

  const roster = useMemo<RosterRow[]>(() => {
    if (!cls) return []
    return db.data.students
      .filter((s) => s.classId === cls.id)
      .map((s) => {
        const masked = s.protectedIdentity && !principal.protectedClearance
        const full = `${s.firstName} ${s.lastName}`
        return { id: s.id, student: s, masked, name: masked ? maskName(full) : full }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }, [cls, principal])

  const scheduleByDay = useMemo(() => {
    if (!cls) return []
    const events = db.data.scheduleEvents.filter((e) => e.classId === cls.id)
    return [0, 1, 2, 3, 4, 5, 6]
      .map((wd) => ({
        wd,
        events: events
          .filter((e) => e.weekday === wd)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      }))
      .filter((d) => d.events.length > 0)
  }, [cls])

  const attendanceToday = useMemo(() => {
    if (!cls) return []
    const today = fmtDate(new Date())
    return db.data.attendance.filter((a) => a.classId === cls.id && fmtDate(a.date) === today)
  }, [cls])

  const attCounts = useMemo(() => {
    const c: Partial<Record<AttendanceStatus, number>> = {}
    for (const a of attendanceToday) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [attendanceToday])

  const school = cls ? byId(db.data.schools, cls.schoolId) : undefined
  const mentor = cls?.mentorUserId ? byId(db.data.users, cls.mentorUserId) : undefined
  const mentorProfile = mentor ? db.data.staff.find((s) => s.userId === mentor.id) : undefined

  if (!cls) {
    return (
      <>
        <PageHeader title="Klassen hittades inte" icon="SearchX" />
        <Card>
          <CardBody className="flex flex-col items-center py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-ink-subtle">
              <Icon name="SearchX" className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-semibold text-ink">Klassen finns inte</h3>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              Klassen kan ha arkiverats eller flyttats till ett annat läsår.
            </p>
            <Button className="mt-5" variant="secondary" icon="ArrowLeft" onClick={() => navigate('/klasser')}>
              Till klasslistan
            </Button>
          </CardBody>
        </Card>
      </>
    )
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Klassdetalj" icon="Users" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const hasProtected = roster.some((r) => r.masked)
  const markedToday = attendanceToday.length - (attCounts.ej_markerad ?? 0)

  const rosterColumns: Column<RosterRow>[] = [
    {
      key: 'name',
      header: 'Elev',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} color={r.student.photoColor} size="sm" protected={r.masked} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{r.name}</span>
              {r.masked && (
                <Badge tone="warning" icon="ShieldAlert">
                  Skyddad
                </Badge>
              )}
            </div>
            <div className="text-2xs text-ink-subtle">{r.student.gradeLabel}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'flags',
      header: 'Flaggor',
      render: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {r.student.hasAllergyFlag && (
            <Badge tone="danger" icon="Wheat">
              Allergi
            </Badge>
          )}
          {r.student.hasPickupNote && (
            <Badge tone="info" icon="CarFront">
              Hämtning
            </Badge>
          )}
          {!r.student.hasAllergyFlag && !r.student.hasPickupNote && (
            <span className="text-2xs text-ink-subtle">–</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (r) => {
        const m = STUDENT_STATUS_META[r.student.status]
        return <StatusBadge tone={m.tone} label={m.label} />
      },
    },
  ]

  return (
    <>
      <PageHeader
        title={`Klass ${cls.name}`}
        icon="Users"
        subtitle={`${cls.gradeLabel} · ${school?.name ?? 'Okänd skola'}`}
        breadcrumbs={[{ label: 'Klasser & grupper' }, { label: cls.name }]}
        actions={
          <>
            {canTakeAttendance && (
              <Button variant="secondary" icon="ClipboardCheck" onClick={() => navigate('/narvaro')}>
                Ta närvaro
              </Button>
            )}
            {canMessage && (
              <Button icon="MessageSquare" onClick={() => navigate('/meddelanden')}>
                Meddelande till klassen
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Elever i klassen" value={roster.length} icon="Users" tone="primary" />
        <StatCard
          label="Markerade idag"
          value={attendanceDecision.allowed ? `${markedToday} av ${attendanceToday.length}` : '–'}
          icon="ClipboardCheck"
          tone={attendanceDecision.allowed && attendanceToday.length > 0 ? 'info' : 'neutral'}
          hint={
            attendanceDecision.allowed
              ? 'Närvaroregistreringar idag'
              : 'Kräver behörighet till närvaro'
          }
        />
        <MentorCard user={mentor} title={mentorProfile?.title} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 self-start">
          <CardHeader
            icon="Users"
            title="Elevroster"
            subtitle="Klicka på en rad för att öppna elevprofilen."
          />
          {hasProtected && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <Icon name="ShieldAlert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Klassen har elever med skyddad identitet – namn visas maskerade och åtkomst loggas.</span>
            </div>
          )}
          {loading ? (
            <LoadingRows rows={6} />
          ) : (
            <DataTable
              columns={rosterColumns}
              rows={roster}
              onRowClick={(r) => navigate(`/elever/${r.student.id}`)}
              caption={`Elever i klass ${cls.name}`}
              emptyTitle="Inga elever i klassen"
              emptyDescription="När elever skrivs in i klassen visas de här."
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              icon="ClipboardCheck"
              title="Frånvaro just nu"
              subtitle={`Idag · ${fmtDateLong(new Date())}`}
            />
            {!attendanceDecision.allowed ? (
              <DeniedState reason={attendanceDecision.reason} />
            ) : loading ? (
              <LoadingRows rows={3} />
            ) : attendanceToday.length === 0 ? (
              <EmptyState
                icon="CalendarCheck"
                title="Ingen närvaro registrerad idag"
                description="När närvaron tas visas statusfördelningen här."
                actionLabel={canTakeAttendance ? 'Ta närvaro' : undefined}
                onAction={canTakeAttendance ? () => navigate('/narvaro') : undefined}
              />
            ) : (
              <CardBody className="pt-1">
                <div className="flex h-2.5 overflow-hidden rounded-pill bg-surface-3" role="img" aria-label="Statusfördelning för dagens närvaro">
                  {ATT_ORDER.filter((k) => (attCounts[k] ?? 0) > 0).map((k) => (
                    <div
                      key={k}
                      style={{
                        width: `${((attCounts[k] ?? 0) / attendanceToday.length) * 100}%`,
                        backgroundColor: `rgb(var(${ATT_META[k].cssVar}))`,
                      }}
                      title={`${ATTENDANCE_STATUS_LABEL[k]}: ${attCounts[k]}`}
                    />
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {ATT_ORDER.map((k) => (
                    <li key={k} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-ink-muted">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: `rgb(var(${ATT_META[k].cssVar}))` }}
                          aria-hidden
                        />
                        {ATTENDANCE_STATUS_LABEL[k]}
                      </span>
                      <span className="font-medium tabular-nums text-ink">{attCounts[k] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader icon="CalendarDays" title="Schema" subtitle="Veckans lektioner i kompakt vy." />
            {!scheduleDecision.allowed ? (
              <DeniedState reason={scheduleDecision.reason} />
            ) : loading ? (
              <LoadingRows rows={4} />
            ) : scheduleByDay.length === 0 ? (
              <EmptyState
                icon="CalendarDays"
                title="Inget schema inlagt"
                description="Klassens lektioner visas här när schemat är publicerat."
              />
            ) : (
              <CardBody className="space-y-3 pt-1">
                {scheduleByDay.map((day) => (
                  <div key={day.wd}>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                      {WEEKDAY_LABEL[day.wd]}
                    </p>
                    <ul className="space-y-1">
                      {day.events.map((e) => {
                        const room = e.roomId ? byId(db.data.rooms, e.roomId)?.name : undefined
                        return (
                          <li
                            key={e.id}
                            className="flex items-center gap-2 rounded-field bg-surface-2 px-2.5 py-1.5 text-xs"
                          >
                            <span className="tabular-nums text-ink-subtle">
                              {e.startsAt}–{e.endsAt}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.title}</span>
                            {room && <span className="shrink-0 text-ink-subtle">{room}</span>}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

/** Kompakt mentor-vy i statistikraden. */
function MentorCard({ user, title }: { user?: User; title?: string }) {
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
        <div className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Mentor</div>
        <div className="truncate text-sm font-medium text-ink">{user?.name ?? 'Ingen mentor tilldelad'}</div>
        {title && <div className="truncate text-2xs text-ink-subtle">{title}</div>}
      </div>
    </Card>
  )
}
