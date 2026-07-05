import { cn } from '@/lib/cn'
import { Icon } from './Icon'
import { classificationMeta, type Classification } from '@/core/domain/classification'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-muted border-border',
  primary: 'bg-primary-soft text-primary border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
}

export function Badge({
  tone = 'neutral',
  icon,
  dot,
  className,
  children,
}: {
  tone?: Tone
  icon?: string
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  )
}

/** Statusbricka med både färg och text (aldrig enbart färg – tillgänglighet). */
export function StatusBadge({ tone, label, icon }: { tone: Tone; label: string; icon?: string }) {
  return (
    <Badge tone={tone} dot={!icon} icon={icon}>
      {label}
    </Badge>
  )
}

/** Dataklassificering 1–6 med ikon + text. */
export function ClassificationBadge({ level, showLabel = true }: { level: Classification; showLabel?: boolean }) {
  const meta = classificationMeta(level)
  const icon = level >= 5 ? 'ShieldAlert' : level >= 4 ? 'ShieldCheck' : level >= 3 ? 'Shield' : 'Info'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-2xs font-semibold whitespace-nowrap"
      style={{
        color: `rgb(var(--c-${meta.tone}))`,
        backgroundColor: `rgb(var(--c-${meta.tone}) / 0.12)`,
        borderColor: `rgb(var(--c-${meta.tone}) / 0.25)`,
      }}
      title={meta.description}
    >
      <Icon name={icon} className="h-3 w-3" />
      {showLabel ? `${meta.level}. ${meta.short}` : meta.level}
    </span>
  )
}
