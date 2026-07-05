import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

/** Tillgänglig dialog med fokusfälla, Esc-stängning och bakgrundsoverlay. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  const maxW = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full rounded-t-panel bg-surface shadow-pop animate-slide-up sm:rounded-panel',
          maxW,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-field text-ink-subtle hover:bg-surface-2 hover:text-ink"
            aria-label="Stäng"
          >
            <Icon name="X" className="h-5 w-5" />
          </button>
        </div>
        {children && <div className="max-h-[70vh] overflow-y-auto px-5 py-2">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}
