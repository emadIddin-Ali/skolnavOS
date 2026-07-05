import { db } from '@/data/db/store'
import { can, type Principal } from '@/core/permissions/engine'
import type { ResourceKey } from '@/core/domain/permissions'
import { maskName } from '@/lib/format'

/**
 * Behörighetssäker global sök ("Sök i Skolnav"). Wrappar sökmotorn
 * (Meilisearch/Typesense) men filtrerar alltid mot behörighetsmotorn så att
 * ingen restriktiv data läcker via förhandsvisning. Skyddad identitet maskeras.
 */

export interface SearchHit {
  id: string
  resource: ResourceKey
  title: string
  subtitle: string
  href: string
  protected?: boolean
}

export interface SearchGroup {
  resource: ResourceKey
  label: string
  hits: SearchHit[]
}

export function search(principal: Principal, query: string, limit = 8): SearchGroup[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const groups: SearchGroup[] = []
  const push = (resource: ResourceKey, label: string, hits: SearchHit[]) => {
    if (hits.length) groups.push({ resource, label, hits: hits.slice(0, limit) })
  }

  // Elever/barn – behörighetsfiltrerat + maskering av skyddad identitet
  const students = db.data.students
    .filter((s) => `${s.firstName} ${s.lastName} ${s.gradeLabel}`.toLowerCase().includes(q))
    .filter((s) => {
      const d = can(principal, 'read', 'student', {
        organizationId: s.organizationId,
        schoolId: s.schoolId,
        classId: s.classId,
        studentId: s.id,
        protectedIdentity: s.protectedIdentity,
        dataClassification: s.dataClassification as 3 | 5,
      })
      return d.allowed
    })
    .map<SearchHit>((s) => {
      const d = can(principal, 'read', 'student', { studentId: s.id, protectedIdentity: s.protectedIdentity })
      const name = s.protectedIdentity && d.masked ? maskName(`${s.firstName} ${s.lastName}`) : `${s.firstName} ${s.lastName}`
      return {
        id: s.id,
        resource: 'student',
        title: s.protectedIdentity && d.masked ? `${name} (skyddad)` : name,
        subtitle: `${s.gradeLabel} · ${db.data.schools.find((x) => x.id === s.schoolId)?.name ?? ''}`,
        href: `/elever/${s.id}`,
        protected: s.protectedIdentity,
      }
    })
  push('student', 'Elever & barn', students)

  // Personal
  const staff = db.data.users
    .filter((u) => u.id.startsWith('u-staff') && u.name.toLowerCase().includes(q))
    .filter(() => can(principal, 'read', 'staff', {}).allowed)
    .map<SearchHit>((u) => ({ id: u.id, resource: 'staff', title: u.name, subtitle: u.email, href: `/personal/${u.id}` }))
  push('staff', 'Personal', staff)

  // Klasser
  const classes = db.data.classes
    .filter((c) => `${c.name} ${c.gradeLabel}`.toLowerCase().includes(q))
    .filter((c) => can(principal, 'read', 'class', { organizationId: c.organizationId, schoolId: c.schoolId, classId: c.id }).allowed)
    .map<SearchHit>((c) => ({ id: c.id, resource: 'class', title: c.name, subtitle: c.gradeLabel, href: `/klasser/${c.id}` }))
  push('class', 'Klasser & grupper', classes)

  // Kurser
  const courses = db.data.courses
    .filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q))
    .filter((c) => can(principal, 'read', 'course', { organizationId: c.organizationId, schoolId: c.schoolId, courseId: c.id }).allowed)
    .map<SearchHit>((c) => ({ id: c.id, resource: 'course', title: c.name, subtitle: c.code, href: `/kurser/${c.id}` }))
  push('course', 'Kurser', courses)

  // Dokument
  const files = db.data.files
    .filter((f) => f.name.toLowerCase().includes(q))
    .filter((f) => can(principal, 'read', 'file', { organizationId: f.organizationId, schoolId: f.schoolId, studentId: f.studentId, dataClassification: f.dataClassification as 2 | 3 | 4 }).allowed)
    .map<SearchHit>((f) => ({ id: f.id, resource: 'file', title: f.name, subtitle: 'Dokument', href: `/dokument/${f.id}` }))
  push('file', 'Filer & dokument', files)

  return groups
}
