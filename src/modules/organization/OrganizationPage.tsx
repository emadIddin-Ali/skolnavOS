import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, DataTable, Badge, StatusBadge,
  Segmented, Icon, ProgressBar, DeniedState, EmptyState, LoadingRows, Skeleton, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { db, latency } from '@/data/db/store'
import type { Organization, School, SchoolYear, Term, FeatureFlag } from '@/data/schema'
import { SCHOOL_TYPE_LABEL } from '@/data/schema'
import { useSession } from '@/core/state/session'
import { fmtDateLong, fmtNumber } from '@/lib/format'
import { setFeatureFlag } from './service'

// ---- Presentationskartor ----
const ORG_KIND_LABEL: Record<Organization['kind'], string> = {
  kommun: 'Kommunal huvudman',
  friskola: 'Fristående huvudman',
  koncern: 'Koncern',
}
const ORG_KIND_TONE: Record<Organization['kind'], Tone> = {
  kommun: 'primary',
  friskola: 'accent',
  koncern: 'info',
}
const LICENSE_TIER_LABEL: Record<Organization['licenseTier'], string> = {
  bas: 'Bas',
  standard: 'Standard',
  plus: 'Plus',
  koncern: 'Koncern',
}
const FLAG_SCOPE_LABEL: Record<FeatureFlag['scope'], string> = {
  plattform: 'Plattform',
  organisation: 'Organisation',
  skola: 'Skola',
}
const SCHOOL_TYPE_TONE: Record<School['type'], Tone> = {
  forskola: 'accent',
  grundskola: 'primary',
  gymnasium: 'info',
  vux: 'neutral',
}

export function OrganizationPage() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const activeSchoolId = useSession((s) => s.schoolId)
  const readDecision = usePermission('read', 'organization')
  const canAdmin = useCan('admin', 'organization')

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const org = useMemo(
    () => db.data.organizations.find((o) => o.id === principal.organizationId),
    [principal.organizationId],
  )

  const schools = useMemo(
    () => {
      void refresh
      return db.data.schools.filter((s) => s.organizationId === principal.organizationId)
    },
    [principal.organizationId, refresh],
  )

  const years = useMemo(() => {
    const list = db.data.schoolYears.filter((y) => y.organizationId === principal.organizationId)
    return [...list].sort((a, b) => (a.current === b.current ? b.startsOn.localeCompare(a.startsOn) : a.current ? -1 : 1))
  }, [principal.organizationId])

  const stats = useMemo(() => {
    void refresh
    const students = db.data.students.filter((s) => s.organizationId === principal.organizationId).length
    const staff = db.data.staff.filter((s) => s.organizationId === principal.organizationId && s.active).length
    const licenses = db.data.licenses.filter((l) => l.organizationId === principal.organizationId)
    const activeLicenses = licenses.filter((l) => l.status === 'aktiv').length
    return { students, staff, activeLicenses, totalLicenses: licenses.length }
  }, [principal.organizationId, refresh])

  const flags = useMemo(() => {
    void refresh
    return db.data.featureFlags
  }, [refresh])

  function toggleFlag(flag: FeatureFlag, enabled: boolean) {
    if (flag.enabled === enabled) return
    setTogglingKey(flag.key)
    try {
      setFeatureFlag(principal, flag.key, enabled)
      bump()
      toast.success(
        enabled ? 'Funktion aktiverad' : 'Funktion avaktiverad',
        `«${flag.label}» är nu ${enabled ? 'på' : 'av'} för organisationen.`,
      )
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte spara', 'Ändringen kunde inte genomföras just nu. Försök igen.')
    } finally {
      setTogglingKey(null)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Organisation" icon="Building2" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const schoolColumns: Column<School>[] = [
    {
      key: 'name',
      header: 'Skola',
      render: (s) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
            <Icon name="School" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-ink truncate">{s.name}</span>
              {s.id === activeSchoolId && (
                <Badge tone="success" icon="Check">Aktiv</Badge>
              )}
            </div>
            <div className="text-2xs text-ink-subtle truncate">{s.address}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Skolform',
      render: (s) => <Badge tone={SCHOOL_TYPE_TONE[s.type]}>{SCHOOL_TYPE_LABEL[s.type]}</Badge>,
    },
    {
      key: 'municipality',
      header: 'Kommun',
      hideOnMobile: true,
      render: (s) => <span className="text-ink-muted">{s.municipality}</span>,
    },
    {
      key: 'students',
      header: 'Elever',
      align: 'right',
      render: (s) => <span className="tabular-nums text-ink">{fmtNumber(s.studentCount)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Organisation"
        icon="Building2"
        subtitle="Huvudmannens skolor, läsår och funktionsinställningar."
      />

      {/* Översiktskort */}
      {loading ? (
        <Card className="mb-5 p-5">
          <Skeleton className="h-6 w-64 rounded-field" />
          <Skeleton className="mt-3 h-4 w-40 rounded-field" />
        </Card>
      ) : org ? (
        <Card className="mb-5">
          <CardBody className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-panel bg-primary-soft text-primary">
                  <Icon name="Building2" className="h-7 w-7" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink">{org.name}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    Org.nr {org.orgNumber} · Kund sedan {fmtDateLong(org.createdAt)}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Badge tone={ORG_KIND_TONE[org.kind]} icon="Scale">{ORG_KIND_LABEL[org.kind]}</Badge>
                    <Badge tone="info" icon="BadgeCheck">Licens: {LICENSE_TIER_LABEL[org.licenseTier]}</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="mb-5">
          <EmptyState icon="Building2" title="Ingen organisation hittades" description="Din inloggning saknar koppling till en organisation." />
        </Card>
      )}

      {/* Nyckeltal */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Skolor" value={loading ? '–' : schools.length} icon="School" tone="primary" />
        <StatCard label="Elever totalt" value={loading ? '–' : fmtNumber(stats.students)} icon="Users" tone="info" />
        <StatCard label="Personal" value={loading ? '–' : fmtNumber(stats.staff)} icon="Briefcase" tone="accent" />
        <StatCard
          label="Aktiva licenser"
          value={loading ? '–' : stats.activeLicenses}
          icon="BadgeCheck"
          tone="success"
          hint={loading ? undefined : `av ${stats.totalLicenses} licensmoduler`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Skolor */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Skolor"
            subtitle="Enheter inom organisationen. Aktiv skola styr vad som visas i menyn."
            icon="School"
          />
          {loading ? (
            <LoadingRows rows={4} />
          ) : (
            <DataTable
              columns={schoolColumns}
              rows={schools}
              caption="Organisationens skolor"
              emptyTitle="Inga skolor registrerade"
              onRowClick={(s) => {
                if (s.id === activeSchoolId) navigate('/skola')
                else toast.info('Byt skola i väljaren uppe till vänster', `Välj «${s.name}» för att öppna skolvyn.`)
              }}
            />
          )}
        </Card>

        {/* Läsår & terminer */}
        <Card>
          <CardHeader title="Läsår & terminer" subtitle="Aktuell period är markerad." icon="CalendarRange" />
          <CardBody>
            {loading ? (
              <LoadingRows rows={3} />
            ) : years.length === 0 ? (
              <EmptyState icon="CalendarRange" title="Inga läsår upplagda" description="Läsår administreras vid terminsstart." />
            ) : (
              <div className="space-y-4">
                {years.map((y) => (
                  <YearTimeline key={y.id} year={y} terms={db.data.terms.filter((t) => t.schoolYearId === y.id)} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Funktionsflaggor */}
      <Card className="mt-5">
        <CardHeader
          title="Funktionsflaggor"
          subtitle={
            canAdmin
              ? 'Slå på eller av funktioner för organisationen. Ändringar loggas.'
              : 'Visas i läsläge – ändringar kräver administratörsbehörighet.'
          }
          icon="Settings2"
          action={!canAdmin ? <Badge tone="neutral" icon="Lock">Läsläge</Badge> : undefined}
        />
        <CardBody className="pt-1">
          {loading ? (
            <LoadingRows rows={4} />
          ) : (
            <ul className="divide-y divide-border">
              {flags.map((flag) => (
                <li key={flag.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{flag.label}</span>
                      <Badge tone="neutral">{FLAG_SCOPE_LABEL[flag.scope]}</Badge>
                    </div>
                    <div className="mt-0.5 text-2xs text-ink-subtle">Nyckel: {flag.key}</div>
                  </div>
                  {canAdmin ? (
                    <Segmented
                      size="sm"
                      value={flag.enabled ? 'pa' : 'av'}
                      onChange={(v) => {
                        if (togglingKey) return
                        toggleFlag(flag, v === 'pa')
                      }}
                      options={[
                        { value: 'pa', label: 'På', icon: 'Check' },
                        { value: 'av', label: 'Av' },
                      ]}
                    />
                  ) : (
                    <StatusBadge
                      tone={flag.enabled ? 'success' : 'neutral'}
                      icon={flag.enabled ? 'CircleCheck' : 'CircleSlash'}
                      label={flag.enabled ? 'På' : 'Av'}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Tidslinje för ett läsår med terminer
// ---------------------------------------------------------------------------

function YearTimeline({ year, terms }: { year: SchoolYear; terms: Term[] }) {
  return (
    <div
      className={
        'rounded-field border p-3 ' +
        (year.current ? 'border-primary/40 bg-primary-soft/40' : 'border-border bg-surface')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="CalendarRange" className={'h-4 w-4 ' + (year.current ? 'text-primary' : 'text-ink-subtle')} />
          <span className="font-medium text-ink">Läsår {year.label}</span>
        </div>
        {year.current && <Badge tone="primary" dot>Pågår</Badge>}
      </div>
      <div className="mt-1 text-2xs text-ink-subtle">
        {fmtDateLong(year.startsOn)} – {fmtDateLong(year.endsOn)}
      </div>
      {terms.length > 0 && (
        <ol className="mt-3 space-y-2 border-l border-border pl-3">
          {terms.map((t) => (
            <li key={t.id} className="relative">
              <span
                className={
                  'absolute -left-[17px] top-1.5 h-2 w-2 rounded-full ' +
                  (t.current ? 'bg-primary' : 'bg-surface-3')
                }
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className={'text-sm ' + (t.current ? 'font-medium text-ink' : 'text-ink-muted')}>{t.label}</span>
                {t.current && <Badge tone="success" icon="CalendarCheck">Aktuell</Badge>}
              </div>
              <div className="text-2xs text-ink-subtle">
                {fmtDateLong(t.startsOn)} – {fmtDateLong(t.endsOn)}
              </div>
              {t.current && <TermProgress term={t} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function TermProgress({ term }: { term: Term }) {
  const start = new Date(term.startsOn).getTime()
  const end = new Date(term.endsOn).getTime()
  const now = Date.now()
  const pct = end > start ? ((now - start) / (end - start)) * 100 : 0
  return <ProgressBar value={pct} tone="primary" showValue className="mt-1.5 max-w-[220px]" />
}
