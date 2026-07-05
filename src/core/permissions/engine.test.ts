import { describe, it, expect } from 'vitest'
import { can, type Principal } from './engine'
import type { GuardianPermissions } from '@/data/schema'

const fullPerms = (over: Partial<GuardianPermissions> = {}): GuardianPermissions => ({
  viewSchedule: true, reportAbsence: true, chatWithStaff: true, signConsents: true,
  viewDocumentation: true, viewDocuments: true, updateContact: true, pickup: true,
  urgentNotifications: true, viewAssessments: false, viewIncidents: false, ...over,
})

function mk(over: Partial<Principal>): Principal {
  return {
    userId: 'u1', role: 'larare', organizationId: 'orgA', schoolIds: ['s1'],
    classIds: [], courseIds: [], guardianStudentIds: [], guardianPermsByStudent: {},
    ownStudentId: null, validUntil: null, protectedClearance: false,
    supportSession: null, breakGlass: false, mfaSatisfied: true,
    now: '2026-02-09T09:00:00.000Z', ...over,
  }
}

describe('behörighetsmotor – RBAC', () => {
  it('nekar resurs utan grant', () => {
    const p = mk({ role: 'koksansvarig' })
    expect(can(p, 'read', 'audit_log').allowed).toBe(false)
    expect(can(p, 'read', 'audit_log').code).toBe('no_grant')
  })

  it('nekar åtgärd som inte ingår i grant', () => {
    const p = mk({ role: 'elev_grund', ownStudentId: 'stu1' })
    expect(can(p, 'delete', 'schedule').code).toBe('action_not_permitted')
  })
})

describe('tenant-isolering', () => {
  it('lärare i orgA når inte data i orgB', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'] })
    const d = can(p, 'read', 'student', { organizationId: 'orgB', schoolId: 's99' })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('tenant')
  })
})

describe('scope – skola & klass', () => {
  it('rektor når elev i egen skola men inte annan skola', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'] })
    expect(can(p, 'read', 'student', { organizationId: 'orgA', schoolId: 's1', studentId: 'x' }).allowed).toBe(true)
    expect(can(p, 'read', 'student', { organizationId: 'orgA', schoolId: 's2', studentId: 'x' }).code).toBe('scope_school')
  })

  it('lärare kan uppdatera närvaro i tilldelad klass men inte annan', () => {
    const p = mk({ role: 'larare', schoolIds: ['s1'], classIds: ['c1'] })
    expect(can(p, 'update', 'attendance', { schoolId: 's1', classId: 'c1', studentId: 'x' }).allowed).toBe(true)
    expect(can(p, 'update', 'attendance', { schoolId: 's1', classId: 'c2', studentId: 'x' }).code).toBe('scope_class')
  })
})

describe('relationsbaserad vårdnadshavaråtkomst', () => {
  it('vårdnadshavare ser bara egna barn', () => {
    const p = mk({ role: 'vardnadshavare', guardianStudentIds: ['kid1'], guardianPermsByStudent: { kid1: fullPerms() } })
    expect(can(p, 'read', 'student', { studentId: 'kid1' }).allowed).toBe(true)
    expect(can(p, 'read', 'student', { studentId: 'kid2' }).code).toBe('relation')
  })

  it('per-barn-behörighet blockerar frånvaroanmälan när reportAbsence=false', () => {
    const p = mk({ role: 'vardnadshavare', guardianStudentIds: ['kid1'], guardianPermsByStudent: { kid1: fullPerms({ reportAbsence: false }) } })
    expect(can(p, 'create', 'absence', { studentId: 'kid1' }).code).toBe('relation_permission')
  })

  it('per-barn-behörighet blockerar signering när signConsents=false', () => {
    const p = mk({ role: 'vardnadshavare', guardianStudentIds: ['kid1'], guardianPermsByStudent: { kid1: fullPerms({ signConsents: false }) } })
    expect(can(p, 'sign', 'consent', { studentId: 'kid1' }).code).toBe('relation_permission')
  })
})

describe('tillfällig behörighet (vikarie) går ut', () => {
  it('nekar när validUntil passerats', () => {
    const p = mk({ role: 'vikarie', schoolIds: ['s1'], classIds: ['c1'], validUntil: '2026-02-01T00:00:00.000Z', now: '2026-02-09T09:00:00.000Z' })
    expect(can(p, 'read', 'attendance', { schoolId: 's1', classId: 'c1' }).code).toBe('expired')
  })
  it('tillåter innan utgång', () => {
    const p = mk({ role: 'vikarie', schoolIds: ['s1'], classIds: ['c1'], validUntil: '2026-03-01T00:00:00.000Z', now: '2026-02-09T09:00:00.000Z' })
    expect(can(p, 'read', 'attendance', { schoolId: 's1', classId: 'c1' }).allowed).toBe(true)
  })
})

describe('skyddad identitet', () => {
  it('maskerar läsning utan klarering', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'], protectedClearance: false })
    const d = can(p, 'read', 'student', { schoolId: 's1', studentId: 'x', protectedIdentity: true })
    expect(d.allowed).toBe(true)
    expect(d.masked).toBe(true)
    expect(d.logRead).toBe(true)
  })
  it('kräver anledning med klarering', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'], protectedClearance: true })
    const d = can(p, 'read', 'student', { schoolId: 's1', studentId: 'x', protectedIdentity: true })
    expect(d.requiresReason).toBe(true)
  })
  it('blockerar bulkexport av skyddad identitet', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'], protectedClearance: true })
    const d = can(p, 'export', 'student', { schoolId: 's1', protectedIdentity: true, bulk: true })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('protected')
  })
})

describe('extern granskare', () => {
  it('får läsa men aldrig exportera persondata', () => {
    const p = mk({ role: 'granskare', schoolIds: ['s1'] })
    expect(can(p, 'read', 'audit_log').allowed).toBe(true)
    expect(can(p, 'export', 'report').code).toBe('export_forbidden')
  })
})

describe('systemroller – kontrollerad supportåtkomst', () => {
  it('IT-support nekas persondata utan supportsession', () => {
    const p = mk({ role: 'it_support', schoolIds: ['s1'], supportSession: null })
    expect(can(p, 'read', 'student', { schoolId: 's1', studentId: 'x' }).code).toBe('support_required')
  })
  it('tillåts med aktiv supportsession som täcker modulen', () => {
    const p = mk({ role: 'it_support', schoolIds: ['s1'], supportSession: { active: true, modules: ['student'], schoolId: 's1', expiresAt: '2026-12-01T00:00:00.000Z' } })
    expect(can(p, 'read', 'student', { schoolId: 's1', studentId: 'x' }).allowed).toBe(true)
  })
  it('break-glass tillåter men flaggar hög risk och loggning', () => {
    const p = mk({ role: 'it_support', schoolIds: ['s1'], supportSession: null, breakGlass: true })
    const d = can(p, 'read', 'student', { schoolId: 's1', studentId: 'x' })
    expect(d.allowed).toBe(true)
    expect(d.breakGlass).toBe(true)
    expect(d.logRead).toBe(true)
  })
})

describe('dataklassificering', () => {
  it('blockerar bulkexport av känslig klass 4', () => {
    const p = mk({ role: 'rektor', schoolIds: ['s1'] })
    const d = can(p, 'export', 'report', { schoolId: 's1', dataClassification: 4, bulk: true })
    expect(d.code).toBe('bulk_export_blocked')
  })
})
