import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { navItemByPath } from '@/app/navigation'
import type { ResourceKey } from '@/core/domain/permissions'
import { RESOURCE_LABEL } from '@/core/domain/permissions'
import { createReport } from '@/core/export/reports'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { ForbiddenError } from '@/core/permissions/engine'
import type { Classification } from '@/core/domain/classification'
import { resourceView } from './resourceViews'
import {
  PageHeader, Card, DataTable, Segmented, Button, toast,
  EmptyState, ErrorState, DeniedState, OfflineState, ConflictState, LoadingRows,
} from '@/ui'

/** Klassificering per resurs för korrekt exporthantering. */
const EXPORT_CLASSIFICATION: Partial<Record<ResourceKey, Classification>> = {
  health: 4, incident: 4, assessment: 4, audit_log: 6, security: 6, gdpr: 4,
}

type StateKey = 'aktiv' | 'tom' | 'laddar' | 'fel' | 'nekad' | 'konflikt' | 'offline'

/**
 * Generisk modulvy: sidhuvud, behörighetskontroll, tillståndsflikar och
 * verklig aktiv data. Standardläget är alltid "Aktiv data". Flaggskepps-
 * moduler ersätter denna med skräddarsydd UI, men varje route får direkt
 * en fungerande, behörighetsfiltrerad vy.
 */
export function ModuleScaffold({
  resource: resourceProp,
  title: titleProp,
  icon: iconProp,
  subtitle,
}: {
  resource?: ResourceKey
  title?: string
  icon?: string
  subtitle?: string
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const principal = usePrincipal()
  const nav = navItemByPath(location.pathname)
  const resource = resourceProp ?? nav?.resource ?? 'dashboard'
  const title = titleProp ?? nav?.label ?? RESOURCE_LABEL[resource]
  const icon = iconProp ?? nav?.icon ?? 'LayoutDashboard'

  const readDecision = usePermission('read', resource)
  const canExport = usePermission('export', resource).allowed
  const [state, setState] = useState<StateKey>('aktiv')
  const [exporting, setExporting] = useState(false)

  const handleExport = () => {
    setExporting(true)
    try {
      const job = createReport(principal, {
        type: resource,
        title: `${RESOURCE_LABEL[resource]} – export`,
        format: 'csv',
        schoolId: principal.schoolIds[0] ?? null,
        classification: EXPORT_CLASSIFICATION[resource] ?? 3,
        reason: 'Export från listvy',
      })
      toast.success('Exporten är köad', 'Rapporten bearbetas i bakgrunden.', {
        actionLabel: 'Visa rapporter',
        onAction: () => navigate('/rapporter'),
      })
      void job
    } catch (e) {
      if (e instanceof RateLimitedError) toast.warning('Exportgränsen är nådd', e.message)
      else if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Exporten kunde inte startas', 'Försök igen om en stund.')
    } finally {
      setExporting(false)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title={title} icon={icon} subtitle={subtitle} />
        <Card><DeniedState reason={readDecision.reason} /></Card>
      </>
    )
  }

  const view = resourceView(resource, principal)

  return (
    <>
      <PageHeader
        title={title}
        icon={icon}
        subtitle={subtitle ?? `${RESOURCE_LABEL[resource]} · behörighetsfiltrerad vy`}
        actions={
          canExport ? (
            <Button variant="secondary" size="sm" icon="Download" loading={exporting} onClick={handleExport}>
              Exportera
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Segmented
          size="sm"
          value={state}
          onChange={setState}
          options={[
            { value: 'aktiv', label: 'Aktiv data', icon: 'Database' },
            { value: 'tom', label: 'Tomt' },
            { value: 'laddar', label: 'Laddar' },
            { value: 'fel', label: 'Fel' },
            { value: 'nekad', label: 'Åtkomst nekad' },
            { value: 'konflikt', label: 'Konflikt' },
            { value: 'offline', label: 'Offline' },
          ]}
        />
        <p className="mt-1.5 text-2xs text-ink-subtle">
          Tillståndsflikar för demonstration. Standard är alltid aktiv data.
        </p>
      </div>

      <Card>
        {state === 'laddar' && <LoadingRows rows={6} />}
        {state === 'fel' && <ErrorState onRetry={() => setState('aktiv')} />}
        {state === 'nekad' && <DeniedState />}
        {state === 'konflikt' && <ConflictState onReload={() => setState('aktiv')} />}
        {state === 'offline' && <OfflineState onRetry={() => setState('aktiv')} />}
        {state === 'tom' && (
          <EmptyState
            title={`Inga ${RESOURCE_LABEL[resource].toLowerCase()} än`}
            description="När data läggs till visas den här."
          />
        )}
        {state === 'aktiv' &&
          (view ? (
            <DataTable
              columns={view.columns}
              rows={view.rows}
              onRowClick={view.hrefFor ? (row) => { const href = view.hrefFor!(row); if (href) navigate(href) } : undefined}
              emptyTitle={`Inga ${RESOURCE_LABEL[resource].toLowerCase()}`}
            />
          ) : (
            <div className="p-6">
              <EmptyState
                icon="LayoutList"
                title={RESOURCE_LABEL[resource]}
                description="Den här modulen är förberedd i arkitekturen. Bygg vidare med list-, detalj- och flödesvyer enligt modulmallen."
              />
            </div>
          ))}
      </Card>
    </>
  )
}
