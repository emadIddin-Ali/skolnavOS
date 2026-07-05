import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, Tabs, Button, Badge, Icon,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { listNotifications } from '@/core/notifications/notifications'
import type { NotificationItem } from '@/data/schema'
import { fmtRelative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { CATEGORY_META, CHANNEL_META, DELIVERY_META } from './meta'
import {
  confirmOwnNotification,
  markAllNotificationsRead,
  markNotificationRead,
  retryDelivery,
} from './service'

type TabKey = 'alla' | 'olasta' | 'bekrafta'

const TAB_LABEL: Record<TabKey, string> = {
  alla: 'Alla',
  olasta: 'Olästa',
  bekrafta: 'Kräver bekräftelse',
}

function needsConfirmation(n: NotificationItem): boolean {
  return n.requiresConfirmation && !n.confirmedAt
}

export function NotificationsPage() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const readDecision = usePermission('read', 'notification')

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('alla')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 250)
    return () => clearTimeout(t)
  }, [])

  const items = useMemo(() => {
    void refresh
    return [...listNotifications(principal.userId)].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }, [principal, refresh])

  const counts = useMemo(
    () => ({
      alla: items.length,
      olasta: items.filter((n) => !n.read).length,
      bekrafta: items.filter(needsConfirmation).length,
    }),
    [items],
  )

  const failed = useMemo(() => items.filter((n) => n.deliveryStatus === 'misslyckad'), [items])

  const visible = useMemo(() => {
    if (tab === 'olasta') return items.filter((n) => !n.read)
    if (tab === 'bekrafta') return items.filter(needsConfirmation)
    return items
  }, [items, tab])

  function run(id: string | null, fn: () => void, success?: { title: string; description?: string }) {
    setBusyId(id)
    try {
      fn()
      bump()
      if (success) toast.success(success.title, success.description)
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Något gick fel', 'Åtgärden kunde inte genomföras just nu.')
    } finally {
      setBusyId(null)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Notiser" icon="Bell" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Notiser"
        icon="Bell"
        subtitle="Alla dina aviseringar – med leveransstatus och kvittenser."
        actions={
          <>
            <Button
              variant="secondary"
              icon="Settings"
              onClick={() => navigate('/installningar')}
            >
              Notisinställningar
            </Button>
            <Button
              variant="secondary"
              icon="CheckCheck"
              disabled={counts.olasta === 0}
              title={counts.olasta === 0 ? 'Alla notiser är redan lästa' : undefined}
              onClick={() =>
                run(null, () => markAllNotificationsRead(principal), {
                  title: 'Alla notiser markerade som lästa',
                })
              }
            >
              Markera alla lästa
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Olästa"
          value={counts.olasta}
          icon="Bell"
          tone={counts.olasta ? 'info' : 'neutral'}
        />
        <StatCard
          label="Kräver bekräftelse"
          value={counts.bekrafta}
          icon="BellRing"
          tone={counts.bekrafta ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Misslyckade leveranser"
          value={failed.length}
          icon="TriangleAlert"
          tone={failed.length ? 'danger' : 'neutral'}
        />
      </div>

      {failed.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            icon="TriangleAlert"
            title="Misslyckade leveranser"
            subtitle="Dessa aviseringar kunde inte levereras till vald kanal."
          />
          <CardBody className="pt-0">
            <ul className="divide-y divide-border rounded-field border border-border">
              {failed.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Icon name={CHANNEL_META[n.channel].icon} className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{n.title}</p>
                    <p className="text-2xs text-ink-subtle">
                      {CHANNEL_META[n.channel].label} · {fmtRelative(n.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="RefreshCw"
                    loading={busyId === `retry-${n.id}`}
                    disabled={busyId !== null}
                    onClick={() =>
                      run(`retry-${n.id}`, () => retryDelivery(principal, n.id), {
                        title: 'Skickad igen',
                        description: `«${n.title}» har levererats på nytt.`,
                      })
                    }
                  >
                    Försök igen
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="px-2 pt-1 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={(['alla', 'olasta', 'bekrafta'] as TabKey[]).map((key) => ({
              value: key,
              label: TAB_LABEL[key],
              count: counts[key],
            }))}
          />
        </div>

        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="BellRing"
            title={
              tab === 'olasta'
                ? 'Inga olästa notiser'
                : tab === 'bekrafta'
                  ? 'Inget väntar på bekräftelse'
                  : 'Inga notiser än'
            }
            description={
              tab === 'alla'
                ? 'När något händer som rör dig visas det här.'
                : 'Bra jobbat – du är ikapp.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((n) => {
              const cat = CATEGORY_META[n.category]
              const chan = CHANNEL_META[n.channel]
              const delivery = DELIVERY_META[n.deliveryStatus]
              return (
                <li key={n.id} className={cn('px-4 py-3.5 sm:px-5', !n.read && 'bg-primary-soft/30')}>
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-field',
                        n.urgent ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-muted',
                      )}
                    >
                      <Icon name={cat.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Oläst" />
                        )}
                        <p className={cn('text-sm text-ink', n.read ? 'font-medium' : 'font-semibold')}>
                          {n.title}
                        </p>
                        {n.urgent && (
                          <Badge tone="danger" icon="TriangleAlert">
                            Viktigt
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone={cat.tone} icon={cat.icon}>{cat.label}</Badge>
                        <Badge tone="neutral" icon={chan.icon}>{chan.label}</Badge>
                        <Badge tone={delivery.tone} icon={delivery.icon}>{delivery.label}</Badge>
                        {n.requiresConfirmation && n.confirmedAt && (
                          <Badge tone="success" icon="Check">
                            Bekräftad {fmtRelative(n.confirmedAt)}
                          </Badge>
                        )}
                        <span className="text-2xs text-ink-subtle">{fmtRelative(n.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                      {needsConfirmation(n) && (
                        <Button
                          size="sm"
                          icon="Check"
                          loading={busyId === `confirm-${n.id}`}
                          disabled={busyId !== null}
                          onClick={() =>
                            run(`confirm-${n.id}`, () => confirmOwnNotification(principal, n.id), {
                              title: 'Bekräftat',
                              description: 'Din kvittens har registrerats.',
                            })
                          }
                        >
                          Bekräfta
                        </Button>
                      )}
                      {!n.read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="Check"
                          disabled={busyId !== null}
                          title="Markera som läst"
                          onClick={() => run(`read-${n.id}`, () => markNotificationRead(principal, n.id))}
                        >
                          Markera läst
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
