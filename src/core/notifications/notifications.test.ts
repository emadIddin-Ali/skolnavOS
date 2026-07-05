import { describe, it, expect } from 'vitest'
import { sendNotification, listNotifications, unreadCount, markAllRead } from './notifications'

const base = {
  organizationId: 'org-lund',
  category: 'meddelande' as const,
}

describe('notistjänst', () => {
  it('levererar app-notis och listar för mottagaren', () => {
    const n = sendNotification({ ...base, userId: 'ntf-test-1', title: 'Hej', body: 'Test' })
    expect(n.deliveryStatus).toBe('levererad')
    expect(listNotifications('ntf-test-1').some((x) => x.id === n.id)).toBe(true)
  })

  it('maskerar känsligt innehåll (klass ≥3) i extern kanal', () => {
    const n = sendNotification({
      ...base,
      userId: 'ntf-test-2',
      title: 'Frånvaro',
      body: 'Elev Anna Svensson är sjuk idag.',
      channel: 'push',
      classification: 4,
    })
    expect(n.body).not.toContain('Anna')
    expect(n.body).toMatch(/Logga in för att läsa/)
  })

  it('behåller innehåll i intern app-kanal oavsett klassificering', () => {
    const n = sendNotification({
      ...base,
      userId: 'ntf-test-3',
      title: 'Frånvaro',
      body: 'Detaljerad info',
      channel: 'app',
      classification: 4,
    })
    expect(n.body).toBe('Detaljerad info')
  })

  it('avduplicerar upprepade notiser (batchas)', () => {
    const first = sendNotification({ ...base, userId: 'ntf-test-4', title: 'Samma', body: 'x' })
    const dup = sendNotification({ ...base, userId: 'ntf-test-4', title: 'Samma', body: 'x' })
    expect(first.deliveryStatus).toBe('levererad')
    expect(dup.deliveryStatus).toBe('batchad')
  })

  it('digest-kanal batchas alltid', () => {
    const n = sendNotification({ ...base, userId: 'ntf-test-5', title: 'Veckobrev', body: 'x', channel: 'digest' })
    expect(n.deliveryStatus).toBe('batchad')
  })

  it('oläst-räknare och markera alla lästa fungerar', () => {
    sendNotification({ ...base, userId: 'ntf-test-6', title: 'A', body: 'x' })
    sendNotification({ ...base, userId: 'ntf-test-6', title: 'B', body: 'x' })
    expect(unreadCount('ntf-test-6')).toBeGreaterThanOrEqual(2)
    markAllRead('ntf-test-6')
    expect(unreadCount('ntf-test-6')).toBe(0)
  })
})
