import { cn } from '@/lib/cn'
import { Icon } from './Icon'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: string
}

/** Segmenterad kontroll – för lägesväxlare och filter. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-1 rounded-field bg-surface-2 p-1', className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[7px] font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-sm',
            value === opt.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {opt.icon && <Icon name={opt.icon} className="h-3.5 w-3.5" />}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** Enkel flik-navigation. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number; icon?: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-border overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors -mb-px',
            value === t.value
              ? 'border-primary text-primary'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {t.icon && <Icon name={t.icon} className="h-4 w-4" />}
          {t.label}
          {t.count != null && (
            <span className={cn('rounded-pill px-1.5 text-2xs tabular-nums', value === t.value ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-ink-subtle')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Textfält med ikon (sök m.m.). */
export function TextInput({
  icon,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon?: string }) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon && <Icon name={icon} className="pointer-events-none absolute left-3 h-4 w-4 text-ink-subtle" />}
      <input
        className={cn(
          'h-10 w-full rounded-field border border-border bg-surface text-sm text-ink placeholder:text-ink-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary',
          icon ? 'pl-9 pr-3' : 'px-3',
        )}
        {...props}
      />
    </div>
  )
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className={cn(
          'h-10 w-full appearance-none rounded-field border border-border bg-surface pl-3 pr-9 text-sm text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary',
        )}
        {...props}
      >
        {children}
      </select>
      <Icon name="ChevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
    </div>
  )
}
