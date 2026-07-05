import { authorize, type Principal, type Target } from '@/core/permissions/engine'
import { actorFromPrincipal, logAudit } from '@/core/audit/audit'
import { confirmNotification, markAllRead, markRead } from '@/core/notifications/notifications'
import { db } from '@/data/db/store'
import type { NotificationItem } from '@/data/schema'

/**
 * Tjänstelager för notissidan. Varje mutation auktoriseras mot
 * behörighetsmotorn (notiser är alltid "egen"-scope) innan db.data rörs.
 */

function ownTarget(principal: Principal): Target {
  return { organizationId: principal.organizationId, ownerUserId: principal.userId }
}

function findOwn(principal: Principal, id: string): NotificationItem {
  const n = db.data.notifications.find((x) => x.id === id && x.userId === principal.userId)
  if (!n) throw new Error('Notisen kunde inte hittas.')
  return n
}

/** Markerar en egen notis som läst. */
export function markNotificationRead(principal: Principal, id: string): void {
  authorize(principal, 'update', 'notification', ownTarget(principal))
  findOwn(principal, id)
  markRead(id)
}

/** Markerar alla egna notiser som lästa. Returnerar antal påverkade. */
export function markAllNotificationsRead(principal: Principal): number {
  authorize(principal, 'update', 'notification', ownTarget(principal))
  const count = db.data.notifications.filter((n) => n.userId === principal.userId && !n.read).length
  markAllRead(principal.userId)
  logAudit(actorFromPrincipal(principal), {
    action: 'notification.mark_all_read',
    resource: 'notification',
    targetLabel: `${count} notiser markerade som lästa`,
  })
  return count
}

/** Bekräftar en notis som kräver kvittens. */
export function confirmOwnNotification(principal: Principal, id: string): NotificationItem {
  authorize(principal, 'update', 'notification', ownTarget(principal))
  const n = findOwn(principal, id)
  confirmNotification(id)
  logAudit(actorFromPrincipal(principal), {
    action: 'notification.confirm',
    resource: 'notification',
    targetId: n.id,
    targetLabel: n.title,
  })
  return n
}

/** Skickar om en misslyckad leverans (simulerat: sätts till levererad). */
export function retryDelivery(principal: Principal, id: string): NotificationItem {
  authorize(principal, 'update', 'notification', ownTarget(principal))
  const n = findOwn(principal, id)
  if (n.deliveryStatus !== 'misslyckad') throw new Error('Endast misslyckade leveranser kan skickas igen.')
  n.deliveryStatus = 'levererad'
  logAudit(actorFromPrincipal(principal), {
    action: 'notification.redeliver',
    resource: 'notification',
    targetId: n.id,
    targetLabel: n.title,
  })
  return n
}
