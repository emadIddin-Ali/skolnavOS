import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, SectionTitle, Card, CardBody, CardHeader, Button, Badge, StatusBadge,
  ClassificationBadge, StatCard, Modal, TextInput, Icon, DataTable,
  EmptyState, DeniedState, Skeleton, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { MealPlan, HealthRecord } from '@/data/schema'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ALLERGENS, saveMealDay, createNextWeek, exportSpecialDietList } from './service'

// ---- Hjälpare för veckologik (mån–fre) ----
const DAY_NAMES = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag'] as const

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Måndag 00:00 i samma vecka. */
function startOfWeek(input: Date): Date {
  const d = new Date(input)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

/** ISO 8601-veckonummer. */
function isoWeek(input: Date): number {
  const date = new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/** Lokal Date från nyckel "yyyy-MM-dd". */
function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface DaySlot {
  dayName: string
  date: Date
  dateKey: string
  meal: MealPlan | null
  isToday: boolean
}

const SEVERITY_TONE: Record<HealthRecord['severity'], Tone> = {
  'låg': 'neutral',
  medel: 'info',
  'hög': 'warning',
  kritisk: 'danger',
}
const SEVERITY_ORDER: HealthRecord['severity'][] = ['låg', 'medel', 'hög', 'kritisk']

interface DietRow {
  id: string
  label: string
  kind: 'allergi' | 'specialkost'
  count: number
  maxSeverity: HealthRecord['severity']
}

export function MealsPage() {
  const principal = usePrincipal()
  const mealDecision = usePermission('read', 'meal')
  const healthDecision = usePermission('read', 'health')
  const canEditMeal = usePermission('update', 'meal').allowed
  const canCreateMeal = usePermission('create', 'meal').allowed
  const isGuardian = principal.role === 'vardnadshavare'

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ dateKey: string; dayName: string; meal: MealPlan | null } | null>(null)
  const [creatingWeek, setCreatingWeek] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    pause(250).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Skola: första skolan i principalens räckvidd som har matsedel.
  const schoolId = useMemo(() => {
    void refresh
    return (
      principal.schoolIds.find((id) => db.data.meals.some((m) => m.schoolId === id)) ??
      principal.schoolIds[0] ??
      null
    )
  }, [principal, refresh])
  const school = byId(db.data.schools, schoolId)

  // Veckor (nyckel = måndagens datum). Helgdagar visas inte i mån–fre-vyn.
  const weeks = useMemo(() => {
    void refresh
    const map = new Map<string, MealPlan[]>()
    if (!schoolId) return map
    for (const m of db.data.meals) {
      if (m.schoolId !== schoolId) continue
      const d = new Date(m.date)
      const wd = d.getDay()
      if (wd === 0 || wd === 6) continue
      const key = fmtDate(startOfWeek(d))
      const arr = map.get(key) ?? []
      arr.push(m)
      map.set(key, arr)
    }
    return map
  }, [schoolId, refresh])

  const weekKeys = useMemo(() => [...weeks.keys()].sort(), [weeks])
  const todayKey = fmtDate(new Date())
  const todayWeekKey = fmtDate(startOfWeek(new Date()))
  const defaultWeek = weekKeys.find((k) => k >= todayWeekKey) ?? weekKeys[weekKeys.length - 1] ?? null
  const activeWeek = selectedWeek && weekKeys.includes(selectedWeek) ? selectedWeek : defaultWeek
  const weekIndex = activeWeek ? weekKeys.indexOf(activeWeek) : -1

  const days = useMemo<DaySlot[]>(() => {
    if (!activeWeek) return []
    const monday = parseKey(activeWeek)
    const items = weeks.get(activeWeek) ?? []
    return DAY_NAMES.map((dayName, i) => {
      const date = addDays(monday, i)
      const dateKey = fmtDate(date)
      return {
        dayName,
        date,
        dateKey,
        meal: items.find((m) => fmtDate(m.date) === dateKey) ?? null,
        isToday: dateKey === todayKey,
      }
    })
  }, [activeWeek, weeks, todayKey])

  // Specialkost-aggregat: ENDAST antal, aldrig elevnamn.
  const diet = useMemo(() => {
    void refresh
    const map = new Map<string, DietRow>()
    let total = 0
    let allergi = 0
    let critical = 0
    for (const h of db.data.health) {
      if (h.kind !== 'specialkost' && h.kind !== 'allergi') continue
      const decision = can(principal, 'read', 'health', {
        organizationId: h.organizationId,
        schoolId: h.schoolId,
        studentId: h.studentId,
        dataClassification: h.dataClassification,
      })
      if (!decision.allowed) continue
      total += 1
      if (h.kind === 'allergi') allergi += 1
      if (h.severity === 'kritisk') critical += 1
      const key = `${h.kind}:${h.label}`
      const row = map.get(key) ?? {
        id: key,
        label: h.label,
        kind: h.kind,
        count: 0,
        maxSeverity: 'låg' as HealthRecord['severity'],
      }
      row.count += 1
      if (SEVERITY_ORDER.indexOf(h.severity) > SEVERITY_ORDER.indexOf(row.maxSeverity)) {
        row.maxSeverity = h.severity
      }
      map.set(key, row)
    }
    const rows = [...map.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'sv'),
    )
    return { rows, total, allergi, critical }
  }, [principal, refresh])

  const showDietSection = healthDecision.allowed && !isGuardian
  const pageDenied = !mealDecision.allowed && !showDietSection

  async function handleCreateWeek() {
    if (!schoolId) return
    setCreatingWeek(true)
    await pause(350)
    try {
      const monday = createNextWeek(principal, schoolId)
      setSelectedWeek(fmtDate(monday))
      bump()
      toast.success('Ny vecka skapad', `Vecka ${isoWeek(monday)} är upplagd – fyll i rätterna per dag.`)
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Kunde inte skapa veckan', 'Försök igen om en stund.')
    } finally {
      setCreatingWeek(false)
    }
  }

  async function handleExport() {
    if (!schoolId) return
    setExporting(true)
    await pause(300)
    try {
      exportSpecialDietList(principal, schoolId, diet.total)
      toast.success('Export beställd', 'Specialkostlistan bearbetas och blir klar under Exporter.')
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Export nekades', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Exportgräns nådd', e.message)
      else toast.error('Kunde inte skapa exporten', 'Försök igen om en stund.')
    } finally {
      setExporting(false)
    }
  }

  if (pageDenied) {
    return (
      <>
        <PageHeader title="Måltider" icon="UtensilsCrossed" />
        <Card>
          <DeniedState reason={mealDecision.reason} />
        </Card>
      </>
    )
  }

  const dietColumns: Column<DietRow>[] = [
    {
      key: 'label',
      header: 'Behov',
      render: (r) => <span className="font-medium text-ink">{r.label}</span>,
    },
    {
      key: 'kind',
      header: 'Kategori',
      render: (r) => (
        <Badge tone={r.kind === 'allergi' ? 'warning' : 'info'} icon={r.kind === 'allergi' ? 'Wheat' : 'UtensilsCrossed'}>
          {r.kind === 'allergi' ? 'Allergi' : 'Specialkost'}
        </Badge>
      ),
    },
    {
      key: 'severity',
      header: 'Högsta allvarlighetsgrad',
      hideOnMobile: true,
      render: (r) => (
        <StatusBadge
          tone={SEVERITY_TONE[r.maxSeverity]}
          label={r.maxSeverity.charAt(0).toUpperCase() + r.maxSeverity.slice(1)}
        />
      ),
    },
    {
      key: 'count',
      header: 'Antal barn',
      align: 'right',
      render: (r) => <span className="font-semibold tabular-nums text-ink">{r.count}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Måltider"
        icon="UtensilsCrossed"
        subtitle={
          school
            ? `Veckans matsedel för ${school.name}.`
            : 'Veckans matsedel och specialkost.'
        }
        actions={
          canCreateMeal && mealDecision.allowed ? (
            <Button icon="CalendarDays" loading={creatingWeek} onClick={handleCreateWeek}>
              Ny vecka
            </Button>
          ) : undefined
        }
      />

      {/* ---- Veckovy mån–fre ---- */}
      {mealDecision.allowed ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Veckans matsedel</SectionTitle>
            {activeWeek && (
              <div className="flex items-center gap-2">
                <span title={weekIndex <= 0 ? 'Ingen tidigare vecka' : 'Föregående vecka'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="ChevronLeft"
                    aria-label="Föregående vecka"
                    disabled={weekIndex <= 0}
                    onClick={() => setSelectedWeek(weekKeys[weekIndex - 1])}
                  />
                </span>
                <span className="text-sm font-medium text-ink tabular-nums">
                  Vecka {isoWeek(parseKey(activeWeek))}
                  <span className="hidden text-ink-subtle sm:inline">
                    {' '}· {fmtDate(parseKey(activeWeek))} – {fmtDate(addDays(parseKey(activeWeek), 4))}
                  </span>
                </span>
                <span title={weekIndex >= weekKeys.length - 1 ? 'Ingen senare vecka' : 'Nästa vecka'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="ChevronRight"
                    aria-label="Nästa vecka"
                    disabled={weekIndex >= weekKeys.length - 1}
                    onClick={() => setSelectedWeek(weekKeys[weekIndex + 1])}
                  />
                </span>
              </div>
            )}
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-card" />
              ))}
            </div>
          ) : !activeWeek ? (
            <Card>
              <EmptyState
                icon="UtensilsCrossed"
                title="Ingen matsedel publicerad"
                description="När köket publicerar veckans matsedel visas den här."
                actionLabel={canCreateMeal ? 'Skapa vecka' : undefined}
                onAction={canCreateMeal ? handleCreateWeek : undefined}
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {days.map((d) => {
                const planned = !!d.meal && d.meal.lunch.trim().length > 0
                return (
                  <Card
                    key={d.dateKey}
                    className={cn('flex flex-col', d.isToday && 'border-primary ring-1 ring-primary/35')}
                  >
                    <CardBody className="flex flex-1 flex-col gap-3 pt-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-ink">{d.dayName}</div>
                          <div className="text-2xs text-ink-subtle tabular-nums">{d.dateKey}</div>
                        </div>
                        {d.isToday && (
                          <Badge tone="primary" dot>
                            Idag
                          </Badge>
                        )}
                      </div>

                      {planned ? (
                        <div className="flex flex-1 flex-col gap-2.5">
                          <div className="flex items-start gap-2 text-sm text-ink">
                            <Icon name="UtensilsCrossed" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>{d.meal!.lunch}</span>
                          </div>
                          <div className="flex items-start gap-2 text-sm text-ink-muted">
                            <span title="Vegetariskt alternativ">
                              <Icon name="Heart" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                            </span>
                            <span>{d.meal!.vegetarian || 'Vegetariskt alternativ saknas'}</span>
                          </div>
                          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                            {d.meal!.allergens.length > 0 ? (
                              d.meal!.allergens.map((a) => (
                                <Badge key={a} tone="warning" icon="Wheat">
                                  {a}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-2xs text-ink-subtle">Inga märkta allergener</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 flex-col gap-1.5 text-sm text-ink-subtle">
                          <Icon name="CircleDashed" className="h-4 w-4" />
                          <span>Ingen rätt planerad ännu.</span>
                        </div>
                      )}

                      {canEditMeal && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="PencilLine"
                          className="mt-1 self-start"
                          onClick={() => setEditing({ dateKey: d.dateKey, dayName: d.dayName, meal: d.meal })}
                        >
                          {planned ? 'Redigera' : 'Planera dag'}
                        </Button>
                      )}
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <Card>
          <DeniedState reason={mealDecision.reason} />
        </Card>
      )}

      {/* ---- Specialkost & allergier (endast antal) ---- */}
      {showDietSection && (
        <section className="mt-6">
          <SectionTitle>Specialkost & allergier</SectionTitle>
          <Card>
            <CardHeader
              icon="ClipboardList"
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  Sammanställning för köket <ClassificationBadge level={4} />
                </span>
              }
              subtitle="Aggregerat underlag per kostbehov – uppdateras av elevhälsan."
              action={
                <span title={diet.total === 0 ? 'Inget att exportera' : 'Skapa CSV-export under Exporter'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="Download"
                    loading={exporting}
                    disabled={diet.total === 0}
                    onClick={handleExport}
                  >
                    Exportera lista
                  </Button>
                </span>
              }
            />
            <CardBody className="space-y-4">
              <div className="flex items-start gap-2 rounded-field border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
                <Icon name="EyeOff" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Av integritetsskäl visas endast antal – inga elevnamn. Namnlistor hanteras av elevhälsan.</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Registrerade behov" value={diet.total} icon="ClipboardList" tone="primary" />
                <StatCard label="Varav allergier" value={diet.allergi} icon="Wheat" tone={diet.allergi ? 'warning' : 'neutral'} />
                <StatCard label="Kritisk nivå" value={diet.critical} icon="TriangleAlert" tone={diet.critical ? 'danger' : 'neutral'} />
              </div>

              {loading ? (
                <Skeleton className="h-36 rounded-field" />
              ) : diet.rows.length === 0 ? (
                <EmptyState
                  icon="ClipboardList"
                  title="Ingen specialkost registrerad"
                  description="När elevhälsan registrerar allergier eller specialkost visas antalen här."
                />
              ) : (
                <div className="rounded-field border border-border">
                  <DataTable
                    columns={dietColumns}
                    rows={diet.rows}
                    caption="Specialkost och allergier – antal per behov"
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </section>
      )}

      {editing && schoolId && (
        <MealEditModal
          schoolId={schoolId}
          dateKey={editing.dateKey}
          dayName={editing.dayName}
          meal={editing.meal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Redigera/planera en dag (köksansvarig, skoladmin)
// ---------------------------------------------------------------------------

function MealEditModal({
  schoolId,
  dateKey,
  dayName,
  meal,
  onClose,
  onSaved,
}: {
  schoolId: string
  dateKey: string
  dayName: string
  meal: MealPlan | null
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const [lunch, setLunch] = useState(meal?.lunch ?? '')
  const [vegetarian, setVegetarian] = useState(meal?.vegetarian ?? '')
  const [allergens, setAllergens] = useState<string[]>(meal?.allergens ?? [])
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lunchError = lunch.trim().length < 3 ? 'Ange dagens lunchrätt (minst 3 tecken).' : null
  const vegError = vegetarian.trim().length < 3 ? 'Ange det vegetariska alternativet (minst 3 tecken).' : null
  const valid = !lunchError && !vegError

  function toggleAllergen(a: string) {
    setAllergens((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  }

  async function submit() {
    setError(null)
    if (!valid) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    await pause(400)
    try {
      saveMealDay(principal, {
        schoolId,
        date: meal?.date ?? new Date(`${dateKey}T11:30:00`).toISOString(),
        lunch,
        vegetarian,
        allergens,
      })
      toast.success('Matsedeln sparad', `${dayName} ${dateKey} är uppdaterad.`)
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else if (e instanceof RateLimitedError) setError(e.message)
      else setError('Det gick inte att spara just nu. Försök igen om en stund.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${dayName} · ${dateKey}`}
      description="Fyll i dagens lunch, vegetariskt alternativ och märk upp allergener."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon="Save" loading={saving} onClick={submit}>
            Spara matsedel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="meal-lunch" className="mb-1.5 block text-sm font-medium text-ink">
            Lunch <span className="text-danger">*</span>
          </label>
          <TextInput
            id="meal-lunch"
            icon="UtensilsCrossed"
            value={lunch}
            placeholder="T.ex. Köttbullar med potatismos och lingon"
            maxLength={120}
            onChange={(e) => setLunch(e.target.value)}
          />
          {showErrors && lunchError && <p className="mt-1 text-2xs text-danger">{lunchError}</p>}
        </div>

        <div>
          <label htmlFor="meal-veg" className="mb-1.5 block text-sm font-medium text-ink">
            Vegetariskt alternativ <span className="text-danger">*</span>
          </label>
          <TextInput
            id="meal-veg"
            icon="Heart"
            value={vegetarian}
            placeholder="T.ex. Vegetarisk gryta med bröd och sallad"
            maxLength={120}
            onChange={(e) => setVegetarian(e.target.value)}
          />
          {showErrors && vegError && <p className="mt-1 text-2xs text-danger">{vegError}</p>}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Allergener</span>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => {
              const active = allergens.includes(a)
              return (
                <button
                  type="button"
                  key={a}
                  onClick={() => toggleAllergen(a)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                    active
                      ? 'border-warning bg-warning-soft text-warning'
                      : 'border-border bg-surface text-ink-muted hover:bg-surface-2',
                  )}
                >
                  <Icon name="Wheat" className="h-3.5 w-3.5" />
                  {a}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-2xs text-ink-subtle">
            Markera de allergener som förekommer i någon av dagens rätter.
          </p>
        </div>
      </div>
    </Modal>
  )
}
