import { useEffect, useRef, useState, cloneElement, type ReactElement } from 'react'
import { cn } from '@/lib/cn'

/**
 * Lätt popover med klick-utanför- och Esc-stängning. Använd för menyer,
 * notiscenter, sök och växlare. Tillgänglig via tangentbord.
 */
export function Popover({
  trigger,
  children,
  align = 'end',
  width = 'w-72',
  className,
}: {
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent) => void; 'aria-expanded'?: boolean }>
  children: (close: () => void) => React.ReactNode
  align?: 'start' | 'end' | 'center'
  width?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      {cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          trigger.props.onClick?.(e)
          setOpen((v) => !v)
        },
        'aria-expanded': open,
      })}
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-2 max-h-[70vh] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-panel border border-border bg-surface p-1.5 shadow-pop animate-slide-up',
            align === 'end' && 'right-0',
            align === 'start' && 'left-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            width,
            className,
          )}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  danger,
}: {
  icon?: string
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-left text-sm transition-colors',
        active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-2',
        danger && 'text-danger hover:bg-danger-soft',
      )}
    >
      {icon && <IconInline name={icon} />}
      <span className="flex-1">{children}</span>
      {active && <IconInline name="Check" />}
    </button>
  )
}

// undvik cirkulär import med Icon barrel
import { Icon } from './Icon'
function IconInline({ name }: { name: string }) {
  return <Icon name={name} className="h-4 w-4 shrink-0" />
}
