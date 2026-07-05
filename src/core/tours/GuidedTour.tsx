import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSession } from '@/core/state/session'
import { usePrincipal } from '@/core/permissions/usePermission'
import { tourForRole, type TourStep } from './tours'
import { Button, Icon } from '@/ui'
import { cn } from '@/lib/cn'

interface Rect { top: number; left: number; width: number; height: number }

/**
 * Guidad tur: mörkad overlay, fokuserat element (spotlight), pekare, korta
 * svenska steg, stegprickar och kontroller. Startar första gången per roll och
 * kan startas om från användarmenyn (via session.tourRestartKey).
 */
export function GuidedTour() {
  const principal = usePrincipal()
  const restartKey = useSession((s) => s.tourRestartKey)
  const tour = tourForRole(principal.role)
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const startedFor = useRef<string | null>(null)

  const seenKey = `skolnav-tour-seen-${principal.role}`

  // Starta automatiskt första gången per roll
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    if (startedFor.current === principal.role) return
    startedFor.current = principal.role
    if (!localStorage.getItem(seenKey)) {
      setIndex(0)
      setActive(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal.role])

  // Starta om via menyn
  useEffect(() => {
    if (restartKey > 0) {
      setIndex(0)
      setActive(true)
    }
  }, [restartKey])

  const step: TourStep | undefined = tour.steps[index]

  const measure = useCallback(() => {
    if (!step?.target) { setRect(null); return }
    const el = document.querySelector(step.target)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step])

  useLayoutEffect(() => {
    if (!active) return
    measure()
    const onChange = () => measure()
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [active, measure])

  const close = (markSeen = false) => {
    if (markSeen && typeof localStorage !== 'undefined') localStorage.setItem(seenKey, '1')
    setActive(false)
  }
  const next = () => (index < tour.steps.length - 1 ? setIndex((i) => i + 1) : close(true))
  const prev = () => setIndex((i) => Math.max(0, i - 1))

  if (!active || !step) return null

  // Tooltip-position
  const pad = 8
  const tipWidth = 320
  let tipStyle: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (rect) {
    const below = rect.top + rect.height + 12
    const spaceBelow = window.innerHeight - (rect.top + rect.height)
    const top = spaceBelow > 200 ? below : Math.max(12, rect.top - 12 - 180)
    let left = rect.left + rect.width / 2 - tipWidth / 2
    left = Math.max(12, Math.min(left, window.innerWidth - tipWidth - 12))
    tipStyle = { top, left, width: tipWidth }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Guidad tur">
      {/* Spotlight eller helmörk overlay */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-ink/55" />
      )}

      {/* Tooltip-kort */}
      <div
        className="absolute animate-slide-up rounded-panel border border-border bg-surface p-4 shadow-pop"
        style={tipStyle}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary">
            <Icon name="Compass" className="h-4 w-4" />
          </span>
          <h3 className="font-semibold text-ink">{step.title}</h3>
        </div>
        <p className="text-sm text-ink-muted">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden>
            {tour.steps.map((_, i) => (
              <span key={i} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border-strong')} />
            ))}
          </div>
          <span className="text-2xs text-ink-subtle">{index + 1} / {tour.steps.length}</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button className="text-2xs text-ink-subtle hover:underline" onClick={() => close(true)}>
            Visa inte igen
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && <Button variant="ghost" size="sm" onClick={prev}>Tillbaka</Button>}
            <Button variant="ghost" size="sm" onClick={() => close(false)}>Hoppa över</Button>
            <Button size="sm" onClick={next} iconRight={index === tour.steps.length - 1 ? 'Check' : 'ArrowRight'}>
              {index === tour.steps.length - 1 ? 'Klart' : 'Nästa'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
