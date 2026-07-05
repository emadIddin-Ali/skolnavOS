import { useNavigate } from 'react-router-dom'
import { usePrincipal } from '@/core/permissions/usePermission'
import { useSession } from '@/core/state/session'
import { db } from '@/data/db/store'
import { ROLES } from '@/core/domain/roles'
import { MODES } from '@/core/domain/modes'
import { dashboardMetrics, studentsInScope } from './metrics'
import type { Tone } from '@/ui'
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, ProgressRing, Button, Avatar, Badge,
  SectionTitle, Checklist, Icon,
} from '@/ui'
import { fmtDateLong, fmtRelative } from '@/lib/format'

export function Dashboard() {
  const principal = usePrincipal()
  const mode = useSession((s) => s.mode)
  const navigate = useNavigate()
  const meta = ROLES[principal.role]
  const user = db.data.users.find((u) => u.id === principal.userId)
  const m = dashboardMetrics(principal)
  const school = db.data.schools.find((s) => s.id === principal.schoolIds[0])

  const isGuardian = principal.role === 'vardnadshavare'
  const isStudent = principal.role === 'elev_grund' || principal.role === 'elev_gy'
  const kids = studentsInScope(principal)

  return (
    <>
      <PageHeader
        title={`Hej ${user?.name?.split(' ')[0] ?? ''}!`}
        subtitle={`${fmtDateLong(new Date())} · ${meta.label}${school ? ` · ${school.name}` : ''} · Läge: ${MODES[mode].label}`}
        icon={meta.icon}
        actions={<Button variant="secondary" size="sm" icon="Compass" onClick={() => useSession.getState().restartTour()}>Guidad tur</Button>}
      />

      {/* Vårdnadshavare: barnkort */}
      {isGuardian && kids.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Mina barn</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kids.map((kid) => {
              const rel = db.data.relations.find((r) => r.studentId === kid.id && r.guardianUserId === principal.userId)
              return (
                <Card key={kid.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={`${kid.firstName} ${kid.lastName}`} color={kid.photoColor} size="lg" />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{kid.firstName} {kid.lastName}</p>
                      <p className="text-2xs text-ink-subtle">{kid.gradeLabel} · {db.data.schools.find((s) => s.id === kid.schoolId)?.name}</p>
                    </div>
                  </div>
                  {rel?.conflictNote && <Badge tone="warning" icon="TriangleAlert" className="mt-2">Observera vid hämtning</Badge>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon="CalendarX" onClick={() => navigate('/franvaro')}>Anmäl frånvaro</Button>
                    <Button size="sm" variant="ghost" icon="CalendarDays" onClick={() => navigate('/schema')}>Schema</Button>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Elev: nästa steg */}
      {isStudent && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Nästa lektion" value="Matematik" hint="Sal 3 · 08:15" icon="CalendarClock" tone="primary" onClick={() => navigate('/schema')} />
          <StatCard label="Uppgifter kvar" value={db.data.assignments.length} hint="Se deadlines" icon="ClipboardCheck" tone="warning" onClick={() => navigate('/uppgifter')} />
          <StatCard label="Olästa meddelanden" value={m.unreadMessages} icon="MessageSquare" tone="info" onClick={() => navigate('/meddelanden')} />
        </div>
      )}

      {/* Operativa nyckeltal (personal/ledning) */}
      {!isStudent && !isGuardian && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex items-center gap-4 p-4">
            <ProgressRing value={m.attendanceRate} tone={m.attendanceRate >= 90 ? 'success' : 'warning'} sublabel="närvaro" />
            <div>
              <p className="text-sm font-medium text-ink">Närvaro idag</p>
              <p className="text-2xs text-ink-subtle">{m.present} närvarande · {m.absent} frånvarande · {m.late} sena</p>
              {m.unmarked > 0 && <Badge tone="warning" className="mt-1">{m.unmarked} ej markerade</Badge>}
            </div>
          </Card>
          <StatCard label="Elever i din vy" value={m.studentCount} icon="Users" tone="primary" onClick={() => navigate('/elever')} />
          <StatCard label="Frånvaro att hantera" value={m.pendingAbsence} icon="CalendarX" tone={m.pendingAbsence ? 'warning' : 'neutral'} onClick={() => navigate('/franvaro')} />
          <StatCard label="Olästa meddelanden" value={m.unreadMessages} icon="MessageSquare" tone="info" onClick={() => navigate('/meddelanden')} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Att göra idag */}
        <Card className="lg:col-span-2">
          <CardHeader title="Att göra idag" icon="ListChecks" subtitle="Prioriterat utifrån din roll" />
          <CardBody className="space-y-2">
            {buildTodo(m).map((t, i) => (
              <button
                key={i}
                onClick={() => navigate(t.to)}
                className="flex w-full items-center gap-3 rounded-field border border-border p-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field" style={{ backgroundColor: `rgb(var(--c-${t.tone}) / 0.14)`, color: `rgb(var(--c-${t.tone}))` }}>
                  <Icon name={t.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-ink">{t.label}</span>
                  <span className="block text-2xs text-ink-subtle">{t.hint}</span>
                </span>
                {t.count != null && <Badge tone={t.count > 0 ? t.tone : 'neutral'}>{t.count}</Badge>}
                <Icon name="ChevronRight" className="h-4 w-4 text-ink-subtle" />
              </button>
            ))}
          </CardBody>
        </Card>

        {/* Onboarding / kom igång */}
        <Card>
          <CardHeader title="Kom igång" icon="Sparkles" subtitle="Din onboarding" />
          <CardBody>
            <div className="mb-3 flex items-center gap-3">
              <ProgressRing value={60} size={48} stroke={5} tone="primary" />
              <p className="text-sm text-ink-muted">3 av 5 steg klara</p>
            </div>
            <Checklist
              items={[
                { label: 'Verifiera din profil', done: true },
                { label: 'Ställ in notiser', done: true },
                { label: 'Bekanta dig med navigeringen', done: true },
                { label: 'Gå den guidade turen', done: false, hint: 'Startas från användarmenyn' },
                { label: 'Anpassa ditt läge', done: false },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      {/* Anslag + notiser */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Anslag" icon="Megaphone" action={<Button variant="ghost" size="sm" onClick={() => navigate('/anslag')}>Alla</Button>} />
          <CardBody className="space-y-2">
            {db.data.announcements.slice(0, 3).map((a) => (
              <div key={a.id} className="rounded-field border border-border p-3">
                <div className="flex items-center gap-2">
                  {a.urgent && <Badge tone="danger" icon="TriangleAlert">Viktigt</Badge>}
                  <p className="text-sm font-medium text-ink">{a.title}</p>
                </div>
                <p className="mt-1 text-2xs text-ink-muted line-clamp-2">{a.body}</p>
                <p className="mt-1 text-2xs text-ink-subtle">{fmtRelative(a.publishedAt)}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Senaste aktivitet" icon="Activity" />
          <CardBody className="space-y-2">
            {db.data.auditLogs.slice(0, 5).map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-sm">
                <Icon name="Dot" className="h-4 w-4 text-ink-subtle" />
                <span className="flex-1 text-ink-muted"><span className="font-mono text-2xs text-ink">{l.action}</span> · {l.targetLabel}</span>
                <span className="text-2xs text-ink-subtle whitespace-nowrap">{fmtRelative(l.at)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function buildTodo(m: ReturnType<typeof dashboardMetrics>) {
  const items: { label: string; hint: string; icon: string; tone: Tone; to: string; count?: number }[] = []
  if (m.unmarked > 0) items.push({ label: 'Markera dagens närvaro', hint: `${m.unmarked} elever saknar markering`, icon: 'UserCheck', tone: 'warning', to: '/narvaro', count: m.unmarked })
  if (m.pendingAbsence > 0) items.push({ label: 'Hantera frånvaroanmälningar', hint: 'Väntar på bekräftelse', icon: 'CalendarX', tone: 'info', to: '/franvaro', count: m.pendingAbsence })
  if (m.pendingConsents > 0) items.push({ label: 'Samtycken att följa upp', hint: 'Ej fullständigt signerade', icon: 'FileSignature', tone: 'primary', to: '/samtycken', count: m.pendingConsents })
  if (m.unreadMessages > 0) items.push({ label: 'Läs nya meddelanden', hint: 'Olästa konversationer', icon: 'MessageSquare', tone: 'info', to: '/meddelanden', count: m.unreadMessages })
  if (m.openIncidents > 0) items.push({ label: 'Öppna incidenter', hint: 'Under utredning', icon: 'ShieldAlert', tone: 'danger', to: '/incidenter', count: m.openIncidents })
  if (m.securityOpen > 0) items.push({ label: 'Granska säkerhetshändelser', hint: 'Ej åtgärdade', icon: 'Lock', tone: 'danger', to: '/sakerhet', count: m.securityOpen })
  if (m.gdprOpen > 0) items.push({ label: 'GDPR-begäranden', hint: 'Kräver handläggning', icon: 'ShieldCheck', tone: 'warning', to: '/gdpr', count: m.gdprOpen })
  if (m.integrationIssues > 0) items.push({ label: 'Integrationer behöver åtgärd', hint: 'Fel eller saknad konfiguration', icon: 'Plug', tone: 'warning', to: '/integrationer', count: m.integrationIssues })
  if (m.rateWarnings > 0) items.push({ label: 'Gränser & kvoter', hint: 'Aktiva begränsningar', icon: 'Gauge', tone: 'warning', to: '/granser', count: m.rateWarnings })
  if (items.length === 0) items.push({ label: 'Allt är i ordning', hint: 'Inga öppna uppgifter just nu', icon: 'CheckCircle2', tone: 'success', to: '/' })
  return items.slice(0, 6)
}
