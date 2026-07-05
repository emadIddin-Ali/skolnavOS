import { cn } from '@/lib/cn'
import type { Tone } from './Badge'

const toneVar: Record<Tone, string> = {
  neutral: '--c-ink-subtle',
  primary: '--c-primary',
  success: '--c-success',
  warning: '--c-warning',
  danger: '--c-danger',
  info: '--c-info',
  accent: '--c-accent',
}

/** Completion ring – ersätter långa textstycken med visuell status. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 6,
  tone = 'primary',
  label,
  sublabel,
}: {
  value: number
  size?: number
  stroke?: number
  tone?: Tone
  label?: React.ReactNode
  sublabel?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = c - (pct / 100) * c
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${Math.round(pct)} procent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-surface-3))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`rgb(var(${toneVar[tone]}))`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <span className="text-sm font-semibold text-ink">{label ?? `${Math.round(pct)}%`}</span>
        {sublabel && <span className="text-2xs text-ink-subtle">{sublabel}</span>}
      </div>
    </div>
  )
}

export function ProgressBar({
  value,
  tone = 'primary',
  className,
  showValue,
}: {
  value: number
  tone?: Tone
  className?: string
  showValue?: boolean
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-3">
        <div
          className="h-full rounded-pill transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: `rgb(var(${toneVar[tone]}))` }}
        />
      </div>
      {showValue && <span className="text-xs font-medium text-ink-muted tabular-nums">{Math.round(pct)}%</span>}
    </div>
  )
}
