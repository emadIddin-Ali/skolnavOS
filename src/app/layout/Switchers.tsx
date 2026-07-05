import { useSession } from '@/core/state/session'
import { usePrincipal } from '@/core/permissions/usePermission'
import { ROLES, ROLE_CATEGORY_LABEL, type RoleCategory, type RoleKey, ROLE_KEYS } from '@/core/domain/roles'
import { MODES, MODE_KEYS } from '@/core/domain/modes'
import { db } from '@/data/db/store'
import { Icon, Segmented } from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { cn } from '@/lib/cn'

function TriggerButton({ icon, label, sub, className }: { icon: string; label: string; sub?: string; className?: string }) {
  return (
    <button
      className={cn(
        'flex items-center gap-2 rounded-field border border-border bg-surface px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2',
        className,
      )}
    >
      <Icon name={icon} className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight text-ink">{label}</span>
        {sub && <span className="block truncate text-2xs leading-tight text-ink-subtle">{sub}</span>}
      </span>
      <Icon name="ChevronsUpDown" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
    </button>
  )
}

export function RoleSwitcher() {
  const role = useSession((s) => s.role)
  const setRole = useSession((s) => s.setRole)
  const meta = ROLES[role]

  const categories: RoleCategory[] = ['system', 'organisation', 'skolledning', 'personal', 'elevhalsa', 'elev', 'vardnadshavare']
  const byCat = (c: RoleCategory) => ROLE_KEYS.filter((k) => ROLES[k].category === c)

  return (
    <Popover
      align="start"
      width="w-80"
      trigger={<TriggerButton icon={meta.icon} label={meta.short} sub="Byt roll (demo)" />}
    >
      {(close) => (
        <div className="max-h-[60vh]">
          <p className="px-2.5 py-1.5 text-2xs uppercase tracking-wide text-ink-subtle">Visa systemet som</p>
          {categories.map((cat) => (
            <div key={cat} className="mb-1">
              <p className="px-2.5 pt-1.5 text-2xs font-semibold text-ink-subtle">{ROLE_CATEGORY_LABEL[cat]}</p>
              {byCat(cat).map((k) => (
                <MenuItem
                  key={k}
                  icon={ROLES[k].icon}
                  active={k === role}
                  onClick={() => {
                    setRole(k as RoleKey)
                    close()
                  }}
                >
                  {ROLES[k].label}
                </MenuItem>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function SchoolSwitcher() {
  const principal = usePrincipal()
  const schoolId = useSession((s) => s.schoolId)
  const setSchool = useSession((s) => s.setSchool)
  const schools = db.data.schools.filter((s) => principal.schoolIds.includes(s.id))
  const current = db.data.schools.find((s) => s.id === schoolId) ?? schools[0]

  if (schools.length <= 1) return null

  return (
    <Popover align="start" width="w-72" trigger={<TriggerButton icon="School" label={current?.name ?? 'Skola'} sub="Aktiv skola" />}>
      {(close) => (
        <div>
          <p className="px-2.5 py-1.5 text-2xs uppercase tracking-wide text-ink-subtle">Välj skola</p>
          {schools.map((s) => (
            <MenuItem key={s.id} icon="School" active={s.id === schoolId} onClick={() => { setSchool(s.id); close() }}>
              <span className="block">{s.name}</span>
              <span className="block text-2xs text-ink-subtle">{s.municipality}</span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function ModeSwitcher({ compact }: { compact?: boolean }) {
  const mode = useSession((s) => s.mode)
  const setMode = useSession((s) => s.setMode)
  return (
    <Segmented
      size={compact ? 'sm' : 'md'}
      value={mode}
      onChange={setMode}
      options={MODE_KEYS.map((k) => ({ value: k, label: MODES[k].label, icon: MODES[k].icon }))}
    />
  )
}

export function YearSwitcher() {
  const yearId = useSession((s) => s.schoolYearId)
  const setYear = useSession((s) => s.setYear)
  const years = db.data.schoolYears
  const current = years.find((y) => y.id === yearId) ?? years[0]
  return (
    <Popover align="end" width="w-56" trigger={<TriggerButton icon="CalendarRange" label={current?.label ?? 'Läsår'} sub="Läsår" />}>
      {(close) => (
        <div>
          {years.map((y) => (
            <MenuItem key={y.id} icon="CalendarRange" active={y.id === yearId} onClick={() => { setYear(y.id); close() }}>
              {y.label} {y.current && <span className="text-2xs text-success">· aktuellt</span>}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function ThemeToggle() {
  const theme = useSession((s) => s.theme)
  const toggle = useSession((s) => s.toggleTheme)
  return (
    <button
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-field border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label={theme === 'light' ? 'Byt till mörkt tema' : 'Byt till ljust tema'}
    >
      <Icon name={theme === 'light' ? 'Moon' : 'Sun'} className="h-4 w-4" />
    </button>
  )
}
