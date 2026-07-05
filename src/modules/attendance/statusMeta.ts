import type { AttendanceStatus } from '@/data/schema'
import type { Tone } from '@/ui'

export type SwipeDir = 'right' | 'left' | 'up' | 'down'

export interface StatusMeta {
  tone: Tone
  icon: string
  /** Svepriktning som sätter statusen (höger/vänster/upp/ned). */
  dir?: SwipeDir
}

/** Färg + ikon per närvarostatus. Aldrig enbart färg – alltid text via label. */
export const STATUS_META: Record<AttendanceStatus, StatusMeta> = {
  narvarande: { tone: 'success', icon: 'Check', dir: 'right' },
  franvarande: { tone: 'danger', icon: 'X', dir: 'left' },
  sen: { tone: 'warning', icon: 'Clock', dir: 'up' },
  hamtad: { tone: 'info', icon: 'LogOut', dir: 'down' },
  ej_markerad: { tone: 'neutral', icon: 'CircleDashed' },
}

/** Markerbara statusar i knapp-/svepordning (positiv → negativ). */
export const MARKABLE: AttendanceStatus[] = ['narvarande', 'sen', 'hamtad', 'franvarande']

/** Svepriktning → status. Höger=Närvarande, vänster=Frånvarande, upp=Sen, ned=Hämtad. */
export const DIR_STATUS: Record<SwipeDir, AttendanceStatus> = {
  right: 'narvarande',
  left: 'franvarande',
  up: 'sen',
  down: 'hamtad',
}

export const DIR_ICON: Record<SwipeDir, string> = {
  right: 'ArrowRight',
  left: 'ArrowLeft',
  up: 'ArrowUp',
  down: 'ArrowDown',
}
