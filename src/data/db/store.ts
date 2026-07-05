import { generateSeed, type SeedData } from '@/data/seed/seed'

/**
 * In-memory-"backend". Simulerar en databas (Postgres/Supabase) med tenant-
 * isolering. Tjänstelagret (services) auktoriserar via behörighetsmotorn INNAN
 * det rör dessa tabeller – store:t självt är avsiktligt auktoritetslöst, precis
 * som en databas. Bytbar mot riktig backend utan att UI berörs.
 */

let seed: SeedData = generateSeed()

export const db = {
  get data() {
    return seed
  },
  reset(now?: Date) {
    seed = generateSeed(now)
  },
}

/** Simulerad nätverkslatens för realistiska laddningstillstånd. */
export function latency(ms = 180): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Nästa löpnummer-id för nya poster. */
let counter = 100000
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

/** Enkel index-hjälpare. */
export function byId<T extends { id: string }>(arr: T[], id: string | null | undefined): T | undefined {
  if (!id) return undefined
  return arr.find((x) => x.id === id)
}
