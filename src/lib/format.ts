import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'

type DateInput = string | number | Date

function toDate(d: DateInput): Date {
  if (d instanceof Date) return d
  if (typeof d === 'number') return new Date(d)
  return parseISO(d)
}

/** 2026-07-04 */
export function fmtDate(d: DateInput): string {
  return format(toDate(d), 'yyyy-MM-dd')
}

/** 4 juli 2026 */
export function fmtDateLong(d: DateInput): string {
  return format(toDate(d), 'd MMMM yyyy', { locale: sv })
}

/** 08:15 */
export function fmtTime(d: DateInput): string {
  return format(toDate(d), 'HH:mm')
}

/** 4 jul 08:15 */
export function fmtDateTime(d: DateInput): string {
  return format(toDate(d), 'd MMM HH:mm', { locale: sv })
}

/** Relativt: "för 3 minuter sedan", "Idag 08:15", "Igår 14:00" */
export function fmtRelative(d: DateInput): string {
  const date = toDate(d)
  if (isToday(date)) return `Idag ${format(date, 'HH:mm')}`
  if (isYesterday(date)) return `Igår ${format(date, 'HH:mm')}`
  return formatDistanceToNow(date, { locale: sv, addSuffix: true })
}

/** Veckodag kort: mån, tis … */
export function fmtWeekday(d: DateInput): string {
  return format(toDate(d), 'EEE', { locale: sv })
}

/**
 * Maskerar personnummer. Skyddad identitet visar aldrig fullständigt nummer.
 * 20120504-1234 -> "2012••••-••••" (visar bara födelseår i icke-maskerat läge).
 */
export function maskPersonnummer(pnr: string, masked: boolean): string {
  if (!masked) return pnr
  const digits = pnr.replace(/\D/g, '')
  if (digits.length < 4) return '••••••••-••••'
  return `${digits.slice(0, 4)}••••-••••`
}

/** Maskerar namn för skyddad identitet: "Anna Svensson" -> "A. S." */
export function maskName(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ')
}

/** Filstorlek i läsbart format. */
export function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`
}

/** Procent utan decimaler, svensk formattering. */
export function fmtPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits).replace('.', ',')} %`
}

/** Heltal med tusentalsavgränsare (svenskt mellanslag). */
export function fmtNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE').format(value)
}

/** Initialer för avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
