import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, SectionTitle, Card, CardBody, Button, Badge, StatCard, Avatar,
  Modal, TextInput, Select, Icon, EmptyState, DeniedState, Skeleton, toast,
} from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { Student, PickupAuthorization } from '@/data/schema'
import { RELATION_TYPE_LABEL } from '@/data/schema'
import { fmtDate, fmtTime, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { addPickupAuthorization, revokePickupAuthorization } from './service'

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Relationstyper som innebär hämtrestriktion och alltid ska varnas för. */
const RESTRICTED_RELATIONS = ['ej_hamtbehorig', 'begransad_kontakt'] as const

interface Restriction {
  id: string
  typeLabel: string
  personName: string
  note: string | null
}

interface ChildRow {
  student: Student
  masked: boolean
  name: string
  meta: string
  pickups: PickupAuthorization[]
  restrictions: Restriction[]
  canAdd: boolean
  addReason: string
  canManage: boolean
}

interface PickedRow {
  id: string
  name: string
  masked: boolean
  color: string
  meta: string
  time: string
}

export function PickupPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'pickup')
  const canReadAttendance = usePermission('read', 'attendance').allowed
  const isGuardian = principal.role === 'vardnadshavare'

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [addFor, setAddFor] = useState<ChildRow | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    pause(250).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Barn i räckvidd: VH ser egna barn, personal ser barn med hämtinformation.
  const children = useMemo<ChildRow[]>(() => {
    void refresh
    const students = db.data.students
    const inScope = (s: Student) =>
      principal.classIds.length > 0
        ? s.classId != null && principal.classIds.includes(s.classId)
        : principal.schoolIds.includes(s.schoolId)

    const base = isGuardian
      ? students.filter((s) => principal.guardianStudentIds.includes(s.id))
      : students.filter(
          (s) =>
            s.status === 'inskriven' &&
            inScope(s) &&
            (s.hasPickupNote ||
              db.data.pickups.some((p) => p.studentId === s.id) ||
              db.data.relations.some(
                (r) =>
                  r.studentId === s.id &&
                  (RESTRICTED_RELATIONS as readonly string[]).includes(r.relationType),
              )),
        )

    return base
      .map<ChildRow | null>((s) => {
        const target = {
          organizationId: s.organizationId,
          schoolId: s.schoolId,
          classId: s.classId,
          studentId: s.id,
          protectedIdentity: s.protectedIdentity,
        }
        const decision = can(principal, 'read', 'pickup', target)
        if (!decision.allowed) return null
        const masked = Boolean(decision.masked)
        const fullName = `${s.firstName} ${s.lastName}`
        const cls = s.classId ? byId(db.data.classes, s.classId) : undefined
        const school = byId(db.data.schools, s.schoolId)
        const createDec = can(principal, 'create', 'pickup', target)
        const updateDec = can(principal, 'update', 'pickup', target)
        return {
          student: s,
          masked,
          name: masked ? maskName(fullName) : fullName,
          meta: [s.gradeLabel, cls?.name, school?.name].filter(Boolean).join(' · '),
          pickups: db.data.pickups
            .filter((p) => p.studentId === s.id)
            .sort(
              (a, b) =>
                Number(b.authorized) - Number(a.authorized) ||
                b.createdAt.localeCompare(a.createdAt),
            ),
          restrictions: db.data.relations
            .filter(
              (r) =>
                r.studentId === s.id &&
                (RESTRICTED_RELATIONS as readonly string[]).includes(r.relationType),
            )
            .map((r) => ({
              id: r.id,
              typeLabel: RELATION_TYPE_LABEL[r.relationType],
              personName: db.data.users.find((u) => u.id === r.guardianUserId)?.name ?? 'Okänd person',
              note: r.conflictNote,
            })),
          canAdd: createDec.allowed,
          addReason: createDec.reason,
          canManage: updateDec.allowed,
        }
      })
      .filter((c): c is ChildRow => c !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }, [principal, isGuardian, refresh])

  const visibleChildren = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return children
    return children.filter((c) => c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q))
  }, [children, query])

  // Dagens hämtstatus (personal): barn markerade som hämtade idag.
  const todayKey = fmtDate(new Date())
  const pickedToday = useMemo<PickedRow[]>(() => {
    void refresh
    if (isGuardian || !canReadAttendance) return []
    return db.data.attendance
      .filter((a) => a.status === 'hamtad' && fmtDate(a.date) === todayKey)
      .map<PickedRow | null>((a) => {
        const student = byId(db.data.students, a.studentId)
        if (!student) return null
        const decision = can(principal, 'read', 'attendance', {
          organizationId: a.organizationId,
          schoolId: a.schoolId,
          classId: a.classId,
          studentId: a.studentId,
          protectedIdentity: student.protectedIdentity,
        })
        if (!decision.allowed) return null
        const fullName = `${student.firstName} ${student.lastName}`
        const masked = Boolean(decision.masked)
        const cls = student.classId ? byId(db.data.classes, student.classId) : undefined
        return {
          id: a.id,
          name: masked ? maskName(fullName) : fullName,
          masked,
          color: student.photoColor,
          meta: [student.gradeLabel, cls?.name].filter(Boolean).join(' · '),
          time: fmtTime(a.markedAt ?? a.date),
        }
      })
      .filter((r): r is PickedRow => r !== null)
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [principal, isGuardian, canReadAttendance, todayKey, refresh])

  const stats = useMemo(() => {
    const persons = children.reduce(
      (sum, c) => sum + c.pickups.filter((p) => p.authorized).length,
      0,
    )
    const restricted = children.filter((c) => c.restrictions.length > 0).length
    return { children: children.length, persons, restricted }
  }, [children])

  function handleRevoke(p: PickupAuthorization, childName: string) {
    try {
      revokePickupAuthorization(principal, p.id)
      bump()
      toast.success('Behörighet återkallad', `${p.personName} får inte längre hämta ${childName}.`)
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Kunde inte återkalla', 'Försök igen om en stund.')
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Hämtning" icon="HandHeart" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const showStatusColumn = !isGuardian && canReadAttendance

  return (
    <>
      <PageHeader
        title="Hämtning"
        icon="HandHeart"
        subtitle={
          isGuardian
            ? 'Hantera vilka personer som får hämta dina barn.'
            : 'Hämtberättigade personer, restriktioner och dagens hämtstatus.'
        }
      />

      <div className={cn('mb-5 grid gap-3 sm:grid-cols-2', showStatusColumn ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <StatCard label="Barn med hämtinformation" value={stats.children} icon="Baby" tone="primary" />
        <StatCard label="Hämtbehöriga personer" value={stats.persons} icon="UserCheck" tone={stats.persons ? 'success' : 'neutral'} />
        <StatCard label="Barn med restriktion" value={stats.restricted} icon="ShieldX" tone={stats.restricted ? 'danger' : 'neutral'} />
        {showStatusColumn && (
          <StatCard label="Hämtade idag" value={pickedToday.length} icon="CarFront" tone={pickedToday.length ? 'info' : 'neutral'} />
        )}
      </div>

      <div className={cn('grid gap-5', showStatusColumn && 'lg:grid-cols-3')}>
        {/* ---- Hämtberättigade per barn ---- */}
        <section className={cn('min-w-0 space-y-3', showStatusColumn && 'lg:col-span-2')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Hämtberättigade per barn</SectionTitle>
            {!isGuardian && children.length > 0 && (
              <TextInput
                icon="Search"
                placeholder="Sök barn…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full max-w-56"
                aria-label="Sök barn"
              />
            )}
          </div>

          {isGuardian && (
            <p className="text-sm text-ink-muted">
              Vårdnadshavare är alltid hämtberättigade. Lägg till andra betrodda personer som får
              hämta ditt barn – förskolan ser listan vid hämtning.
            </p>
          )}

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-card" />
              ))}
            </div>
          ) : visibleChildren.length === 0 ? (
            <Card>
              <EmptyState
                icon="HandHeart"
                title={
                  query
                    ? 'Inga träffar'
                    : isGuardian
                      ? 'Inga barn kopplade till ditt konto'
                      : 'Inga hämtnoteringar i din grupp'
                }
                description={
                  query
                    ? 'Prova ett annat sökord.'
                    : isGuardian
                      ? 'Kontakta skolan för att koppla vårdnadshavarskap.'
                      : 'Barn med hämtberättigade personer eller restriktioner visas här.'
                }
              />
            </Card>
          ) : (
            visibleChildren.map((c) => (
              <ChildCard
                key={c.student.id}
                child={c}
                isGuardian={isGuardian}
                onAdd={() => setAddFor(c)}
                onRevoke={(p) => handleRevoke(p, c.name)}
              />
            ))
          )}
        </section>

        {/* ---- Dagens hämtstatus (personal) ---- */}
        {showStatusColumn && (
          <section className="min-w-0">
            <SectionTitle>Dagens hämtstatus</SectionTitle>
            <Card>
              {loading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 rounded-field" />
                  ))}
                </div>
              ) : pickedToday.length === 0 ? (
                <EmptyState
                  icon="CarFront"
                  title="Inga barn hämtade ännu"
                  description="Barn som markeras som «Hämtad / gått hem» i närvaron visas här med tid."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {pickedToday.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar name={r.name} color={r.color} size="sm" protected={r.masked} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                          {r.masked && (
                            <span title="Skyddad identitet – namnet visas maskerat">
                              <Icon name="ShieldAlert" className="h-3.5 w-3.5 shrink-0 text-warning" />
                            </span>
                          )}
                        </div>
                        {r.meta && <div className="truncate text-2xs text-ink-subtle">{r.meta}</div>}
                      </div>
                      <Badge tone="success" icon="Check">
                        {r.time}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}
      </div>

      {addFor && (
        <AddPickupModal
          child={addFor}
          onClose={() => setAddFor(null)}
          onSaved={() => {
            setAddFor(null)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Kort per barn
// ---------------------------------------------------------------------------

function ChildCard({
  child,
  isGuardian,
  onAdd,
  onRevoke,
}: {
  child: ChildRow
  isGuardian: boolean
  onAdd: () => void
  onRevoke: (p: PickupAuthorization) => void
}) {
  const principal = usePrincipal()
  const s = child.student

  const addButton = child.canAdd ? (
    <Button size="sm" variant="secondary" icon="UserPlus" onClick={onAdd}>
      Lägg till hämtberättigad
    </Button>
  ) : isGuardian ? (
    <span title={child.addReason}>
      <Button size="sm" variant="secondary" icon="UserPlus" disabled>
        Lägg till hämtberättigad
      </Button>
    </span>
  ) : null

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={child.name} color={s.photoColor} protected={child.masked} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-ink">{child.name}</span>
              {child.masked && (
                <span title="Skyddad identitet – uppgifter visas maskerade och åtkomst loggas">
                  <Icon name="ShieldAlert" className="h-3.5 w-3.5 shrink-0 text-warning" />
                </span>
              )}
              {s.hasPickupNote && (
                <Badge tone="info" icon="ClipboardList">
                  Hämtnotering
                </Badge>
              )}
            </div>
            <div className="truncate text-2xs text-ink-subtle">{child.meta}</div>
          </div>
        </div>
        {addButton}
      </div>

      <CardBody className="space-y-3 pt-0">
        {child.restrictions.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
          >
            <Icon name="ShieldX" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">
                {r.typeLabel}: {r.personName}
              </p>
              {r.note && <p className="mt-0.5">{r.note}</p>}
              <p className="mt-0.5 text-2xs">Kontrollera alltid legitimation vid osäkerhet.</p>
            </div>
          </div>
        ))}

        {child.pickups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Inga hämtberättigade personer registrerade utöver vårdnadshavarna.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-field border border-border">
            {child.pickups.map((p) => {
              const addedBy =
                p.addedByUserId === principal.userId
                  ? 'dig'
                  : db.data.users.find((u) => u.id === p.addedByUserId)?.name ?? 'skolan'
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar name={p.personName} size="sm" color="#64748b" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          p.authorized ? 'text-ink' : 'text-ink-subtle line-through',
                        )}
                      >
                        {p.personName}
                      </span>
                      <Badge tone={p.authorized ? 'success' : 'danger'} icon={p.authorized ? 'BadgeCheck' : 'Ban'}>
                        {p.authorized ? 'Hämtbehörig' : 'Återkallad'}
                      </Badge>
                    </div>
                    <div className="truncate text-2xs text-ink-subtle">
                      {p.relation}
                      {p.note ? ` · ${p.note}` : ''} · Tillagd av {addedBy}
                    </div>
                  </div>
                  {child.canManage && p.authorized && (
                    <Popover
                      width="w-56"
                      trigger={
                        <Button variant="ghost" size="sm" icon="ChevronDown" aria-label={`Åtgärder för ${p.personName}`} />
                      }
                    >
                      {(close) => (
                        <MenuItem
                          danger
                          icon="UserX"
                          onClick={() => {
                            close()
                            onRevoke(p)
                          }}
                        >
                          Återkalla behörighet
                        </MenuItem>
                      )}
                    </Popover>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Lägg till hämtberättigad
// ---------------------------------------------------------------------------

const RELATION_OPTIONS = [
  'Mormor',
  'Morfar',
  'Farmor',
  'Farfar',
  'Moster',
  'Faster',
  'Morbror',
  'Farbror',
  'Äldre syskon',
  'Familjevän',
  'Granne',
  'Annan närstående',
]

function AddPickupModal({
  child,
  onClose,
  onSaved,
}: {
  child: ChildRow
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const [personName, setPersonName] = useState('')
  const [relation, setRelation] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameError = personName.trim().length < 2 ? 'Ange personens fullständiga namn.' : null
  const relationError = !relation ? 'Välj relation till barnet.' : null
  const valid = !nameError && !relationError

  async function submit() {
    setError(null)
    if (!valid) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    await pause(400)
    try {
      addPickupAuthorization(principal, {
        studentId: child.student.id,
        personName,
        relation,
        note,
      })
      toast.success(
        'Hämtberättigad tillagd',
        `${personName.trim()} får nu hämta ${child.name}. Ansvarig pedagog har notifierats.`,
      )
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof RateLimitedError) setError(e.message)
      else setError('Det gick inte att spara just nu. Försök igen om en stund.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Lägg till hämtberättigad"
      description={`Person som får hämta ${child.name}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon="UserPlus" loading={saving} onClick={submit}>
            Spara
          </Button>
        </>
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
          <label htmlFor="pickup-name" className="mb-1.5 block text-sm font-medium text-ink">
            Namn <span className="text-danger">*</span>
          </label>
          <TextInput
            id="pickup-name"
            icon="User"
            value={personName}
            placeholder="För- och efternamn"
            maxLength={80}
            onChange={(e) => setPersonName(e.target.value)}
          />
          {showErrors && nameError && <p className="mt-1 text-2xs text-danger">{nameError}</p>}
        </div>

        <div>
          <label htmlFor="pickup-relation" className="mb-1.5 block text-sm font-medium text-ink">
            Relation <span className="text-danger">*</span>
          </label>
          <Select id="pickup-relation" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="" disabled>
              Välj relation …
            </option>
            {RELATION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          {showErrors && relationError && <p className="mt-1 text-2xs text-danger">{relationError}</p>}
        </div>

        <div>
          <label htmlFor="pickup-note" className="mb-1.5 block text-sm font-medium text-ink">
            Anteckning <span className="text-ink-subtle">(valfritt)</span>
          </label>
          <textarea
            id="pickup-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="T.ex. hämtar endast på fredagar."
            className="w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
        </div>

        <p className="text-2xs text-ink-subtle">
          Uppgiften registreras i skolans system, loggas och ansvarig pedagog notifieras.
        </p>
      </div>
    </Modal>
  )
}
