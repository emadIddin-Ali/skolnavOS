import { db, nextId, byId } from '@/data/db/store'
import { can, authorize, ForbiddenError, type Principal, type Target } from '@/core/permissions/engine'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import { maskName } from '@/lib/format'
import type {
  GuardianStudentRelation,
  GuardianPermissions,
  RelationType,
  Student,
  User,
  GuardianProfile,
} from '@/data/schema'
import { RELATION_TYPE_LABEL } from '@/data/schema'
import type { Tone } from '@/ui'

/**
 * Tjänstelager för Vårdnadshavare & relationer. All mutation går via
 * behörighetsmotorn (authorize) innan store:t rörs, och känsliga åtgärder
 * revideras via granskningsloggen. UI:t får dölja knappar men aldrig lita på
 * det ensamt – auktoriteten sitter här.
 */

/* ---------- Behörighetsnycklar & etiketter ---------- */

export const PERMISSION_KEYS: (keyof GuardianPermissions)[] = [
  'viewSchedule',
  'reportAbsence',
  'chatWithStaff',
  'signConsents',
  'viewDocumentation',
  'viewDocuments',
  'updateContact',
  'pickup',
  'urgentNotifications',
  'viewAssessments',
  'viewIncidents',
]

export const PERMISSION_LABEL: Record<keyof GuardianPermissions, string> = {
  viewSchedule: 'Se schema',
  reportAbsence: 'Anmäla frånvaro',
  chatWithStaff: 'Kontakta personal',
  signConsents: 'Signera samtycken',
  viewDocumentation: 'Se dokumentation',
  viewDocuments: 'Se dokument',
  updateContact: 'Uppdatera kontaktuppgifter',
  pickup: 'Hämtbehörig',
  urgentNotifications: 'Akutnotiser',
  viewAssessments: 'Se bedömningar',
  viewIncidents: 'Se incidenter',
}

export const PERMISSION_ICON: Record<keyof GuardianPermissions, string> = {
  viewSchedule: 'CalendarDays',
  reportAbsence: 'CalendarX',
  chatWithStaff: 'MessageSquare',
  signConsents: 'FileSignature',
  viewDocumentation: 'BookOpen',
  viewDocuments: 'FileText',
  updateContact: 'Contact',
  pickup: 'CarFront',
  urgentNotifications: 'BellRing',
  viewAssessments: 'GraduationCap',
  viewIncidents: 'ShieldAlert',
}

/* ---------- Relationstyper: ton & ikon ---------- */

export const RELATION_TYPE_TONE: Record<RelationType, Tone> = {
  vardnadshavare: 'primary',
  kontaktperson: 'info',
  nodkontakt: 'accent',
  hamtbehorig: 'success',
  begransad_kontakt: 'warning',
  endast_information: 'neutral',
  ej_hamtbehorig: 'danger',
  skyddad_restriktion: 'danger',
}

export const RELATION_TYPE_ICON: Record<RelationType, string> = {
  vardnadshavare: 'Heart',
  kontaktperson: 'Contact',
  nodkontakt: 'PhoneCall',
  hamtbehorig: 'CarFront',
  begransad_kontakt: 'ShieldAlert',
  endast_information: 'Info',
  ej_hamtbehorig: 'Ban',
  skyddad_restriktion: 'Lock',
}

/** Relationstyper som alltid ska lyftas som konflikt/varning. */
const CONFLICT_TYPES: RelationType[] = ['begransad_kontakt', 'ej_hamtbehorig', 'skyddad_restriktion']

export function isConflictRelation(rel: GuardianStudentRelation): boolean {
  return rel.conflictNote != null || CONFLICT_TYPES.includes(rel.relationType)
}

/** Allvarlig konflikt (röd) vs uppmärksamhet (gul). */
export function conflictTone(rel: GuardianStudentRelation): Tone {
  if (rel.relationType === 'ej_hamtbehorig' || rel.relationType === 'skyddad_restriktion') return 'danger'
  if (rel.relationType === 'begransad_kontakt') return 'warning'
  return rel.conflictNote ? 'warning' : 'neutral'
}

/* ---------- Läsning / härledning ---------- */

export interface ChildDisplay {
  student: Student
  name: string
  masked: boolean
  protectedIdentity: boolean
}

export interface GuardianRow {
  id: string
  user: User
  profile?: GuardianProfile
  relations: GuardianStudentRelation[]
  childCount: number
  verified: boolean
  hasConflict: boolean
  sharedCustody: boolean
  relationTypes: RelationType[]
}

export function studentById(id: string): Student | undefined {
  return byId(db.data.students, id)
}

/** Barnets visningsnamn med maskning vid skyddad identitet utan klarering. */
export function childDisplay(principal: Principal, student: Student): ChildDisplay {
  const full = `${student.firstName} ${student.lastName}`
  const masked = student.protectedIdentity && !principal.protectedClearance
  return {
    student,
    name: masked ? maskName(full) : full,
    masked,
    protectedIdentity: student.protectedIdentity,
  }
}

/** Target för en relation (för behörighetskontroll). */
export function relTarget(rel: GuardianStudentRelation): Target {
  const student = studentById(rel.studentId)
  return {
    organizationId: rel.organizationId,
    schoolId: rel.schoolId ?? student?.schoolId ?? null,
    studentId: rel.studentId,
    protectedIdentity: student?.protectedIdentity,
    dataClassification: (rel.dataClassification as Target['dataClassification']) ?? 3,
  }
}

/** Kan principalen läsa (någon del av) relationen? Styr synlighet i listan. */
export function canReadRelation(principal: Principal, rel: GuardianStudentRelation): boolean {
  return can(principal, 'read', 'guardian_relation', relTarget(rel)).allowed
}

/** Alla vårdnadshavaranvändare (id börjar på "u-guard") med minst en relation. */
export function allGuardianUsers(): User[] {
  const withRelation = new Set(db.data.relations.map((r) => r.guardianUserId))
  return db.data.users.filter((u) => u.id.startsWith('u-guard') && withRelation.has(u.id))
}

/** Behörighetsfiltrerade rader för listan. */
export function visibleGuardians(principal: Principal): GuardianRow[] {
  const rows: GuardianRow[] = []
  for (const user of allGuardianUsers()) {
    const relations = db.data.relations.filter(
      (r) => r.guardianUserId === user.id && canReadRelation(principal, r),
    )
    if (relations.length === 0) continue
    const profile = db.data.guardians.find((gp) => gp.userId === user.id)
    rows.push({
      id: user.id,
      user,
      profile,
      relations,
      childCount: relations.length,
      verified: profile?.verified ?? relations.some((r) => r.verifiedAt != null),
      hasConflict: relations.some(isConflictRelation),
      sharedCustody: relations.some((r) => r.sharedCustody),
      relationTypes: [...new Set(relations.map((r) => r.relationType))],
    })
  }
  return rows.sort((a, b) => a.user.name.localeCompare(b.user.name, 'sv'))
}

/** Elever principalen kan koppla en relation till (skol-/klass-scope). */
export function linkableStudents(principal: Principal): Student[] {
  return db.data.students
    .filter((s) => can(principal, 'create', 'guardian_relation', {
      organizationId: s.organizationId,
      schoolId: s.schoolId,
      studentId: s.id,
      protectedIdentity: s.protectedIdentity,
    }).allowed)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'sv'))
}

export function defaultPermissions(): GuardianPermissions {
  return {
    viewSchedule: true,
    reportAbsence: true,
    chatWithStaff: true,
    signConsents: true,
    viewDocumentation: true,
    viewDocuments: true,
    updateContact: true,
    pickup: true,
    urgentNotifications: true,
    viewAssessments: false,
    viewIncidents: false,
  }
}

/* ---------- Mutationer ---------- */

export interface MutationResult {
  ok: boolean
  error?: string
}

function fail(e: unknown): MutationResult {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message }
  return { ok: false, error: 'Åtgärden kunde inte slutföras.' }
}

/** Ändra en per-barn-behörighet. Auktoritativ kontroll + revision. */
export function updatePermission(
  principal: Principal,
  relationId: string,
  key: keyof GuardianPermissions,
  value: boolean,
): MutationResult {
  const rel = db.data.relations.find((r) => r.id === relationId)
  if (!rel) return { ok: false, error: 'Relationen hittades inte.' }
  try {
    const decision = authorize(principal, 'update', 'guardian_relation', relTarget(rel))
    const prev = rel.permissions[key]
    if (prev === value) return { ok: true }
    rel.permissions = { ...rel.permissions, [key]: value }
    rel.updatedAt = new Date().toISOString()
    rel.version += 1
    logAudit(actorFromPrincipal(principal, rel.schoolId), {
      action: 'guardian.permission.update',
      resource: 'guardian_relation',
      targetId: rel.id,
      targetLabel: `${PERMISSION_LABEL[key]} för relation ${rel.id}`,
      previousValue: String(prev),
      newValue: String(value),
      reason: decision.requiresReason ? 'Hantering av skyddad relation' : null,
      riskLevel: decision.requiresReason ? 'hög' : 'låg',
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export interface CreateGuardianInput {
  name: string
  email: string
  phone?: string
  invite?: boolean
}

/** Lägg till en ny vårdnadshavare (användare + profil). */
export function createGuardian(principal: Principal, input: CreateGuardianInput): MutationResult & { userId?: string } {
  const now = new Date().toISOString()
  const schoolId = principal.schoolIds[0] ?? null
  try {
    authorize(principal, 'create', 'guardian', { organizationId: principal.organizationId, schoolId })
    const uid = nextId('u-guard')
    const user: User = {
      id: uid,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone?.trim() || undefined,
      avatarColor: '#2f8f83',
      protectedIdentity: false,
      mfaEnabled: false,
      status: input.invite ? 'inbjuden' : 'inaktiv',
      lastLoginAt: null,
      createdAt: now,
    }
    db.data.users.push(user)
    const profile: GuardianProfile = {
      id: nextId('guard'),
      userId: uid,
      phone: input.phone?.trim() || undefined,
      preferredChannel: 'app',
      verified: false,
      organizationId: principal.organizationId,
      schoolId: schoolId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dataClassification: 3,
      sourceSystem: 'skolnav',
      externalId: null,
      version: 1,
      lastSyncedAt: null,
      retentionMonths: 36,
    }
    db.data.guardians.push(profile)
    logAudit(actorFromPrincipal(principal, schoolId), {
      action: 'guardian.create',
      resource: 'guardian',
      targetId: uid,
      targetLabel: user.name,
      newValue: user.email,
      riskLevel: 'medel',
    })
    if (input.invite) {
      sendNotification({
        userId: uid,
        organizationId: principal.organizationId,
        title: 'Välkommen till Skolnav',
        body: 'Du har bjudits in som vårdnadshavare. Aktivera ditt konto för att komma igång.',
        category: 'system',
      })
    }
    return { ok: true, userId: uid }
  } catch (e) {
    return fail(e)
  }
}

/** Bjud in / återsänd inbjudan till en befintlig vårdnadshavare. */
export function inviteGuardian(principal: Principal, guardianUserId: string): MutationResult {
  const user = db.data.users.find((u) => u.id === guardianUserId)
  if (!user) return { ok: false, error: 'Vårdnadshavaren hittades inte.' }
  const rel = db.data.relations.find((r) => r.guardianUserId === guardianUserId)
  const schoolId = rel?.schoolId ?? principal.schoolIds[0] ?? null
  try {
    authorize(principal, 'update', 'guardian', { organizationId: principal.organizationId, schoolId })
    const prev = user.status
    user.status = 'inbjuden'
    sendNotification({
      userId: guardianUserId,
      organizationId: principal.organizationId,
      title: 'Inbjudan till Skolnav',
      body: 'Du har blivit inbjuden att aktivera ditt vårdnadshavarkonto.',
      category: 'system',
    })
    logAudit(actorFromPrincipal(principal, schoolId), {
      action: 'guardian.invite',
      resource: 'guardian',
      targetId: guardianUserId,
      targetLabel: user.name,
      previousValue: prev,
      newValue: 'inbjuden',
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export interface LinkInput {
  guardianUserId: string
  studentId: string
  relationType: RelationType
  permissions: GuardianPermissions
  sharedCustody?: boolean
}

/** Koppla en vårdnadshavare till ett barn (även syskon, nödkontakt, hämtbehörig). */
export function linkGuardianToChild(principal: Principal, input: LinkInput): MutationResult {
  const student = studentById(input.studentId)
  if (!student) return { ok: false, error: 'Barnet hittades inte.' }
  const user = db.data.users.find((u) => u.id === input.guardianUserId)
  if (!user) return { ok: false, error: 'Vårdnadshavaren hittades inte.' }
  const already = db.data.relations.some(
    (r) => r.guardianUserId === input.guardianUserId && r.studentId === input.studentId,
  )
  if (already) return { ok: false, error: 'En relation mellan dessa finns redan.' }
  const now = new Date().toISOString()
  try {
    authorize(principal, 'create', 'guardian_relation', {
      organizationId: student.organizationId,
      schoolId: student.schoolId,
      studentId: student.id,
      protectedIdentity: student.protectedIdentity,
    })
    const rel: GuardianStudentRelation = {
      id: nextId('rel'),
      guardianUserId: input.guardianUserId,
      studentId: input.studentId,
      relationType: input.relationType,
      permissions: input.permissions,
      sharedCustody: input.sharedCustody ?? false,
      conflictNote: null,
      verifiedAt: null,
      organizationId: student.organizationId,
      schoolId: student.schoolId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dataClassification: student.protectedIdentity ? 5 : 3,
      sourceSystem: 'skolnav',
      externalId: null,
      version: 1,
      lastSyncedAt: null,
      retentionMonths: 36,
    }
    db.data.relations.push(rel)
    logAudit(actorFromPrincipal(principal, student.schoolId), {
      action: 'guardian.link',
      resource: 'guardian_relation',
      targetId: rel.id,
      targetLabel: `${user.name} → ${RELATION_TYPE_LABEL[input.relationType]}`,
      newValue: input.relationType,
      riskLevel: student.protectedIdentity ? 'hög' : 'medel',
      reason: student.protectedIdentity ? 'Koppling till skyddad identitet' : null,
    })
    sendNotification({
      userId: input.guardianUserId,
      organizationId: principal.organizationId,
      title: 'Ny koppling registrerad',
      body: `Du har registrerats som ${RELATION_TYPE_LABEL[input.relationType].toLowerCase()} för ett barn.`,
      category: 'system',
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export interface RestrictionInput {
  relationType: Extract<RelationType, 'begransad_kontakt' | 'ej_hamtbehorig' | 'skyddad_restriktion'>
  conflictNote: string
}

/** Sätt restriktion/skyddsmarkering på en befintlig relation. */
export function applyRestriction(
  principal: Principal,
  relationId: string,
  input: RestrictionInput,
): MutationResult {
  const rel = db.data.relations.find((r) => r.id === relationId)
  if (!rel) return { ok: false, error: 'Relationen hittades inte.' }
  const now = new Date().toISOString()
  try {
    authorize(principal, 'update', 'guardian_relation', relTarget(rel))
    const prev = rel.relationType
    rel.relationType = input.relationType
    rel.conflictNote = input.conflictNote.trim() || null
    // En restriktion stänger av hämtning och begränsar direkta kanaler.
    if (input.relationType !== 'begransad_kontakt') {
      rel.permissions = { ...rel.permissions, pickup: false }
    }
    if (input.relationType === 'skyddad_restriktion') {
      rel.permissions = { ...rel.permissions, pickup: false, chatWithStaff: false }
      rel.dataClassification = 5
    }
    rel.updatedAt = now
    rel.version += 1
    logAudit(actorFromPrincipal(principal, rel.schoolId), {
      action: 'guardian.restriction',
      resource: 'guardian_relation',
      targetId: rel.id,
      targetLabel: `Restriktion: ${RELATION_TYPE_LABEL[input.relationType]}`,
      previousValue: prev,
      newValue: input.relationType,
      reason: input.conflictNote.trim() || 'Restriktion registrerad',
      riskLevel: 'hög',
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
