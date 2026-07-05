import { describe, it, expect, beforeAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/app/providers'
import { useSession } from '@/core/state/session'
import type { RoleKey } from '@/core/domain/roles'

import { Dashboard } from '@/modules/dashboard/Dashboard'
import { AttendancePage } from '@/modules/attendance/AttendancePage'
import { AbsencePage } from '@/modules/absence/AbsencePage'
import { GuardiansPage } from '@/modules/guardians/GuardiansPage'
import { MessagesPage } from '@/modules/messages/MessagesPage'
import { IntegrationsPage } from '@/modules/integrations/IntegrationsPage'
import { GdprPage } from '@/modules/gdpr/GdprPage'
import { SecurityPage } from '@/modules/security/SecurityPage'
import { SupportPage } from '@/modules/support/SupportPage'
import { SchedulePage } from '@/modules/schedule/SchedulePage'
import { AssignmentsPage } from '@/modules/assignments/AssignmentsPage'
import { AssessmentsPage } from '@/modules/assessments/AssessmentsPage'
import { AnnouncementsPage } from '@/modules/announcements/AnnouncementsPage'
import { DocumentationPage } from '@/modules/documentation/DocumentationPage'
import { MealsPage } from '@/modules/meals/MealsPage'
import { PickupPage } from '@/modules/pickup/PickupPage'
import { OrganizationPage } from '@/modules/organization/OrganizationPage'
import { SchoolPage } from '@/modules/school/SchoolPage'
import { SystemHealthPage } from '@/modules/system/SystemHealthPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { ProfilePage } from '@/modules/profile/ProfilePage'
import { NotificationsPage } from '@/modules/notifications/NotificationsPage'
import { ReportsPage } from '@/modules/reports/ReportsPage'
import { ImportsPage } from '@/modules/imports/ImportsPage'
import { FilesPage } from '@/modules/files/FilesPage'
import { IncidentsPage } from '@/modules/incidents/IncidentsPage'
import { ConsentsPage } from '@/modules/consents/ConsentsPage'
import { HealthPage } from '@/modules/health/HealthPage'
import { LoginPage } from '@/modules/auth/LoginPage'

// jsdom-shims
beforeAll(() => {
  if (!window.matchMedia) {
    // @ts-expect-error test shim
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  }
})

function renderAs(role: RoleKey, ui: React.ReactElement) {
  useSession.setState({
    authenticated: true,
    role,
    schoolId: 'sch-bjorkeberga',
    mode: 'admin',
    supportActive: false,
    breakGlass: false,
    mfaSatisfied: true,
    connection: 'online',
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const pages: [string, React.ReactElement][] = [
  ['Dashboard', <Dashboard />],
  ['Schedule', <SchedulePage />],
  ['Attendance', <AttendancePage />],
  ['Absence', <AbsencePage />],
  ['Assignments', <AssignmentsPage />],
  ['Assessments', <AssessmentsPage />],
  ['Messages', <MessagesPage />],
  ['Announcements', <AnnouncementsPage />],
  ['Documentation', <DocumentationPage />],
  ['Meals', <MealsPage />],
  ['Pickup', <PickupPage />],
  ['Notifications', <NotificationsPage />],
  ['Guardians', <GuardiansPage />],
  ['Health', <HealthPage />],
  ['Incidents', <IncidentsPage />],
  ['Consents', <ConsentsPage />],
  ['Files', <FilesPage />],
  ['Reports', <ReportsPage />],
  ['Imports', <ImportsPage />],
  ['GDPR', <GdprPage />],
  ['Security', <SecurityPage />],
  ['Support', <SupportPage />],
  ['Integrations', <IntegrationsPage />],
  ['Organization', <OrganizationPage />],
  ['School', <SchoolPage />],
  ['SystemHealth', <SystemHealthPage />],
  ['Settings', <SettingsPage />],
  ['Profile', <ProfilePage />],
]

describe('alla sidor renderar utan krasch (roll: rektor)', () => {
  for (const [name, el] of pages) {
    it(`${name} renderar`, () => {
      const { container } = renderAs('rektor', el)
      expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
      cleanup()
    })
  }
})

describe('rollanpassad dashboard renderar för nyckelroller', () => {
  const roles: RoleKey[] = ['huvudman', 'larare', 'mentor', 'vardnadshavare', 'elev_grund', 'elev_gy', 'kurator', 'it_support', 'granskare', 'koksansvarig']
  for (const role of roles) {
    it(`dashboard – ${role}`, () => {
      const { container } = renderAs(role, <Dashboard />)
      expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
      cleanup()
    })
  }
})

describe('rollstyrda vyer', () => {
  it('Absence som vårdnadshavare renderar', () => {
    const { container } = renderAs('vardnadshavare', <AbsencePage />)
    expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
    cleanup()
  })
  it('Schedule som elev renderar', () => {
    const { container } = renderAs('elev_grund', <SchedulePage />)
    expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
    cleanup()
  })
  it('Consents som vårdnadshavare renderar', () => {
    const { container } = renderAs('vardnadshavare', <ConsentsPage />)
    expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
    cleanup()
  })
  it('Meals som köksansvarig renderar', () => {
    const { container } = renderAs('koksansvarig', <MealsPage />)
    expect(container.textContent && container.textContent.length).toBeGreaterThan(0)
    cleanup()
  })
})

describe('inloggning', () => {
  it('LoginPage renderar för utloggad session', () => {
    useSession.setState({ authenticated: false })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.textContent).toContain('Skolnav')
    cleanup()
    useSession.setState({ authenticated: true })
  })
})
