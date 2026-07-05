import { db } from '@/data/db/store'
import type { Principal } from '@/core/permissions/engine'
import { can } from '@/core/permissions/engine'
import type { ResourceKey } from '@/core/domain/permissions'
import type { Column } from '@/ui'
import { Badge, StatusBadge, ClassificationBadge, Avatar, ProgressBar, type Tone } from '@/ui'
import { maskName, fmtDate, fmtRelative, fmtBytes, fmtDateTime } from '@/lib/format'
import { RELATION_TYPE_LABEL, SCHOOL_TYPE_LABEL } from '@/data/schema'
import { ATTENDANCE_STATUS_LABEL, ABSENCE_REASON_LABEL, ABSENCE_STATUS_LABEL } from '@/data/schema'
import { INTEGRATION_STATUS_LABEL, RATE_LIMIT_STATE_LABEL } from '@/data/schema'
import type { AttendanceStatus, AbsenceStatus } from '@/data/schema'

export interface ResourceView {
  rows: { id: string }[]
  columns: Column<any>[]
  hrefFor?: (row: any) => string | undefined
}

const attTone: Record<AttendanceStatus, Tone> = {
  narvarande: 'success', franvarande: 'danger', sen: 'warning', hamtad: 'info', ej_markerad: 'neutral',
}
const absTone: Record<AbsenceStatus, Tone> = {
  inskickad: 'info', bekraftad: 'success', avslagen: 'danger', kraver_atgard: 'warning',
}

function schoolName(id: string | null | undefined) {
  return db.data.schools.find((s) => s.id === id)?.name ?? '—'
}

/** Returnerar rader (behörighetsfiltrerade) + kolumner för en resurs. */
export function resourceView(resource: ResourceKey, principal: Principal): ResourceView | null {
  const inScope = (schoolId?: string | null, classId?: string | null, studentId?: string | null, extra: Record<string, unknown> = {}) =>
    can(principal, 'read', resource, { organizationId: principal.organizationId, schoolId, classId, studentId, ...extra }).allowed

  switch (resource) {
    case 'student': {
      const rows = db.data.students.filter((s) =>
        principal.role === 'vardnadshavare'
          ? principal.guardianStudentIds.includes(s.id)
          : principal.ownStudentId
            ? s.id === principal.ownStudentId
            : inScope(s.schoolId, s.classId, s.id, { protectedIdentity: s.protectedIdentity, dataClassification: s.dataClassification }),
      )
      return {
        rows,
        hrefFor: (s) => `/elever/${s.id}`,
        columns: [
          {
            key: 'name', header: 'Namn', render: (s) => {
              const masked = s.protectedIdentity && !principal.protectedClearance
              const name = masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`
              return (
                <div className="flex items-center gap-2.5">
                  <Avatar name={name} color={s.photoColor} size="sm" protected={s.protectedIdentity} />
                  <div>
                    <div className="font-medium text-ink flex items-center gap-1.5">{name}{s.protectedIdentity && <Badge tone="danger" icon="ShieldAlert">Skyddad</Badge>}</div>
                    <div className="text-2xs text-ink-subtle">{s.gradeLabel}</div>
                  </div>
                </div>
              )
            },
          },
          { key: 'school', header: 'Skola', hideOnMobile: true, render: (s) => <span className="text-ink-muted">{schoolName(s.schoolId)}</span> },
          { key: 'flags', header: 'Flaggor', render: (s) => (
            <div className="flex gap-1">
              {s.hasAllergyFlag && <Badge tone="warning" icon="Wheat">Allergi</Badge>}
              {s.hasPickupNote && <Badge tone="info" icon="DoorOpen">Hämtning</Badge>}
            </div>
          ) },
          { key: 'class', header: 'Klassificering', hideOnMobile: true, render: (s) => <ClassificationBadge level={s.dataClassification as 3 | 5} /> },
        ],
      }
    }

    case 'guardian': {
      const rels = db.data.relations
      const seen = new Set<string>()
      const rows = db.data.users.filter((u) => u.id.startsWith('u-guard') && rels.some((r) => r.guardianUserId === u.id) && !seen.has(u.id) && seen.add(u.id) && inScope())
      return {
        rows,
        columns: [
          { key: 'name', header: 'Vårdnadshavare', render: (u) => (
            <div className="flex items-center gap-2.5"><Avatar name={u.name} color={u.avatarColor} size="sm" /><span className="font-medium text-ink">{u.name}</span></div>
          ) },
          { key: 'children', header: 'Barn', render: (u) => {
            const kids = rels.filter((r) => r.guardianUserId === u.id)
            return <span className="text-ink-muted">{kids.length} barn</span>
          } },
          { key: 'rel', header: 'Relation', hideOnMobile: true, render: (u) => {
            const rel = rels.find((r) => r.guardianUserId === u.id)
            return <Badge tone={rel?.conflictNote ? 'warning' : 'neutral'}>{rel ? RELATION_TYPE_LABEL[rel.relationType] : '—'}</Badge>
          } },
          { key: 'status', header: 'Status', render: (u) => <StatusBadge tone={u.status === 'aktiv' ? 'success' : 'warning'} label={u.status === 'aktiv' ? 'Aktiv' : 'Inbjuden'} /> },
        ],
      }
    }

    case 'staff': {
      const rows = db.data.staff.filter((s) => inScope(s.schoolId)).map((s) => ({ ...s, user: db.data.users.find((u) => u.id === s.userId) }))
      return {
        rows,
        columns: [
          { key: 'name', header: 'Namn', render: (s) => (
            <div className="flex items-center gap-2.5"><Avatar name={s.user?.name ?? ''} color={s.user?.avatarColor} size="sm" /><span className="font-medium text-ink">{s.user?.name}</span></div>
          ) },
          { key: 'title', header: 'Roll', render: (s) => <span className="text-ink-muted">{s.title}</span> },
          { key: 'school', header: 'Skola', hideOnMobile: true, render: (s) => <span className="text-ink-muted">{schoolName(s.schoolId)}</span> },
          { key: 'emp', header: 'Anställning', hideOnMobile: true, render: (s) => <Badge>{s.employmentType}</Badge> },
        ],
      }
    }

    case 'class': {
      const rows = db.data.classes.filter((c) => inScope(c.schoolId, c.id))
      return {
        rows, hrefFor: (c) => `/klasser/${c.id}`,
        columns: [
          { key: 'name', header: 'Klass', render: (c) => <span className="font-medium text-ink">{c.name}</span> },
          { key: 'grade', header: 'Årskurs', render: (c) => <span className="text-ink-muted">{c.gradeLabel}</span> },
          { key: 'school', header: 'Skola', hideOnMobile: true, render: (c) => <span className="text-ink-muted">{schoolName(c.schoolId)}</span> },
          { key: 'count', header: 'Elever', align: 'right', render: (c) => <span className="tabular-nums text-ink">{c.studentCount}</span> },
        ],
      }
    }

    case 'course': {
      const rows = db.data.courses.filter((c) => inScope(c.schoolId, null, null, { courseId: c.id }))
      return {
        rows, hrefFor: (c) => `/kurser/${c.id}`,
        columns: [
          { key: 'code', header: 'Kod', render: (c) => <span className="font-mono text-2xs text-ink-muted">{c.code}</span> },
          { key: 'name', header: 'Kurs', render: (c) => <span className="font-medium text-ink">{c.name}</span> },
          { key: 'pts', header: 'Poäng', align: 'right', hideOnMobile: true, render: (c) => <span className="tabular-nums text-ink-muted">{c.points}</span> },
          { key: 'count', header: 'Elever', align: 'right', render: (c) => <span className="tabular-nums text-ink">{c.studentCount}</span> },
        ],
      }
    }

    case 'attendance': {
      const rows = db.data.attendance.filter((a) => inScope(a.schoolId, a.classId, a.studentId)).slice(0, 60).map((a) => ({ ...a, student: db.data.students.find((s) => s.id === a.studentId) }))
      return {
        rows,
        columns: [
          { key: 'student', header: 'Elev', render: (a) => <span className="font-medium text-ink">{a.student ? `${a.student.firstName} ${a.student.lastName}` : '—'}</span> },
          { key: 'date', header: 'Datum', render: (a) => <span className="text-ink-muted">{fmtDate(a.date)}</span> },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge tone={attTone[a.status as AttendanceStatus]} label={ATTENDANCE_STATUS_LABEL[a.status as AttendanceStatus]} /> },
        ],
      }
    }

    case 'absence': {
      const rows = db.data.absences.filter((a) => inScope(a.schoolId, null, a.studentId)).map((a) => ({ ...a, student: db.data.students.find((s) => s.id === a.studentId) }))
      return {
        rows,
        columns: [
          { key: 'student', header: 'Elev', render: (a) => <span className="font-medium text-ink">{a.student ? `${a.student.firstName} ${a.student.lastName}` : '—'}</span> },
          { key: 'reason', header: 'Orsak', render: (a) => <Badge>{ABSENCE_REASON_LABEL[a.reason as keyof typeof ABSENCE_REASON_LABEL]}</Badge> },
          { key: 'date', header: 'Datum', hideOnMobile: true, render: (a) => <span className="text-ink-muted">{fmtDate(a.date)}</span> },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge tone={absTone[a.status as AbsenceStatus]} label={ABSENCE_STATUS_LABEL[a.status as AbsenceStatus]} /> },
        ],
      }
    }

    case 'incident': {
      const rows = db.data.incidents.filter((i) => inScope(i.schoolId, null, i.studentId, { dataClassification: 4 }))
      return {
        rows,
        columns: [
          { key: 'title', header: 'Incident', render: (i) => <span className="font-medium text-ink">{i.title}</span> },
          { key: 'cat', header: 'Kategori', hideOnMobile: true, render: (i) => <Badge>{i.category}</Badge> },
          { key: 'sev', header: 'Allvar', render: (i) => <StatusBadge tone={i.severity === 'allvarlig' ? 'danger' : i.severity === 'hög' ? 'warning' : 'neutral'} label={i.severity} /> },
          { key: 'status', header: 'Status', render: (i) => <Badge tone={i.status === 'avslutad' ? 'success' : 'info'}>{i.status.replace('_', ' ')}</Badge> },
        ],
      }
    }

    case 'consent': {
      const rows = db.data.consentRequests.filter((c) => inScope(c.schoolId, null, c.studentId))
      return {
        rows,
        columns: [
          { key: 'title', header: 'Samtycke', render: (c) => <span className="font-medium text-ink">{c.title}</span> },
          { key: 'prog', header: 'Svar', render: (c) => <div className="w-28"><ProgressBar value={(c.respondedCount / c.requiredCount) * 100} tone="success" showValue /></div> },
          { key: 'status', header: 'Status', render: (c) => <Badge tone={c.status === 'signerad' ? 'success' : c.status === 'delvis' ? 'warning' : 'info'}>{c.status}</Badge> },
        ],
      }
    }

    case 'file': {
      const rows = db.data.files.filter((f) => inScope(f.schoolId, null, f.studentId, { dataClassification: f.dataClassification }))
      return {
        rows,
        columns: [
          { key: 'name', header: 'Fil', render: (f) => <span className="flex items-center gap-2 font-medium text-ink"><span className="text-ink-subtle">▪</span>{f.name}</span> },
          { key: 'cat', header: 'Kategori', hideOnMobile: true, render: (f) => <Badge>{f.category}</Badge> },
          { key: 'size', header: 'Storlek', align: 'right', hideOnMobile: true, render: (f) => <span className="tabular-nums text-ink-muted">{fmtBytes(f.sizeBytes)}</span> },
          { key: 'scan', header: 'Skanning', render: (f) => <StatusBadge tone={f.scanStatus === 'ren' ? 'success' : f.scanStatus === 'misstänkt' ? 'danger' : 'neutral'} label={f.scanStatus} /> },
          { key: 'class', header: 'Klass.', render: (f) => <ClassificationBadge level={f.dataClassification as 2 | 3 | 4} showLabel={false} /> },
        ],
      }
    }

    case 'report': {
      const rows = db.data.reports.filter((r) => r.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'title', header: 'Rapport', render: (r) => <span className="font-medium text-ink">{r.title}</span> },
          { key: 'fmt', header: 'Format', hideOnMobile: true, render: (r) => <Badge>{r.format.toUpperCase()}</Badge> },
          { key: 'prog', header: 'Förlopp', render: (r) => r.status === 'klar' ? <StatusBadge tone="success" label="Klar" /> : r.status === 'misslyckad' ? <StatusBadge tone="danger" label="Misslyckad" /> : <div className="w-28"><ProgressBar value={r.progress} showValue /></div> },
        ],
      }
    }

    case 'audit_log': {
      const rows = db.data.auditLogs.filter((l) => l.organizationId === principal.organizationId).slice(0, 60)
      return {
        rows,
        columns: [
          { key: 'at', header: 'Tid', render: (l) => <span className="text-ink-muted whitespace-nowrap">{fmtDateTime(l.at)}</span> },
          { key: 'action', header: 'Åtgärd', render: (l) => <span className="font-mono text-2xs text-ink">{l.action}</span> },
          { key: 'role', header: 'Roll', hideOnMobile: true, render: (l) => <span className="text-ink-muted">{l.actorRole}</span> },
          { key: 'target', header: 'Objekt', hideOnMobile: true, render: (l) => <span className="text-ink-muted">{l.targetLabel}</span> },
          { key: 'risk', header: 'Risk', render: (l) => <StatusBadge tone={l.riskLevel === 'kritisk' || l.riskLevel === 'hög' ? 'danger' : l.riskLevel === 'medel' ? 'warning' : 'neutral'} label={l.riskLevel} /> },
        ],
      }
    }

    case 'integration': {
      const rows = db.data.integrations.filter((i) => i.organizationId === principal.organizationId)
      return {
        rows, hrefFor: (i) => `/integrationer/${i.id}`,
        columns: [
          { key: 'name', header: 'Integration', render: (i) => <span className="font-medium text-ink">{i.name}</span> },
          { key: 'vendor', header: 'Motor', hideOnMobile: true, render: (i) => <span className="text-2xs text-ink-subtle">{i.vendorHint}</span> },
          { key: 'usage', header: 'Idag', align: 'right', hideOnMobile: true, render: (i) => <span className="tabular-nums text-ink-muted">{i.usageDay}{i.quotaDay ? ` / ${i.quotaDay}` : ''}</span> },
          { key: 'status', header: 'Status', render: (i) => {
            const tone: Tone = i.status === 'aktiv' || i.status === 'testad' ? 'success' : i.status === 'fel' ? 'danger' : String(i.status).startsWith('kraver') ? 'warning' : 'neutral'
            return <StatusBadge tone={tone} label={INTEGRATION_STATUS_LABEL[i.status as keyof typeof INTEGRATION_STATUS_LABEL]} />
          } },
        ],
      }
    }

    case 'license': {
      const rows = db.data.licenses.filter((l) => l.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'mod', header: 'Modul', render: (l) => <span className="font-medium text-ink">{l.module}</span> },
          { key: 'seats', header: 'Platser', render: (l) => <div className="w-36"><ProgressBar value={(l.seatsUsed / l.seats) * 100} tone={l.seatsUsed > l.seats ? 'danger' : 'primary'} showValue /></div> },
          { key: 'use', header: 'Använt', align: 'right', hideOnMobile: true, render: (l) => <span className="tabular-nums text-ink-muted">{l.seatsUsed} / {l.seats}</span> },
          { key: 'status', header: 'Status', render: (l) => <StatusBadge tone={l.status === 'aktiv' ? 'success' : l.status === 'provperiod' ? 'info' : 'warning'} label={l.status} /> },
        ],
      }
    }

    case 'health': {
      const rows = db.data.health.filter((h) => inScope(h.schoolId, null, h.studentId, { dataClassification: 4 })).map((h) => ({ ...h, student: db.data.students.find((s) => s.id === h.studentId) }))
      return {
        rows,
        columns: [
          { key: 'label', header: 'Uppgift', render: (h) => <span className="font-medium text-ink">{h.label}</span> },
          { key: 'kind', header: 'Typ', render: (h) => <Badge>{h.kind}</Badge> },
          { key: 'sev', header: 'Allvar', render: (h) => <StatusBadge tone={h.severity === 'kritisk' ? 'danger' : h.severity === 'hög' ? 'warning' : 'neutral'} label={h.severity} /> },
          { key: 'class', header: 'Klass.', render: () => <ClassificationBadge level={4} showLabel={false} /> },
        ],
      }
    }

    case 'rate_limit': {
      const rows = db.data.rateLimitEvents.filter((e) => e.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'dim', header: 'Dimension', render: (e) => <span className="font-mono text-2xs text-ink">{e.dimension}</span> },
          { key: 'scope', header: 'Omfång', hideOnMobile: true, render: (e) => <span className="text-2xs text-ink-subtle">{e.scope}</span> },
          { key: 'count', header: 'Antal', align: 'right', render: (e) => <span className="tabular-nums text-ink-muted">{e.count} / {e.limit}</span> },
          { key: 'state', header: 'Tillstånd', render: (e) => <StatusBadge tone={e.state === 'blockerad' || e.state === 'eskalerad' ? 'danger' : e.state === 'begransad' ? 'warning' : e.state === 'narmar_grans' ? 'info' : 'success'} label={RATE_LIMIT_STATE_LABEL[e.state as keyof typeof RATE_LIMIT_STATE_LABEL]} /> },
        ],
      }
    }

    case 'gdpr': {
      const rows = db.data.gdprRequests.filter((g) => g.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'subject', header: 'Berörd', render: (g) => <span className="font-medium text-ink">{g.subjectName}</span> },
          { key: 'type', header: 'Typ', render: (g) => <Badge>{g.type}</Badge> },
          { key: 'status', header: 'Status', render: (g) => <StatusBadge tone={g.status === 'fardigstalld' ? 'success' : g.status === 'avslagen' ? 'danger' : g.status === 'kraver_verifiering' ? 'warning' : 'info'} label={g.status.replace(/_/g, ' ')} /> },
          { key: 'due', header: 'Förfaller', hideOnMobile: true, render: (g) => <span className="text-ink-muted">{fmtDate(g.dueAt)}</span> },
        ],
      }
    }

    case 'security': {
      const rows = db.data.securityEvents.filter((e) => e.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'type', header: 'Händelse', render: (e) => <span className="font-mono text-2xs text-ink">{e.type}</span> },
          { key: 'desc', header: 'Beskrivning', render: (e) => <span className="text-ink-muted">{e.description}</span> },
          { key: 'risk', header: 'Risk', render: (e) => <StatusBadge tone={e.riskLevel === 'kritisk' || e.riskLevel === 'hög' ? 'danger' : e.riskLevel === 'medel' ? 'warning' : 'neutral'} label={e.riskLevel} /> },
          { key: 'resolved', header: 'Status', render: (e) => <Badge tone={e.resolved ? 'success' : 'warning'}>{e.resolved ? 'Åtgärdad' : 'Öppen'}</Badge> },
        ],
      }
    }

    case 'notification': {
      const rows = db.data.notifications.filter((n) => n.userId === principal.userId)
      return {
        rows,
        columns: [
          { key: 'title', header: 'Notis', render: (n) => <span className="font-medium text-ink">{n.title}</span> },
          { key: 'cat', header: 'Kategori', hideOnMobile: true, render: (n) => <Badge>{n.category}</Badge> },
          { key: 'ch', header: 'Kanal', hideOnMobile: true, render: (n) => <Badge>{n.channel}</Badge> },
          { key: 'del', header: 'Leverans', render: (n) => <StatusBadge tone={n.deliveryStatus === 'levererad' ? 'success' : n.deliveryStatus === 'misslyckad' ? 'danger' : 'neutral'} label={n.deliveryStatus} /> },
        ],
      }
    }

    case 'import': {
      const rows = db.data.imports.filter((i) => i.organizationId === principal.organizationId)
      return {
        rows,
        columns: [
          { key: 'file', header: 'Fil', render: (i) => <span className="font-medium text-ink">{i.fileName}</span> },
          { key: 'type', header: 'Typ', render: (i) => <Badge>{i.type}</Badge> },
          { key: 'res', header: 'Resultat', render: (i) => <span className="text-ink-muted tabular-nums">{i.ok} ok · {i.failed} fel</span> },
          { key: 'status', header: 'Status', render: (i) => <StatusBadge tone={i.status === 'klar' ? 'success' : i.status === 'delvis' ? 'warning' : i.status === 'misslyckad' ? 'danger' : 'info'} label={i.status} /> },
        ],
      }
    }

    default:
      return null
  }
}
