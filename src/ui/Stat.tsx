import { cn } from '@/lib/cn'
import { Icon } from './Icon'
import type { Tone } from './Badge'

const iconTone: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  hint,
  trend,
  className,
  onClick,
}: {
  label: string
  value: React.ReactNode
  icon?: string
  tone?: Tone
  hint?: string
  trend?: { dir: 'up' | 'down' | 'flat'; label: string }
  className?: string
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-card',
        onClick && 'transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        className,
      )}
    >
      {icon && (
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-field', iconTone[tone])}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-2xl font-semibold tabular-nums text-ink leading-none">{value}</div>
        <div className="mt-1 text-sm text-ink-muted">{label}</div>
        {hint && <div className="mt-0.5 text-2xs text-ink-subtle">{hint}</div>}
        {trend && (
          <div
            className={cn(
              'mt-1 inline-flex items-center gap-1 text-2xs font-medium',
              trend.dir === 'up' && 'text-success',
              trend.dir === 'down' && 'text-danger',
              trend.dir === 'flat' && 'text-ink-subtle',
            )}
          >
            <Icon name={trend.dir === 'up' ? 'TrendingUp' : trend.dir === 'down' ? 'TrendingDown' : 'Minus'} className="h-3 w-3" />
            {trend.label}
          </div>
        )}
      </div>
    </Comp>
  )
}
