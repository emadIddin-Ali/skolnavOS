import { db, nextId, byId } from '@/data/db/store'
import type { Conversation, Message, User } from '@/data/schema'
import type { Principal } from '@/core/permissions/engine'
import { authorize, can, ForbiddenError } from '@/core/permissions/engine'
import { checkRateLimit } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { sendNotification } from '@/core/notifications/notifications'
import { maskName } from '@/lib/format'
import type { Tone } from '@/ui'

/**
 * Tjänstelager för Meddelanden. All mutation går via behörighetsmotorn
 * (authorize) och loggas. UI:t förlitar sig aldrig enbart på dolda knappar.
 */

export type Kind = Conversation['kind']

export const KIND_LABEL: Record<Kind, string> = {
  direkt: 'Direkt',
  vh_larare: 'VH–lärare',
  personal: 'Personal',
  klass: 'Klass',
  avdelning: 'Avdelning',
}

export const KIND_ICON: Record<Kind, string> = {
  direkt: 'MessageSquare',
  vh_larare: 'Users',
  personal: 'Briefcase',
  klass: 'GraduationCap',
  avdelning: 'Blocks',
}

export const KIND_TONE: Record<Kind, Tone> = {
  direkt: 'neutral',
  vh_larare: 'primary',
  personal: 'info',
  klass: 'accent',
  avdelning: 'success',
}

/** Ledningsroller med skolövergripande läsbehörighet för meddelanden. */
const OVERSIGHT_ROLES: string[] = ['superadmin', 'huvudman', 'rektor', 'bitr_rektor', 'skoladmin']

function readTarget(c: Conversation) {
  const student = c.studentId ? byId(db.data.students, c.studentId) : undefined
  return {
    organizationId: c.organizationId,
    schoolId: c.schoolId ?? null,
    studentId: c.studentId,
    dataClassification: c.dataClassification as 1 | 2 | 3 | 4 | 5 | 6,
    protectedIdentity: student?.protectedIdentity ?? false,
  }
}

/** Kan principalen läsa den här konversationen (behörighetsmotorn avgör)? */
export function canReadConversation(principal: Principal, c: Conversation): boolean {
  return can(principal, 'read', 'message', readTarget(c)).allowed
}

/**
 * Inkorg: konversationer där jag är deltagare, filtrerat via can(read).
 * Ledningsroller får dessutom skolans konversationer inom sin räckvidd
 * (oversight) så att vyn aldrig är tom som standard.
 */
export function visibleConversations(principal: Principal): Conversation[] {
  const oversight = OVERSIGHT_ROLES.includes(principal.role)
  return db.data.conversations
    .filter((c) => {
      const member = c.memberUserIds.includes(principal.userId)
      const ownChild =
        principal.role === 'vardnadshavare' &&
        !!c.studentId &&
        principal.guardianStudentIds.includes(c.studentId)
      if (!member && !oversight && !ownChild) return false
      return canReadConversation(principal, c)
    })
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
}

export function isMember(principal: Principal, c: Conversation): boolean {
  return c.memberUserIds.includes(principal.userId)
}

export function conversationMessages(conversationId: string): Message[] {
  return db.data.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1))
}

export function lastMessage(conversationId: string): Message | undefined {
  const msgs = conversationMessages(conversationId)
  return msgs[msgs.length - 1]
}

/** Namn med maskering för skyddad identitet. */
export function displayUserName(
  principal: Principal,
  user?: Pick<User, 'name' | 'protectedIdentity'> | null,
): string {
  if (!user) return 'Okänd användare'
  if (user.protectedIdentity && !principal.protectedClearance) return maskName(user.name)
  return user.name
}

/** Den/de andra deltagarna (ej mig själv). */
export function otherMembers(principal: Principal, c: Conversation): User[] {
  return c.memberUserIds
    .filter((id) => id !== principal.userId)
    .map((id) => byId(db.data.users, id))
    .filter((u): u is User => !!u)
}

/** Rubriktext för konversationen (motpart eller gruppnamn). */
export function conversationTitle(principal: Principal, c: Conversation): string {
  const others = otherMembers(principal, c)
  if (c.kind === 'klass' || c.kind === 'avdelning' || c.kind === 'personal') {
    if (others.length > 1) return `${displayUserName(principal, others[0])} +${others.length - 1}`
  }
  if (others.length === 0) return 'Endast du'
  return displayUserName(principal, others[0])
}

export interface StudentContext {
  name: string
  gradeLabel: string
  protectedMasked: boolean
}

export function studentContext(principal: Principal, c: Conversation): StudentContext | null {
  if (!c.studentId) return null
  const s = byId(db.data.students, c.studentId)
  if (!s) return null
  const masked = s.protectedIdentity && !principal.protectedClearance
  const full = `${s.firstName} ${s.lastName}`
  return {
    name: masked ? maskName(full) : full,
    gradeLabel: s.gradeLabel,
    protectedMasked: masked,
  }
}

/** Markera konversationen som läst för mig (nollställ oläst + läskvitto). */
export function markConversationRead(principal: Principal, conversationId: string): void {
  const conv = byId(db.data.conversations, conversationId)
  if (!conv) return
  conv.unread = 0
  for (const m of db.data.messages) {
    if (m.conversationId === conversationId && !m.readBy.includes(principal.userId)) {
      m.readBy.push(principal.userId)
    }
  }
}

/** Markera som oläst igen (personlig inkorgsåtgärd). */
export function markConversationUnread(conversationId: string): void {
  const conv = byId(db.data.conversations, conversationId)
  if (conv) conv.unread = Math.max(1, conv.unread)
}

export function toggleArchived(principal: Principal, conversationId: string): void {
  const conv = byId(db.data.conversations, conversationId)
  if (!conv) return
  conv.archived = !conv.archived
  logAudit(actorFromPrincipal(principal, conv.schoolId), {
    action: conv.archived ? 'message.archive' : 'message.unarchive',
    resource: 'message',
    targetId: conv.id,
    targetLabel: conv.subject,
    riskLevel: 'låg',
  })
}

/** Behöver konversationen läsbekräftelse av mig? */
export function needsConfirmation(principal: Principal, c: Conversation): boolean {
  if (!c.requiresConfirmation) return false
  return conversationMessages(c.id).some(
    (m) => m.senderUserId !== principal.userId && !m.confirmed,
  )
}

export function confirmRead(principal: Principal, c: Conversation): void {
  for (const m of db.data.messages) {
    if (m.conversationId === c.id && m.senderUserId !== principal.userId) {
      m.confirmed = true
      if (!m.readBy.includes(principal.userId)) m.readBy.push(principal.userId)
    }
  }
  c.unread = 0
  logAudit(actorFromPrincipal(principal, c.schoolId), {
    action: 'message.confirm',
    resource: 'message',
    targetId: c.id,
    targetLabel: c.subject,
    riskLevel: 'låg',
  })
}

export interface SendResult {
  ok: boolean
  error?: string
  warning?: string
}

/** Skicka meddelande: rate-limit → authorize → mutera → notis → audit. */
export function sendMessage(principal: Principal, conv: Conversation, body: string): SendResult {
  const text = body.trim()
  if (!text) return { ok: false, error: 'Skriv ett meddelande först.' }

  // 1) Kostnads-/missbruksskydd.
  const rl = checkRateLimit('message.send', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) {
    return {
      ok: false,
      error: `Du har skickat många meddelanden på kort tid (gräns ${rl.limit} ${rl.windowLabel}). Vänta en stund och försök igen.`,
    }
  }

  // 2) Auktorisering (auktoritativ – inte bara dold knapp).
  try {
    authorize(principal, 'create', 'message', {
      organizationId: conv.organizationId,
      schoolId: conv.schoolId ?? null,
      studentId: conv.studentId,
    })
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message }
    throw e
  }

  // 3) Mutera.
  const now = new Date().toISOString()
  const message: Message = {
    id: nextId('msg'),
    conversationId: conv.id,
    senderUserId: principal.userId,
    body: text,
    sentAt: now,
    readBy: [principal.userId],
    confirmed: false,
    attachmentIds: [],
  }
  db.data.messages.push(message)
  conv.lastMessageAt = now
  conv.unread = 0

  // 4) Notis till mottagare (klassificering → maskeras i extern kanal).
  const recipients = conv.memberUserIds.filter((id) => id !== principal.userId)
  for (const rid of recipients) {
    sendNotification({
      userId: rid,
      organizationId: conv.organizationId,
      title: 'Nytt meddelande',
      body: `${conv.subject}: du har ett nytt meddelande i Skolnav.`,
      category: 'meddelande',
      channel: 'app',
      classification: conv.dataClassification as 1 | 2 | 3 | 4 | 5 | 6,
    })
  }

  // 5) Granskningslogg.
  logAudit(actorFromPrincipal(principal, conv.schoolId), {
    action: 'message.send',
    resource: 'message',
    targetId: conv.id,
    targetLabel: conv.subject,
    riskLevel: 'låg',
  })

  return { ok: true, warning: rl.state === 'narmar_grans' ? 'Du närmar dig gränsen för antal meddelanden.' : undefined }
}

export interface RecipientOption {
  userId: string
  label: string
  sublabel: string
  kind: Kind
  studentId: string | null
}

/**
 * Behörighetsbegränsade mottagare. Vårdnadshavare når endast personal kring
 * egna barn (och bara för barn där relationen tillåter kontakt). Personal och
 * ledning når vårdnadshavare och kollegor inom sin räckvidd.
 */
export function recipientOptions(principal: Principal): RecipientOption[] {
  const options: RecipientOption[] = []
  const seen = new Set<string>()
  const push = (o: RecipientOption) => {
    const key = `${o.userId}:${o.studentId ?? ''}`
    if (seen.has(key) || o.userId === principal.userId) return
    seen.add(key)
    options.push(o)
  }

  if (principal.role === 'vardnadshavare') {
    for (const sid of principal.guardianStudentIds) {
      const perms = principal.guardianPermsByStudent[sid]
      if (perms && perms.chatWithStaff === false) continue // relationen tillåter inte kontakt
      const student = byId(db.data.students, sid)
      if (!student) continue
      const childName = student.protectedIdentity && !principal.protectedClearance
        ? maskName(`${student.firstName} ${student.lastName}`)
        : student.firstName
      const staffIds = new Set<string>()
      const cls = student.classId ? byId(db.data.classes, student.classId) : undefined
      if (cls?.mentorUserId) staffIds.add(cls.mentorUserId)
      db.data.staff
        .filter((s) => s.schoolId === student.schoolId && s.active)
        .slice(0, 6)
        .forEach((s) => staffIds.add(s.userId))
      for (const staffId of staffIds) {
        const u = byId(db.data.users, staffId)
        if (!u) continue
        const profile = db.data.staff.find((s) => s.userId === staffId)
        push({
          userId: staffId,
          label: displayUserName(principal, u),
          sublabel: `${profile?.title ?? 'Personal'} · gäller ${childName}`,
          kind: 'vh_larare',
          studentId: sid,
        })
      }
    }
    return options.slice(0, 40)
  }

  // Personal och ledning
  const scopeStudents = principal.classIds.length
    ? db.data.students.filter((s) => s.classId && principal.classIds.includes(s.classId))
    : db.data.students.filter((s) => principal.schoolIds.includes(s.schoolId))
  const scopeStudentIds = new Set(scopeStudents.map((s) => s.id))

  // Vårdnadshavare till elever i räckvidden
  for (const rel of db.data.relations) {
    if (!scopeStudentIds.has(rel.studentId)) continue
    const guardian = byId(db.data.users, rel.guardianUserId)
    const student = byId(db.data.students, rel.studentId)
    if (!guardian || !student) continue
    const childName = student.protectedIdentity && !principal.protectedClearance
      ? maskName(`${student.firstName} ${student.lastName}`)
      : `${student.firstName} ${student.lastName}`
    push({
      userId: rel.guardianUserId,
      label: displayUserName(principal, guardian),
      sublabel: `Vårdnadshavare · ${childName}`,
      kind: 'vh_larare',
      studentId: rel.studentId,
    })
    if (options.length >= 30) break
  }

  // Kollegor på samma skola
  db.data.staff
    .filter((s) => !!s.schoolId && principal.schoolIds.includes(s.schoolId) && s.active)
    .slice(0, 20)
    .forEach((s) => {
      const u = byId(db.data.users, s.userId)
      if (!u) return
      push({
        userId: s.userId,
        label: displayUserName(principal, u),
        sublabel: `${s.title} · kollega`,
        kind: 'personal',
        studentId: null,
      })
    })

  return options.slice(0, 50)
}

export interface CreateResult {
  ok: boolean
  conv?: Conversation
  error?: string
}

/** Skapa ny konversation via en vald mottagare (behörighetsprövad). */
export function createConversation(
  principal: Principal,
  input: { recipient: RecipientOption; subject: string; body: string },
): CreateResult {
  const subject = input.subject.trim() || 'Ny konversation'
  const schoolId = input.recipient.studentId
    ? byId(db.data.students, input.recipient.studentId)?.schoolId ?? principal.schoolIds[0] ?? null
    : principal.schoolIds[0] ?? null

  try {
    authorize(principal, 'create', 'message', {
      organizationId: principal.organizationId,
      schoolId,
      studentId: input.recipient.studentId,
    })
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message }
    throw e
  }

  const now = new Date().toISOString()
  const conv: Conversation = {
    id: nextId('conv'),
    subject,
    kind: input.recipient.kind,
    memberUserIds: [principal.userId, input.recipient.userId],
    studentId: input.recipient.studentId,
    lastMessageAt: now,
    unread: 0,
    archived: false,
    requiresConfirmation: false,
    organizationId: principal.organizationId,
    schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: 3,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: 36,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.conversations.unshift(conv)

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'message.conversation.create',
    resource: 'message',
    targetId: conv.id,
    targetLabel: subject,
    riskLevel: 'låg',
  })

  const body = input.body.trim()
  if (body) {
    const res = sendMessage(principal, conv, body)
    if (!res.ok) return { ok: false, error: res.error }
  }

  return { ok: true, conv }
}
