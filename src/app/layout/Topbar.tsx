import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/core/state/session'
import { usePrincipal } from '@/core/permissions/usePermission'
import { db } from '@/data/db/store'
import { search } from '@/core/search/search'
import { listNotifications, unreadCount, markAllRead, markRead, confirmNotification } from '@/core/notifications/notifications'
import { ROLES } from '@/core/domain/roles'
import { Icon, Avatar, Badge } from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { RoleSwitcher, SchoolSwitcher, YearSwitcher, ThemeToggle } from './Switchers'
import { fmtRelative } from '@/lib/format'
import { cn } from '@/lib/cn'

function GlobalSearch() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => (q.length >= 2 ? search(principal, q) : []), [principal, q])

  return (
    <div className="relative w-full max-w-md">
      <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Sök i Skolnav …"
        aria-label="Sök i Skolnav"
        className="h-10 w-full rounded-field border border-border bg-surface-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      />
      {open && q.length >= 2 && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-panel border border-border bg-surface shadow-pop animate-slide-up">
          {groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Inga träffar för «{q}»</p>
          ) : (
            <div className="max-h-96 overflow-y-auto p-1.5">
              {groups.map((g) => (
                <div key={g.resource} className="mb-1">
                  <p className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{g.label}</p>
                  {g.hits.map((h) => (
                    <button
                      key={h.id}
                      onMouseDown={() => { navigate(h.href); setQ(''); setOpen(false) }}
                      className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-left hover:bg-surface-2"
                    >
                      <Icon name={h.protected ? 'ShieldAlert' : 'ArrowRight'} className="h-4 w-4 text-ink-subtle" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{h.title}</span>
                        <span className="block truncate text-2xs text-ink-subtle">{h.subtitle}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              <p className="border-t border-border px-2.5 py-1.5 text-2xs text-ink-subtle">
                Resultat filtreras efter din behörighet. Skyddade uppgifter maskeras.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationCenter() {
  const principal = usePrincipal()
  const [, force] = useState(0)
  const items = listNotifications(principal.userId)
  const unread = unreadCount(principal.userId)

  return (
    <Popover
      align="end"
      width="w-96"
      trigger={
        <button className="relative grid h-9 w-9 place-items-center rounded-field border border-border bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Notiser (${unread} olästa)`}>
          <Icon name="Bell" className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread}
            </span>
          )}
        </button>
      }
    >
      {() => (
        <div>
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <p className="text-sm font-semibold text-ink">Notiser</p>
            <button className="text-2xs text-primary hover:underline" onClick={() => { markAllRead(principal.userId); force((n) => n + 1) }}>
              Markera alla som lästa
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Inga notiser</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {items.slice(0, 12).map((n) => (
                <div key={n.id} className={cn('rounded-field px-2.5 py-2', !n.read && 'bg-primary-soft/40')}>
                  <div className="flex items-start gap-2">
                    <Icon name={n.urgent ? 'AlertTriangle' : 'Bell'} className={cn('mt-0.5 h-4 w-4 shrink-0', n.urgent ? 'text-danger' : 'text-ink-subtle')} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{n.title}</p>
                      <p className="text-2xs text-ink-muted">{n.body}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-2xs text-ink-subtle">{fmtRelative(n.createdAt)}</span>
                        {n.deliveryStatus !== 'levererad' && <Badge tone={n.deliveryStatus === 'misslyckad' ? 'danger' : 'neutral'}>{n.deliveryStatus}</Badge>}
                        {n.requiresConfirmation && !n.confirmedAt && (
                          <button className="text-2xs font-medium text-primary hover:underline" onClick={() => { confirmNotification(n.id); force((x) => x + 1) }}>
                            Bekräfta
                          </button>
                        )}
                        {!n.read && !n.requiresConfirmation && (
                          <button className="text-2xs text-ink-subtle hover:underline" onClick={() => { markRead(n.id); force((x) => x + 1) }}>
                            Markera läst
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

function UserMenu() {
  const principal = usePrincipal()
  const user = db.data.users.find((u) => u.id === principal.userId)
  const mfaSatisfied = useSession((s) => s.mfaSatisfied)
  const setMfa = useSession((s) => s.setMfa)
  const restartTour = useSession((s) => s.restartTour)
  const logout = useSession((s) => s.logout)
  const navigate = useNavigate()
  const meta = ROLES[principal.role]

  return (
    <Popover
      align="end"
      width="w-72"
      trigger={
        <button className="flex items-center gap-2 rounded-field p-0.5 pr-2 hover:bg-surface-2" aria-label="Användarmeny">
          <Avatar name={user?.name ?? 'Användare'} color={user?.avatarColor} size="sm" />
          <span className="hidden text-sm font-medium text-ink lg:block">{user?.name?.split(' ')[0]}</span>
          <Icon name="ChevronDown" className="hidden h-3.5 w-3.5 text-ink-subtle lg:block" />
        </button>
      }
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={user?.name ?? ''} color={user?.avatarColor} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
              <p className="truncate text-2xs text-ink-subtle">{meta.label}</p>
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <MenuItem icon="User" onClick={() => { navigate('/profil'); close() }}>Min profil</MenuItem>
          <MenuItem icon={mfaSatisfied ? 'ShieldCheck' : 'ShieldOff'} onClick={() => setMfa(!mfaSatisfied)}>
            {mfaSatisfied ? 'MFA aktiv' : 'MFA ej uppfylld'}
          </MenuItem>
          <MenuItem icon="Lock" onClick={() => { navigate('/sakerhet'); close() }}>Säkerhet</MenuItem>
          <MenuItem icon="Compass" onClick={() => { restartTour(); close() }}>Starta guidad tur</MenuItem>
          <div className="my-1 border-t border-border" />
          <MenuItem
            icon="LogOut"
            danger
            onClick={() => {
              close()
              logout()
              navigate('/login')
            }}
          >
            Logga ut
          </MenuItem>
        </div>
      )}
    </Popover>
  )
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur sm:px-5">
      <button onClick={onMenu} className="grid h-9 w-9 place-items-center rounded-field text-ink-muted hover:bg-surface-2 lg:hidden" aria-label="Öppna meny">
        <Icon name="Menu" className="h-5 w-5" />
      </button>
      <div className="hidden items-center gap-2 md:flex" data-tour="role">
        <RoleSwitcher />
        <SchoolSwitcher />
      </div>
      <div className="flex flex-1 justify-center px-2" data-tour="search">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden lg:block"><YearSwitcher /></div>
        <ThemeToggle />
        <span data-tour="notifications"><NotificationCenter /></span>
        <UserMenu />
      </div>
    </header>
  )
}
