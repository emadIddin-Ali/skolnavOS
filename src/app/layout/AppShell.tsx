import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ModeSwitcher, RoleSwitcher, SchoolSwitcher, YearSwitcher } from './Switchers'
import { useSession } from '@/core/state/session'
import { usePrincipal } from '@/core/permissions/usePermission'
import { db } from '@/data/db/store'
import { ROLES } from '@/core/domain/roles'
import { Icon, Button } from '@/ui'
import { GuidedTour } from '@/core/tours/GuidedTour'
import { fmtRelative } from '@/lib/format'
import { cn } from '@/lib/cn'

function Banner({ tone, icon, children }: { tone: 'warning' | 'danger' | 'info' | 'success'; icon: string; children: React.ReactNode }) {
  const tones = {
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    success: 'bg-success-soft text-success',
  }
  return (
    <div className={cn('flex items-center gap-2 px-4 py-2 text-sm', tones[tone])}>
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Banners() {
  const connection = useSession((s) => s.connection)
  const setConnection = useSession((s) => s.setConnection)
  const supportActive = useSession((s) => s.supportActive)
  const setSupportActive = useSession((s) => s.setSupportActive)
  const breakGlass = useSession((s) => s.breakGlass)
  const principal = usePrincipal()

  const expired = principal.validUntil && new Date().toISOString() > principal.validUntil
  const supportSession = db.data.supportSessions.find((s) => s.status === 'aktiv')

  return (
    <>
      {connection === 'offline' && (
        <Banner tone="warning" icon="WifiOff">
          Du är offline. Ändringar sparas lokalt och synkas när anslutningen är tillbaka.
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setConnection('online')}>Återanslut</Button>
        </Banner>
      )}
      {connection === 'reconnecting' && <Banner tone="info" icon="RefreshCw">Återansluter …</Banner>}
      {breakGlass && (
        <Banner tone="danger" icon="ShieldAlert">
          Break-glass-åtkomst är aktiv. All aktivitet loggas med hög risknivå och granskas i efterhand.
        </Banner>
      )}
      {supportActive && (
        <Banner tone="info" icon="LifeBuoy">
          Supportsession aktiv{supportSession ? ` · ${supportSession.reason}` : ''}
          {supportSession?.expiresAt ? ` · giltig till ${fmtRelative(supportSession.expiresAt)}` : ''}.
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setSupportActive(false)}>Avsluta</Button>
        </Banner>
      )}
      {principal.role === 'vikarie' && (
        <Banner tone={expired ? 'danger' : 'warning'} icon="Clock">
          {expired
            ? 'Din tillfälliga behörighet har gått ut. Du kan bara läsa tidigare information.'
            : `Tillfällig behörighet (vikariat) · giltig till ${principal.validUntil ? fmtRelative(principal.validUntil) : 'okänt'}.`}
        </Banner>
      )}
    </>
  )
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const authenticated = useSession((s) => s.authenticated)
  const principal = usePrincipal()
  const meta = ROLES[principal.role]

  // Auth-skyddat skal: utloggad session skickas till inloggningen.
  if (!authenticated) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* Desktop-sidomeny */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobil drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-border bg-surface shadow-pop animate-slide-up">
            {/* Växlare som är dolda i topbaren på små skärmar */}
            <div className="flex flex-col gap-2 border-b border-border p-3 md:hidden">
              <RoleSwitcher />
              <SchoolSwitcher />
              <YearSwitcher />
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar onNavigate={() => setDrawer(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setDrawer(true)} />
        <Banners />

        {/* Lägesväxlare + kontext */}
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 sm:px-5" data-tour="mode">
          <ModeSwitcher compact />
          <span className="hidden items-center gap-1.5 text-2xs text-ink-subtle sm:flex">
            <Icon name={meta.icon} className="h-3.5 w-3.5" />
            {meta.description}
          </span>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-5 lg:px-8">
          <Outlet />
        </main>
      </div>

      <GuidedTour />
    </div>
  )
}
