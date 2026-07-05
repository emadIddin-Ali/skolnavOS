import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, Badge, StatusBadge, Button, DataTable,
  ProgressBar, Icon, DeniedState, EmptyState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, latency, byId } from '@/data/db/store'
import type { Integration, IntegrationRun, RateLimitEvent, RateLimitState } from '@/data/schema'
import { RATE_LIMIT_STATE_LABEL } from '@/data/schema'
import { listIntegrations } from '@/core/integrations/registry'
import { fmtRelative, fmtDateTime, fmtNumber } from '@/lib/format'
import { runHealthCheck } from './service'

// ---- Delsystem härledda från integrationskategorier ----
const SUBSYSTEMS: { key: string; label: string; icon: string; categories: Integration['category'][] }[] = [
  { key: 'databas', label: 'Databas', icon: 'Database', categories: [] },
  { key: 'notiser', label: 'Notiser', icon: 'Bell', categories: ['notis'] },
  { key: 'pdf', label: 'PDF-generering', icon: 'FileText', categories: ['pdf'] },
  { key: 'sok', label: 'Sök', icon: 'Search', categories: ['sok'] },
  { key: 'signering', label: 'Signering', icon: 'PenLine', categories: ['signering'] },
  { key: 'loggar', label: 'Loggar', icon: 'ScrollText', categories: ['logg'] },
]

type SubsystemState = 'drift' | 'storning' | 'ej_konfigurerad' | 'vilande'

const SUBSYSTEM_META: Record<SubsystemState, { label: string; tone: Tone; icon: string }> = {
  drift: { label: 'Drift', tone: 'success', icon: 'CircleCheck' },
  storning: { label: 'Störning', tone: 'danger', icon: 'TriangleAlert' },
  ej_konfigurerad: { label: 'Ej konfigurerad', tone: 'warning', icon: 'Wrench' },
  vilande: { label: 'Vilande', tone: 'neutral', icon: 'Power' },
}

const RL_STATE_TONE: Record<RateLimitState, Tone> = {
  normal: 'neutral',
  narmar_grans: 'warning',
  begransad: 'warning',
  blockerad: 'danger',
  kraver_verifiering: 'warning',
  eskalerad: 'danger',
}

const RUN_STATUS_META: Record<IntegrationRun['status'], { tone: Tone; icon: string; label: string }> = {
  ok: { tone: 'success', icon: 'CircleCheck', label: 'OK' },
  fel: { tone: 'danger', icon: 'CircleX', label: 'Fel' },
  partiell: { tone: 'warning', icon: 'TriangleAlert', label: 'Partiell' },
  pausad: { tone: 'neutral', icon: 'Pause', label: 'Pausad' },
}

function subsystemState(items: Integration[]): SubsystemState {
  if (items.some((i) => i.status === 'fel')) return 'storning'
  if (items.some((i) => i.status.startsWith('kraver_'))) return 'ej_konfigurerad'
  if (items.some((i) => i.status === 'aktiv' || i.status === 'testad')) return 'drift'
  return 'vilande'
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

interface RunRow {
  id: string
  run: IntegrationRun
  integrationName: string
}

export function SystemHealthPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'system_health')

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [checking, setChecking] = useState(false)

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

  const integrations = useMemo(() => {
    void refresh
    return listIntegrations(principal.organizationId)
  }, [principal.organizationId, refresh])

  const failing = useMemo(() => integrations.filter((i) => i.status === 'fel'), [integrations])

  const quotaItems = useMemo(
    () => integrations.filter((i) => i.quotaDay != null && i.quotaDay > 0),
    [integrations],
  )

  const rateLimitEvents = useMemo<RateLimitEvent[]>(() => {
    void refresh
    return db.data.rateLimitEvents.filter((e) => e.organizationId === principal.organizationId)
  }, [principal.organizationId, refresh])

  const runRows = useMemo<RunRow[]>(() => {
    void refresh
    const orgIntegrationIds = new Set(integrations.map((i) => i.id))
    return db.data.integrationRuns
      .filter((r) => orgIntegrationIds.has(r.integrationId))
      .map((run) => ({
        id: run.id,
        run,
        integrationName: byId(db.data.integrations, run.integrationId)?.name ?? 'Okänd integration',
      }))
      .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))
      .slice(0, 12)
  }, [integrations, refresh])

  async function healthCheck() {
    if (checking) return
    setChecking(true)
    try {
      const result = await runHealthCheck(principal)
      bump()
      if (result.total === 0) {
        toast.info('Inga aktiva integrationer', 'Det finns inget att hälsokontrollera just nu.')
      } else if (result.ok === result.total) {
        toast.success('Hälsokontroll klar', `${result.ok} av ${result.total} integrationer svarar korrekt.`)
      } else {
        toast.warning(
          'Hälsokontroll klar med avvikelser',
          `${result.ok} av ${result.total} OK. Problem: ${result.failures.map((f) => f.name).join(', ')}.`,
        )
      }
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Kvot nådd', e.message)
      else toast.error('Hälsokontrollen misslyckades', 'Försök igen om en stund.')
    } finally {
      setChecking(false)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Systemhälsa" icon="Activity" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const rlColumns: Column<RateLimitEvent>[] = [
    {
      key: 'dimension',
      header: 'Dimension',
      render: (e) => <span className="font-medium text-ink">{e.dimension}</span>,
    },
    {
      key: 'scope',
      header: 'Omfattning',
      hideOnMobile: true,
      render: (e) => <span className="text-ink-muted">{e.scope}</span>,
    },
    {
      key: 'state',
      header: 'Tillstånd',
      render: (e) => <StatusBadge tone={RL_STATE_TONE[e.state]} label={RATE_LIMIT_STATE_LABEL[e.state]} />,
    },
    {
      key: 'usage',
      header: 'Förbrukning',
      align: 'right',
      render: (e) => (
        <span className="tabular-nums text-ink">
          {fmtNumber(e.count)} / {fmtNumber(e.limit)}{' '}
          <span className="text-2xs text-ink-subtle">{e.windowLabel}</span>
        </span>
      ),
    },
    {
      key: 'at',
      header: 'Tidpunkt',
      hideOnMobile: true,
      render: (e) => <span className="text-ink-muted">{fmtRelative(e.at)}</span>,
    },
  ]

  const runColumns: Column<RunRow>[] = [
    {
      key: 'integration',
      header: 'Integration',
      render: (r) => <span className="font-medium text-ink">{r.integrationName}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const meta = RUN_STATUS_META[r.run.status]
        return <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
      },
    },
    {
      key: 'started',
      header: 'Startad',
      render: (r) => <span className="text-ink-muted">{fmtDateTime(r.run.startedAt)}</span>,
    },
    {
      key: 'items',
      header: 'Poster',
      align: 'right',
      hideOnMobile: true,
      render: (r) => <span className="tabular-nums text-ink">{fmtNumber(r.run.itemsProcessed)}</span>,
    },
    {
      key: 'duration',
      header: 'Tid',
      align: 'right',
      hideOnMobile: true,
      render: (r) => <span className="tabular-nums text-ink-muted">{fmtDuration(r.run.durationMs)}</span>,
    },
    {
      key: 'message',
      header: 'Meddelande',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted">{r.run.message || '—'}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Systemhälsa"
        icon="Activity"
        subtitle="Driftstatus för plattformens delsystem, kvoter och integrationskörningar."
        actions={
          <Button icon="Stethoscope" loading={checking} onClick={healthCheck}>
            Kör hälsokontroll
          </Button>
        }
      />

      {/* Incidentbanner */}
      {!loading && failing.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-card border border-danger/30 bg-danger-soft p-4">
          <Icon name="Siren" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="font-semibold text-danger">Pågående störning</p>
            <ul className="mt-1 space-y-0.5 text-sm text-danger">
              {failing.map((i) => (
                <li key={i.id}>
                  {i.name}: {i.lastError ?? 'Okänt fel'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Statuspanel per delsystem */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {SUBSYSTEMS.map((sub) => {
          const items = integrations.filter((i) => sub.categories.includes(i.category))
          const state: SubsystemState = sub.key === 'databas' ? 'drift' : subsystemState(items)
          const meta = SUBSYSTEM_META[state]
          const lastSync =
            sub.key === 'databas'
              ? null
              : items.reduce<string | null>(
                  (acc, i) => (i.lastSyncAt && (!acc || i.lastSyncAt > acc) ? i.lastSyncAt : acc),
                  null,
                )
          return (
            <Card key={sub.key} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-field bg-surface-2 text-ink-muted">
                  <Icon name={sub.icon} className="h-[18px] w-[18px]" />
                </span>
                <StatusBadge tone={meta.tone} icon={meta.icon} label={meta.label} />
              </div>
              <div className="mt-3 font-medium text-ink">{sub.label}</div>
              <div className="mt-0.5 text-2xs text-ink-subtle">
                {sub.key === 'databas'
                  ? 'Kontinuerlig replikering'
                  : lastSync
                    ? `Senaste synk ${fmtRelative(lastSync)}`
                    : 'Ingen synk registrerad'}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Kvoter */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Dagskvoter"
            subtitle="Förbrukning per integration under innevarande dygn."
            icon="Gauge"
          />
          <CardBody>
            {loading ? (
              <LoadingRows rows={3} />
            ) : quotaItems.length === 0 ? (
              <EmptyState icon="Gauge" title="Inga kvoter konfigurerade" description="Integrationer utan dagskvot visas inte här." />
            ) : (
              <ul className="space-y-4">
                {quotaItems.map((i) => {
                  const pct = (i.usageDay / (i.quotaDay as number)) * 100
                  const tone: Tone = pct >= 95 ? 'danger' : pct >= 80 ? 'warning' : 'success'
                  return (
                    <li key={i.id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-ink">{i.name}</span>
                        <span className="tabular-nums text-ink-muted">
                          {fmtNumber(i.usageDay)} / {fmtNumber(i.quotaDay as number)}
                        </span>
                      </div>
                      <ProgressBar value={pct} tone={tone} />
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Gränshändelser"
            subtitle="Registrerade kvot- och missbruksskyddshändelser."
            icon="ShieldAlert"
          />
          {loading ? (
            <LoadingRows rows={3} />
          ) : (
            <DataTable
              columns={rlColumns}
              rows={rateLimitEvents}
              caption="Gränshändelser"
              emptyTitle="Inga gränshändelser"
              emptyDescription="Alla flöden ligger inom normala kvoter."
            />
          )}
        </Card>
      </div>

      {/* Senaste integrationskörningar */}
      <Card className="mt-5">
        <CardHeader
          title="Senaste integrationskörningar"
          subtitle="De 12 senaste körningarna, inklusive manuella hälsokontroller."
          icon="History"
          action={
            failing.length === 0 && !loading ? (
              <Badge tone="success" icon="CircleCheck">Inga aktiva incidenter</Badge>
            ) : undefined
          }
        />
        {loading ? (
          <LoadingRows rows={4} />
        ) : (
          <DataTable
            columns={runColumns}
            rows={runRows}
            caption="Integrationskörningar"
            emptyTitle="Inga körningar registrerade"
            emptyDescription="Kör en hälsokontroll för att testa anslutningarna."
          />
        )}
      </Card>
    </>
  )
}
