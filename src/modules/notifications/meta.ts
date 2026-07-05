import type { Tone } from '@/ui'
import type { NotificationChannel, NotificationItem } from '@/data/schema'

/** Presentationsmetadata för notiser – delas av Notiser- och Inställningssidan. */

export type NotificationCategory = NotificationItem['category']
export type DeliveryStatus = NotificationItem['deliveryStatus']

export const CATEGORY_ORDER: NotificationCategory[] = [
  'franvaro',
  'meddelande',
  'samtycke',
  'schema',
  'sakerhet',
  'system',
  'rapport',
]

export const CATEGORY_META: Record<NotificationCategory, { label: string; tone: Tone; icon: string }> = {
  franvaro: { label: 'Frånvaro', tone: 'warning', icon: 'CalendarX' },
  meddelande: { label: 'Meddelanden', tone: 'primary', icon: 'MessageSquare' },
  samtycke: { label: 'Samtycken', tone: 'accent', icon: 'PenLine' },
  schema: { label: 'Schema', tone: 'info', icon: 'CalendarDays' },
  sakerhet: { label: 'Säkerhet', tone: 'danger', icon: 'ShieldAlert' },
  system: { label: 'System', tone: 'neutral', icon: 'Server' },
  rapport: { label: 'Rapporter', tone: 'success', icon: 'FileText' },
}

export const CHANNEL_META: Record<NotificationChannel, { label: string; icon: string }> = {
  app: { label: 'I appen', icon: 'Bell' },
  push: { label: 'Push', icon: 'Smartphone' },
  epost: { label: 'E-post', icon: 'Mail' },
  sms: { label: 'SMS', icon: 'MessagesSquare' },
  digest: { label: 'Sammandrag', icon: 'MailOpen' },
}

export const DELIVERY_META: Record<DeliveryStatus, { label: string; tone: Tone; icon: string }> = {
  köad: { label: 'Köad', tone: 'neutral', icon: 'Clock' },
  skickad: { label: 'Skickad', tone: 'info', icon: 'Send' },
  levererad: { label: 'Levererad', tone: 'success', icon: 'CheckCheck' },
  misslyckad: { label: 'Misslyckad', tone: 'danger', icon: 'CircleX' },
  batchad: { label: 'Sammanslagen', tone: 'neutral', icon: 'Inbox' },
}
