import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RoleKey, AppMode } from '@/core/domain/roles'
import { ROLES } from '@/core/domain/roles'

export type Theme = 'light' | 'dark'

interface SessionState {
  /** Demo-inloggning: falskt visar inloggningssidan. */
  authenticated: boolean
  role: RoleKey
  mode: AppMode
  schoolId: string
  schoolYearId: string
  theme: Theme
  /** MFA uppfylld i sessionen (för administrativa åtgärder). */
  mfaSatisfied: boolean
  /** Aktiv supportsession (systemroller). */
  supportActive: boolean
  breakGlass: boolean
  /** Guidad tur som ska (om)startas för aktuell vy. */
  tourRestartKey: number
  /** Simulerat uppkopplingsläge för felhantering. */
  connection: 'online' | 'offline' | 'reconnecting'

  /** Loggar in som vald roll (demo-identitet). */
  login: (role: RoleKey) => void
  logout: () => void
  setRole: (role: RoleKey) => void
  setMode: (mode: AppMode) => void
  setSchool: (schoolId: string) => void
  setYear: (yearId: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setMfa: (v: boolean) => void
  setSupportActive: (v: boolean) => void
  setBreakGlass: (v: boolean) => void
  restartTour: () => void
  setConnection: (c: SessionState['connection']) => void
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      authenticated: true,
      role: 'rektor',
      mode: 'admin',
      schoolId: 'sch-bjorkeberga',
      schoolYearId: 'sy-2526',
      theme: 'light',
      mfaSatisfied: true,
      supportActive: false,
      breakGlass: false,
      tourRestartKey: 0,
      connection: 'online',

      login: (role) =>
        set({
          authenticated: true,
          role,
          mode: ROLES[role].defaultMode,
          mfaSatisfied: !ROLES[role].requiresMfa ? true : false,
          supportActive: false,
          breakGlass: false,
        }),
      logout: () =>
        set({ authenticated: false, supportActive: false, breakGlass: false }),
      setRole: (role) => set({ role, mode: ROLES[role].defaultMode }),
      setMode: (mode) => set({ mode }),
      setSchool: (schoolId) => set({ schoolId }),
      setYear: (schoolYearId) => set({ schoolYearId }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
      setMfa: (mfaSatisfied) => set({ mfaSatisfied }),
      setSupportActive: (supportActive) => set({ supportActive }),
      setBreakGlass: (breakGlass) => set({ breakGlass }),
      restartTour: () => set({ tourRestartKey: get().tourRestartKey + 1 }),
      setConnection: (connection) => set({ connection }),
    }),
    {
      name: 'skolnav-session',
      partialize: (s) => ({
        authenticated: s.authenticated,
        role: s.role,
        mode: s.mode,
        schoolId: s.schoolId,
        schoolYearId: s.schoolYearId,
        theme: s.theme,
      }),
    },
  ),
)

/** Applicera tema/läge på <html> – anropas från providers. */
export function applyDocumentAttributes(theme: Theme, mode: AppMode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-mode', mode)
}
