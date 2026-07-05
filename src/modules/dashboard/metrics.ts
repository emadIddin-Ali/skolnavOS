import { db } from '@/data/db/store'
import type { Principal } from '@/core/permissions/engine'
import { can } from '@/core/permissions/engine'

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

export function studentsInScope(p: Principal) {
  return db.data.students.filter((s) => {
    if (p.role === 'vardnadshavare') return p.guardianStudentIds.includes(s.id)
    if (p.ownStudentId) return s.id === p.ownStudentId
    return can(p, 'read', 'student', { organizationId: s.organizationId, schoolId: s.schoolId, classId: s.classId, studentId: s.id, protectedIdentity: s.protectedIdentity }).allowed
  })
}

export function dashboardMetrics(p: Principal) {
  const students = studentsInScope(p)
  const studentIds = new Set(students.map((s) => s.id))

  const todayAtt = db.data.attendance.filter((a) => isToday(a.date) && (studentIds.has(a.studentId) || can(p, 'read', 'attendance', { schoolId: a.schoolId, classId: a.classId, studentId: a.studentId }).allowed))
  const marked = todayAtt.filter((a) => a.status !== 'ej_markerad')
  const present = todayAtt.filter((a) => a.status === 'narvarande').length
  const absent = todayAtt.filter((a) => a.status === 'franvarande').length
  const late = todayAtt.filter((a) => a.status === 'sen').length
  const unmarked = todayAtt.filter((a) => a.status === 'ej_markerad').length

  const pendingAbsence = db.data.absences.filter(
    (a) => (a.status === 'inskickad' || a.status === 'kraver_atgard') && can(p, 'read', 'absence', { schoolId: a.schoolId, studentId: a.studentId }).allowed,
  ).length

  const unreadMessages = db.data.conversations
    .filter((c) => c.memberUserIds.includes(p.userId))
    .reduce((sum, c) => sum + c.unread, 0)

  const pendingConsents = db.data.consentRequests.filter(
    (c) => c.status !== 'signerad' && can(p, 'read', 'consent', { schoolId: c.schoolId, studentId: c.studentId }).allowed,
  ).length

  const openIncidents = db.data.incidents.filter(
    (i) => (i.status === 'öppen' || i.status === 'under_utredning') && can(p, 'read', 'incident', { schoolId: i.schoolId, studentId: i.studentId, dataClassification: 4 }).allowed,
  ).length

  const integrationIssues = can(p, 'read', 'integration').allowed
    ? db.data.integrations.filter((i) => i.organizationId === p.organizationId && (i.status === 'fel' || i.status.startsWith('kraver'))).length
    : 0

  const rateWarnings = can(p, 'read', 'rate_limit').allowed
    ? db.data.rateLimitEvents.filter((e) => e.organizationId === p.organizationId && e.state !== 'normal' && e.state !== 'narmar_grans').length
    : 0

  const gdprOpen = can(p, 'read', 'gdpr').allowed
    ? db.data.gdprRequests.filter((g) => g.organizationId === p.organizationId && g.status !== 'fardigstalld' && g.status !== 'arkiverad').length
    : 0

  const securityOpen = can(p, 'read', 'security').allowed
    ? db.data.securityEvents.filter((e) => e.organizationId === p.organizationId && !e.resolved).length
    : 0

  return {
    studentCount: students.length,
    attendanceRate: marked.length ? Math.round((present / marked.length) * 100) : 0,
    present, absent, late, unmarked,
    todayTotal: todayAtt.length,
    pendingAbsence,
    unreadMessages,
    pendingConsents,
    openIncidents,
    integrationIssues,
    rateWarnings,
    gdprOpen,
    securityOpen,
  }
}
