import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, DataTable, Button, Badge, StatusBadge,
  Avatar, Modal, TextInput, Icon, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { Course, SchoolClass, StaffProfile, User } from '@/data/schema'
import { fmtRelative, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { setStaffAccountStatus, updateStaffProfile } from './service'

/**
 * Personaldetalj (/personal/:id, id = userId). Rektor/skoladmin kan redigera
 * profil och avaktivera konto – alltid via tjänstelagret med auktorisering
 * och granskningslogg.
 */

const EMPLOYMENT_META: Record<StaffProfile['employmentType'], { label: string; tone: Tone }> = {
  tillsvidare: { label: 'Tillsvidare', tone: 'success' },
  visstid: { label: 'Visstid', tone: 'info' },
  vikarie: { label: 'Vikarie', tone: 'warning' },
  timanställd: { label: 'Timanställd', tone: 'neutral' },
}

const USER_STATUS_META: Record<User['status'], { label: string; tone: Tone }> = {
  aktiv: { label: 'Aktiv', tone: 'success' },
  inbjuden: { label: 'Inbjuden', tone: 'info' },
  inaktiv: { label: 'Inaktiv', tone: 'danger' },
  last: { label: 'Låst', tone: 'warning' },
}

function subjectName(code: string): string {
  return db.data.subjects.find((s) => s.code === code)?.name ?? code
}

export function StaffDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const principal = usePrincipal()

  const [refresh, setRefresh] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 200)
    return () => clearTimeout(t)
  }, [])

  const user = byId(db.data.users, id)
  const profile = db.data.staff.find((s) => s.userId === id)

  const target = profile
    ? { organizationId: profile.organizationId, schoolId: profile.schoolId ?? null }
    : undefined
  const readDecision = usePermission('read', 'staff', target)
  const updateDecision = usePermission('update', 'staff', target)

  const mentorClasses = useMemo<SchoolClass[]>(
    () => (user ? db.data.classes.filter((c) => c.mentorUserId === user.id) : []),
    [user],
  )
  const teacherCourses = useMemo<Course[]>(
    () => (user ? db.data.courses.filter((c) => c.teacherUserId === user.id) : []),
    [user],
  )

  if (!user || !profile) {
    return (
      <>
        <PageHeader title="Personen hittades inte" icon="SearchX" />
        <Card>
          <CardBody className="flex flex-col items-center py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-ink-subtle">
              <Icon name="SearchX" className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-semibold text-ink">Personalprofilen finns inte</h3>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              Kontot kan ha avslutats eller flyttats till en annan skola.
            </p>
            <Button className="mt-5" variant="secondary" icon="ArrowLeft" onClick={() => navigate('/personal')}>
              Till personallistan
            </Button>
          </CardBody>
        </Card>
      </>
    )
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Personaldetalj" icon="Briefcase" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  void refresh // omrendering efter mutation läser senaste värden ur store:t

  const masked = user.protectedIdentity && !principal.protectedClearance
  const name = masked ? maskName(user.name) : user.name
  const school = byId(db.data.schools, profile.schoolId)
  const canUpdate = updateDecision.allowed
  const statusMeta = USER_STATUS_META[user.status]
  const employmentMeta = EMPLOYMENT_META[profile.employmentType]

  function handleError(e: unknown, fallback: string) {
    if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
    else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
    else toast.error(fallback, e instanceof Error ? e.message : 'Försök igen om en stund.')
  }

  function reactivate() {
    if (statusBusy || !user) return
    setStatusBusy(true)
    try {
      setStaffAccountStatus(principal, user.id, 'aktiv')
      toast.success('Kontot aktiverat', `${user.name} kan logga in igen.`)
      setRefresh((x) => x + 1)
    } catch (e) {
      handleError(e, 'Kunde inte aktivera kontot')
    } finally {
      setStatusBusy(false)
    }
  }

  const classColumns: Column<SchoolClass>[] = [
    {
      key: 'name',
      header: 'Klass',
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{c.name}</div>
          <div className="text-2xs text-ink-subtle">{c.gradeLabel}</div>
        </div>
      ),
    },
    {
      key: 'school',
      header: 'Skola',
      hideOnMobile: true,
      render: (c) => (
        <span className="text-ink-muted">{byId(db.data.schools, c.schoolId)?.name ?? '–'}</span>
      ),
    },
    {
      key: 'students',
      header: 'Elever',
      align: 'right',
      render: (c) => <span className="tabular-nums text-ink">{c.studentCount}</span>,
    },
  ]

  const courseColumns: Column<Course>[] = [
    {
      key: 'name',
      header: 'Kurs',
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{c.name}</div>
          <div className="text-2xs text-ink-subtle">{c.code}</div>
        </div>
      ),
    },
    {
      key: 'points',
      header: 'Poäng',
      align: 'right',
      hideOnMobile: true,
      render: (c) => <span className="tabular-nums text-ink-muted">{c.points}</span>,
    },
    {
      key: 'students',
      header: 'Elever',
      align: 'right',
      render: (c) => <span className="tabular-nums text-ink">{c.studentCount}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${profile.title} · ${school?.name ?? 'Okänd skola'}`}
        breadcrumbs={[{ label: 'Personal' }, { label: name }]}
        actions={
          <>
            <Button variant="ghost" icon="ArrowLeft" onClick={() => navigate('/personal')}>
              Tillbaka
            </Button>
            {canUpdate && (
              <Button variant="secondary" icon="PenLine" onClick={() => setEditOpen(true)}>
                Redigera
              </Button>
            )}
            {canUpdate && user.status !== 'inaktiv' && (
              <Button variant="danger" icon="UserX" onClick={() => setDeactivateOpen(true)}>
                Avaktivera konto
              </Button>
            )}
            {canUpdate && user.status === 'inaktiv' && (
              <Button icon="UserCheck" loading={statusBusy} onClick={reactivate}>
                Aktivera konto
              </Button>
            )}
          </>
        }
      />

      {masked && (
        <Card className="mb-4 border-warning/40 bg-warning-soft/50">
          <CardBody className="flex items-start gap-3 py-4">
            <Icon name="ShieldAlert" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-warning">Skyddad identitet.</span>{' '}
              Uppgifter visas maskerade och all åtkomst loggas.
            </p>
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody className="flex flex-col gap-5 py-5 sm:flex-row sm:items-start">
          <Avatar name={name} color={user.avatarColor} size="lg" protected={masked} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">{name}</h2>
              <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
              <Badge tone={employmentMeta.tone} icon="Briefcase">
                {employmentMeta.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">{profile.title}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.subjects.length > 0 ? (
                profile.subjects.map((code) => (
                  <Badge key={code} tone="primary">
                    {subjectName(code)}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-ink-subtle">Inga ämnen registrerade.</span>
              )}
            </div>
          </div>
          <dl className="grid shrink-0 gap-3 text-sm sm:w-64">
            <InfoRow icon="School" label="Skola" value={school?.name ?? 'Ej angiven'} />
            <InfoRow icon="Mail" label="E-post" value={masked ? '••••••••' : user.email} />
            <InfoRow
              icon="History"
              label="Senaste inloggning"
              value={user.lastLoginAt ? fmtRelative(user.lastLoginAt) : 'Aldrig'}
            />
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader
            icon="Users"
            title="Mentorsklasser"
            subtitle={`${mentorClasses.length} uppdrag som mentor.`}
          />
          {loading ? (
            <LoadingRows rows={2} />
          ) : (
            <DataTable
              columns={classColumns}
              rows={mentorClasses}
              onRowClick={(c) => navigate(`/klasser/${c.id}`)}
              caption={`Mentorsklasser för ${name}`}
              emptyTitle="Inga mentorsuppdrag"
              emptyDescription="Klasser där personen är mentor visas här."
            />
          )}
        </Card>

        <Card className="self-start">
          <CardHeader
            icon="BookOpen"
            title="Kurser"
            subtitle={`${teacherCourses.length} kurser som ansvarig lärare.`}
          />
          {loading ? (
            <LoadingRows rows={2} />
          ) : (
            <DataTable
              columns={courseColumns}
              rows={teacherCourses}
              onRowClick={(c) => navigate(`/kurser/${c.id}`)}
              caption={`Kurser för ${name}`}
              emptyTitle="Inga kursuppdrag"
              emptyDescription="Kurser där personen är ansvarig lärare visas här."
            />
          )}
        </Card>
      </div>

      {editOpen && (
        <EditStaffModal
          user={user}
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            setRefresh((x) => x + 1)
          }}
        />
      )}

      {deactivateOpen && (
        <DeactivateModal
          user={user}
          onClose={() => setDeactivateOpen(false)}
          onDone={() => {
            setDeactivateOpen(false)
            setRefresh((x) => x + 1)
          }}
        />
      )}
    </>
  )
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
      <div className="min-w-0">
        <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
        <dd className="truncate font-medium text-ink">{value}</dd>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Redigera profil (titel + ämnen som togglebara chips)
// ---------------------------------------------------------------------------

function EditStaffModal({
  user,
  profile,
  onClose,
  onSaved,
}: {
  user: User
  profile: StaffProfile
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const [title, setTitle] = useState(profile.title)
  const [subjects, setSubjects] = useState<string[]>([...profile.subjects])
  const [saving, setSaving] = useState(false)
  const valid = title.trim().length > 0

  function toggleSubject(code: string) {
    setSubjects((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      updateStaffProfile(principal, user.id, { title, subjects })
      toast.success('Profilen sparad', 'Ändringarna har registrerats i granskningsloggen.')
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Kunde inte spara', e instanceof Error ? e.message : 'Försök igen om en stund.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera personalprofil"
      description={user.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            icon="Save"
            loading={saving}
            disabled={!valid || saving}
            title={valid ? undefined : 'Ange en titel för att kunna spara'}
            onClick={save}
          >
            Spara ändringar
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="staff-title">
            Titel <span className="text-danger">*</span>
          </label>
          <TextInput
            id="staff-title"
            value={title}
            icon="Briefcase"
            placeholder="T.ex. Lärare, matematik"
            onChange={(e) => setTitle(e.target.value)}
          />
          {!valid && <p className="mt-1 text-2xs text-danger">Titel är obligatoriskt.</p>}
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Ämnen</span>
          <div className="flex flex-wrap gap-1.5">
            {db.data.subjects.map((s) => {
              const active = subjects.includes(s.code)
              return (
                <button
                  key={s.code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSubject(s.code)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  {active && <Icon name="Check" className="h-3 w-3" />}
                  {s.name}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-2xs text-ink-subtle">{subjects.length} ämnen valda.</p>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Avaktivera konto (bekräftelse)
// ---------------------------------------------------------------------------

function DeactivateModal({
  user,
  onClose,
  onDone,
}: {
  user: User
  onClose: () => void
  onDone: () => void
}) {
  const principal = usePrincipal()
  const [busy, setBusy] = useState(false)

  function confirm() {
    if (busy) return
    setBusy(true)
    try {
      setStaffAccountStatus(principal, user.id, 'inaktiv')
      toast.success('Kontot avaktiverat', `${user.name} kan inte längre logga in. Åtgärden är loggad.`)
      onDone()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Kunde inte avaktivera', 'Försök igen om en stund.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Avaktivera konto"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="danger" icon="UserX" loading={busy} disabled={busy} onClick={confirm}>
            Avaktivera
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Åtgärden loggas med hög risknivå och kan ångras genom att kontot aktiveras igen.</span>
        </div>
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{user.name}</span> förlorar omedelbart åtkomst till
          Skolnav. Pågående sessioner avslutas och inloggning blockeras.
        </p>
      </div>
    </Modal>
  )
}
