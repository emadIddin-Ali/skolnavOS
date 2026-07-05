import { useState } from 'react'
import type { Integration, IntegrationStatus } from '@/data/schema'
import { INTEGRATION_STATUS_LABEL } from '@/data/schema'
import type { Principal } from '@/core/permissions/engine'
import { runsFor } from '@/core/integrations/registry'
import { Modal, Button, StatusBadge, ProgressBar, Checklist, Icon } from '@/ui'
import { fmtRelative, fmtNumber, fmtDateTime } from '@/lib/format'
import {
  CATEGORY_META,
  STATUS_TONE,
  STATUS_ICON,
  RUN_TONE,
  RUN_LABEL,
  isOperational,
  needsAction,
  missingRequirement,
  usageRatio,
  usageTone,
} from './meta'
import { changeStatus, saveConfiguration, runTest, type ActionResult } from './service'

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/** Detaljvy för en integration: status, kvoter, integritet, körningar och åtgärder. */
export function IntegrationDetail({
  integration,
  principal,
  canUpdate,
  onClose,
  onChanged,
}: {
  integration: Integration
  principal: Principal
  canUpdate: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [feedback, setFeedback] = useState<ActionResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  const cat = CATEGORY_META[integration.category]
  const ratio = usageRatio(integration)
  const missing = missingRequirement(integration)
  const setup = integration.status.startsWith('kraver_')
  const operational = isOperational(integration.status)
  const runs = runsFor(integration.id)

  function apply(res: ActionResult) {
    setFeedback(res)
    if (res.ok) onChanged()
  }

  function handleStatus(next: IntegrationStatus) {
    apply(changeStatus(principal, integration, next))
  }

  function handleSaveConfig() {
    if (setup) {
      apply(changeStatus(principal, integration, 'inaktiv'))
    } else {
      apply(saveConfiguration(principal, integration))
    }
    setConfigOpen(false)
  }

  async function handleTest() {
    setTesting(true)
    const res = await runTest(principal, integration)
    setTesting(false)
    apply(res)
  }

  const requirements = [
    { label: 'Avtal med leverantör klart', done: integration.status !== 'kraver_avtal' },
    { label: 'API-nyckel / behörighet registrerad', done: integration.status !== 'kraver_nyckel' },
    { label: 'Konfiguration ifylld', done: integration.status !== 'kraver_konfiguration' },
    { label: 'Anslutning testad', done: integration.lastSyncAt != null, hint: integration.lastSyncAt ? `Senast ${fmtRelative(integration.lastSyncAt)}` : 'Kör ett anslutningstest' },
  ]

  const footer = canUpdate ? (
    <>
      <Button variant="ghost" onClick={onClose}>Stäng</Button>
      <Button variant="secondary" icon="PlugZap" loading={testing} onClick={handleTest}>
        Testa anslutning
      </Button>
      {operational ? (
        <Button variant="secondary" icon="Pause" onClick={() => handleStatus('pausad')}>Pausa</Button>
      ) : integration.status === 'kommande' ? (
        <Button icon="Power" disabled title="Släpps i en kommande version">Aktivera</Button>
      ) : (
        <Button
          icon="Power"
          disabled={setup}
          title={setup ? 'Slutför konfigurationen först' : undefined}
          onClick={() => handleStatus('aktiv')}
        >
          Aktivera
        </Button>
      )}
    </>
  ) : (
    <Button variant="secondary" onClick={onClose}>Stäng</Button>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={integration.name}
      description={`${cat.label} · Motor: ${integration.vendorHint}`}
      size="lg"
      footer={footer}
    >
      <div className="space-y-5 py-1">
        {/* Åtgärds- och testresultat */}
        {feedback && (
          <div
            className="flex items-start gap-2 rounded-field border px-3 py-2 text-sm"
            style={{
              color: `rgb(var(--c-${feedback.ok ? 'success' : 'danger'}))`,
              backgroundColor: `rgb(var(--c-${feedback.ok ? 'success' : 'danger'}) / 0.1)`,
              borderColor: `rgb(var(--c-${feedback.ok ? 'success' : 'danger'}) / 0.25)`,
            }}
            role="status"
          >
            <Icon name={feedback.ok ? 'CheckCircle2' : 'TriangleAlert'} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Status */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={STATUS_TONE[integration.status]}
            icon={STATUS_ICON[integration.status]}
            label={INTEGRATION_STATUS_LABEL[integration.status]}
          />
          <span className="text-2xs text-ink-subtle">
            {integration.lastSyncAt ? `Senaste synk ${fmtRelative(integration.lastSyncAt)}` : 'Ingen synk ännu'}
          </span>
        </div>

        {/* Setup-status: exakt vad som saknas + säker lokal reserv */}
        {needsAction(integration.status) && missing && (
          <div className="rounded-field border border-warning/30 bg-warning-soft/60 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <Icon name="TriangleAlert" className="h-4 w-4 shrink-0" />
              Kräver åtgärd: {missing}
            </p>
            {integration.fallback && (
              <p className="mt-1.5 flex items-start gap-2 text-sm text-ink-muted">
                <Icon name="ShieldCheck" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                Tills vidare används en säker lokal reserv: {integration.fallback}
              </p>
            )}
          </div>
        )}

        {/* Användning */}
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Användning</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-field border border-border p-3">
              <p className="text-2xs text-ink-subtle">Idag</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {fmtNumber(integration.usageDay)}
                {integration.quotaDay != null && <span className="text-sm font-normal text-ink-subtle"> / {fmtNumber(integration.quotaDay)}</span>}
              </p>
              {ratio != null ? (
                <ProgressBar value={ratio} tone={usageTone(ratio)} className="mt-2" showValue />
              ) : (
                <p className="mt-2 text-2xs text-ink-subtle">Ingen dagskvot satt</p>
              )}
            </div>
            <div className="rounded-field border border-border p-3">
              <p className="text-2xs text-ink-subtle">Denna månad</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{fmtNumber(integration.usageMonth)}</p>
              <p className="mt-2 text-2xs text-ink-subtle">Ackumulerade anrop</p>
            </div>
          </div>
        </section>

        {/* Integritet & data */}
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Integritet & säkerhet</h3>
          <dl className="space-y-2 rounded-field border border-border p-3 text-sm">
            <div className="flex gap-2">
              <dt className="flex w-32 shrink-0 items-center gap-1.5 text-ink-subtle"><Icon name="Database" className="h-3.5 w-3.5" />Data som berörs</dt>
              <dd className="text-ink">{integration.dataTouched || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="flex w-32 shrink-0 items-center gap-1.5 text-ink-subtle"><Icon name="ShieldCheck" className="h-3.5 w-3.5" />Integritet</dt>
              <dd className="text-ink">{integration.privacyNote || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="flex w-32 shrink-0 items-center gap-1.5 text-ink-subtle"><Icon name="LifeBuoy" className="h-3.5 w-3.5" />Reserv vid fel</dt>
              <dd className="text-ink">{integration.fallback || '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Konfiguration & krav */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Konfiguration & krav</h3>
            {canUpdate && (
              <Button variant="ghost" size="sm" icon="Settings2" onClick={() => setConfigOpen((v) => !v)}>
                Konfigurera
              </Button>
            )}
          </div>
          <div className="rounded-field border border-border p-3">
            <Checklist items={requirements} />
            {configOpen && canUpdate && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-2xs text-ink-muted">
                  {setup
                    ? 'När kraven är uppfyllda markeras integrationen som konfigurerad och kan aktiveras.'
                    : 'Spara för att bekräfta aktuell konfiguration. Ändringen loggas i granskningsloggen.'}
                </p>
                <Button size="sm" icon="Save" className="mt-2" onClick={handleSaveConfig}>
                  {setup ? 'Slutför konfiguration' : 'Spara konfiguration'}
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* Senaste körningar */}
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Senaste körningar</h3>
          {runs.length === 0 ? (
            <p className="rounded-field border border-dashed border-border px-3 py-4 text-center text-sm text-ink-subtle">
              Inga körningar registrerade än.
            </p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id} className="flex items-start gap-3 rounded-field border border-border p-3">
                  <StatusBadge tone={RUN_TONE[r.status]} label={RUN_LABEL[r.status]} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{r.message || 'Körning'}</p>
                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      {fmtDateTime(r.startedAt)} · {fmtNumber(r.itemsProcessed)} poster · {fmtDuration(r.durationMs)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!canUpdate && (
          <p className="flex items-center gap-1.5 text-2xs text-ink-subtle">
            <Icon name="Lock" className="h-3.5 w-3.5" />
            Skrivskyddad vy – du kan granska men inte ändra integrationer.
          </p>
        )}
      </div>
    </Modal>
  )
}
