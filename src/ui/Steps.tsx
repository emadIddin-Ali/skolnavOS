import { cn } from '@/lib/cn'
import { Icon } from './Icon'

export interface Step {
  label: string
  done?: boolean
}

/** Stegindikator för onboarding, samtycken och flerstegsflöden. */
export function StepIndicator({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Steg">
      {steps.map((step, i) => {
        const state = step.done || i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={i} className="flex flex-1 items-center gap-1">
            <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
                state === 'done' && 'border-transparent bg-primary text-primary-fg',
                state === 'current' && 'border-primary text-primary',
                state === 'todo' && 'border-border text-ink-subtle',
              )}
            >
              {state === 'done' ? <Icon name="Check" className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn('hidden text-xs sm:block', state === 'todo' ? 'text-ink-subtle' : 'text-ink-muted')}>
              {step.label}
            </span>
            {i < steps.length - 1 && <span className={cn('h-px flex-1', i < current ? 'bg-primary' : 'bg-border')} />}
          </li>
        )
      })}
    </ol>
  )
}

/** Checklista för onboarding-uppgifter. */
export function Checklist({
  items,
}: {
  items: { label: string; done: boolean; hint?: string }[]
}) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
              it.done ? 'border-transparent bg-success text-white' : 'border-border-strong text-transparent',
            )}
          >
            <Icon name="Check" className="h-3 w-3" />
          </span>
          <div>
            <span className={cn('text-sm', it.done ? 'text-ink-muted line-through' : 'text-ink')}>{it.label}</span>
            {it.hint && <p className="text-2xs text-ink-subtle">{it.hint}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
