import { cn } from '@/lib/cn'
import { Icon } from './Icon'

/** Sidhuvud med titel, undertitel, brödsmulor och primär åtgärd. */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  breadcrumbs,
  className,
}: {
  title: string
  subtitle?: string
  icon?: string
  actions?: React.ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  className?: string
}) {
  return (
    <div className={cn('mb-5', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex items-center gap-1.5 text-xs text-ink-subtle" aria-label="Brödsmulor">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <Icon name="ChevronRight" className="h-3 w-3" />}
              <span className={i === breadcrumbs.length - 1 ? 'text-ink-muted' : ''}>{b.label}</span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-panel bg-primary-soft text-primary">
              <Icon name={icon} className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">{children}</h2>
      {action}
    </div>
  )
}
