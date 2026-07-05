import { create } from 'zustand'
import { useEffect } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

/**
 * Globalt feedbacksystem (toast). Används för bekräftelser, fel och
 * statusuppdateringar efter åtgärder. Tillgängligt: aria-live, stängbart,
 * auto-försvinner. Anropa via toast.success('Sparat') m.fl. var som helst,
 * eller useToast() i komponenter.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
  /** Valfri åtgärd, t.ex. "Visa" som navigerar. */
  actionLabel?: string
  onAction?: () => void
  duration: number
}

interface ToastState {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let toastId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++toastId
    const item: ToastItem = { id, duration: t.duration ?? 4500, ...t }
    set({ items: [...get().items, item].slice(-4) }) // max 4 samtidigt
    return id
  },
  dismiss: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}))

/** Imperativt API – kan användas i tjänstelager och event-handlers. */
export const toast = {
  success: (title: string, description?: string, opts?: Partial<ToastItem>) =>
    useToastStore.getState().push({ tone: 'success', title, description, ...opts }),
  error: (title: string, description?: string, opts?: Partial<ToastItem>) =>
    useToastStore.getState().push({ tone: 'error', title, description, duration: 7000, ...opts }),
  info: (title: string, description?: string, opts?: Partial<ToastItem>) =>
    useToastStore.getState().push({ tone: 'info', title, description, ...opts }),
  warning: (title: string, description?: string, opts?: Partial<ToastItem>) =>
    useToastStore.getState().push({ tone: 'warning', title, description, duration: 6000, ...opts }),
}

export function useToast() {
  return toast
}

const toneMeta: Record<ToastTone, { icon: string; cls: string }> = {
  success: { icon: 'CheckCircle2', cls: 'text-success' },
  error: { icon: 'XCircle', cls: 'text-danger' },
  info: { icon: 'Info', cls: 'text-info' },
  warning: { icon: 'TriangleAlert', cls: 'text-warning' },
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), item.duration)
    return () => clearTimeout(t)
  }, [item.id, item.duration, dismiss])

  const meta = toneMeta[item.tone]
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-panel border border-border bg-surface p-3.5 shadow-pop animate-slide-up"
    >
      <Icon name={meta.icon} className={cn('mt-0.5 h-5 w-5 shrink-0', meta.cls)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{item.title}</p>
        {item.description && <p className="mt-0.5 text-sm text-ink-muted">{item.description}</p>}
        {item.actionLabel && item.onAction && (
          <button
            className="mt-1.5 text-sm font-medium text-primary hover:underline"
            onClick={() => {
              item.onAction?.()
              dismiss(item.id)
            }}
          >
            {item.actionLabel}
          </button>
        )}
      </div>
      <button
        onClick={() => dismiss(item.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-field text-ink-subtle hover:bg-surface-2 hover:text-ink"
        aria-label="Stäng"
      >
        <Icon name="X" className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Monteras en gång i appskalet. */
export function Toaster() {
  const items = useToastStore((s) => s.items)
  if (items.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
