import { db, nextId } from '@/data/db/store'
import type { Integration, IntegrationRun, IntegrationStatus } from '@/data/schema'

/**
 * Integrationsregister. Varje integration är en adapter som wrappas som en
 * native del av Skolnav – aldrig extern UI. Om en integration inte är
 * konfigurerad används säker lokal fallback och status visas tydligt.
 */

export function listIntegrations(organizationId: string): Integration[] {
  return db.data.integrations.filter((i) => i.organizationId === organizationId)
}

export function getIntegration(key: string, organizationId: string): Integration | undefined {
  return db.data.integrations.find((i) => i.key === key && i.organizationId === organizationId)
}

export function isOperational(i: Integration | undefined): boolean {
  return !!i && (i.status === 'aktiv' || i.status === 'testad')
}

export function runsFor(integrationId: string): IntegrationRun[] {
  return db.data.integrationRuns.filter((r) => r.integrationId === integrationId)
}

/** Simulerad anslutningstest. */
export async function testConnection(id: string): Promise<{ ok: boolean; message: string }> {
  const i = db.data.integrations.find((x) => x.id === id)
  if (!i) return { ok: false, message: 'Integrationen hittades inte.' }
  await new Promise((r) => setTimeout(r, 400))
  if (i.status === 'kraver_avtal') return { ok: false, message: 'Avtal saknas – anslutning kan inte testas.' }
  if (i.status === 'kraver_nyckel') return { ok: false, message: 'API-nyckel saknas.' }
  if (i.status === 'kraver_konfiguration') return { ok: false, message: 'Konfiguration ofullständig.' }
  const run: IntegrationRun = {
    id: nextId('run'),
    integrationId: id,
    startedAt: new Date().toISOString(),
    status: 'ok',
    itemsProcessed: 1,
    durationMs: 400,
    message: 'Testanrop lyckades',
  }
  db.data.integrationRuns.unshift(run)
  i.lastSyncAt = run.startedAt
  i.lastError = null
  return { ok: true, message: 'Anslutningen fungerar.' }
}

export function setIntegrationStatus(id: string, status: IntegrationStatus) {
  const i = db.data.integrations.find((x) => x.id === id)
  if (i) i.status = status
}

/**
 * Kör en integrationsberoende åtgärd med graceful degradation.
 * Om integrationen inte är operativ används fallback och resultatet flaggas.
 */
export async function withIntegration<T>(
  key: string,
  organizationId: string,
  live: (i: Integration) => Promise<T>,
  fallback: () => T,
): Promise<{ value: T; usedFallback: boolean; status: IntegrationStatus | 'saknas' }> {
  const i = getIntegration(key, organizationId)
  if (!i) return { value: fallback(), usedFallback: true, status: 'saknas' }
  if (!isOperational(i)) return { value: fallback(), usedFallback: true, status: i.status }
  try {
    const value = await live(i)
    return { value, usedFallback: false, status: i.status }
  } catch {
    return { value: fallback(), usedFallback: true, status: 'fel' }
  }
}
