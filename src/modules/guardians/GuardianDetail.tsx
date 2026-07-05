import { db } from '@/data/db/store'
import { can, type Principal } from '@/core/permissions/engine'
import {
  Modal, Avatar, Badge, StatusBadge, Segmented, Button, Icon, ClassificationBadge,
} from '@/ui'
import { fmtRelative, maskName } from '@/lib/format'
import { RELATION_TYPE_LABEL, type GuardianStudentRelation, type GuardianPermissions } from '@/data/schema'
import type { Classification } from '@/core/domain/classification'
import {
  type GuardianRow,
  PERMISSION_KEYS, PERMISSION_LABEL, PERMISSION_ICON,
  RELATION_TYPE_TONE, RELATION_TYPE_ICON,
  isConflictRelation, conflictTone, childDisplay, relTarget, studentById,
  updatePermission,
} from './service'
import type { FlowRequest } from './GuardianFlows'

/** Detaljvy för en vårdnadshavare: barn, relationer, konflikter och
 *  behörighetsmatris. Redigering går via tjänstelagret med full revision. */
export function GuardianDetail({
  principal,
  row,
  onClose,
  onBump,
  onFlow,
  onError,
}: {
  principal: Principal
  row: GuardianRow
  onClose: () => void
  onBump: () => void
  onFlow: (req: FlowRequest) => void
  onError: (msg: string) => void
}) {
  const { user, profile, relations } = row

  function toggle(rel: GuardianStudentRelation, key: keyof GuardianPermissions, value: boolean) {
    const res = updatePermission(principal, rel.id, key, value)
    if (!res.ok) onError(res.error ?? 'Kunde inte spara ändringen.')
    onBump()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={user.protectedIdentity ? maskName(user.name) : user.name}
      description={`${row.childCount} ${row.childCount === 1 ? 'barn' : 'barn'} · ${user.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Stäng</Button>
          <Button variant="secondary" icon="Users" onClick={() => onFlow({ kind: 'sibling', guardianId: user.id })}>
            Syskonlänka
          </Button>
          <Button icon="Link2" onClick={() => onFlow({ kind: 'link', guardianId: user.id })}>
            Koppla till barn
          </Button>
        </>
      }
    >
      {/* Kontaktkort */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-panel border border-border bg-surface-2 p-4">
        <Avatar name={user.name} color={user.avatarColor} size="lg" protected={user.protectedIdentity} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{user.protectedIdentity ? maskName(user.name) : user.name}</p>
            {row.verified ? (
              <StatusBadge tone="success" icon="BadgeCheck" label="Verifierad" />
            ) : (
              <StatusBadge tone="warning" icon="Clock" label="Ej verifierad" />
            )}
            <StatusBadge
              tone={user.status === 'aktiv' ? 'success' : user.status === 'inbjuden' ? 'info' : 'neutral'}
              label={statusLabel(user.status)}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-ink-subtle">
            <span className="inline-flex items-center gap-1"><Icon name="Mail" className="h-3 w-3" />{user.email}</span>
            {(profile?.phone ?? user.phone) && (
              <span className="inline-flex items-center gap-1"><Icon name="Phone" className="h-3 w-3" />{profile?.phone ?? user.phone}</span>
            )}
            {user.lastLoginAt && (
              <span className="inline-flex items-center gap-1"><Icon name="LogIn" className="h-3 w-3" />Senast inloggad {fmtRelative(user.lastLoginAt)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon="PhoneCall" onClick={() => onFlow({ kind: 'emergency', guardianId: user.id })}>
            Nödkontakt
          </Button>
        </div>
      </div>

      {/* Relationer / barn */}
      <div className="space-y-4">
        {relations.map((rel) => (
          <RelationCard
            key={rel.id}
            principal={principal}
            rel={rel}
            onToggle={toggle}
            onFlow={onFlow}
          />
        ))}
      </div>
    </Modal>
  )
}

function RelationCard({
  principal,
  rel,
  onToggle,
  onFlow,
}: {
  principal: Principal
  rel: GuardianStudentRelation
  onToggle: (rel: GuardianStudentRelation, key: keyof GuardianPermissions, value: boolean) => void
  onFlow: (req: FlowRequest) => void
}) {
  const student = studentById(rel.studentId)
  if (!student) return null
  const child = childDisplay(principal, student)
  const school = db.data.schools.find((s) => s.id === student.schoolId)
  const canEdit = can(principal, 'update', 'guardian_relation', relTarget(rel)).allowed
  const conflict = isConflictRelation(rel)

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      {/* Barnrubrik */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={child.name} color={student.photoColor} protected={child.masked} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink truncate">{child.name}</p>
              {child.masked && <Badge tone="warning" icon="ShieldAlert">Skyddad identitet</Badge>}
            </div>
            <p className="text-2xs text-ink-subtle">{student.gradeLabel}{school ? ` · ${school.name}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={RELATION_TYPE_TONE[rel.relationType]} icon={RELATION_TYPE_ICON[rel.relationType]}>
            {RELATION_TYPE_LABEL[rel.relationType]}
          </Badge>
          {rel.sharedCustody && <Badge tone="info" icon="Users">Delad vårdnad</Badge>}
          <ClassificationBadge level={(rel.dataClassification as Classification) ?? 3} />
        </div>
      </div>

      {/* Konfliktvarning */}
      {conflict && (
        <div
          className="mt-3 flex items-start gap-2.5 rounded-field border p-3 text-sm"
          style={{
            backgroundColor: `rgb(var(--c-${conflictTone(rel)}) / 0.10)`,
            borderColor: `rgb(var(--c-${conflictTone(rel)}) / 0.30)`,
          }}
        >
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `rgb(var(--c-${conflictTone(rel)}))` }} />
          <div>
            <p className="font-medium text-ink">{RELATION_TYPE_LABEL[rel.relationType]}</p>
            <p className="text-2xs text-ink-muted">{rel.conflictNote ?? 'Kontrollera villkoren vid hämtning och kontakt.'}</p>
          </div>
        </div>
      )}

      {/* Skyddad identitet – diskret notis */}
      {child.masked && (
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-warning">
          <Icon name="EyeOff" className="h-3 w-3" />
          Namnet är maskerat. Du saknar klarering för skyddad identitet.
        </p>
      )}

      {/* Behörighetsmatris */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Behörigheter för denna relation</h4>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
              <Icon name="Lock" className="h-3 w-3" /> Skrivskyddad
            </span>
          )}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {PERMISSION_KEYS.map((key) => {
            const on = rel.permissions[key]
            return (
              <div key={key} className="flex items-center justify-between gap-3 rounded-field border border-border/70 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                  <Icon name={PERMISSION_ICON[key]} className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="truncate">{PERMISSION_LABEL[key]}</span>
                </span>
                {canEdit ? (
                  <Segmented
                    size="sm"
                    value={on ? 'pa' : 'av'}
                    onChange={(v) => onToggle(rel, key, v === 'pa')}
                    options={[
                      { value: 'pa', label: 'På' },
                      { value: 'av', label: 'Av' },
                    ]}
                  />
                ) : (
                  <StatusBadge tone={on ? 'success' : 'neutral'} label={on ? 'På' : 'Av'} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Relationsåtgärder */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="secondary"
          icon="ShieldAlert"
          onClick={() => onFlow({ kind: 'restriction', relationId: rel.id })}
        >
          Restriktion / skyddad
        </Button>
      </div>
    </div>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'aktiv': return 'Aktiv'
    case 'inbjuden': return 'Inbjuden'
    case 'inaktiv': return 'Inaktiv'
    case 'last': return 'Låst'
    default: return status
  }
}
