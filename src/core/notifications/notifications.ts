import { db, nextId } from '@/data/db/store'
import type { NotificationItem, NotificationChannel } from '@/data/schema'
import { classificationMeta, type Classification } from '@/core/domain/classification'
import { checkRateLimit } from '@/core/rate-limit/rateLimit'

/**
 * Notistjänst. Batchar, avduplicerar, respekterar dataklassificering (inget
 * känsligt i push/e-postkropp) och loggar leveransstatus. Wrappar interna
 * adaptrar (Novu/ntfy/Web Push/SMTP) – användaren ser bara "Notiser".
 */

export interface SendNotificationInput {
  userId: string
  organizationId: string
  title: string
  body: string
  category: NotificationItem['category']
  channel?: NotificationChannel
  urgent?: boolean
  requiresConfirmation?: boolean
  classification?: Classification
}

const recentDedupe = new Map<string, number>()

export function sendNotification(input: SendNotificationInput): NotificationItem {
  const classification = input.classification ?? 3
  const meta = classificationMeta(classification)
  const channel = input.channel ?? 'app'

  // Avduplicering (samma mottagare + titel inom 30 s)
  const dedupeKey = `${input.userId}:${input.title}`
  const last = recentDedupe.get(dedupeKey) ?? 0
  const now = Date.now()
  const isDuplicate = now - last < 30_000
  recentDedupe.set(dedupeKey, now)

  // Kostnadsskydd
  const rl = checkRateLimit('notification.send', `org:${input.organizationId}`, input.organizationId)

  // Maskera känsligt innehåll för push/e-post
  const externalChannel = channel === 'push' || channel === 'epost' || channel === 'sms'
  const safeBody =
    externalChannel && !meta.allowInNotificationBody
      ? 'Du har en ny händelse i Skolnav. Logga in för att läsa.'
      : input.body

  const deliveryStatus: NotificationItem['deliveryStatus'] = isDuplicate
    ? 'batchad'
    : !rl.allowed
      ? 'köad'
      : channel === 'digest'
        ? 'batchad'
        : 'levererad'

  const item: NotificationItem = {
    id: nextId('ntf'),
    userId: input.userId,
    organizationId: input.organizationId,
    title: input.title,
    body: safeBody,
    category: input.category,
    channel,
    urgent: input.urgent ?? false,
    read: false,
    requiresConfirmation: input.requiresConfirmation ?? false,
    confirmedAt: null,
    deliveryStatus,
    createdAt: new Date().toISOString(),
  }
  db.data.notifications.unshift(item)
  return item
}

export function listNotifications(userId: string): NotificationItem[] {
  return db.data.notifications.filter((n) => n.userId === userId)
}

export function unreadCount(userId: string): number {
  return db.data.notifications.filter((n) => n.userId === userId && !n.read).length
}

export function markRead(id: string) {
  const n = db.data.notifications.find((x) => x.id === id)
  if (n) n.read = true
}

export function markAllRead(userId: string) {
  db.data.notifications.filter((n) => n.userId === userId).forEach((n) => (n.read = true))
}

export function confirmNotification(id: string) {
  const n = db.data.notifications.find((x) => x.id === id)
  if (n) {
    n.confirmedAt = new Date().toISOString()
    n.read = true
  }
}
