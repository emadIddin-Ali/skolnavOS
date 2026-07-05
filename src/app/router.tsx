import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { NAV_ITEMS } from './navigation'
import { LoadingRows, PageHeader, Card, CardBody, Button } from '@/ui'
import { ModuleScaffold } from '@/modules/_scaffold/ModuleScaffold'
import { DetailPlaceholder } from '@/modules/_scaffold/DetailPlaceholder'

const Dashboard = lazy(() => import('@/modules/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })))

// Skräddarsydda moduler – laddas lazy per route (route-nivå-kodklyvning).
const Attendance = lazy(() => import('@/modules/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })))
const Absence = lazy(() => import('@/modules/absence/AbsencePage').then((m) => ({ default: m.AbsencePage })))
const Messages = lazy(() => import('@/modules/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })))
const Integrations = lazy(() => import('@/modules/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })))
const Gdpr = lazy(() => import('@/modules/gdpr/GdprPage').then((m) => ({ default: m.GdprPage })))
const Security = lazy(() => import('@/modules/security/SecurityPage').then((m) => ({ default: m.SecurityPage })))
const Support = lazy(() => import('@/modules/support/SupportPage').then((m) => ({ default: m.SupportPage })))
const Guardians = lazy(() => import('@/modules/guardians/GuardiansPage').then((m) => ({ default: m.GuardiansPage })))
const Schedule = lazy(() => import('@/modules/schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const Assignments = lazy(() => import('@/modules/assignments/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })))
const Assessments = lazy(() => import('@/modules/assessments/AssessmentsPage').then((m) => ({ default: m.AssessmentsPage })))
const Announcements = lazy(() => import('@/modules/announcements/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })))
const Documentation = lazy(() => import('@/modules/documentation/DocumentationPage').then((m) => ({ default: m.DocumentationPage })))
const Meals = lazy(() => import('@/modules/meals/MealsPage').then((m) => ({ default: m.MealsPage })))
const Pickup = lazy(() => import('@/modules/pickup/PickupPage').then((m) => ({ default: m.PickupPage })))
const Organization = lazy(() => import('@/modules/organization/OrganizationPage').then((m) => ({ default: m.OrganizationPage })))
const School = lazy(() => import('@/modules/school/SchoolPage').then((m) => ({ default: m.SchoolPage })))
const SystemHealth = lazy(() => import('@/modules/system/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })))
const Settings = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const Profile = lazy(() => import('@/modules/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const Notifications = lazy(() => import('@/modules/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const Reports = lazy(() => import('@/modules/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const Imports = lazy(() => import('@/modules/imports/ImportsPage').then((m) => ({ default: m.ImportsPage })))
const Files = lazy(() => import('@/modules/files/FilesPage').then((m) => ({ default: m.FilesPage })))
const Incidents = lazy(() => import('@/modules/incidents/IncidentsPage').then((m) => ({ default: m.IncidentsPage })))
const Consents = lazy(() => import('@/modules/consents/ConsentsPage').then((m) => ({ default: m.ConsentsPage })))
const Health = lazy(() => import('@/modules/health/HealthPage').then((m) => ({ default: m.HealthPage })))
const Login = lazy(() => import('@/modules/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const ClassDetail = lazy(() => import('@/modules/classes/ClassDetailPage').then((m) => ({ default: m.ClassDetailPage })))
const CourseDetail = lazy(() => import('@/modules/courses/CourseDetailPage').then((m) => ({ default: m.CourseDetailPage })))
const StaffDetail = lazy(() => import('@/modules/staffdir/StaffDetailPage').then((m) => ({ default: m.StaffDetailPage })))

function Fallback() {
  return <div className="mx-auto max-w-3xl"><LoadingRows rows={7} /></div>
}
const S = (el: React.ReactNode) => <Suspense fallback={<Fallback />}>{el}</Suspense>

/** Rutter med skräddarsydd modul (övriga får den datadrivna scaffold-vyn). */
const BESPOKE: Record<string, React.ReactNode> = {
  '/schema': S(<Schedule />),
  '/narvaro': S(<Attendance />),
  '/franvaro': S(<Absence />),
  '/uppgifter': S(<Assignments />),
  '/bedomning': S(<Assessments />),
  '/meddelanden': S(<Messages />),
  '/anslag': S(<Announcements />),
  '/dokumentation': S(<Documentation />),
  '/maltider': S(<Meals />),
  '/hamtning': S(<Pickup />),
  '/notiser': S(<Notifications />),
  '/vardnadshavare': S(<Guardians />),
  '/halsa': S(<Health />),
  '/incidenter': S(<Incidents />),
  '/samtycken': S(<Consents />),
  '/dokument': S(<Files />),
  '/rapporter': S(<Reports />),
  '/import': S(<Imports />),
  '/gdpr': S(<Gdpr />),
  '/sakerhet': S(<Security />),
  '/support': S(<Support />),
  '/integrationer': S(<Integrations />),
  '/organisation': S(<Organization />),
  '/skola': S(<School />),
  '/systemhalsa': S(<SystemHealth />),
  '/installningar': S(<Settings />),
}

function NotFound() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Sidan hittades inte" icon="Compass" />
      <Card><CardBody className="py-12 text-center">
        <p className="text-ink-muted">Vägen leder ingenstans. Kontrollera adressen eller gå tillbaka till översikten.</p>
        <Button className="mt-4" onClick={() => navigate('/')}>Till översikten</Button>
      </CardBody></Card>
    </>
  )
}

const childRoutes = NAV_ITEMS.filter((i) => i.to !== '/').map((item) => ({
  path: item.to.slice(1),
  element: BESPOKE[item.to] ?? <ModuleScaffold />,
}))

export const router = createBrowserRouter([
  { path: '/login', element: S(<Login />) },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: S(<Dashboard />) },
      ...childRoutes,
      { path: 'elever/:id', element: <DetailPlaceholder resource="student" /> },
      { path: 'klasser/:id', element: S(<ClassDetail />) },
      { path: 'kurser/:id', element: S(<CourseDetail />) },
      { path: 'dokument/:id', element: <DetailPlaceholder resource="file" /> },
      { path: 'personal/:id', element: S(<StaffDetail />) },
      { path: 'profil', element: S(<Profile />) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
