import { cn } from '@/lib/cn'
import { Icon } from './Icon'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-border bg-surface shadow-card', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
            <Icon name={icon} className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">{title}</h3>
          {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)}
      {...props}
    />
  )
}
