import { useParams, useNavigate } from 'react-router-dom'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { db } from '@/data/db/store'
import type { ResourceKey } from '@/core/domain/permissions'
import { PageHeader, Card, CardBody, DeniedState, Button, Avatar, Badge, ClassificationBadge } from '@/ui'
import { maskName, fmtDate } from '@/lib/format'

/** Generisk detaljvy tills modulens skräddarsydda detaljsida är byggd. */
export function DetailPlaceholder({ resource }: { resource: ResourceKey }) {
  if (resource === 'student') return <StudentDetail />
  return <GenericDetail resource={resource} />
}

function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const principal = usePrincipal()
  const s = db.data.students.find((x) => x.id === id)
  const decision = usePermission('read', 'student', s ? { organizationId: s.organizationId, schoolId: s.schoolId, classId: s.classId, studentId: s.id, protectedIdentity: s.protectedIdentity } : undefined)

  if (!s) return <NotFoundInline />
  if (!decision.allowed) return <><PageHeader title="Elevprofil" icon="User" /><Card><DeniedState reason={decision.reason} /></Card></>
  {
    const masked = s.protectedIdentity && decision.masked
    const name = masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`
    const rels = db.data.relations.filter((r) => r.studentId === s.id)
    return (
      <>
        <PageHeader
          title={name}
          subtitle={`${s.gradeLabel} · ${db.data.schools.find((x) => x.id === s.schoolId)?.name}`}
          breadcrumbs={[{ label: 'Elever & barn' }, { label: name }]}
          actions={<Button variant="secondary" size="sm" icon="ArrowLeft" onClick={() => navigate('/elever')}>Tillbaka</Button>}
        />
        {s.protectedIdentity && (
          <Card className="mb-4 border-danger/40 bg-danger-soft/50">
            <CardBody className="flex items-start gap-3 py-4">
              <Avatar name={name} protected size="md" />
              <div>
                <p className="font-semibold text-danger">Skyddad identitet</p>
                <p className="text-sm text-ink-muted">Uppgifter maskeras och all åtkomst loggas. {principal.protectedClearance ? 'Du har klarering – ange anledning innan du öppnar känsliga fält.' : 'Du saknar klarering för fullständig visning.'}</p>
              </div>
            </CardBody>
          </Card>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardBody className="py-4">
              <h3 className="mb-3 font-semibold text-ink">Vårdnadshavare & relationer</h3>
              <div className="space-y-2">
                {rels.map((r) => {
                  const u = db.data.users.find((x) => x.id === r.guardianUserId)
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-field border border-border p-3">
                      <Avatar name={u?.name ?? ''} color={u?.avatarColor} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink">{u?.name}</p>
                        <p className="text-2xs text-ink-subtle">{r.conflictNote ?? 'Inga anmärkningar'}</p>
                      </div>
                      <Badge tone={r.conflictNote ? 'warning' : 'neutral'}>{r.relationType.replace(/_/g, ' ')}</Badge>
                    </div>
                  )
                })}
                {rels.length === 0 && <p className="text-sm text-ink-muted">Inga registrerade relationer.</p>}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2 py-4 text-sm">
              <Row label="Personnummer" value={masked ? '••••••••-••••' : s.personnummer} />
              <Row label="Födelsedatum" value={fmtDate(s.birthDate)} />
              <Row label="Status" value={s.status} />
              <div className="flex items-center justify-between"><span className="text-ink-subtle">Klassificering</span><ClassificationBadge level={s.dataClassification as 3 | 5} /></div>
            </CardBody>
          </Card>
        </div>
      </>
    )
  }
}

/** Övriga entiteter – enkel detaljvy. */
function GenericDetail({ resource }: { resource: ResourceKey }) {
  const { id } = useParams()
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Detaljvy" icon="FileText" subtitle={`${resource} · ${id}`} actions={<Button variant="secondary" size="sm" icon="ArrowLeft" onClick={() => navigate(-1)}>Tillbaka</Button>} />
      <Card><CardBody className="py-8 text-center text-sm text-ink-muted">Detaljvy förberedd. Bygg vidare enligt modulmallen.</CardBody></Card>
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-subtle">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  )
}

function NotFoundInline() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Hittades inte" icon="SearchX" />
      <Card><CardBody className="py-10 text-center"><p className="text-ink-muted">Objektet finns inte eller har flyttats.</p><Button className="mt-4" variant="secondary" onClick={() => navigate('/')}>Till översikten</Button></CardBody></Card>
    </>
  )
}
