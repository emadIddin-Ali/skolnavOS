import { useMemo, useReducer, useState, type CSSProperties } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, ProgressRing, ProgressBar,
  Badge, StatusBadge, ClassificationBadge, Button, Tabs, Checklist,
  EmptyState, DeniedState, Icon,
} from '@/ui'
import type { Tone } from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db } from '@/data/db/store'
import type { SecurityEvent } from '@/data/schema'
import { RATE_LIMIT_STATE_LABEL } from '@/data/schema'
import { fmtRelative, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  SECURITY_EVENT_META, RISK_META, RATE_STATE_TONE, EVENT_ACTION_META, EVENT_ACTION_ORDER,
  type EventActionKind,
} from './meta'
import {
  actOnSecurityEvent, authorizeKeyAction, authorizeWebhookRotation, authorizeSessionRevoke,
  exportSecurityReport,
} from './service'
import {
  initialSessions, initialApiKeys, initialWebhooks, rotatedPrefix, ageDays,
  type DeviceSession, type ApiKey, type WebhookEndpoint,
} from './mockData'

type TabKey = 'oversikt' | 'handelser' | 'sessioner' | 'nycklar'
type Flash = { tone: 'success' | 'danger' | 'info'; msg: string } | null

/** Kända administratörskonton – används för MFA-täckning och rekommendationer. */
const ADMIN_IDS = ['u-superadmin', 'u-huvudman', 'u-rektor', 'u-bitr', 'u-skoladmin', 'u-itsupport']

const FLASH_CLASSES: Record<'success' | 'danger' | 'info', string> = {
  success: 'border-success/30 bg-success-soft text-success',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  info: 'border-info/30 bg-info-soft text-info',
}

function chipStyle(tone: Tone): CSSProperties {
  return { backgroundColor: `rgb(var(--c-${tone}) / 0.14)`, color: `rgb(var(--c-${tone}))` }
}

/** Namn med maskering för skyddad identitet (utan klarering). */
function displayUser(userId: string | null, protectedClearance: boolean): { label: string; masked: boolean } {
  if (!userId) return { label: 'System', masked: false }
  const u = db.data.users.find((x) => x.id === userId)
  if (!u) return { label: 'Okänd användare', masked: false }
  const masked = u.protectedIdentity && !protectedClearance
  return { label: masked ? maskName(u.name) : u.name, masked }
}

export function SecurityPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'security')
  const canUpdate = usePermission('update', 'security').allowed
  const canExport = usePermission('export', 'export').allowed

  const [tab, setTab] = useState<TabKey>('oversikt')
  const [flash, setFlash] = useState<Flash>(null)
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [sessions, setSessions] = useState<DeviceSession[]>(() => initialSessions())
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(() => initialApiKeys())
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>(() => initialWebhooks())
  const [exporting, setExporting] = useState(false)

  const org = principal.organizationId

  const events = useMemo(() => {
    void refresh
    return db.data.securityEvents
      .filter((e) => e.organizationId === org)
      .slice()
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [org, refresh])

  const rateEvents = useMemo(() => db.data.rateLimitEvents.filter((r) => r.organizationId === org), [org])

  // --- Behörighetsfiltrerad vy: nekas läsning visas DeniedState i stället. ---
  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Säkerhetscenter" icon="ShieldCheck" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  // --- Härledda nyckeltal ---
  const openEvents = events.filter((e) => !e.resolved)
  const failedLogins = events.filter((e) => e.type === 'login_fail')
  const unresolvedFails = failedLogins.filter((e) => !e.resolved)
  const activeRateWarnings = rateEvents.filter((r) => r.state !== 'normal')
  const newDeviceEvents = events.filter((e) => e.type === 'new_device')

  const adminUsers = db.data.users.filter((u) => ADMIN_IDS.includes(u.id))
  const adminsWithMfa = adminUsers.filter((u) => u.mfaEnabled)
  const adminsMissingMfa = adminUsers.filter((u) => !u.mfaEnabled)
  const mfaPct = adminUsers.length ? Math.round((adminsWithMfa.length / adminUsers.length) * 100) : 100

  const oldKeys = apiKeys.filter((k) => k.status === 'aktiv' && ageDays(k.createdAt) > 90)
  const bankid = db.data.integrations.find((i) => i.key === 'bankid' && i.organizationId === org)

  let posture = 100
  for (const e of openEvents) {
    posture -= e.riskLevel === 'kritisk' ? 20 : e.riskLevel === 'hög' ? 12 : e.riskLevel === 'medel' ? 6 : 2
  }
  posture -= adminsMissingMfa.length * 6 + oldKeys.length * 4 + activeRateWarnings.length * 3
  posture = Math.max(5, Math.min(100, posture))
  const postureTone: Tone = posture >= 80 ? 'success' : posture >= 55 ? 'warning' : 'danger'
  const postureLabel = posture >= 80 ? 'God status' : posture >= 55 ? 'Se över' : 'Kräver åtgärd'

  const recommendations = [
    {
      label: 'Aktivera MFA för administratörer',
      done: adminsMissingMfa.length === 0,
      hint: adminsMissingMfa.length
        ? `${adminsMissingMfa.length} administratörskonton saknar MFA`
        : 'Alla administratörer har stark inloggning',
    },
    {
      label: 'Åtgärda öppna säkerhetshändelser',
      done: openEvents.length === 0,
      hint: openEvents.length ? `${openEvents.length} händelser väntar på granskning` : 'Inga öppna händelser',
    },
    {
      label: 'Utred misslyckade inloggningar',
      done: unresolvedFails.length === 0,
      hint: unresolvedFails.length ? `${unresolvedFails.length} oåtgärdade inloggningsförsök` : 'Inga oåtgärdade försök',
    },
    {
      label: 'Rotera API-nycklar äldre än 90 dagar',
      done: oldKeys.length === 0,
      hint: oldKeys.length ? `${oldKeys.length} nycklar bör roteras` : 'Alla nycklar är aktuella',
    },
    {
      label: 'Se över begränsade konton och kvoter',
      done: activeRateWarnings.length === 0,
      hint: activeRateWarnings.length ? `${activeRateWarnings.length} aktiva begränsningar` : 'Inga aktiva begränsningar',
    },
    {
      label: 'Aktivera e-legitimation (BankID)',
      done: bankid?.status === 'aktiv',
      hint: bankid?.status === 'aktiv' ? 'Aktiverad' : 'Kräver avtal innan aktivering',
    },
  ]

  // --- Åtgärder (auktoriseras i tjänstelagret) ---
  function flashError(e: unknown) {
    if (e instanceof ForbiddenError || e instanceof RateLimitedError) setFlash({ tone: 'danger', msg: e.message })
    else setFlash({ tone: 'danger', msg: 'Åtgärden kunde inte slutföras just nu.' })
  }

  function runEventAction(eventId: string, kind: EventActionKind) {
    try {
      actOnSecurityEvent(principal, eventId, kind)
      setFlash({ tone: 'success', msg: EVENT_ACTION_META[kind].done })
      bump()
    } catch (e) {
      flashError(e)
    }
  }

  function terminateSession(s: DeviceSession) {
    try {
      authorizeSessionRevoke(principal, `${s.device} · ${s.ip}`)
      setSessions((list) => list.filter((x) => x.id !== s.id))
      setFlash({ tone: 'success', msg: `Sessionen på ${s.device} har avslutats.` })
    } catch (e) {
      flashError(e)
    }
  }

  function rotateKey(k: ApiKey) {
    try {
      authorizeKeyAction(principal, k.name, 'rotera')
      const now = new Date().toISOString()
      setApiKeys((list) =>
        list.map((x) =>
          x.id === k.id ? { ...x, prefix: rotatedPrefix(x.environment), createdAt: now, lastUsedAt: now } : x,
        ),
      )
      setFlash({ tone: 'success', msg: `Nyckeln «${k.name}» har roterats. Uppdatera din integration.` })
    } catch (e) {
      flashError(e)
    }
  }

  function revokeKey(k: ApiKey) {
    try {
      authorizeKeyAction(principal, k.name, 'aterkalla')
      setApiKeys((list) => list.map((x) => (x.id === k.id ? { ...x, status: 'aterkallad' } : x)))
      setFlash({ tone: 'info', msg: `Nyckeln «${k.name}» har återkallats.` })
    } catch (e) {
      flashError(e)
    }
  }

  function rotateWebhook(w: WebhookEndpoint) {
    try {
      authorizeWebhookRotation(principal, w.url)
      setWebhooks((list) =>
        list.map((x) =>
          x.id === w.id ? { ...x, signatureStatus: 'verifierad', secretRotatedAt: new Date().toISOString() } : x,
        ),
      )
      setFlash({ tone: 'success', msg: 'Signeringshemligheten har roterats.' })
    } catch (e) {
      flashError(e)
    }
  }

  function runExport() {
    setExporting(true)
    try {
      exportSecurityReport(principal)
      setFlash({ tone: 'success', msg: 'Säkerhetsrapport köad (klass 6). Skyddad data filtreras bort.' })
    } catch (e) {
      flashError(e)
    } finally {
      setExporting(false)
    }
  }

  const tabs: { value: TabKey; label: string; icon: string; count?: number }[] = [
    { value: 'oversikt', label: 'Översikt', icon: 'LayoutDashboard' },
    { value: 'handelser', label: 'Händelser', icon: 'ShieldAlert', count: openEvents.length },
    { value: 'sessioner', label: 'Sessioner & enheter', icon: 'MonitorSmartphone', count: sessions.length },
    { value: 'nycklar', label: 'API-nycklar', icon: 'KeyRound', count: apiKeys.filter((k) => k.status === 'aktiv').length },
  ]

  return (
    <>
      <PageHeader
        title="Säkerhetscenter"
        icon="ShieldCheck"
        subtitle="Övervaka händelser, sessioner och nycklar. Säkerhetsdata klassas som klass 6."
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex">
              <ClassificationBadge level={6} />
            </span>
            {canExport && (
              <Button variant="secondary" size="sm" icon="Download" loading={exporting} onClick={runExport}>
                Exportera rapport
              </Button>
            )}
          </div>
        }
      />

      {flash && <FlashBanner flash={flash} onClose={() => setFlash(null)} />}

      <div className="mb-5">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {tab === 'oversikt' && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Öppna säkerhetshändelser"
              value={openEvents.length}
              icon="ShieldAlert"
              tone={openEvents.length ? 'danger' : 'success'}
              hint={`${events.length} loggade totalt`}
              onClick={() => setTab('handelser')}
            />
            <StatCard
              label="Misslyckade inloggningar"
              value={failedLogins.length}
              icon="ShieldX"
              tone={unresolvedFails.length ? 'warning' : 'neutral'}
              hint={unresolvedFails.length ? `${unresolvedFails.length} oåtgärdade` : 'Inga oåtgärdade'}
            />
            <StatCard
              label="Aktiva sessioner"
              value={sessions.length}
              icon="MonitorSmartphone"
              tone="primary"
              hint="Klicka för att hantera"
              onClick={() => setTab('sessioner')}
            />
            <Card className="flex items-center gap-4 p-4">
              <ProgressRing
                value={mfaPct}
                tone={mfaPct >= 100 ? 'success' : mfaPct >= 60 ? 'warning' : 'danger'}
                sublabel="MFA"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">MFA-status</p>
                <p className="text-2xs text-ink-subtle">
                  {adminsWithMfa.length} av {adminUsers.length} administratörer
                </p>
                {adminsMissingMfa.length > 0 && (
                  <Badge tone="warning" className="mt-1">
                    {adminsMissingMfa.length} saknar MFA
                  </Badge>
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Säkerhetsrekommendationer"
                icon="ListChecks"
                subtitle="Prioriterade åtgärder för att stärka skyddet."
                action={
                  <div className="flex items-center gap-2.5">
                    <ProgressRing value={posture} size={44} stroke={5} tone={postureTone} />
                    <StatusBadge tone={postureTone} label={postureLabel} />
                  </div>
                }
              />
              <CardBody>
                <Checklist items={recommendations} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Kvoter & gränser" icon="Gauge" subtitle="Aktiva begränsningar från kostnadsskyddet." />
              <CardBody className="space-y-3.5">
                {activeRateWarnings.length === 0 ? (
                  <p className="text-sm text-ink-subtle">Inga aktiva begränsningar just nu.</p>
                ) : (
                  activeRateWarnings.map((r) => (
                    <div key={r.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-2xs text-ink">{r.dimension}</span>
                        <StatusBadge tone={RATE_STATE_TONE[r.state]} label={RATE_LIMIT_STATE_LABEL[r.state]} />
                      </div>
                      <ProgressBar
                        className="mt-1.5"
                        value={Math.min(100, Math.round((r.count / r.limit) * 100))}
                        tone={RATE_STATE_TONE[r.state]}
                        showValue
                      />
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {r.scope} · {r.count}/{r.limit} {r.windowLabel}
                      </p>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Senaste säkerhetshändelser"
              icon="Activity"
              action={
                <Button variant="ghost" size="sm" iconRight="ChevronRight" onClick={() => setTab('handelser')}>
                  Alla händelser
                </Button>
              }
            />
            <CardBody className="space-y-2.5">
              {events.length === 0 ? (
                <p className="text-sm text-ink-subtle">Inga registrerade händelser.</p>
              ) : (
                events.slice(0, 5).map((e) => (
                  <EventLine key={e.id} event={e} protectedClearance={principal.protectedClearance} />
                ))
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'handelser' && (
        <EventsTab
          events={events}
          canUpdate={canUpdate}
          protectedClearance={principal.protectedClearance}
          onAction={runEventAction}
        />
      )}

      {tab === 'sessioner' && (
        <SessionsTab
          sessions={sessions}
          newDeviceEvents={newDeviceEvents}
          canUpdate={canUpdate}
          protectedClearance={principal.protectedClearance}
          onTerminate={terminateSession}
        />
      )}

      {tab === 'nycklar' && (
        <KeysTab
          apiKeys={apiKeys}
          webhooks={webhooks}
          canUpdate={canUpdate}
          onRotate={rotateKey}
          onRevoke={revokeKey}
          onRotateWebhook={rotateWebhook}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Delkomponenter
// ---------------------------------------------------------------------------

function FlashBanner({ flash, onClose }: { flash: NonNullable<Flash>; onClose: () => void }) {
  return (
    <div className={cn('mb-4 flex items-center gap-2 rounded-field border px-3 py-2 text-sm', FLASH_CLASSES[flash.tone])}>
      <Icon
        name={flash.tone === 'success' ? 'CheckCircle2' : flash.tone === 'info' ? 'Info' : 'TriangleAlert'}
        className="h-4 w-4 shrink-0"
      />
      <span className="flex-1">{flash.msg}</span>
      <button onClick={onClose} aria-label="Stäng" className="opacity-70 transition-opacity hover:opacity-100">
        <Icon name="X" className="h-4 w-4" />
      </button>
    </div>
  )
}

function EventLine({ event, protectedClearance }: { event: SecurityEvent; protectedClearance: boolean }) {
  const meta = SECURITY_EVENT_META[event.type]
  const risk = RISK_META[event.riskLevel]
  const { label: userLabel } = displayUser(event.userId, protectedClearance)
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field" style={chipStyle(risk.tone)}>
        <Icon name={meta.icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{meta.label}</p>
        <p className="truncate text-2xs text-ink-subtle">
          {event.description} · {userLabel}
        </p>
      </div>
      <StatusBadge tone={risk.tone} label={risk.label} />
      {!event.resolved && <Badge tone="warning">Öppen</Badge>}
    </div>
  )
}

type EventFilter = 'alla' | 'oppna' | 'losta' | 'hog'

function EventsTab({
  events,
  canUpdate,
  protectedClearance,
  onAction,
}: {
  events: SecurityEvent[]
  canUpdate: boolean
  protectedClearance: boolean
  onAction: (id: string, kind: EventActionKind) => void
}) {
  const [filter, setFilter] = useState<EventFilter>('alla')

  const rows = events.map((event) => ({ event, ...displayUser(event.userId, protectedClearance) }))
  const counts = {
    alla: rows.length,
    oppna: rows.filter((r) => !r.event.resolved).length,
    losta: rows.filter((r) => r.event.resolved).length,
    hog: rows.filter((r) => r.event.riskLevel === 'hög' || r.event.riskLevel === 'kritisk').length,
  }
  const filtered = rows.filter((r) =>
    filter === 'alla'
      ? true
      : filter === 'oppna'
        ? !r.event.resolved
        : filter === 'losta'
          ? r.event.resolved
          : r.event.riskLevel === 'hög' || r.event.riskLevel === 'kritisk',
  )
  const anyMasked = filtered.some((r) => r.masked)

  const filterTabs: { value: EventFilter; label: string; count?: number }[] = [
    { value: 'alla', label: 'Alla', count: counts.alla },
    { value: 'oppna', label: 'Öppna', count: counts.oppna },
    { value: 'losta', label: 'Åtgärdade', count: counts.losta },
    { value: 'hog', label: 'Hög risk', count: counts.hog },
  ]

  return (
    <Card>
      <div className="px-2 pt-1 sm:px-4">
        <Tabs value={filter} onChange={setFilter} tabs={filterTabs} />
      </div>

      {anyMasked && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-2xs text-warning">
          <Icon name="ShieldAlert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Skyddad identitet förekommer – namn maskeras. Behandla uppgifterna varsamt.</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="ShieldCheck"
          title="Inga händelser att visa"
          description="Det finns inga säkerhetshändelser med det valda filtret."
        />
      ) : (
        <div className="divide-y divide-border/70 px-1 py-1">
          {filtered.map(({ event, label, masked }) => {
            const meta = SECURITY_EVENT_META[event.type]
            const risk = RISK_META[event.riskLevel]
            return (
              <div key={event.id} className="flex items-start gap-3 px-3 py-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-field" style={chipStyle(risk.tone)}>
                  <Icon name={meta.icon} className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{meta.label}</span>
                    <StatusBadge tone={risk.tone} label={risk.label} />
                    {event.resolved ? (
                      <Badge tone="success" icon="Check">
                        Åtgärdad
                      </Badge>
                    ) : (
                      <Badge tone="warning" dot>
                        Öppen
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{event.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-subtle">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="Clock" className="h-3 w-3" /> {fmtRelative(event.at)}
                    </span>
                    {event.ip && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="Globe" className="h-3 w-3" /> {event.ip}
                      </span>
                    )}
                    {event.device && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="Monitor" className="h-3 w-3" /> {event.device}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Icon name="User" className="h-3 w-3" /> {label}
                      {masked && (
                        <span title="Skyddad identitet – maskerad">
                          <Icon name="ShieldAlert" className="h-3 w-3 text-warning" />
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                {canUpdate && (
                  <Popover
                    align="end"
                    width="w-56"
                    trigger={<Button variant="ghost" size="icon" icon="MoreVertical" aria-label="Åtgärder" />}
                  >
                    {(close) => (
                      <>
                        {EVENT_ACTION_ORDER.map((kind) => {
                          const m = EVENT_ACTION_META[kind]
                          return (
                            <MenuItem
                              key={kind}
                              icon={m.icon}
                              danger={m.danger}
                              onClick={() => {
                                onAction(event.id, kind)
                                close()
                              }}
                            >
                              {m.label}
                            </MenuItem>
                          )
                        })}
                      </>
                    )}
                  </Popover>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function SessionsTab({
  sessions,
  newDeviceEvents,
  canUpdate,
  protectedClearance,
  onTerminate,
}: {
  sessions: DeviceSession[]
  newDeviceEvents: SecurityEvent[]
  canUpdate: boolean
  protectedClearance: boolean
  onTerminate: (s: DeviceSession) => void
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Aktiva sessioner"
          icon="MonitorSmartphone"
          subtitle="Enheter som är inloggade. Avsluta sessioner du inte känner igen."
        />
        <CardBody className="space-y-2">
          {sessions.length === 0 ? (
            <EmptyState icon="MonitorCheck" title="Inga aktiva sessioner" description="Alla sessioner har avslutats." />
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-field border border-border p-3">
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-field',
                    s.trusted ? 'bg-primary-soft text-primary' : 'bg-warning-soft text-warning',
                  )}
                >
                  <Icon name={s.icon} className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{s.device}</span>
                    {s.current && (
                      <Badge tone="primary" dot>
                        Denna enhet
                      </Badge>
                    )}
                    {s.trusted ? (
                      <Badge tone="success" icon="ShieldCheck">
                        Betrodd
                      </Badge>
                    ) : (
                      <Badge tone="warning" icon="ShieldQuestion">
                        Ny enhet
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    {s.platform} · {s.ip} · {s.location}
                  </p>
                  <p className="text-2xs text-ink-subtle">Senast aktiv {fmtRelative(s.lastActiveAt)}</p>
                </div>
                {s.current ? (
                  <span className="shrink-0 text-2xs font-medium text-success">Aktiv nu</span>
                ) : (
                  canUpdate && (
                    <Button variant="secondary" size="sm" icon="LogOut" onClick={() => onTerminate(s)}>
                      Avsluta
                    </Button>
                  )
                )}
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Nya enheter" icon="Smartphone" subtitle="Upptäckta enheter från säkerhetsloggen." />
        <CardBody className="space-y-2">
          {newDeviceEvents.length === 0 ? (
            <p className="text-sm text-ink-subtle">Inga nya enheter registrerade.</p>
          ) : (
            newDeviceEvents.map((e) => {
              const { label } = displayUser(e.userId, protectedClearance)
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-field border border-border p-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                    <Icon name="Smartphone" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{e.device ?? 'Ny enhet'}</p>
                    <p className="truncate text-2xs text-ink-subtle">
                      {e.ip ?? 'okänd IP'} · {label} · {fmtRelative(e.at)}
                    </p>
                  </div>
                  {e.resolved ? (
                    <Badge tone="success" icon="Check">
                      Godkänd
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      Ny
                    </Badge>
                  )}
                </div>
              )
            })
          )}
        </CardBody>
      </Card>
    </div>
  )
}

const SIGNATURE_META: Record<WebhookEndpoint['signatureStatus'], { tone: Tone; label: string; icon: string }> = {
  verifierad: { tone: 'success', label: 'Signatur verifierad', icon: 'ShieldCheck' },
  saknar_hemlighet: { tone: 'warning', label: 'Saknar hemlighet', icon: 'ShieldQuestion' },
  fel: { tone: 'danger', label: 'Signaturfel', icon: 'ShieldX' },
}

function KeysTab({
  apiKeys,
  webhooks,
  canUpdate,
  onRotate,
  onRevoke,
  onRotateWebhook,
}: {
  apiKeys: ApiKey[]
  webhooks: WebhookEndpoint[]
  canUpdate: boolean
  onRotate: (k: ApiKey) => void
  onRevoke: (k: ApiKey) => void
  onRotateWebhook: (w: WebhookEndpoint) => void
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="API-nycklar"
          icon="KeyRound"
          subtitle="Nycklar för integrationer. Rotera regelbundet och återkalla oanvända nycklar."
        />
        <CardBody className="space-y-2">
          {apiKeys.map((k) => {
            const revoked = k.status === 'aterkallad'
            const old = !revoked && ageDays(k.createdAt) > 90
            return (
              <div key={k.id} className={cn('rounded-field border border-border p-3', revoked && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{k.name}</span>
                      <Badge tone={k.environment === 'live' ? 'primary' : 'neutral'}>
                        {k.environment === 'live' ? 'Produktion' : 'Test'}
                      </Badge>
                      {revoked ? (
                        <Badge tone="danger" icon="Ban">
                          Återkallad
                        </Badge>
                      ) : old ? (
                        <Badge tone="warning" icon="Clock">
                          Bör roteras
                        </Badge>
                      ) : (
                        <Badge tone="success" dot>
                          Aktiv
                        </Badge>
                      )}
                    </div>
                    <code className="mt-1 block font-mono text-2xs text-ink-muted">{k.prefix}</code>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {k.scopes.map((sc) => (
                        <span
                          key={sc}
                          className="inline-flex items-center rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-2xs text-ink-muted"
                        >
                          {sc}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-2xs text-ink-subtle">
                      Skapad {fmtRelative(k.createdAt)} · Senast använd {k.lastUsedAt ? fmtRelative(k.lastUsedAt) : 'aldrig'}
                    </p>
                  </div>
                  {canUpdate && !revoked && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="secondary" size="sm" icon="RefreshCw" onClick={() => onRotate(k)}>
                        Rotera
                      </Button>
                      <Popover
                        align="end"
                        width="w-52"
                        trigger={<Button variant="ghost" size="icon" icon="MoreVertical" aria-label="Fler åtgärder" />}
                      >
                        {(close) => (
                          <MenuItem
                            icon="Ban"
                            danger
                            onClick={() => {
                              onRevoke(k)
                              close()
                            }}
                          >
                            Återkalla nyckel
                          </MenuItem>
                        )}
                      </Popover>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Webhooks & signering"
          icon="Webhook"
          subtitle="Utgående webhooks signeras med HMAC. Verifiera signaturstatus och rotera hemligheter."
        />
        <CardBody className="space-y-2">
          {webhooks.map((w) => {
            const sig = SIGNATURE_META[w.signatureStatus]
            return (
              <div key={w.id} className="rounded-field border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <code className="block break-all font-mono text-2xs text-ink">{w.url}</code>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={sig.tone} label={sig.label} icon={sig.icon} />
                      <span className="text-2xs text-ink-subtle">Hemlighet roterad {fmtRelative(w.secretRotatedAt)}</span>
                    </div>
                    <p className="mt-1 text-2xs text-ink-subtle">
                      Senaste leverans {w.lastDeliveryAt ? fmtRelative(w.lastDeliveryAt) : '—'} · {w.events.join(', ')}
                    </p>
                  </div>
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="RefreshCw"
                      className="shrink-0"
                      onClick={() => onRotateWebhook(w)}
                    >
                      Rotera hemlighet
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardBody>
      </Card>
    </div>
  )
}
