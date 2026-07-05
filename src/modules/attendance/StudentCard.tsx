import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Card, Avatar, Badge, StatusBadge, Icon } from '@/ui'
import { cn } from '@/lib/cn'
import { maskName, fmtTime } from '@/lib/format'
import type { AttendanceStatus, Student } from '@/data/schema'
import { ATTENDANCE_STATUS_LABEL } from '@/data/schema'
import { STATUS_META, MARKABLE, DIR_STATUS, DIR_ICON, type SwipeDir } from './statusMeta'

const SWIPE_THRESHOLD = 56
const CLAMP = 44

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Elevkort för signaturnärvaro. Fyra knappar (obligatoriskt – tillgänglighet)
 * plus svep som bonus: höger=Närvarande, vänster=Frånvarande, upp=Sen, ned=Hämtad.
 */
export function StudentCard({
  student,
  status,
  markedAt,
  masked,
  canUpdate,
  queued,
  onSet,
}: {
  student: Student
  status: AttendanceStatus
  markedAt?: string | null
  masked: boolean
  canUpdate: boolean
  queued: boolean
  onSet: (next: AttendanceStatus) => void
}) {
  const fullName = `${student.firstName} ${student.lastName}`
  const displayName = masked ? maskName(fullName) : fullName
  const interactive = canUpdate && !masked

  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false })
  const start = useRef<{ x: number; y: number } | null>(null)

  const hintDir: SwipeDir | null = useMemo(() => {
    if (!drag.active) return null
    const { dx, dy } = drag
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return null
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
    return dy < 0 ? 'up' : 'down'
  }, [drag])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive || e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY }
    setDrag({ dx: 0, dy: 0, active: true })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, active: true })
  }
  function endDrag(apply: boolean) {
    if (!start.current) return
    const { dx, dy } = drag
    const dir: SwipeDir | null =
      Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD
        ? Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy < 0
            ? 'up'
            : 'down'
        : null
    start.current = null
    setDrag({ dx: 0, dy: 0, active: false })
    if (apply && dir) onSet(DIR_STATUS[dir])
  }

  const meta = STATUS_META[status]
  const hintStatus = hintDir ? DIR_STATUS[hintDir] : null

  return (
    <Card
      className={cn(
        'relative overflow-hidden p-0 transition-shadow',
        drag.active && 'shadow-panel',
      )}
    >
      {/* Svepindikator */}
      {hintStatus && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          style={{ backgroundColor: `rgb(var(--c-${STATUS_META[hintStatus].tone}) / 0.10)` }}
          aria-hidden
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold shadow-card"
            style={{
              color: `rgb(var(--c-${STATUS_META[hintStatus].tone}))`,
              backgroundColor: 'rgb(var(--c-surface))',
            }}
          >
            <Icon name={DIR_ICON[hintDir!]} className="h-3.5 w-3.5" />
            {ATTENDANCE_STATUS_LABEL[hintStatus]}
          </span>
        </div>
      )}

      {/* Svepyta (pan-y låter sidan scrolla vertikalt på touch) */}
      <div
        className={cn('p-4', interactive && 'cursor-grab active:cursor-grabbing select-none')}
        style={interactive ? { touchAction: 'pan-y' } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        <div
          style={{
            transform: `translate(${clamp(drag.dx, -CLAMP, CLAMP)}px, ${clamp(drag.dy, -CLAMP, CLAMP)}px)`,
            transition: drag.active ? 'none' : 'transform 180ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div className="flex items-start gap-3">
            <Avatar name={displayName} color={student.photoColor} size="lg" protected={masked} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{displayName}</p>
              <p className="text-2xs text-ink-subtle">{student.gradeLabel}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={meta.tone} icon={meta.icon} label={ATTENDANCE_STATUS_LABEL[status]} />
                {queued && <Badge tone="neutral" icon="CloudOff">Köad</Badge>}
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {masked && (
              <Badge tone="neutral" icon="ShieldAlert">Skyddad identitet</Badge>
            )}
            {student.hasAllergyFlag && (
              <Badge tone="warning" icon="TriangleAlert">Allergi</Badge>
            )}
            {student.hasPickupNote && (
              <Badge tone="info" icon="Car">Hämtning</Badge>
            )}
          </div>

          {markedAt && (
            <p className="mt-2 text-2xs text-ink-subtle">
              Markerad {fmtTime(markedAt)}
            </p>
          )}
        </div>
      </div>

      {/* Fyra knappar – obligatoriskt tillgängligt alternativ till svep */}
      <div className="grid grid-cols-4 gap-1 border-t border-border p-1.5">
        {MARKABLE.map((s) => {
          const m = STATUS_META[s]
          const active = status === s
          return (
            <button
              key={s}
              type="button"
              disabled={!canUpdate}
              onClick={() => onSet(s)}
              aria-pressed={active}
              aria-label={`Markera ${ATTENDANCE_STATUS_LABEL[s]}`}
              title={ATTENDANCE_STATUS_LABEL[s]}
              className={cn(
                'flex flex-col items-center gap-1 rounded-field px-1 py-2 text-2xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                'disabled:opacity-40 disabled:pointer-events-none',
                active
                  ? 'text-white'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
              style={active ? { backgroundColor: `rgb(var(--c-${m.tone}))` } : undefined}
            >
              <Icon name={m.icon} className="h-[18px] w-[18px]" />
              <span className="max-w-full truncate">{ATTENDANCE_STATUS_LABEL[s]}</span>
            </button>
          )
        })}
      </div>

      {!canUpdate && (
        <p className="border-t border-border px-4 py-1.5 text-2xs text-ink-subtle">
          {masked ? 'Skyddad identitet – hantering kräver klarering.' : 'Du har endast läsbehörighet.'}
        </p>
      )}
    </Card>
  )
}
