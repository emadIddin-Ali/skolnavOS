import { cn } from '@/lib/cn'
import { Icon } from './Icon'
import { Button } from './Button'

/** Gemensam tom-/fel-/nekad-/offline-/konflikt-vy. Svenska, lugn, med åtgärd. */
function StateShell({
  icon,
  tone,
  title,
  description,
  action,
  className,
}: {
  icon: string
  tone: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: `rgb(var(--c-${tone}) / 0.12)` }}>
        <Icon name={icon} className="h-6 w-6" style={{ color: `rgb(var(--c-${tone}))` }} />
      </span>
      <h3 className="mt-4 font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function EmptyState({ title = 'Inget att visa än', description, actionLabel, onAction, icon = 'Inbox' }: {
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  icon?: string
}) {
  return (
    <StateShell
      icon={icon}
      tone="ink-subtle"
      title={title}
      description={description}
      action={actionLabel && onAction ? <Button onClick={onAction} icon="Plus">{actionLabel}</Button> : undefined}
    />
  )
}

export function ErrorState({ description = 'Något gick fel. Försök igen om en stund.', onRetry }: { description?: string; onRetry?: () => void }) {
  return (
    <StateShell
      icon="TriangleAlert"
      tone="danger"
      title="Kunde inte läsa in"
      description={description}
      action={onRetry ? <Button variant="secondary" icon="RotateCcw" onClick={onRetry}>Försök igen</Button> : undefined}
    />
  )
}

export function DeniedState({ reason }: { reason?: string }) {
  return (
    <StateShell
      icon="Lock"
      tone="warning"
      title="Åtkomst nekad"
      description={reason ?? 'Du saknar behörighet för den här vyn. Kontakta din administratör om du behöver åtkomst.'}
    />
  )
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <StateShell
      icon="WifiOff"
      tone="ink-subtle"
      title="Du är offline"
      description="Vissa åtgärder pausas tills anslutningen är tillbaka. Dina ändringar sparas och synkas automatiskt."
      action={onRetry ? <Button variant="secondary" icon="RotateCcw" onClick={onRetry}>Försök återansluta</Button> : undefined}
    />
  )
}

export function ConflictState({ onReload }: { onReload?: () => void }) {
  return (
    <StateShell
      icon="GitMerge"
      tone="warning"
      title="Ändringen krockar"
      description="Uppgiften har ändrats av någon annan sedan du öppnade den. Läs in senaste versionen innan du sparar."
      action={onReload ? <Button variant="secondary" icon="RefreshCw" onClick={onReload}>Läs in senaste</Button> : undefined}
    />
  )
}

/** Skelett-laddning. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-field" />
      ))}
    </div>
  )
}
