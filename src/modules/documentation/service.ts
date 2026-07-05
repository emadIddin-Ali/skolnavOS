import { db, nextId } from '@/data/db/store'
import { authorize, ForbiddenError, type Principal } from '@/core/permissions/engine'
import { sendNotification } from '@/core/notifications/notifications'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import type { DocumentationPost } from '@/data/schema'

/**
 * Tjänstelager för pedagogisk dokumentation. Auktoriserar ALLTID via
 * behörighetsmotorn innan store:t rörs; redigering och borttagning är
 * dessutom begränsad till författarens egna inlägg.
 */

export interface DocumentationInput {
  title: string
  body: string
  studentIds: string[]
  visibleToGuardians: boolean
}

function resolveTarget(studentIds: string[], principal: Principal) {
  const students = db.data.students.filter((s) => studentIds.includes(s.id))
  const schoolId = students[0]?.schoolId ?? principal.schoolIds[0] ?? null
  const classIds = [
    ...new Set(students.map((s) => s.classId).filter((c): c is string => Boolean(c))),
  ]
  return {
    students,
    schoolId,
    classId: classIds.length === 1 ? classIds[0] : null,
    anyProtected: students.some((s) => s.protectedIdentity),
  }
}

/** Skapa ett dokumentationsinlägg (pedagog/lärare/mentor m.fl.). */
export function createDocumentationPost(
  principal: Principal,
  input: DocumentationInput,
): DocumentationPost {
  if (input.studentIds.length === 0) throw new Error('Minst ett barn måste taggas.')
  const { students, schoolId, classId, anyProtected } = resolveTarget(input.studentIds, principal)
  if (students.length === 0) throw new Error('De valda barnen kunde inte hittas.')

  // Auktoritativ kontroll – skyddad identitet kräver särskild klarering.
  authorize(principal, 'create', 'documentation', {
    organizationId: principal.organizationId,
    schoolId,
    classId,
    protectedIdentity: anyProtected,
  })

  const now = new Date().toISOString()
  const post: DocumentationPost = {
    id: nextId('doc'),
    title: input.title.trim(),
    body: input.body.trim(),
    studentIds: students.map((s) => s.id),
    classId,
    authorUserId: principal.userId,
    visibleToGuardians: input.visibleToGuardians,
    postedAt: now,
    organizationId: principal.organizationId,
    schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: anyProtected ? 5 : 3,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: 36,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.documentation.unshift(post)

  // En representativ vårdnadshavare notifieras (aldrig känsligt innehåll i kroppen).
  if (post.visibleToGuardians) {
    const rel = db.data.relations.find(
      (r) => post.studentIds.includes(r.studentId) && r.permissions.viewDocumentation !== false,
    )
    if (rel) {
      sendNotification({
        userId: rel.guardianUserId,
        organizationId: principal.organizationId,
        title: 'Ny pedagogisk dokumentation',
        body: 'Ett nytt inlägg om ditt barn finns att läsa. Logga in för detaljer.',
        category: 'meddelande',
        channel: 'app',
        classification: 3,
      })
    }
  }

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'documentation.create',
    resource: 'documentation',
    targetId: post.id,
    targetLabel: post.title,
    newValue: post.visibleToGuardians ? 'Synlig för vårdnadshavare' : 'Endast personal',
    riskLevel: 'låg',
  })

  return post
}

/** Uppdatera ett eget inlägg. */
export function updateDocumentationPost(
  principal: Principal,
  postId: string,
  input: DocumentationInput,
): DocumentationPost {
  const post = db.data.documentation.find((p) => p.id === postId && !p.deletedAt)
  if (!post) throw new Error('Inlägget kunde inte hittas.')
  if (post.authorUserId !== principal.userId) {
    throw new ForbiddenError({
      allowed: false,
      code: 'scope_own',
      reason: 'Du kan endast redigera dina egna inlägg.',
    })
  }
  if (input.studentIds.length === 0) throw new Error('Minst ett barn måste taggas.')
  const { students, schoolId, classId, anyProtected } = resolveTarget(input.studentIds, principal)
  if (students.length === 0) throw new Error('De valda barnen kunde inte hittas.')

  authorize(principal, 'update', 'documentation', {
    organizationId: post.organizationId,
    schoolId,
    classId,
    ownerUserId: post.authorUserId,
    protectedIdentity: anyProtected,
  })

  const previousVisibility = post.visibleToGuardians ? 'Synlig för vårdnadshavare' : 'Endast personal'
  post.title = input.title.trim()
  post.body = input.body.trim()
  post.studentIds = students.map((s) => s.id)
  post.classId = classId
  post.visibleToGuardians = input.visibleToGuardians
  post.updatedAt = new Date().toISOString()
  post.updatedBy = principal.userId
  post.version += 1

  logAudit(actorFromPrincipal(principal, post.schoolId), {
    action: 'documentation.update',
    resource: 'documentation',
    targetId: post.id,
    targetLabel: post.title,
    previousValue: previousVisibility,
    newValue: post.visibleToGuardians ? 'Synlig för vårdnadshavare' : 'Endast personal',
    riskLevel: 'låg',
  })

  return post
}

/** Ta bort (mjuk borttagning) ett eget inlägg. */
export function deleteDocumentationPost(principal: Principal, postId: string): void {
  const post = db.data.documentation.find((p) => p.id === postId && !p.deletedAt)
  if (!post) throw new Error('Inlägget kunde inte hittas.')
  if (post.authorUserId !== principal.userId) {
    throw new ForbiddenError({
      allowed: false,
      code: 'scope_own',
      reason: 'Du kan endast ta bort dina egna inlägg.',
    })
  }

  authorize(principal, 'delete', 'documentation', {
    organizationId: post.organizationId,
    schoolId: post.schoolId ?? null,
    classId: post.classId,
    ownerUserId: post.authorUserId,
  })

  const now = new Date().toISOString()
  post.deletedAt = now
  post.updatedAt = now
  post.updatedBy = principal.userId
  post.version += 1

  logAudit(actorFromPrincipal(principal, post.schoolId), {
    action: 'documentation.delete',
    resource: 'documentation',
    targetId: post.id,
    targetLabel: post.title,
    previousValue: post.title,
    newValue: 'Borttagen',
    riskLevel: 'medel',
  })
}
