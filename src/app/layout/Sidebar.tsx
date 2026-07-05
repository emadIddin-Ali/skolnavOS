import { NavLink } from 'react-router-dom'
import { useMemo } from 'react'
import { usePrincipal } from '@/core/permissions/usePermission'
import { useSession } from '@/core/state/session'
import { buildNav } from '@/app/navigation'
import { ROLES } from '@/core/domain/roles'
import { Icon } from '@/ui'
import { cn } from '@/lib/cn'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const principal = usePrincipal()
  const mode = useSession((s) => s.mode)
  const sections = useMemo(() => buildNav(principal, mode), [principal, mode])
  const meta = ROLES[principal.role]

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4" aria-label="Huvudmeny" data-tour="nav">
      <div className="mb-3 flex items-center gap-2.5 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-field bg-primary text-primary-fg">
          <Icon name="Hexagon" className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">Skolnav OS</p>
          <p className="text-2xs text-ink-subtle">{meta.short}</p>
        </div>
      </div>

      {sections.map((sec) => (
        <div key={sec.section} className="mb-1">
          {sec.section !== 'oversikt' && (
            <p className="px-2 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{sec.label}</p>
          )}
          <ul className="space-y-0.5">
            {sec.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-field px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon name={item.icon} className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-primary' : 'text-ink-subtle')} />
                      <span className="truncate">{item.resolvedLabel}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-auto px-2 pt-4">
        <p className="text-2xs text-ink-subtle">
          {meta.machine ? 'Maskinkonto' : meta.requiresMfa ? 'Kräver stark autentisering' : 'Standardbehörighet'}
        </p>
      </div>
    </nav>
  )
}
