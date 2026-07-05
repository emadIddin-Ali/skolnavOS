import { useMemo, useState } from 'react'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { listIntegrations } from '@/core/integrations/registry'
import type { Integration } from '@/data/schema'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, Tabs, Select, TextInput,
  Badge, Icon, EmptyState, DeniedState,
} from '@/ui'
import {
  CATEGORY_META,
  isOperational,
  groupOf,
  needsAction,
  missingRequirement,
  type IntegrationCategory,
  type StatusGroup,
} from './meta'
import { IntegrationCard } from './IntegrationCard'
import { IntegrationDetail } from './IntegrationDetail'

const GROUP_ORDER: StatusGroup[] = ['alla', 'aktiv', 'atgard', 'vilande']
const GROUP_LABEL: Record<StatusGroup, string> = {
  alla: 'Alla',
  aktiv: 'I drift',
  atgard: 'Kräver åtgärd',
  vilande: 'Vilande',
}
const GROUP_ICON: Record<StatusGroup, string> = {
  alla: 'LayoutGrid',
  aktiv: 'CheckCircle2',
  atgard: 'TriangleAlert',
  vilande: 'Power',
}

export function IntegrationsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'integration')
  const canUpdate = useCan('update', 'integration')

  const [refresh, setRefresh] = useState(0)
  const [group, setGroup] = useState<StatusGroup>('alla')
  const [category, setCategory] = useState<'alla' | IntegrationCategory>('alla')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const all = useMemo(
    () => listIntegrations(principal.organizationId),
    [principal.organizationId, refresh],
  )

  // Kategorier som faktiskt finns i datan (för filtret).
  const categories = useMemo(() => {
    const present = new Set(all.map((i) => i.category))
    return (Object.keys(CATEGORY_META) as IntegrationCategory[]).filter((c) => present.has(c))
  }, [all])

  // Bas för filtret: kategori + fritext (statusflikarna räknas ovanpå denna).
  const base = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (i) =>
        (category === 'alla' || i.category === category) &&
        (q === '' || `${i.name} ${i.vendorHint} ${CATEGORY_META[i.category].label}`.toLowerCase().includes(q)),
    )
  }, [all, category, query])

  const groupCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = { alla: base.length, aktiv: 0, atgard: 0, vilande: 0 }
    for (const i of base) counts[groupOf(i.status)] += 1
    return counts
  }, [base])

  const filtered = useMemo(
    () => base.filter((i) => group === 'alla' || groupOf(i.status) === group),
    [base, group],
  )

  const summary = useMemo(() => {
    let aktiva = 0
    let atgard = 0
    let fel = 0
    let vilande = 0
    for (const i of all) {
      if (isOperational(i.status)) aktiva += 1
      else if (i.status === 'fel') fel += 1
      else if (i.status.startsWith('kraver_')) atgard += 1
      else vilande += 1
    }
    return { aktiva, atgard, fel, vilande, total: all.length }
  }, [all])

  const attentionItems = useMemo(() => all.filter((i) => needsAction(i.status)), [all])

  const selected = selectedId ? all.find((i) => i.id === selectedId) ?? null : null

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Integrationer" icon="Plug" subtitle="Anslutna tjänster i Skolnav" />
        <Card><DeniedState reason={readDecision.reason} /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Integrationer"
        icon="Plug"
        subtitle="Anslutna tjänster som fungerar som en native del av Skolnav. Vid otillgänglighet används alltid en säker lokal reserv."
      />

      {/* Sammanfattning */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="I drift" value={summary.aktiva} icon="CheckCircle2" tone="success" hint={`av ${summary.total} integrationer`} />
        <StatCard label="Kräver åtgärd" value={summary.atgard} icon="Wrench" tone={summary.atgard ? 'warning' : 'neutral'} hint="Avtal, nyckel eller konfiguration saknas" />
        <StatCard label="Fel" value={summary.fel} icon="TriangleAlert" tone={summary.fel ? 'danger' : 'neutral'} hint="Senaste körning misslyckades" />
        <StatCard label="Vilande" value={summary.vilande} icon="Power" tone="neutral" hint="Inaktiva, pausade eller kommande" />
      </div>

      {/* Kräver åtgärd – native setup-status med säker lokal reserv */}
      {attentionItems.length > 0 && (
        <Card className="mb-6 border-warning/40">
          <CardHeader
            title="Behöver din uppmärksamhet"
            subtitle="Säker lokal reserv används tills tjänsten är konfigurerad – ingen funktion är blockerad."
            icon="TriangleAlert"
          />
          <CardBody className="space-y-2">
            {attentionItems.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className="flex w-full items-start gap-3 rounded-field border border-border p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-warning-soft text-warning">
                  <Icon name={CATEGORY_META[i.category].icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{i.name}</span>
                    <Badge tone="warning">{missingRequirement(i)}</Badge>
                  </span>
                  {i.fallback && (
                    <span className="mt-0.5 block text-2xs text-ink-muted">
                      Reserv i drift: {i.fallback}
                    </span>
                  )}
                </span>
                <Icon name="ChevronRight" className="mt-1 h-4 w-4 shrink-0 text-ink-subtle" />
              </button>
            ))}
          </CardBody>
        </Card>
      )}

      {/* Filter */}
      <div className="mb-4 space-y-3">
        <Tabs
          value={group}
          onChange={setGroup}
          tabs={GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g], icon: GROUP_ICON[g], count: groupCounts[g] }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextInput
            icon="Search"
            placeholder="Sök integration eller motor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
            aria-label="Sök integration"
          />
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'alla' | IntegrationCategory)}
            className="sm:w-56"
            aria-label="Filtrera på kategori"
          >
            <option value="alla">Alla kategorier</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_META[c].label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Rutnät */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="SearchX"
            title="Inga integrationer matchar filtret"
            description="Justera status, kategori eller sökord för att se fler."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((i: Integration) => (
            <IntegrationCard key={i.id} integration={i} onOpen={(x) => setSelectedId(x.id)} />
          ))}
        </div>
      )}

      {selected && (
        <IntegrationDetail
          key={selected.id}
          integration={selected}
          principal={principal}
          canUpdate={canUpdate}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefresh((r) => r + 1)}
        />
      )}
    </>
  )
}
