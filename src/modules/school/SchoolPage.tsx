import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, Badge, Avatar, Button, Modal, TextInput,
  DataTable, Icon, DeniedState, EmptyState, ErrorState, LoadingRows, Skeleton, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { db, latency } from '@/data/db/store'
import type { School, SchoolClass } from '@/data/schema'
import { SCHOOL_TYPE_LABEL } from '@/data/schema'
import { useSession } from '@/core/state/session'
import { fmtNumber, maskName } from '@/lib/format'
import { updateSchoolInfo } from './service'

const SCHOOL_TYPE_TONE: Record<School['type'], Tone> = {
  forskola: 'accent',
  grundskola: 'primary',
  gymnasium: 'info',
  vux: 'neutral',
}

interface ClassRow {
  id: string
  cls: SchoolClass
  mentorLabel: string
  mentorColor?: string
  mentorMasked: boolean
}

export function SchoolPage() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const schoolId = useSession((s) => s.schoolId)

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [editOpen, setEditOpen] = useState(false)

  const school = useMemo(() => {
    void refresh
    return db.data.schools.find((s) => s.id === schoolId)
  }, [schoolId, refresh])

  const readDecision = usePermission(
    'read',
    'school',
    school ? { organizationId: school.organizationId, schoolId: school.id } : undefined,
  )
  const canEdit = useCan(
    'update',
    'school',
    school ? { organizationId: school.organizationId, schoolId: school.id } : undefined,
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [schoolId])

  const org = useMemo(
    () => (school ? db.data.organizations.find((o) => o.id === school.organizationId) : undefined),
    [school],
  )

  const principalUser = useMemo(
    () => (school?.principalUserId ? db.data.users.find((u) => u.id === school.principalUserId) : undefined),
    [school],
  )

  const departments = useMemo(
    () => (school ? db.data.departments.filter((d) => d.schoolId === school.id) : []),
    [school],
  )

  const classRows = useMemo<ClassRow[]>(() => {
    if (!school) return []
    return db.data.classes
      .filter((c) => c.schoolId === school.id)
      .map((cls) => {
        const mentor = cls.mentorUserId ? db.data.users.find((u) => u.id === cls.mentorUserId) : undefined
        const masked = Boolean(mentor?.protectedIdentity && !principal.protectedClearance)
        return {
          id: cls.id,
          cls,
          mentorLabel: mentor ? (masked ? maskName(mentor.name) : mentor.name) : 'Ej tilldelad',
          mentorColor: mentor?.avatarColor,
          mentorMasked: masked,
        }
      })
      .sort((a, b) => a.cls.name.localeCompare(b.cls.name, 'sv'))
  }, [school, principal])

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Skola" icon="School" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  if (!school) {
    return (
      <>
        <PageHeader title="Skola" icon="School" />
        <Card>
          <ErrorState description="Den valda skolan kunde inte hittas. Byt skola i väljaren uppe till vänster." />
        </Card>
      </>
    )
  }

  const classColumns: Column<ClassRow>[] = [
    {
      key: 'name',
      header: 'Klass',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-soft text-primary text-xs font-semibold">
            {r.cls.name.slice(0, 3)}
          </span>
          <span className="font-medium text-ink">{r.cls.name}</span>
        </div>
      ),
    },
    {
      key: 'grade',
      header: 'Årskurs',
      render: (r) => <Badge tone="neutral">{r.cls.gradeLabel}</Badge>,
    },
    {
      key: 'mentor',
      header: 'Mentor',
      hideOnMobile: true,
      render: (r) =>
        r.cls.mentorUserId ? (
          <div className="flex items-center gap-2">
            <Avatar name={r.mentorLabel} color={r.mentorColor} size="sm" protected={r.mentorMasked} />
            <span className="text-ink-muted">{r.mentorLabel}</span>
            {r.mentorMasked && (
              <span title="Skyddad identitet – namnet är maskerat">
                <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
              </span>
            )}
          </div>
        ) : (
          <span className="text-ink-subtle">Ej tilldelad</span>
        ),
    },
    {
      key: 'students',
      header: 'Elever',
      align: 'right',
      render: (r) => <span className="tabular-nums text-ink">{fmtNumber(r.cls.studentCount)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={school.name}
        icon="School"
        subtitle={`${SCHOOL_TYPE_LABEL[school.type]} · ${school.municipality}`}
        actions={
          canEdit ? (
            <Button icon="PencilLine" variant="secondary" onClick={() => setEditOpen(true)}>
              Redigera skolinfo
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Infokort */}
        <Card className="lg:col-span-2">
          <CardHeader title="Skoluppgifter" icon="Info" />
          <CardBody>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-56 rounded-field" />
                <Skeleton className="h-5 w-72 rounded-field" />
                <Skeleton className="h-5 w-48 rounded-field" />
              </div>
            ) : (
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <InfoField label="Skolform">
                  <Badge tone={SCHOOL_TYPE_TONE[school.type]}>{SCHOOL_TYPE_LABEL[school.type]}</Badge>
                </InfoField>
                <InfoField label="Kommun">{school.municipality}</InfoField>
                <InfoField label="Adress">{school.address}</InfoField>
                <InfoField label="Elevantal">{fmtNumber(school.studentCount)} elever</InfoField>
                <InfoField label="Rektor">
                  {principalUser ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar
                        name={
                          principalUser.protectedIdentity && !principal.protectedClearance
                            ? maskName(principalUser.name)
                            : principalUser.name
                        }
                        color={principalUser.avatarColor}
                        size="sm"
                        protected={principalUser.protectedIdentity && !principal.protectedClearance}
                      />
                      {principalUser.protectedIdentity && !principal.protectedClearance
                        ? maskName(principalUser.name)
                        : principalUser.name}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">Ej angiven</span>
                  )}
                </InfoField>
                <InfoField label="Huvudman">{org?.name ?? 'Okänd'}</InfoField>
              </dl>
            )}
          </CardBody>
        </Card>

        {/* Enkel statisk "karta" */}
        <Card>
          <CardHeader title="Plats" icon="Map" />
          <CardBody>
            <div className="grid place-items-center rounded-field border border-dashed border-border bg-surface-2 px-4 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
                <Icon name="Map" className="h-6 w-6" />
              </span>
              <p className="mt-3 font-medium text-ink">{school.address}</p>
              <p className="mt-1 text-2xs tabular-nums text-ink-subtle">
                {school.lat.toFixed(3).replace('.', ',')}° N · {school.lng.toFixed(3).replace('.', ',')}° Ö
              </p>
            </div>
            <p className="mt-3 text-2xs text-ink-subtle">
              Kartvy via OpenStreetMap aktiveras i integrationscentret.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Avdelningar */}
      <Card className="mt-5">
        <CardHeader title="Avdelningar" subtitle="Skolans organisatoriska enheter." icon="Network" />
        <CardBody>
          {loading ? (
            <LoadingRows rows={2} />
          ) : departments.length === 0 ? (
            <EmptyState
              icon="Network"
              title="Inga avdelningar"
              description="Skolan är inte indelad i avdelningar."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((dep) => {
                const depClasses = classRows.filter((r) => r.cls.departmentId === dep.id)
                const depStudents = depClasses.reduce((sum, r) => sum + r.cls.studentCount, 0)
                return (
                  <div key={dep.id} className="flex items-center gap-3 rounded-field border border-border bg-surface p-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-accent-soft text-accent">
                      <Icon name="Network" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{dep.name}</div>
                      <div className="text-2xs text-ink-subtle">
                        {depClasses.length} {depClasses.length === 1 ? 'klass' : 'klasser'} · {fmtNumber(depStudents)} elever
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Klasser */}
      <Card className="mt-5">
        <CardHeader title="Klasser" subtitle="Klicka på en rad för att öppna klassvyn." icon="Grid2x2" />
        {loading ? (
          <LoadingRows rows={5} />
        ) : (
          <DataTable
            columns={classColumns}
            rows={classRows}
            caption="Skolans klasser"
            emptyTitle="Inga klasser upplagda"
            emptyDescription="Klasser för läsåret visas här när de har registrerats."
            onRowClick={(r) => navigate(`/klasser/${r.cls.id}`)}
          />
        )}
      </Card>

      {editOpen && (
        <EditSchoolModal
          school={school}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            bump()
          }}
        />
      )}
    </>
  )
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Redigera skolinfo (rektor/huvudman)
// ---------------------------------------------------------------------------

function EditSchoolModal({
  school,
  onClose,
  onSaved,
}: {
  school: School
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const [name, setName] = useState(school.name)
  const [address, setAddress] = useState(school.address)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = name.trim().length > 0 && address.trim().length > 0

  async function save() {
    if (!valid || saving) return
    setError(null)
    setSaving(true)
    try {
      await latency(250)
      updateSchoolInfo(principal, school.id, { name, address })
      toast.success('Skolinfo uppdaterad', 'Ändringarna är sparade och loggade.')
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
      else setError('Ändringen kunde inte sparas just nu. Försök igen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera skolinfo"
      description="Uppdatera skolans namn och adress. Ändringen loggas i granskningsloggen."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button
            icon="Save"
            onClick={save}
            loading={saving}
            disabled={!valid || saving}
            title={valid ? undefined : 'Fyll i både namn och adress'}
          >
            Spara ändringar
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
          <label htmlFor="school-name" className="mb-1.5 block text-sm font-medium text-ink">
            Skolans namn <span className="text-danger">*</span>
          </label>
          <TextInput
            id="school-name"
            value={name}
            icon="School"
            onChange={(e) => setName(e.target.value)}
            placeholder="T.ex. Björkeberga grundskola"
          />
          {name.trim() === '' && <p className="mt-1 text-2xs text-danger">Namn är obligatoriskt.</p>}
        </div>
        <div>
          <label htmlFor="school-address" className="mb-1.5 block text-sm font-medium text-ink">
            Adress <span className="text-danger">*</span>
          </label>
          <TextInput
            id="school-address"
            value={address}
            icon="Map"
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Gatuadress, ort"
          />
          {address.trim() === '' && <p className="mt-1 text-2xs text-danger">Adress är obligatorisk.</p>}
        </div>
      </div>
    </Modal>
  )
}
