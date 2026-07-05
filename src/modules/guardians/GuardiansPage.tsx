import { useMemo, useState } from 'react'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import {
  PageHeader, Card, CardHeader, CardBody, DataTable, StatCard, Segmented, TextInput,
  Button, Badge, StatusBadge, Avatar, Icon, DeniedState, EmptyState,
} from '@/ui'
import type { Column } from '@/ui'
import { maskName } from '@/lib/format'
import { RELATION_TYPE_LABEL } from '@/data/schema'
import {
  visibleGuardians, isConflictRelation, conflictTone, childDisplay, studentById,
  RELATION_TYPE_TONE, RELATION_TYPE_ICON, type GuardianRow,
} from './service'
import { GuardianDetail } from './GuardianDetail'
import { FlowModal, type FlowRequest } from './GuardianFlows'

type Filter = 'alla' | 'konflikt' | 'delad' | 'overifierad'

export function GuardiansPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'guardian')
  const canCreateGuardian = useCan('create', 'guardian')
  const canLink = useCan('create', 'guardian_relation')

  const [tick, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('alla')
  const [openId, setOpenId] = useState<string | null>(null)
  const [flow, setFlow] = useState<FlowRequest | null>(null)
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; msg: string } | null>(null)

  // Behörighetsfiltrerad, alltid aktiv data. Räknas om vid varje mutation (bump).
  const rows = useMemo(
    () => visibleGuardians(principal),
    // Räknas om vid varje mutation via tick.
    [principal, tick],
  )

  const stats = useMemo(() => {
    let verified = 0, conflicts = 0, shared = 0, children = 0
    for (const r of rows) {
      if (r.verified) verified += 1
      if (r.hasConflict) conflicts += 1
      if (r.sharedCustody) shared += 1
      children += r.childCount
    }
    return { total: rows.length, verified, conflicts, shared, children }
  }, [rows])

  const conflictItems = useMemo(() => {
    const items: { row: GuardianRow; relId: string }[] = []
    for (const r of rows) for (const rel of r.relations) if (isConflictRelation(rel)) items.push({ row: r, relId: rel.id })
    return items
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'konflikt' && !r.hasConflict) return false
      if (filter === 'delad' && !r.sharedCustody) return false
      if (filter === 'overifierad' && r.verified) return false
      if (!q) return true
      return `${r.user.name} ${r.user.email}`.toLowerCase().includes(q)
    })
  }, [rows, query, filter])

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Vårdnadshavare & relationer" icon="Heart" />
        <Card><DeniedState reason={readDecision.reason} /></Card>
      </>
    )
  }

  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null

  const columns: Column<GuardianRow>[] = [
    {
      key: 'name',
      header: 'Vårdnadshavare',
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.user.name} color={r.user.avatarColor} protected={r.user.protectedIdentity} />
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{r.user.protectedIdentity ? maskName(r.user.name) : r.user.name}</p>
            <p className="text-2xs text-ink-subtle truncate">{r.user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'children',
      header: 'Barn',
      align: 'center',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-ink">
          <Icon name="Baby" className="h-4 w-4 text-ink-subtle" />
          <span className="tabular-nums">{r.childCount}</span>
        </span>
      ),
    },
    {
      key: 'relations',
      header: 'Relationstyper',
      hideOnMobile: true,
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.relationTypes.map((t) => (
            <Badge key={t} tone={RELATION_TYPE_TONE[t]} icon={RELATION_TYPE_ICON[t]}>{RELATION_TYPE_LABEL[t]}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'verified',
      header: 'Verifierad',
      hideOnMobile: true,
      render: (r) => r.verified
        ? <StatusBadge tone="success" icon="BadgeCheck" label="Verifierad" />
        : <StatusBadge tone="warning" icon="Clock" label="Ej verifierad" />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="flex items-center gap-2">
          {r.hasConflict && <Badge tone="danger" icon="TriangleAlert">Konflikt</Badge>}
          {r.sharedCustody && <Badge tone="info" icon="Users">Delad</Badge>}
          <Icon name="ChevronRight" className="h-4 w-4 text-ink-subtle" />
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Vårdnadshavare & relationer"
        icon="Heart"
        subtitle="Relationsmodell vårdnadshavare ↔ barn: kopplingar, behörigheter och restriktioner"
        actions={
          <div className="flex items-center gap-2">
            {canCreateGuardian && (
              <Button variant="secondary" size="sm" icon="Send" onClick={() => setFlow({ kind: 'invite' })}>Bjud in</Button>
            )}
            {canCreateGuardian && (
              <Button size="sm" icon="UserPlus" onClick={() => setFlow({ kind: 'add' })}>Lägg till vårdnadshavare</Button>
            )}
          </div>
        }
      />

      {/* Nyckeltal */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Vårdnadshavare" value={stats.total} icon="Users" tone="primary" hint={`${stats.children} kopplingar till barn`} />
        <StatCard label="Verifierade" value={stats.verified} icon="BadgeCheck" tone="success" hint={`${stats.total - stats.verified} väntar`} />
        <StatCard label="Med konflikt" value={stats.conflicts} icon="TriangleAlert" tone={stats.conflicts ? 'danger' : 'neutral'} hint="Restriktion eller notering" onClick={stats.conflicts ? () => setFilter('konflikt') : undefined} />
        <StatCard label="Delad vårdnad" value={stats.shared} icon="Split" tone="info" hint="Informeras separat" onClick={stats.shared ? () => setFilter('delad') : undefined} />
      </div>

      {/* Konfliktexempel – lyfts tydligt */}
      {conflictItems.length > 0 && (
        <Card className="mb-6 border-danger/30">
          <CardHeader
            title="Uppmärksamma villkor"
            icon="ShieldAlert"
            subtitle="Relationer med restriktion, delad vårdnad eller notering"
          />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            {conflictItems.slice(0, 6).map(({ row, relId }) => {
              const rel = row.relations.find((x) => x.id === relId)!
              const student = studentById(rel.studentId)
              const child = student ? childDisplay(principal, student) : null
              return (
                <button
                  key={relId}
                  onClick={() => setOpenId(row.id)}
                  className="flex items-start gap-3 rounded-field border border-border p-3 text-left transition-colors hover:bg-surface-2"
                  style={{ borderColor: `rgb(var(--c-${conflictTone(rel)}) / 0.35)` }}
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-field" style={{ backgroundColor: `rgb(var(--c-${conflictTone(rel)}) / 0.14)`, color: `rgb(var(--c-${conflictTone(rel)}))` }}>
                    <Icon name={RELATION_TYPE_ICON[rel.relationType]} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-ink">{row.user.name}</span>
                      <Badge tone={conflictTone(rel)}>{RELATION_TYPE_LABEL[rel.relationType]}</Badge>
                    </span>
                    <span className="block text-2xs text-ink-subtle">
                      {child ? child.name : 'Barn'} · {rel.conflictNote ?? 'Kontrollera vid hämtning och kontakt.'}
                    </span>
                  </span>
                </button>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* Verktygsrad: sök, filter, flöden */}
      <Card className="mb-4">
        <CardBody className="flex flex-col gap-3 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <TextInput
              icon="Search"
              placeholder="Sök namn eller e-post…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sm:max-w-xs"
            />
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'alla', label: 'Alla' },
                { value: 'konflikt', label: 'Konflikt', icon: 'TriangleAlert' },
                { value: 'delad', label: 'Delad vårdnad', icon: 'Split' },
                { value: 'overifierad', label: 'Ej verifierad', icon: 'Clock' },
              ]}
            />
          </div>
          {canLink && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon="Link2" onClick={() => setFlow({ kind: 'link' })}>Koppla till barn</Button>
              <Button size="sm" variant="secondary" icon="Users" onClick={() => setFlow({ kind: 'sibling' })}>Syskonlänka</Button>
              <Button size="sm" variant="secondary" icon="PhoneCall" onClick={() => setFlow({ kind: 'emergency' })}>Nödkontakt</Button>
              <Button size="sm" variant="secondary" icon="CarFront" onClick={() => setFlow({ kind: 'pickup' })}>Hämtbehörig</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Lista */}
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon="Users"
            title="Inga vårdnadshavare i din vy"
            description="När vårdnadshavare kopplas till barn inom din räckvidd visas de här."
            actionLabel={canCreateGuardian ? 'Lägg till vårdnadshavare' : undefined}
            onAction={canCreateGuardian ? () => setFlow({ kind: 'add' }) : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={(r) => setOpenId(r.id)}
            emptyTitle="Inga träffar"
            emptyDescription="Justera sökning eller filter."
          />
        )}
      </Card>

      {/* Detaljvy */}
      {openRow && (
        <GuardianDetail
          principal={principal}
          row={openRow}
          onClose={() => setOpenId(null)}
          onBump={bump}
          onFlow={(req) => setFlow(req)}
          onError={(msg) => setToast({ tone: 'danger', msg })}
        />
      )}

      {/* Flöden */}
      {flow && (
        <FlowModal
          principal={principal}
          req={flow}
          onClose={() => setFlow(null)}
          onDone={(msg) => { setFlow(null); bump(); setToast({ tone: 'success', msg }) }}
        />
      )}

      {/* Diskret återkoppling */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0">
          <div
            className="flex items-center gap-2 rounded-field border px-4 py-2.5 text-sm shadow-pop"
            style={{
              backgroundColor: `rgb(var(--c-surface))`,
              borderColor: `rgb(var(--c-${toast.tone === 'success' ? 'success' : 'danger'}) / 0.4)`,
            }}
            role="status"
          >
            <Icon
              name={toast.tone === 'success' ? 'CheckCircle2' : 'TriangleAlert'}
              className="h-4 w-4"
              style={{ color: `rgb(var(--c-${toast.tone === 'success' ? 'success' : 'danger'}))` }}
            />
            <span className="text-ink">{toast.msg}</span>
            <button onClick={() => setToast(null)} className="ml-1 text-ink-subtle hover:text-ink" aria-label="Stäng">
              <Icon name="X" className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
