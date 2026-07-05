import type { RoleKey } from '@/core/domain/roles'
import { ROLES } from '@/core/domain/roles'
import type { PermissionAction, ResourceKey } from '@/core/domain/permissions'
import { ACTION_LABEL, RESOURCE_LABEL } from '@/core/domain/permissions'
import { classificationMeta, type Classification } from '@/core/domain/classification'
import type { GuardianPermissions } from '@/data/schema/people'
import { ROLE_GRANTS } from './matrix'

/**
 * Behörighetsmotorn – systemets auktoritet.
 *
 * Frontend får dölja åtgärder för UX, men VARJE känslig åtgärd ska gå via
 * `can()`/`authorize()` i tjänstelagret. Motorn lägger ABAC-regler ovanpå
 * RBAC-baslinjen (matrix.ts): tenant-isolering, skol-/klass-/kurs-/elev-scope,
 * relationsbaserad vårdnadshavaråtkomst, tillfällig behörighet som går ut,
 * skyddad identitet, dataklassificering och kontrollerad supportåtkomst.
 */

export interface Principal {
  userId: string
  role: RoleKey
  organizationId: string
  /** Skolor principalen tillhör (via medlemskap). */
  schoolIds: string[]
  /** ABAC-avgränsning till specifika klasser/kurser. Tom = hela skolan. */
  classIds: string[]
  courseIds: string[]
  /** Elever en vårdnadshavare är kopplad till. */
  guardianStudentIds: string[]
  guardianPermsByStudent: Record<string, GuardianPermissions>
  /** Elevens egen student-id (roll elev). */
  ownStudentId?: string | null
  /** Tillfällig behörighet går ut (vikarie). */
  validUntil?: string | null
  /** Får se skyddad identitet? */
  protectedClearance: boolean
  /** Aktiv supportsession (systemroller). */
  supportSession?: {
    active: boolean
    modules: string[]
    schoolId?: string | null
    expiresAt?: string | null
  } | null
  breakGlass?: boolean
  /** Är MFA uppfylld i sessionen? */
  mfaSatisfied?: boolean
  /** Nuvarande tid (ISO) för utgångskontroller. */
  now: string
}

export interface Target {
  organizationId?: string
  schoolId?: string | null
  classId?: string | null
  courseId?: string | null
  studentId?: string | null
  ownerUserId?: string | null
  dataClassification?: Classification
  protectedIdentity?: boolean
  /** Bulkåtgärd (påverkar exportregler). */
  bulk?: boolean
}

export type DecisionCode =
  | 'ok'
  | 'no_grant'
  | 'action_not_permitted'
  | 'tenant'
  | 'scope_school'
  | 'scope_class'
  | 'scope_course'
  | 'scope_student'
  | 'scope_own'
  | 'relation'
  | 'relation_permission'
  | 'expired'
  | 'protected'
  | 'bulk_export_blocked'
  | 'export_forbidden'
  | 'support_required'

export interface Decision {
  allowed: boolean
  code: DecisionCode
  reason: string
  /** Data ska maskeras (skyddad identitet utan klarering). */
  masked?: boolean
  /** Läsning ska revideras (känslig data). */
  logRead?: boolean
  /** Åtgärden kräver angiven anledning. */
  requiresReason?: boolean
  /** Åtgärden bör kräva MFA. */
  requiresMfa?: boolean
  /** Break-glass användes – hög riskloggning. */
  breakGlass?: boolean
}

const allow = (extra: Partial<Decision> = {}): Decision => ({
  allowed: true,
  code: 'ok',
  reason: 'Åtkomst beviljad.',
  ...extra,
})

const deny = (code: DecisionCode, reason: string, extra: Partial<Decision> = {}): Decision => ({
  allowed: false,
  code,
  reason,
  ...extra,
})

/** Person-/elevnära resurser som systemroller bara når via supportsession. */
const PERSON_RESOURCES: ResourceKey[] = [
  'student',
  'guardian',
  'guardian_relation',
  'health',
  'incident',
  'documentation',
  'assessment',
  'absence',
  'attendance',
  'file',
  'consent',
]

const SYSTEM_ROLES: RoleKey[] = ['superadmin', 'it_support']

/** Resurs → vilken vårdnadshavarbehörighet som krävs (relation-scope). */
const GUARDIAN_PERMISSION_FOR: Partial<
  Record<ResourceKey, keyof GuardianPermissions>
> = {
  schedule: 'viewSchedule',
  absence: 'reportAbsence',
  message: 'chatWithStaff',
  consent: 'signConsents',
  documentation: 'viewDocumentation',
  file: 'viewDocuments',
  guardian: 'updateContact',
  pickup: 'pickup',
  assessment: 'viewAssessments',
  incident: 'viewIncidents',
}

const WRITE_ACTIONS: PermissionAction[] = ['create', 'update', 'delete']

/**
 * Kärnbeslut. Rena, deterministiska regler – ingen sidoeffekt.
 * Logga resultatet separat via auditlogg vid känsliga åtgärder.
 */
export function can(
  principal: Principal,
  action: PermissionAction,
  resource: ResourceKey,
  target: Target = {},
): Decision {
  // Extern granskare är strikt läsbehörig – aldrig export av persondata.
  if (principal.role === 'granskare' && action === 'export') {
    return deny(
      'export_forbidden',
      'Granskarrollen är läsbehörig och får inte exportera personuppgifter.',
    )
  }

  const grants = ROLE_GRANTS[principal.role] ?? {}
  const grant = grants[resource]

  if (!grant) {
    return deny(
      'no_grant',
      `Rollen ${ROLES[principal.role].label} saknar behörighet till ${RESOURCE_LABEL[resource]}.`,
    )
  }
  if (!grant.actions.includes(action)) {
    return deny(
      'action_not_permitted',
      `Du kan inte ${ACTION_LABEL[action].toLowerCase()} ${RESOURCE_LABEL[resource].toLowerCase()}.`,
    )
  }

  // 1) Tenant-isolering (superadmin får korsa tenant men bara via support).
  if (
    target.organizationId &&
    target.organizationId !== principal.organizationId &&
    principal.role !== 'superadmin'
  ) {
    return deny('tenant', 'Åtkomst nekad: tillhör en annan organisation.')
  }

  // 2) Tillfällig behörighet som gått ut (vikarie m.fl.).
  if (principal.validUntil && principal.now > principal.validUntil) {
    return deny(
      'expired',
      'Din tillfälliga behörighet har gått ut. Kontakta administratör.',
    )
  }

  const decision: Decision = allow()

  // 4) Scope-kontroll enligt grantens räckvidd.
  const scopeDecision = checkScope(principal, action, resource, grant.scope, target)
  if (!scopeDecision.allowed) return scopeDecision
  Object.assign(decision, scopeDecision, { allowed: true, code: 'ok' })

  // 5) Kontrollerad supportåtkomst för systemroller mot persondata.
  if (SYSTEM_ROLES.includes(principal.role) && PERSON_RESOURCES.includes(resource)) {
    const s = principal.supportSession
    const covers =
      s?.active &&
      (s.modules.length === 0 || s.modules.includes(resource)) &&
      (!s.schoolId || !target.schoolId || s.schoolId === target.schoolId) &&
      (!s.expiresAt || principal.now <= s.expiresAt)
    if (!covers) {
      if (principal.breakGlass) {
        decision.breakGlass = true
        decision.requiresReason = true
        decision.logRead = true
      } else {
        return deny(
          'support_required',
          'Systemroller når persondata endast via en aktiv, godkänd supportsession.',
          { requiresReason: true },
        )
      }
    }
  }

  // 6) Skyddad identitet.
  if (target.protectedIdentity) {
    if (action === 'export' && target.bulk) {
      return deny(
        'protected',
        'Bulkexport av skyddad identitet är inte tillåten.',
      )
    }
    if (!principal.protectedClearance) {
      // Läsning tillåts men maskerad; öppna detaljprofil kräver klarering.
      if (action === 'read') {
        decision.masked = true
        decision.logRead = true
      } else {
        return deny(
          'protected',
          'Du saknar behörighet att hantera skyddad identitet.',
          { masked: true },
        )
      }
    } else {
      decision.requiresReason = true
      decision.logRead = true
    }
  }

  // 7) Dataklassificering.
  const level = target.dataClassification
  if (level != null) {
    const meta = classificationMeta(level)
    if (action === 'export' && target.bulk && !meta.bulkExport) {
      return deny(
        'bulk_export_blocked',
        `Bulkexport av «${meta.label}» är blockerad av dataskyddsskäl.`,
      )
    }
    if (meta.logRead && action === 'read') decision.logRead = true
  }

  // 8) MFA-rekommendation för administrativa åtgärder.
  if ((action === 'admin' || action === 'delete') && ROLES[principal.role].requiresMfa) {
    decision.requiresMfa = !principal.mfaSatisfied
  }

  return decision
}

function checkScope(
  principal: Principal,
  action: PermissionAction,
  resource: ResourceKey,
  scope: string,
  target: Target,
): Decision {
  switch (scope) {
    case 'organisation':
      return allow()

    case 'skola':
    case 'avdelning': {
      if (!target.schoolId) return allow() // listnivå utan specifik skola
      return principal.schoolIds.includes(target.schoolId)
        ? allow()
        : deny('scope_school', 'Åtkomst nekad: utanför din skola.')
    }

    case 'klass': {
      if (target.schoolId && !principal.schoolIds.includes(target.schoolId)) {
        return deny('scope_school', 'Åtkomst nekad: utanför din skola.')
      }
      if (target.classId && principal.classIds.length > 0) {
        return principal.classIds.includes(target.classId)
          ? allow()
          : deny('scope_class', 'Åtkomst nekad: du är inte kopplad till den klassen.')
      }
      return allow()
    }

    case 'kurs': {
      if (target.courseId && principal.courseIds.length > 0) {
        return principal.courseIds.includes(target.courseId)
          ? allow()
          : deny('scope_course', 'Åtkomst nekad: du undervisar inte i den kursen.')
      }
      return allow()
    }

    case 'elev': {
      // Elevhälsa m.fl.: per elev inom skolan – loggas och kan kräva anledning.
      if (target.schoolId && !principal.schoolIds.includes(target.schoolId)) {
        return deny('scope_school', 'Åtkomst nekad: utanför din skola.')
      }
      return allow({ logRead: true })
    }

    case 'egen': {
      const ownerOk =
        (target.ownerUserId && target.ownerUserId === principal.userId) ||
        (target.studentId && target.studentId === principal.ownStudentId) ||
        (!target.ownerUserId && !target.studentId)
      return ownerOk
        ? allow()
        : deny('scope_own', 'Åtkomst nekad: gäller endast din egen profil.')
    }

    case 'relation': {
      if (!target.studentId) return allow() // listnivå (filtreras till egna barn)
      if (!principal.guardianStudentIds.includes(target.studentId)) {
        return deny('relation', 'Du har ingen registrerad relation till detta barn.')
      }
      // Per-barn-behörighet för vårdnadshavare.
      const permKey = GUARDIAN_PERMISSION_FOR[resource]
      if (permKey && (action !== 'read' || resource === 'consent')) {
        const perms = principal.guardianPermsByStudent[target.studentId]
        const needed =
          resource === 'consent' && action === 'sign'
            ? perms?.signConsents
            : WRITE_ACTIONS.includes(action) || resource === 'pickup'
              ? perms?.[permKey]
              : true
        if (perms && needed === false) {
          return deny(
            'relation_permission',
            'Din relation till barnet saknar behörighet för den här åtgärden.',
          )
        }
      }
      return allow()
    }

    case 'tillfallig': {
      if (principal.validUntil && principal.now > principal.validUntil) {
        return deny('expired', 'Din tillfälliga behörighet har gått ut.')
      }
      if (target.schoolId && !principal.schoolIds.includes(target.schoolId)) {
        return deny('scope_school', 'Åtkomst nekad: utanför ditt uppdrag.')
      }
      if (target.classId && principal.classIds.length > 0 && !principal.classIds.includes(target.classId)) {
        return deny('scope_class', 'Åtkomst nekad: utanför ditt vikariat.')
      }
      return allow()
    }

    default:
      return allow()
  }
}

/** Bekvämlighet: bara boolean. */
export function allowed(
  principal: Principal,
  action: PermissionAction,
  resource: ResourceKey,
  target?: Target,
): boolean {
  return can(principal, action, resource, target).allowed
}

/**
 * Auktorisering i tjänstelagret. Kastar ett fel som UI kan fånga och visa som
 * "Åtkomst nekad" – den auktoritativa kontrollen (inte bara dolt i UI).
 */
export class ForbiddenError extends Error {
  code: DecisionCode
  constructor(decision: Decision) {
    super(decision.reason)
    this.name = 'ForbiddenError'
    this.code = decision.code
  }
}

export function authorize(
  principal: Principal,
  action: PermissionAction,
  resource: ResourceKey,
  target?: Target,
): Decision {
  const decision = can(principal, action, resource, target)
  if (!decision.allowed) throw new ForbiddenError(decision)
  return decision
}
