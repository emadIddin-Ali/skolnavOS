import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardBody, StatCard, ProgressRing, Segmented, Select, Button,
  SectionTitle, Avatar, StatusBadge, Badge, EmptyState, DeniedState, LoadingRows, Icon,
} from '@/ui'
import type { Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { useSession } from '@/core/state/session'
import { db } from '@/data/db/store'
import type { AttendanceStatus, Student, SchoolClass } from '@/data/schema'
import { ATTENDANCE_STATUS_LABEL } from '@/data/schema'
import { fmtDateLong, fmtRelative, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { StudentCard } from './StudentCard'
import { STATUS_META } from './statusMeta'
import { setAttendanceStatus, todayRecord, currentStatus } from './attendanceService'

type Filter = 'alla' | AttendanceStatus

interface Toast {
  tone: Tone
  message: string
}

const PREFERRED_DEFAULT_CLASS = 'cls-bj-4a'

/** Diskret informationsbanner (offline, gränser, fel). */
function Banner({
  tone,
  icon,
  children,
  onClose,
}: {
  tone: Tone
  icon: string
  children: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div
      className="mb-4 flex items-center gap-2.5 rounded-field border px-3.5 py-2.5 text-sm"
      style={{
        color: `rgb(var(--c-${tone}))`,
        backgroundColor: `rgb(var(--c-${tone}) / 0.10)`,
        borderColor: `rgb(var(--c-${tone}) / 0.25)`,
      }}
      role="status"
    >
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-ink">{children}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 text-ink-subtle hover:text-ink" aria-label="Stäng">
          <Icon name="X" className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function AttendancePage() {
  const principal = usePrincipal()
  const connection = useSession((s) => s.connection)
  const offline = connection !== 'online'

  const readDecision = usePermission('read', 'attendance')
  const canUpdateAny = usePermission('update', 'attendance').allowed

  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [loading, setLoading] = useState(true)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('alla')
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState<Toast | null>(null)

  // Initial laddning (simulerad latens för realistiskt laddningstillstånd).
  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => alive && setLoading(false), 220)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  // Auto-stäng notis.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  // Klasser principalen har läsåtkomst till (behörighetsfiltrerat).
  const accessibleClasses = useMemo<SchoolClass[]>(() => {
    return db.data.classes.filter(
      (c) =>
        principal.schoolIds.includes(c.schoolId) &&
        (principal.classIds.length === 0 || principal.classIds.includes(c.id)) &&
        can(principal, 'read', 'attendance', { schoolId: c.schoolId, classId: c.id }).allowed,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal.role, principal.schoolIds.join(','), principal.classIds.join(',')])

  // Standardval: klass med dagens data (helst cls-bj-4a), annars första.
  useEffect(() => {
    if (accessibleClasses.length === 0) {
      setSelectedClassId(null)
      return
    }
    if (selectedClassId && accessibleClasses.some((c) => c.id === selectedClassId)) return
    const preferred = accessibleClasses.find((c) => c.id === PREFERRED_DEFAULT_CLASS)
    const withToday = accessibleClasses.find((c) =>
      db.data.students.some((s) => s.classId === c.id && todayRecord(s.id)),
    )
    setSelectedClassId((preferred ?? withToday ?? accessibleClasses[0]).id)
    setFilter('alla')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibleClasses])

  const selectedClass = accessibleClasses.find((c) => c.id === selectedClassId) ?? null

  // Elever i klassen som principalen får läsa (per-elev-scope).
  const students = useMemo<Student[]>(() => {
    if (!selectedClass) return []
    return db.data.students
      .filter((s) => s.classId === selectedClass.id && s.status === 'inskriven')
      .filter(
        (s) =>
          can(principal, 'read', 'attendance', {
            schoolId: s.schoolId,
            classId: s.classId,
            studentId: s.id,
            protectedIdentity: s.protectedIdentity,
          }).allowed,
      )
      .sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`, 'sv'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, principal.role])

  // Sammanställning (räknas alltid på hela klassen, oberoende av filter).
  const counts = useMemo(() => {
    const acc: Record<AttendanceStatus, number> = {
      narvarande: 0,
      franvarande: 0,
      sen: 0,
      hamtad: 0,
      ej_markerad: 0,
    }
    for (const s of students) acc[currentStatus(s.id)] += 1
    return acc
    // Beroende av `bump` för att spegla mutationer i store:t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, bump])

  const total = students.length
  const present = counts.narvarande + counts.sen + counts.hamtad
  const rate = total > 0 ? Math.round((present / total) * 100) : 0
  const rateTone: Tone = rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'danger'

  const displayed = filter === 'alla' ? students : students.filter((s) => currentStatus(s.id) === filter)

  const unmarked = students.filter(
    (s) =>
      currentStatus(s.id) === 'ej_markerad' &&
      can(principal, 'update', 'attendance', {
        schoolId: s.schoolId,
        classId: s.classId,
        studentId: s.id,
        protectedIdentity: s.protectedIdentity,
      }).allowed,
  )

  // Senaste ändringar: dagens markerade poster i klassen, senaste först.
  const timeline = useMemo(() => {
    if (!selectedClass) return []
    return students
      .map((s) => ({ student: s, rec: todayRecord(s.id) }))
      .filter((x): x is { student: Student; rec: NonNullable<ReturnType<typeof todayRecord>> } =>
        Boolean(x.rec && x.rec.markedAt),
      )
      .sort((a, b) => (b.rec.markedAt! > a.rec.markedAt! ? 1 : -1))
      .slice(0, 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, bump])

  function isMasked(s: Student): boolean {
    return s.protectedIdentity && !principal.protectedClearance
  }

  function canUpdateStudent(s: Student): boolean {
    return can(principal, 'update', 'attendance', {
      schoolId: s.schoolId,
      classId: s.classId,
      studentId: s.id,
      protectedIdentity: s.protectedIdentity,
    }).allowed
  }

  function handleSet(student: Student, next: AttendanceStatus) {
    if (currentStatus(student.id) === next) return
    try {
      const res = setAttendanceStatus(principal, student, next, { offline })
      if (res.queued) {
        setQueuedIds((prev) => {
          const nextSet = new Set(prev)
          nextSet.add(res.record.id)
          return nextSet
        })
      }
      bump()
    } catch (e) {
      if (e instanceof RateLimitedError) setToast({ tone: 'warning', message: e.result.message ?? 'Gränsen är nådd.' })
      else if (e instanceof ForbiddenError) setToast({ tone: 'danger', message: e.message })
      else setToast({ tone: 'danger', message: 'Kunde inte spara markeringen.' })
    }
  }

  function handleMarkAllPresent() {
    let updated = 0
    let limited = false
    const newQueued = new Set(queuedIds)
    for (const s of unmarked) {
      try {
        const res = setAttendanceStatus(principal, s, 'narvarande', { offline })
        if (res.queued) newQueued.add(res.record.id)
        updated += 1
      } catch (e) {
        if (e instanceof RateLimitedError) {
          limited = true
          setToast({ tone: 'warning', message: e.result.message ?? 'Gränsen är nådd – vissa hann inte markeras.' })
          break
        }
        // Hoppa över elever som nekas (t.ex. skyddad identitet).
      }
    }
    setQueuedIds(newQueued)
    bump()
    if (updated > 0 && !limited) {
      setToast({
        tone: offline ? 'warning' : 'success',
        message: offline
          ? `${updated} markerade som närvarande – köade offline.`
          : `${updated} elever markerade som närvarande.`,
      })
    }
  }

  // --- Tillstånd: nekad läsning ---
  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Närvaro" icon="UserCheck" subtitle="Signaturnärvaro" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const school = db.data.schools.find((s) => s.id === (selectedClass?.schoolId ?? principal.schoolIds[0]))
  const useSelect = accessibleClasses.length > 5

  const statFilters: { status: AttendanceStatus; label: string }[] = [
    { status: 'narvarande', label: 'Närvarande' },
    { status: 'franvarande', label: 'Frånvarande' },
    { status: 'sen', label: 'Sen ankomst' },
    { status: 'ej_markerad', label: 'Ej markerad' },
  ]

  return (
    <>
      <PageHeader
        title="Närvaro"
        icon="UserCheck"
        subtitle={`${fmtDateLong(new Date())}${school ? ` · ${school.name}` : ''} · Signaturnärvaro`}
      />

      {offline && (
        <Banner tone="warning" icon={connection === 'reconnecting' ? 'RefreshCw' : 'WifiOff'}>
          {connection === 'reconnecting'
            ? 'Återansluter … Dina markeringar sparas lokalt och synkas automatiskt.'
            : 'Du är offline. Markeringar sparas lokalt som köade och synkas när anslutningen är tillbaka.'}
        </Banner>
      )}

      {toast && <Banner tone={toast.tone} icon={toast.tone === 'success' ? 'CircleCheck' : 'TriangleAlert'} onClose={() => setToast(null)}>{toast.message}</Banner>}

      {accessibleClasses.length === 0 ? (
        <Card>
          <EmptyState
            icon="Users"
            title="Inga klasser tillgängliga"
            description="Din behörighet ger inte åtkomst till någon klass eller grupp för närvaro."
          />
        </Card>
      ) : (
        <>
          {/* Klassväljare + verktyg */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Klass / grupp</span>
              {useSelect ? (
                <Select
                  className="w-48"
                  value={selectedClassId ?? ''}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value)
                    setFilter('alla')
                  }}
                >
                  {accessibleClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.gradeLabel}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="max-w-full overflow-x-auto">
                  <Segmented
                    size="sm"
                    value={selectedClassId ?? accessibleClasses[0].id}
                    onChange={(v) => {
                      setSelectedClassId(v)
                      setFilter('alla')
                    }}
                    options={accessibleClasses.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </div>
              )}
              {selectedClass && (
                <span className="text-2xs text-ink-subtle">
                  {selectedClass.gradeLabel} · {total} elever
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {filter !== 'alla' && (
                <Button variant="ghost" size="sm" icon="ListFilter" onClick={() => setFilter('alla')}>
                  Visa alla
                </Button>
              )}
              {canUpdateAny && unmarked.length > 0 && (
                <Button size="sm" icon="UserCheck" onClick={handleMarkAllPresent}>
                  Markera alla närvarande ({unmarked.length})
                </Button>
              )}
            </div>
          </div>

          {/* Sammanställning */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="flex items-center gap-4 p-4">
              <ProgressRing value={rate} size={72} tone={rateTone} sublabel="närvaro" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Närvarograd</p>
                <p className="text-2xs text-ink-subtle">
                  {present} av {total} på plats
                </p>
                {counts.ej_markerad > 0 && (
                  <Badge tone="warning" className="mt-1.5">
                    {counts.ej_markerad} ej markerade
                  </Badge>
                )}
              </div>
            </Card>
            {statFilters.map((f) => {
              const m = STATUS_META[f.status]
              const active = filter === f.status
              return (
                <StatCard
                  key={f.status}
                  label={f.label}
                  value={counts[f.status]}
                  icon={m.icon}
                  tone={m.tone}
                  hint={active ? 'Filtrerar' : 'Visa dessa'}
                  onClick={() => setFilter(active ? 'alla' : f.status)}
                  className={cn(active && 'ring-2 ring-primary/60')}
                />
              )
            })}
          </div>

          {/* Elevrutnät */}
          <SectionTitle
            action={
              interactiveHint(canUpdateAny)
            }
          >
            Elever{filter !== 'alla' ? ` · ${ATTENDANCE_STATUS_LABEL[filter]}` : ''}
          </SectionTitle>

          {loading ? (
            <Card className="mb-6">
              <LoadingRows rows={6} />
            </Card>
          ) : displayed.length === 0 ? (
            <Card className="mb-6">
              <EmptyState
                icon="UserSearch"
                title={filter === 'alla' ? 'Inga elever i klassen' : 'Inga elever med den statusen'}
                description={
                  filter === 'alla'
                    ? 'Den här klassen saknar inskrivna elever i din vy.'
                    : 'Prova ett annat filter eller visa alla elever.'
                }
                actionLabel={filter !== 'alla' ? 'Visa alla' : undefined}
                onAction={filter !== 'alla' ? () => setFilter('alla') : undefined}
              />
            </Card>
          ) : (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {displayed.map((s) => {
                const rec = todayRecord(s.id)
                return (
                  <StudentCard
                    key={s.id}
                    student={s}
                    status={currentStatus(s.id)}
                    markedAt={rec?.markedAt}
                    masked={isMasked(s)}
                    canUpdate={canUpdateStudent(s)}
                    queued={rec ? queuedIds.has(rec.id) : false}
                    onSet={(next) => handleSet(s, next)}
                  />
                )
              })}
            </div>
          )}

          {/* Senaste ändringar */}
          <SectionTitle>Senaste ändringar</SectionTitle>
          <Card>
            <CardBody className="pt-4">
              {timeline.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-subtle">
                  Inga närvaromarkeringar registrerade för idag ännu.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {timeline.map(({ student, rec }) => {
                    const masked = isMasked(student)
                    const name = masked
                      ? maskName(`${student.firstName} ${student.lastName}`)
                      : `${student.firstName} ${student.lastName}`
                    const m = STATUS_META[rec.status]
                    const marker = db.data.users.find((u) => u.id === rec.markedBy)
                    return (
                      <li key={rec.id} className="flex items-center gap-3 py-2.5">
                        <Avatar name={name} color={student.photoColor} size="sm" protected={masked} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-ink">{name}</p>
                          <p className="text-2xs text-ink-subtle">
                            {marker ? `Av ${marker.name}` : 'Systemmarkering'}
                            {rec.fromAbsenceReport ? ' · från frånvaroanmälan' : ''}
                          </p>
                        </div>
                        {queuedIds.has(rec.id) && <Badge tone="neutral" icon="CloudOff">Köad</Badge>}
                        <StatusBadge tone={m.tone} icon={m.icon} label={ATTENDANCE_STATUS_LABEL[rec.status]} />
                        <span className="hidden w-24 shrink-0 text-right text-2xs text-ink-subtle sm:block">
                          {rec.markedAt ? fmtRelative(rec.markedAt) : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  )
}

/** Diskret ledtext om svep/knappar (endast när markering är möjlig). */
function interactiveHint(canUpdate: boolean) {
  if (!canUpdate) return null
  return (
    <span className="hidden items-center gap-1.5 text-2xs text-ink-subtle sm:inline-flex">
      <Icon name="Hand" className="h-3.5 w-3.5" />
      Svep eller använd knapparna
    </span>
  )
}
