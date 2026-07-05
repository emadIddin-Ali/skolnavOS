import { forwardRef } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: string
  iconRight?: string
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-strong shadow-card',
  secondary: 'bg-surface text-ink border border-border-strong hover:bg-surface-2',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-95 shadow-card',
  subtle: 'bg-primary-soft text-primary hover:bg-primary-soft/70',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  icon: 'h-10 w-10 justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center rounded-field font-medium transition-colors select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Icon name="Loader2" className="h-4 w-4 animate-spin" />
      ) : (
        icon && <Icon name={icon} className="h-4 w-4 shrink-0" />
      )}
      {children}
      {iconRight && <Icon name={iconRight} className="h-4 w-4 shrink-0" />}
    </button>
  )
})
