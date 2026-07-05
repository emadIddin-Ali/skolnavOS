import type { Integration } from '@/data/schema'
import { INTEGRATION_STATUS_LABEL } from '@/data/schema'
import { Card, StatusBadge, ProgressBar, Icon } from '@/ui'
import { fmtRelative, fmtNumber } from '@/lib/format'
import {
  CATEGORY_META,
  STATUS_TONE,
  STATUS_ICON,
  needsAction,
  missingRequirement,
  usageRatio,
  usageTone,
} from './meta'

/** Ett integrationskort i rutnätet. Klick öppnar detaljvyn. */
export function IntegrationCard({ integration, onOpen }: { integration: Integration; onOpen: (i: Integration) => void }) {
  const cat = CATEGORY_META[integration.category]
  const ratio = usageRatio(integration)
  const missing = missingRequirement(integration)
  const attention = needsAction(integration.status)

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(integration)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(integration)
        }
      }}
      className="flex h-full cursor-pointer flex-col p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
            <Icon name={cat.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{integration.name}</p>
            <p className="mt-0.5 text-2xs text-ink-subtle">{cat.label}</p>
          </div>
        </div>
        <StatusBadge
          tone={STATUS_TONE[integration.status]}
          icon={STATUS_ICON[integration.status]}
          label={INTEGRATION_STATUS_LABEL[integration.status]}
        />
      </div>

      {/* Diskret motor-hint (endast synlig i administrativ vy) */}
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-subtle">
        <Icon name="Cpu" className="h-3 w-3" />
        Motor: {integration.vendorHint}
      </p>

      {/* Setup-status när något saknas + säker lokal reserv */}
      {attention && missing && (
        <div className="mt-3 rounded-field border border-warning/30 bg-warning-soft/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-2xs font-medium text-warning">
            <Icon name="TriangleAlert" className="h-3.5 w-3.5 shrink-0" />
            {missing}
          </p>
          {integration.fallback && (
            <p className="mt-1 flex items-start gap-1.5 text-2xs text-ink-muted">
              <Icon name="ShieldCheck" className="mt-px h-3 w-3 shrink-0 text-success" />
              Säker lokal reserv: {integration.fallback}
            </p>
          )}
        </div>
      )}

      {/* Användningsmätare mot dagskvot */}
      {ratio != null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-2xs text-ink-muted">
            <span>Användning idag</span>
            <span className="tabular-nums">
              {fmtNumber(integration.usageDay)} / {fmtNumber(integration.quotaDay ?? 0)}
            </span>
          </div>
          <ProgressBar value={ratio} tone={usageTone(ratio)} />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-2xs text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <Icon name="RefreshCw" className="h-3 w-3" />
          {integration.lastSyncAt ? fmtRelative(integration.lastSyncAt) : 'Aldrig synkad'}
        </span>
        <Icon name="ChevronRight" className="h-4 w-4" />
      </div>
    </Card>
  )
}
