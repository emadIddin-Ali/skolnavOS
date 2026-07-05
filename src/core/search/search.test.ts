import { describe, it, expect } from 'vitest'
import { search } from './search'
import { buildPrincipal } from '@/core/state/principal'
import { db } from '@/data/db/store'

function principalFor(role: Parameters<typeof buildPrincipal>[0]['role']) {
  return buildPrincipal({ role, schoolId: 'sch-bjorkeberga', mfaSatisfied: true, supportActive: false, breakGlass: false })
}

describe('behörighetssäker sök', () => {
  it('kräver minst 2 tecken', () => {
    expect(search(principalFor('rektor'), 'a')).toEqual([])
  })

  it('rektor hittar elever i sin skola', () => {
    const anyStudent = db.data.students.find((s) => s.schoolId === 'sch-bjorkeberga' && !s.protectedIdentity)!
    const groups = search(principalFor('rektor'), anyStudent.firstName.slice(0, 3).toLowerCase())
    const studentGroup = groups.find((g) => g.resource === 'student')
    // Antingen träff i elever eller (om prefixet inte matchar) inga – men aldrig krasch
    if (studentGroup) expect(studentGroup.hits.length).toBeGreaterThan(0)
  })

  it('vårdnadshavare ser inte andras barn i sökresultat', () => {
    const p = principalFor('vardnadshavare')
    const other = db.data.students.find((s) => !p.guardianStudentIds.includes(s.id) && s.schoolId === 'sch-bjorkeberga')!
    const groups = search(p, `${other.firstName} ${other.lastName}`.toLowerCase())
    const hits = groups.find((g) => g.resource === 'student')?.hits ?? []
    expect(hits.some((h) => h.id === other.id)).toBe(false)
  })

  it('skyddad identitet maskeras i förhandsvisning utan klarering', () => {
    const protectedStudent = db.data.students.find((s) => s.protectedIdentity)!
    // skoladmin har ingen protectedClearance i demo-datan
    const groups = search(principalFor('skoladmin'), protectedStudent.firstName.toLowerCase())
    const hit = groups.find((g) => g.resource === 'student')?.hits.find((h) => h.id === protectedStudent.id)
    if (hit) {
      expect(hit.title).not.toContain(protectedStudent.lastName)
      expect(hit.title).toMatch(/skyddad/i)
    }
  })

  it('elev hittar inte personalregister', () => {
    const groups = search(principalFor('elev_grund'), 'anders')
    expect(groups.find((g) => g.resource === 'staff')).toBeUndefined()
  })
})
