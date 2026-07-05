import { db, nextId } from '@/data/db/store'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { createReport } from '@/core/export/reports'
import type { MealPlan, ReportJob } from '@/data/schema'
import { fmtDate } from '@/lib/format'

/**
 * Tjänstelager för måltider. Auktoriserar ALLTID via behörighetsmotorn innan
 * store:t rörs. Kastar ForbiddenError/RateLimitedError som vyn fångar och
 * visar som svensk mikrocopy.
 */

/** De åtta standardallergener som köket märker upp i matsedeln. */
export const ALLERGENS = [
  'Gluten',
  'Laktos',
  'Nötter',
  'Ägg',
  'Fisk',
  'Skaldjur',
  'Soja',
  'Selleri',
] as const

export interface SaveMealDayInput {
  schoolId: string
  /** ISO-datum/tid för dagen som sparas. */
  date: string
  lunch: string
  vegetarian: string
  allergens: string[]
}

/** Skapa eller uppdatera matsedeln för en enskild dag (köksansvarig m.fl.). */
export function saveMealDay(principal: Principal, input: SaveMealDayInput): MealPlan {
  const school = db.data.schools.find((s) => s.id === input.schoolId)
  const dateKey = fmtDate(input.date)
  const existing = db.data.meals.find(
    (m) => m.schoolId === input.schoolId && fmtDate(m.date) === dateKey,
  )

  // Auktoritativ kontroll – uppdatering av befintlig dag eller ny dag.
  authorize(principal, existing ? 'update' : 'create', 'meal', {
    organizationId: school?.organizationId,
    schoolId: input.schoolId,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  let saved: MealPlan
  let previous: string | null = null
  if (existing) {
    previous = existing.lunch || null
    existing.lunch = input.lunch.trim()
    existing.vegetarian = input.vegetarian.trim()
    existing.allergens = [...input.allergens]
    saved = existing
  } else {
    saved = {
      id: nextId('meal'),
      schoolId: input.schoolId,
      date: input.date,
      lunch: input.lunch.trim(),
      vegetarian: input.vegetarian.trim(),
      allergens: [...input.allergens],
    }
    db.data.meals.push(saved)
  }

  logAudit(actorFromPrincipal(principal, input.schoolId), {
    action: existing ? 'meal.update' : 'meal.create',
    resource: 'meal',
    targetId: saved.id,
    targetLabel: `Matsedel · ${dateKey}`,
    previousValue: previous,
    newValue: saved.lunch,
    riskLevel: 'låg',
  })
  return saved
}

/** Första måndagen strikt efter angivet datum. */
function nextMonday(after: Date): Date {
  const d = new Date(after)
  d.setHours(0, 0, 0, 0)
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() !== 1)
  return d
}

/**
 * Skapar nästa veckas fem dagar (mån–fre) med tomma rätter, redo att fyllas i.
 * Returnerar veckans måndag så vyn kan hoppa dit.
 */
export function createNextWeek(principal: Principal, schoolId: string): Date {
  const school = db.data.schools.find((s) => s.id === schoolId)
  authorize(principal, 'create', 'meal', {
    organizationId: school?.organizationId,
    schoolId,
  })

  const rl = checkRateLimit('api', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const schoolMeals = db.data.meals.filter((m) => m.schoolId === schoolId)
  const lastTime = schoolMeals.reduce((max, m) => Math.max(max, new Date(m.date).getTime()), 0)
  const monday = nextMonday(lastTime ? new Date(lastTime) : new Date())

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    d.setHours(11, 30, 0, 0)
    db.data.meals.push({
      id: nextId('meal'),
      schoolId,
      date: d.toISOString(),
      lunch: '',
      vegetarian: '',
      allergens: [],
    })
  }

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'meal.week_create',
    resource: 'meal',
    targetLabel: `Ny matsedelsvecka fr.o.m. ${fmtDate(monday)}`,
    newValue: '5 dagar (mån–fre)',
    riskLevel: 'låg',
  })
  return monday
}

/**
 * Beställer en export av specialkostlistan (klass 4 – känslig). Går via det
 * centrala rapportlagret som auktoriserar, rate-limitar och auditloggar.
 */
export function exportSpecialDietList(
  principal: Principal,
  schoolId: string,
  rowCount: number,
): ReportJob {
  const school = db.data.schools.find((s) => s.id === schoolId)
  return createReport(principal, {
    type: 'meal',
    title: `Specialkostlista – ${school?.name ?? 'skolan'}`,
    format: 'csv',
    reason: 'Underlag till köket (endast antal, inga elevnamn)',
    schoolId,
    classification: 4,
    rowEstimate: rowCount,
  })
}
