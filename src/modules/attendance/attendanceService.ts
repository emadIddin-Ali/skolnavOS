import { db, nextId } from '@/data/db/store'
import type { AttendanceRecord, AttendanceStatus, Student } from '@/data/schema'
import { ATTENDANCE_STATUS_LABEL } from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { fmtDate } from '@/lib/format'

/**
 * Tjänstelager för närvaro. Behörighetsmotorn är auktoritativ: varje mutation
 * går via authorize() (inte bara dolda knappar) och skyddas av rate-limit.
 * Store:t muteras direkt (in-memory-backend) och känsliga åtgärder loggas.
 */

/** Är ISO-datumet dagens datum (lokal kalenderdag)? */
export function isSameDay(dateIso: string, now = new Date()): boolean {
  try {
    return fmtDate(dateIso) === fmtDate(now)
  } catch {
    return false
  }
}

/** Dagens närvaropost för en elev, om den finns. */
export function todayRecord(studentId: string, now = new Date()): AttendanceRecord | undefined {
  return db.data.attendance.find((a) => a.studentId === studentId && isSameDay(a.date, now))
}

/** Aktuell status för en elev idag (ej markerad om post saknas). */
export function currentStatus(studentId: string, now = new Date()): AttendanceStatus {
  return todayRecord(studentId, now)?.status ?? 'ej_markerad'
}

export interface SetStatusResult {
  record: AttendanceRecord
  previous: AttendanceStatus
  queued: boolean
}

/**
 * Sätter/ändrar en elevs närvarostatus för idag. Kastar ForbiddenError vid
 * nekad behörighet och RateLimitedError när gränsen är nådd. Offline: ändringen
 * tillämpas lokalt och markeras som köad (synkas när anslutningen är åter).
 */
export function setAttendanceStatus(
  principal: Principal,
  student: Student,
  next: AttendanceStatus,
  opts: { offline?: boolean; now?: Date } = {},
): SetStatusResult {
  const now = opts.now ?? new Date()

  // Auktoritativ kontroll – aldrig enbart dold i UI.
  authorize(principal, 'update', 'attendance', {
    organizationId: student.organizationId,
    schoolId: student.schoolId,
    classId: student.classId,
    studentId: student.id,
    protectedIdentity: student.protectedIdentity,
  })

  // Kostnads- och missbruksskydd för korrigeringar.
  const rl = checkRateLimit('attendance.correct', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const nowIso = now.toISOString()
  let record = todayRecord(student.id, now)
  const previous: AttendanceStatus = record?.status ?? 'ej_markerad'

  if (!record) {
    record = {
      id: nextId('att'),
      studentId: student.id,
      classId: student.classId,
      courseId: null,
      date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 15).toISOString(),
      status: next,
      markedBy: principal.userId,
      markedAt: nowIso,
      note: '',
      fromAbsenceReport: false,
      organizationId: student.organizationId,
      schoolId: student.schoolId,
      createdBy: principal.userId,
      updatedBy: principal.userId,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
      dataClassification: 3,
      sourceSystem: 'skolnav',
      externalId: null,
      version: 1,
      lastSyncedAt: null,
      retentionMonths: 36,
    }
    db.data.attendance.unshift(record)
  } else {
    record.status = next
    record.markedBy = principal.userId
    record.markedAt = nowIso
    record.updatedBy = principal.userId
    record.updatedAt = nowIso
    record.version += 1
  }

  logAudit(actorFromPrincipal(principal, student.schoolId), {
    action: 'attendance.update',
    resource: 'attendance',
    targetId: student.id,
    targetLabel: `${student.firstName} ${student.lastName}`,
    previousValue: ATTENDANCE_STATUS_LABEL[previous],
    newValue: ATTENDANCE_STATUS_LABEL[next],
    reason: opts.offline ? 'Köad lokal ändring – offline' : null,
    riskLevel: 'låg',
  })

  return { record, previous, queued: !!opts.offline }
}
