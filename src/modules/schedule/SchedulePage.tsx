import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PageHeader, Card, CardBody, Button, Badge, Select, Segmented, Icon,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError, type Principal } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { ScheduleEvent, SchoolClass, Student } from '@/data/schema'
import { fmtDate, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { exportWeekSchedule } from './service'

/**
 * Veckoschema mån–fre från db.data.scheduleEvents. Källan är rollstyrd:
 * elev → egen klass (+ egna kurser), personal → sina klasser och kurser,
 * vårdnadshavare → väljare mellan barnens klasser, skolledning → klassväljare
 * över skolans klasser. Läsning filtreras rad för rad via behörighetsmotorn.
 */

const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag'] as const
const WEEKDAYS_SHORT = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre'] as const
const STAFF_ROLES: string[] = ['larare', 'mentor', 'pedagog', 'vikarie']

// ---- Datumhjälpare (endast aktuell vecka visas) ----

function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

/** ISO-veckonummer. */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/** Kort datum: 29/6. */
function dm(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`
}

// ---- Stabil ämnesfärg: hash → en av sex tokenfärger ----

function subjectToken(e: ScheduleEvent): string {
  const key = e.subjectCode || e.title
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return `--c-class-${(h % 6) + 1}`
}

// ---- Rollstyrd schemakälla ----

interface ScheduleScope {
  key: string
  label: string
  /** Gruppering i väljaren (skolnamn för skolledning). */
  group?: string
  classIds: string[]
  courseIds: string[]
  schoolId: string | null
  /** Barnets id (vårdnadshavare) – krävs för relationskontrollen. */
  studentId?: string
  /** Skyddad identitet utan klarering → namnet är maskerat. */
  masked?: boolean
}

function buildScopes(principal: Principal): ScheduleScope[] {
  const { classes, courses, students, schools } = db.data
  const role = principal.role

  // Elev: egen klass + egna kurser (gymnasium/vux läser kursbaserat schema).
  if (role === 'elev_grund' || role === 'elev_gy') {
    const me = byId(students, principal.ownStudentId)
    const cls = me ? byId(classes, me.classId) : undefined
    return [
      {
        key: 'egen',
        label: cls ? `Klass ${cls.name} · ${cls.gradeLabel}` : 'Mitt schema',
        classIds: cls ? [cls.id] : [],
        courseIds: principal.courseIds,
        schoolId: me?.schoolId ?? principal.schoolIds[0] ?? null,
      },
    ]
  }

  // Vårdnadshavare: en källa per barn (väljare mellan barnens klasser).
  if (role === 'vardnadshavare') {
    return principal.guardianStudentIds
      .map((id) => byId(students, id))
      .filter((s): s is Student => Boolean(s))
      .map((s) => {
        const cls = byId(classes, s.classId)
        const masked = s.protectedIdentity && !principal.protectedClearance
        const name = masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`
        return {
          key: s.id,
          label: cls ? `${name} · ${cls.name}` : name,
          classIds: cls ? [cls.id] : [],
          courseIds: [],
          schoolId: s.schoolId,
          studentId: s.id,
          masked,
        }
      })
  }

  // Personal: egna klasser (fallback: mentorskap) och egna kurser.
  if (STAFF_ROLES.includes(role)) {
    const myClassIds = principal.classIds.length
      ? principal.classIds
      : classes.filter((c) => c.mentorUserId === principal.userId).map((c) => c.id)
    const myCourseIds = principal.courseIds.length
      ? principal.courseIds
      : courses.filter((c) => c.teacherUserId === principal.userId).map((c) => c.id)

    const scopes: ScheduleScope[] = myClassIds
      .map((id) => byId(classes, id))
      .filter((c): c is SchoolClass => Boolean(c))
      .map((c) => ({
        key: c.id,
        label: `Klass ${c.name} · ${c.gradeLabel}`,
        classIds: [c.id],
        courseIds: [],
        schoolId: c.schoolId,
      }))
    if (myCourseIds.length > 0) {
      scopes.push({
        key: 'kurser',
        label: 'Mina kurser',
        classIds: [],
        courseIds: myCourseIds,
        schoolId: principal.schoolIds[0] ?? null,
      })
    }
    return scopes
  }

  // Skolledning/administration m.fl.: klassväljare över skolans klasser.
  return classes
    .filter((c) => principal.schoolIds.includes(c.schoolId))
    .map((c) => ({
      key: c.id,
      label: `${c.name} · ${c.gradeLabel}`,
      group: byId(schools, c.schoolId)?.name,
      classIds: [c.id],
      courseIds: [],
      schoolId: c.schoolId,
    }))
}

function rawEventsFor(scope: ScheduleScope): ScheduleEvent[] {
  return db.data.scheduleEvents.filter(
    (e) =>
      (e.classId !== null && scope.classIds.includes(e.classId)) ||
      (e.courseId !== null && scope.courseIds.includes(e.courseId)),
  )
}

// ---------------------------------------------------------------------------

export function SchedulePage() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const readDecision = usePermission('read', 'schedule')

  const now = new Date()
  const monday = mondayOf(now)
  const weekNo = isoWeek(now)
  const weekDates = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday)
        d.setDate(monday.getDate() + i)
        return d
      }),
    // Måndagen ändras inte under en session – beräkna en gång.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const todayIdxRaw = (now.getDay() + 6) % 7
  const todayIdx = todayIdxRaw <= 4 ? todayIdxRaw : -1
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const [loading, setLoading] = useState(true)
  const [scopeKey, setScopeKey] = useState<string | null>(null)
  const [dayIdx, setDayIdx] = useState(todayIdx >= 0 ? todayIdx : 0)
  const [exporting, setExporting] = useState(false)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  const scopes = useMemo(() => buildScopes(principal), [principal])

  // Vald källa; standard är första källan med seedat schema.
  const activeScope = useMemo(() => {
    const chosen = scopes.find((s) => s.key === scopeKey)
    if (chosen) return chosen
    return scopes.find((s) => rawEventsFor(s).length > 0) ?? scopes[0]
  }, [scopes, scopeKey])

  // Behörighetsfiltrerad läsning: varje schemablock prövas mot motorn.
  const { events, deniedReason } = useMemo(() => {
    void refresh
    if (!activeScope) return { events: [] as ScheduleEvent[], deniedReason: null as string | null }
    let denied: string | null = null
    const list = rawEventsFor(activeScope).filter((e) => {
      const school = byId(db.data.schools, e.schoolId)
      const decision = can(principal, 'read', 'schedule', {
        organizationId: school?.organizationId,
        schoolId: e.schoolId,
        classId: e.classId,
        courseId: e.courseId,
        studentId: activeScope.studentId ?? null,
      })
      if (!decision.allowed && !denied) denied = decision.reason
      return decision.allowed
    })
    return { events: list, deniedReason: denied }
  }, [activeScope, principal, refresh])

  const byDay = useMemo(() => {
    const days: ScheduleEvent[][] = [[], [], [], [], []]
    for (const e of events) if (e.weekday >= 0 && e.weekday <= 4) days[e.weekday].push(e)
    for (const list of days)
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt))
    return days
  }, [events])

  // Färgförklaring: unika ämnen i vyn med sina stabila accentfärger.
  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; token: string }>()
    for (const e of events) if (!seen.has(e.title)) seen.set(e.title, { label: e.title, token: subjectToken(e) })
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'sv'))
  }, [events])

  const groups = useMemo(() => {
    const m = new Map<string, ScheduleScope[]>()
    for (const s of scopes) {
      const key = s.group ?? ''
      const list = m.get(key) ?? []
      list.push(s)
      m.set(key, list)
    }
    return [...m.entries()]
  }, [scopes])
  const hasGroups = groups.some(([g]) => g !== '')

  const exportDecision = usePermission('export', 'export', {
    schoolId: activeScope?.schoolId ?? undefined,
  })

  function handleExport() {
    if (!activeScope) return
    setExporting(true)
    try {
      exportWeekSchedule(principal, {
        weekLabel: `vecka ${weekNo}`,
        scopeLabel: activeScope.label,
        schoolId: activeScope.schoolId,
        eventCount: events.length,
      })
      bump()
      toast.success('Kalenderexporten är köad', 'ICS-filen skapas som bakgrundsjobb.', {
        actionLabel: 'Visa rapporter',
        onAction: () => navigate('/rapporter'),
      })
    } catch (err) {
      if (err instanceof RateLimitedError) toast.warning('Exportgränsen är nådd', err.message)
      else if (err instanceof ForbiddenError) toast.error('Åtkomst nekad', err.message)
      else toast.error('Exporten kunde inte startas', 'Försök igen om en stund.')
    } finally {
      setExporting(false)
    }
  }

  const subtitle = `Vecka ${weekNo} · ${dm(weekDates[0])}–${dm(weekDates[4])} ${monday.getFullYear()}`

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Schema" icon="CalendarDays" subtitle={subtitle} />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const isGuardian = principal.role === 'vardnadshavare'
  const selectorLabel = isGuardian ? 'Barn' : 'Klass'

  return (
    <>
      <PageHeader
        title="Schema"
        icon="CalendarDays"
        subtitle={subtitle}
        actions={
          <Button
            variant="secondary"
            icon="Download"
            loading={exporting}
            disabled={!exportDecision.allowed || !activeScope || loading}
            title={
              exportDecision.allowed
                ? 'Skapa kalenderfil (ICS) som bakgrundsjobb'
                : exportDecision.reason
            }
            onClick={handleExport}
          >
            Exportera (ICS)
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            {scopes.length > 1 ? (
              <>
                <label htmlFor="schedule-scope" className="text-sm font-medium text-ink">
                  {selectorLabel}
                </label>
                <Select
                  id="schedule-scope"
                  className="sm:w-72"
                  value={activeScope?.key ?? ''}
                  onChange={(e) => setScopeKey(e.target.value)}
                >
                  {hasGroups
                    ? groups.map(([group, list]) => (
                        <optgroup key={group || 'övrigt'} label={group || 'Övrigt'}>
                          {list.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    : scopes.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                </Select>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Icon name="Users" className="h-4 w-4 text-ink-subtle" />
                <span className="font-medium text-ink">{activeScope?.label ?? 'Schema'}</span>
              </div>
            )}
            {activeScope?.masked && (
              <span className="inline-flex items-center gap-1.5 text-2xs text-warning">
                <Icon name="ShieldAlert" className="h-3.5 w-3.5 shrink-0" />
                Skyddad identitet – namnet visas maskerat
              </span>
            )}
            {principal.validUntil && (
              <Badge tone="info" icon="Clock">
                Tillfällig behörighet t.o.m. {fmtDate(principal.validUntil)}
              </Badge>
            )}
          </div>
          <p className="text-sm text-ink-muted">
            {events.length} lektioner · {legend.length} ämnen denna vecka
          </p>
        </CardBody>
      </Card>

      <Card>
        {loading ? (
          <LoadingRows rows={6} />
        ) : !activeScope ? (
          <EmptyState
            icon="CalendarX"
            title="Inget schema att visa"
            description={
              isGuardian
                ? 'Inga barn är kopplade till ditt konto. Kontakta skolan för att koppla vårdnadshavarskap.'
                : 'Ingen klass eller kurs är kopplad till ditt konto. Kontakta administratören.'
            }
          />
        ) : deniedReason && events.length === 0 ? (
          <DeniedState reason={deniedReason} />
        ) : events.length === 0 ? (
          <EmptyState
            icon="CalendarX"
            title="Inget schema inlagt"
            description={`${activeScope.label} saknar schemalagda lektioner den här veckan.`}
          />
        ) : (
          <CardBody className="pt-4">
            {/* Mobil: en dag i taget */}
            <div className="md:hidden">
              <Segmented
                size="sm"
                value={String(dayIdx)}
                onChange={(v) => setDayIdx(Number(v))}
                options={WEEKDAYS_SHORT.map((label, i) => ({ value: String(i), label }))}
              />
              <div className="mt-3">
                <DayColumn
                  label={WEEKDAYS[dayIdx]}
                  date={weekDates[dayIdx]}
                  events={byDay[dayIdx]}
                  isToday={dayIdx === todayIdx}
                  nowHM={nowHM}
                />
              </div>
            </div>

            {/* Desktop: hela veckan mån–fre */}
            <div className="hidden md:grid md:grid-cols-5 md:gap-3">
              {WEEKDAYS.map((label, i) => (
                <DayColumn
                  key={label}
                  label={label}
                  date={weekDates[i]}
                  events={byDay[i]}
                  isToday={i === todayIdx}
                  nowHM={nowHM}
                />
              ))}
            </div>

            {legend.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                  Ämnen
                </span>
                {legend.map((l) => (
                  <span key={l.label} className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `rgb(var(${l.token}))` }}
                      aria-hidden
                    />
                    {l.label}
                  </span>
                ))}
              </div>
            )}
          </CardBody>
        )}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Dagskolumn + schemablock
// ---------------------------------------------------------------------------

function DayColumn({
  label,
  date,
  events,
  isToday,
  nowHM,
}: {
  label: string
  date: Date
  events: ScheduleEvent[]
  isToday: boolean
  nowHM: string
}) {
  return (
    <section
      aria-label={`${label} ${dm(date)}`}
      className={cn(
        'rounded-panel border p-2.5',
        isToday ? 'border-primary/50 bg-primary-soft/40 ring-1 ring-primary/30' : 'border-border bg-surface-2/60',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-0.5">
        <div>
          <p className={cn('text-sm font-semibold', isToday ? 'text-primary' : 'text-ink')}>{label}</p>
          <p className="text-2xs tabular-nums text-ink-subtle">{dm(date)}</p>
        </div>
        {isToday && <Badge tone="primary">Idag</Badge>}
      </header>
      <div className="mt-2 space-y-2">
        {events.length === 0 ? (
          <p className="rounded-field border border-dashed border-border px-2 py-3 text-center text-2xs text-ink-subtle">
            Inga lektioner
          </p>
        ) : (
          events.map((e) => (
            <EventBlock
              key={e.id}
              event={e}
              ongoing={isToday && e.startsAt <= nowHM && nowHM < e.endsAt}
            />
          ))
        )}
      </div>
    </section>
  )
}

function EventBlock({ event, ongoing }: { event: ScheduleEvent; ongoing: boolean }) {
  const token = subjectToken(event)
  const room = byId(db.data.rooms, event.roomId)
  const teacher = byId(db.data.users, event.teacherUserId)
  return (
    <article
      className={cn('rounded-field border border-border p-2.5', ongoing && 'ring-1 ring-primary/40')}
      style={{
        borderLeft: `3px solid rgb(var(${token}))`,
        backgroundColor: `rgb(var(${token}) / 0.07)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold tabular-nums text-ink-muted">
          {event.startsAt}–{event.endsAt}
        </span>
        {ongoing && (
          <Badge tone="primary" dot>
            Pågår
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-sm font-medium leading-snug text-ink">{event.title}</p>
      <div className="mt-1.5 space-y-0.5 text-2xs text-ink-subtle">
        {room && (
          <p className="flex items-center gap-1">
            <Icon name="DoorOpen" className="h-3 w-3 shrink-0" />
            {room.name}
          </p>
        )}
        {teacher && (
          <p className="flex min-w-0 items-center gap-1">
            <Icon name="GraduationCap" className="h-3 w-3 shrink-0" />
            <span className="truncate">{teacher.name}</span>
          </p>
        )}
      </div>
    </article>
  )
}
