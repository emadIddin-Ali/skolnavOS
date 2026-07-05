import { useMemo, useState } from 'react'
import { db } from '@/data/db/store'
import type { Principal } from '@/core/permissions/engine'
import {
  Modal, StepIndicator, TextInput, Select, Segmented, Button, Badge, Avatar, Icon,
} from '@/ui'
import { RELATION_TYPE_LABEL, relationTypeEnum, type RelationType, type GuardianPermissions } from '@/data/schema'
import {
  visibleGuardians, linkableStudents, studentById, childDisplay, defaultPermissions,
  PERMISSION_KEYS, PERMISSION_LABEL, PERMISSION_ICON, RELATION_TYPE_ICON,
  createGuardian, inviteGuardian, linkGuardianToChild, applyRestriction,
  type MutationResult,
} from './service'

export type FlowKind = 'add' | 'invite' | 'link' | 'sibling' | 'emergency' | 'pickup' | 'restriction'

export interface FlowRequest {
  kind: FlowKind
  guardianId?: string
  relationId?: string
}

const FLOW_META: Record<FlowKind, { title: string; icon: string; steps: string[] }> = {
  add: { title: 'Lägg till vårdnadshavare', icon: 'UserPlus', steps: ['Uppgifter', 'Bekräfta'] },
  invite: { title: 'Bjud in vårdnadshavare', icon: 'Send', steps: ['Vårdnadshavare', 'Bekräfta'] },
  link: { title: 'Koppla till barn', icon: 'Link2', steps: ['Vårdnadshavare', 'Barn & relation', 'Behörigheter', 'Bekräfta'] },
  sibling: { title: 'Syskonlänkning', icon: 'Users', steps: ['Vårdnadshavare', 'Syskon', 'Bekräfta'] },
  emergency: { title: 'Nödkontakt', icon: 'PhoneCall', steps: ['Vårdnadshavare', 'Barn', 'Bekräfta'] },
  pickup: { title: 'Hämtbehörig', icon: 'CarFront', steps: ['Vårdnadshavare', 'Barn', 'Bekräfta'] },
  restriction: { title: 'Restriktion / skyddad', icon: 'ShieldAlert', steps: ['Typ & orsak', 'Bekräfta'] },
}

type RestrictionType = 'begransad_kontakt' | 'ej_hamtbehorig' | 'skyddad_restriktion'

function presetPermissions(kind: FlowKind): GuardianPermissions {
  const base = defaultPermissions()
  if (kind === 'emergency') {
    return { ...base, reportAbsence: false, signConsents: false, updateContact: false, pickup: false, viewDocumentation: false, viewDocuments: false, viewAssessments: false, viewIncidents: false }
  }
  if (kind === 'pickup') {
    return {
      viewSchedule: true, reportAbsence: false, chatWithStaff: false, signConsents: false,
      viewDocumentation: false, viewDocuments: false, updateContact: false, pickup: true,
      urgentNotifications: true, viewAssessments: false, viewIncidents: false,
    }
  }
  return base
}

function presetType(kind: FlowKind): RelationType {
  if (kind === 'emergency') return 'nodkontakt'
  if (kind === 'pickup') return 'hamtbehorig'
  return 'vardnadshavare'
}

/** Flerstegsflöden för vårdnadshavare & relationer. Ett flöde per FlowKind. */
export function FlowModal({
  principal,
  req,
  onClose,
  onDone,
}: {
  principal: Principal
  req: FlowRequest
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const meta = FLOW_META[req.kind]
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Delad flödesstate
  const [guardianId, setGuardianId] = useState(req.guardianId ?? '')
  const [studentId, setStudentId] = useState('')
  const [relationType, setRelationType] = useState<RelationType>(presetType(req.kind))
  const [perms, setPerms] = useState<GuardianPermissions>(presetPermissions(req.kind))
  const [sharedCustody, setSharedCustody] = useState(false)
  // Ny vårdnadshavare
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [invite, setInvite] = useState(true)
  // Restriktion
  const [restrType, setRestrType] = useState<RestrictionType>('begransad_kontakt')
  const [note, setNote] = useState('')

  const guardians = useMemo(() => visibleGuardians(principal), [principal])
  const allStudents = useMemo(() => linkableStudents(principal), [principal])
  const candidateStudents = useMemo(() => {
    if (!guardianId) return allStudents
    const linked = new Set(
      db.data.relations.filter((r) => r.guardianUserId === guardianId).map((r) => r.studentId),
    )
    return allStudents.filter((s) => !linked.has(s.id))
  }, [allStudents, guardianId])

  const relation = req.relationId ? db.data.relations.find((r) => r.id === req.relationId) : undefined
  const restrictionStudent = relation ? studentById(relation.studentId) : undefined
  const guardian = guardianId ? db.data.users.find((u) => u.id === guardianId) : undefined

  const isLast = step === meta.steps.length - 1

  function canProceed(): boolean {
    if (req.kind === 'add' && step === 0) return name.trim().length > 1 && /.+@.+\..+/.test(email)
    if ((req.kind === 'invite') && step === 0) return !!guardianId
    if (req.kind === 'link') {
      if (step === 0) return !!guardianId
      if (step === 1) return !!studentId
    }
    if ((req.kind === 'sibling' || req.kind === 'emergency' || req.kind === 'pickup')) {
      if (step === 0) return !!guardianId
      if (step === 1) return !!studentId
    }
    if (req.kind === 'restriction' && step === 0) return !!relation && note.trim().length > 3
    return true
  }

  function submit() {
    setError(null)
    let res: MutationResult
    let msg: string
    switch (req.kind) {
      case 'add':
        res = createGuardian(principal, { name, email, phone, invite })
        msg = invite ? 'Vårdnadshavare tillagd och inbjuden.' : 'Vårdnadshavare tillagd.'
        break
      case 'invite':
        res = inviteGuardian(principal, guardianId)
        msg = 'Inbjudan skickad.'
        break
      case 'restriction':
        res = relation
          ? applyRestriction(principal, relation.id, { relationType: restrType, conflictNote: note })
          : { ok: false, error: 'Relationen saknas.' }
        msg = 'Restriktion registrerad.'
        break
      default:
        // link / sibling / emergency / pickup → skapa relation
        res = linkGuardianToChild(principal, {
          guardianUserId: guardianId,
          studentId,
          relationType,
          permissions: perms,
          sharedCustody,
        })
        msg = 'Koppling registrerad.'
    }
    if (res.ok) onDone(msg)
    else setError(res.error ?? 'Åtgärden kunde inte slutföras.')
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={meta.title}
      description="Följ stegen. Åtgärden loggas och behörighetskontrolleras."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          {step > 0 && (
            <Button variant="secondary" icon="ChevronLeft" onClick={() => setStep((s) => s - 1)}>Tillbaka</Button>
          )}
          {isLast ? (
            <Button icon="Check" onClick={submit} disabled={!canProceed()}>Slutför</Button>
          ) : (
            <Button iconRight="ChevronRight" onClick={() => canProceed() && setStep((s) => s + 1)} disabled={!canProceed()}>
              Nästa
            </Button>
          )}
        </>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={meta.steps.map((label) => ({ label }))} current={step} />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------- Vårdnadshavarval (flera flöden) ---------- */}
      {(req.kind === 'invite' || req.kind === 'link' || req.kind === 'sibling' || req.kind === 'emergency' || req.kind === 'pickup') && step === 0 && (
        <Field label="Vårdnadshavare" hint={req.guardianId ? 'Förvald från öppnad profil.' : 'Sök och välj vårdnadshavare.'}>
          <Select value={guardianId} onChange={(e) => setGuardianId(e.target.value)} disabled={!!req.guardianId}>
            <option value="">Välj vårdnadshavare…</option>
            {guardians.map((g) => (
              <option key={g.id} value={g.id}>{g.user.name} · {g.childCount} barn</option>
            ))}
          </Select>
        </Field>
      )}

      {/* ---------- Lägg till: uppgifter ---------- */}
      {req.kind === 'add' && step === 0 && (
        <div className="space-y-3">
          <Field label="Namn"><TextInput icon="User" placeholder="För- och efternamn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="E-post"><TextInput icon="Mail" type="email" placeholder="namn@exempel.se" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Telefon (valfritt)"><TextInput icon="Phone" placeholder="070-000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Skicka inbjudan direkt">
            <Segmented
              value={invite ? 'ja' : 'nej'}
              onChange={(v) => setInvite(v === 'ja')}
              options={[{ value: 'ja', label: 'Ja' }, { value: 'nej', label: 'Nej' }]}
            />
          </Field>
        </div>
      )}

      {/* ---------- Koppla: barn & relation ---------- */}
      {req.kind === 'link' && step === 1 && (
        <div className="space-y-3">
          <StudentPicker principal={principal} students={candidateStudents} value={studentId} onChange={setStudentId} />
          <Field label="Relationstyp">
            <Select value={relationType} onChange={(e) => setRelationType(e.target.value as RelationType)}>
              {relationTypeEnum.options.map((t) => (
                <option key={t} value={t}>{RELATION_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Delad vårdnad">
            <Segmented
              value={sharedCustody ? 'ja' : 'nej'}
              onChange={(v) => setSharedCustody(v === 'ja')}
              options={[{ value: 'nej', label: 'Nej' }, { value: 'ja', label: 'Ja' }]}
            />
          </Field>
        </div>
      )}

      {/* ---------- Koppla: behörigheter ---------- */}
      {req.kind === 'link' && step === 2 && (
        <PermissionEditor perms={perms} onChange={setPerms} />
      )}

      {/* ---------- Syskon / nödkontakt / hämtbehörig: barnval ---------- */}
      {(req.kind === 'sibling' || req.kind === 'emergency' || req.kind === 'pickup') && step === 1 && (
        <div className="space-y-3">
          <StudentPicker
            principal={principal}
            students={candidateStudents}
            value={studentId}
            onChange={setStudentId}
            label={req.kind === 'sibling' ? 'Syskon att koppla' : 'Barn'}
          />
          {req.kind === 'sibling' && (
            <Field label="Relationstyp">
              <Select value={relationType} onChange={(e) => setRelationType(e.target.value as RelationType)}>
                {relationTypeEnum.options.map((t) => (
                  <option key={t} value={t}>{RELATION_TYPE_LABEL[t]}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="rounded-field border border-border bg-surface-2 px-3 py-2 text-2xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon name={RELATION_TYPE_ICON[relationType]} className="h-3.5 w-3.5" />
              Registreras som <strong className="text-ink">{RELATION_TYPE_LABEL[relationType]}</strong> med förvalda behörigheter.
            </span>
          </div>
        </div>
      )}

      {/* ---------- Restriktion: typ & orsak ---------- */}
      {req.kind === 'restriction' && step === 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-field border border-border bg-surface-2 p-3">
            <Icon name="ShieldAlert" className="h-5 w-5 text-warning" />
            <p className="text-sm text-ink-muted">
              {restrictionStudent
                ? <>Restriktionen gäller barnet <strong className="text-ink">{childDisplay(principal, restrictionStudent).name}</strong>.</>
                : 'Ingen relation vald.'}
            </p>
          </div>
          <Field label="Typ av restriktion">
            <Select value={restrType} onChange={(e) => setRestrType(e.target.value as RestrictionType)}>
              <option value="begransad_kontakt">{RELATION_TYPE_LABEL.begransad_kontakt}</option>
              <option value="ej_hamtbehorig">{RELATION_TYPE_LABEL.ej_hamtbehorig}</option>
              <option value="skyddad_restriktion">{RELATION_TYPE_LABEL.skyddad_restriktion}</option>
            </Select>
          </Field>
          <Field label="Orsak / notering (loggas)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="T.ex. domstolsbeslut om begränsad kontakt – kontrollera vid hämtning."
              className="w-full rounded-field border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary"
            />
          </Field>
        </div>
      )}

      {/* ---------- Bekräftelsesteg ---------- */}
      {isLast && (
        <Summary
          principal={principal}
          req={req}
          guardianName={guardian?.name ?? (req.kind === 'add' ? name : '')}
          studentName={studentId ? childDisplay(principal, studentById(studentId)!).name : (restrictionStudent ? childDisplay(principal, restrictionStudent).name : '')}
          relationType={req.kind === 'restriction' ? restrType : relationType}
          invite={invite}
          note={note}
          email={email}
        />
      )}
    </Modal>
  )
}

/* ---------- Delkomponenter ---------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-ink-subtle">{hint}</span>}
    </label>
  )
}

function StudentPicker({
  principal,
  students,
  value,
  onChange,
  label = 'Barn',
}: {
  principal: Principal
  students: ReturnType<typeof linkableStudents>
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  const selected = value ? studentById(value) : undefined
  return (
    <Field label={label} hint={students.length === 0 ? 'Inga tillgängliga barn i din räckvidd.' : undefined}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Välj barn…</option>
        {students.map((s) => {
          const d = childDisplay(principal, s)
          return <option key={s.id} value={s.id}>{d.name} · {s.gradeLabel}</option>
        })}
      </Select>
      {selected && (
        <div className="mt-2 flex items-center gap-2">
          <Avatar name={childDisplay(principal, selected).name} color={selected.photoColor} size="sm" protected={childDisplay(principal, selected).masked} />
          <span className="text-sm text-ink">{childDisplay(principal, selected).name}</span>
          {childDisplay(principal, selected).masked && <Badge tone="warning" icon="ShieldAlert">Skyddad</Badge>}
        </div>
      )}
    </Field>
  )
}

function PermissionEditor({ perms, onChange }: { perms: GuardianPermissions; onChange: (p: GuardianPermissions) => void }) {
  return (
    <div>
      <p className="mb-2 text-2xs text-ink-subtle">Justera vad relationen får göra. Kan ändras senare.</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PERMISSION_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-field border border-border/70 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              <Icon name={PERMISSION_ICON[key]} className="h-4 w-4 shrink-0 text-ink-subtle" />
              <span className="truncate">{PERMISSION_LABEL[key]}</span>
            </span>
            <Segmented
              size="sm"
              value={perms[key] ? 'pa' : 'av'}
              onChange={(v) => onChange({ ...perms, [key]: v === 'pa' })}
              options={[{ value: 'pa', label: 'På' }, { value: 'av', label: 'Av' }]}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function Summary({
  req,
  guardianName,
  studentName,
  relationType,
  invite,
  note,
  email,
}: {
  principal: Principal
  req: FlowRequest
  guardianName: string
  studentName: string
  relationType: RelationType
  invite: boolean
  note: string
  email: string
}) {
  const rows: { label: string; value: React.ReactNode }[] = []
  if (req.kind === 'add') {
    rows.push({ label: 'Namn', value: guardianName || '—' })
    rows.push({ label: 'E-post', value: email || '—' })
    rows.push({ label: 'Inbjudan', value: invite ? 'Skickas direkt' : 'Skickas inte nu' })
  } else if (req.kind === 'invite') {
    rows.push({ label: 'Vårdnadshavare', value: guardianName || '—' })
    rows.push({ label: 'Åtgärd', value: 'Skicka inbjudan' })
  } else if (req.kind === 'restriction') {
    rows.push({ label: 'Barn', value: studentName || '—' })
    rows.push({ label: 'Restriktion', value: RELATION_TYPE_LABEL[relationType] })
    rows.push({ label: 'Orsak', value: note || '—' })
  } else {
    rows.push({ label: 'Vårdnadshavare', value: guardianName || '—' })
    rows.push({ label: 'Barn', value: studentName || '—' })
    rows.push({ label: 'Relation', value: RELATION_TYPE_LABEL[relationType] })
  }
  return (
    <div className="rounded-panel border border-border bg-surface-2 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name="ClipboardCheck" className="h-4 w-4 text-primary" /> Kontrollera innan du slutför
      </p>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
            <dt className="text-2xs uppercase tracking-wide text-ink-subtle">{r.label}</dt>
            <dd className="text-right text-sm text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-2xs text-ink-subtle">Åtgärden loggas i granskningsloggen och kontrolleras mot dina behörigheter.</p>
    </div>
  )
}
