import type {
  Organization, School, SchoolYear, Term, User, Membership, License, FeatureFlag,
  Student, StaffProfile, GuardianProfile, GuardianStudentRelation, GuardianPermissions,
  Department, SchoolClass, Subject, Course, Room, Enrollment, ScheduleEvent,
  Assignment, Submission, Assessment,
  AttendanceRecord, AttendanceStatus, AbsenceReport, PickupAuthorization, MealPlan,
  HealthRecord, Incident, ConsentTemplate, ConsentRequest, ConsentResponse,
  Conversation, Message, Announcement, DocumentationPost, NotificationItem,
  StoredFile, ReportJob, ImportJob, AuditLog, SecurityEvent, GdprRequest,
  SupportSession, Integration, IntegrationRun, RateLimitEvent,
} from '@/data/schema'
import type { RoleKey } from '@/core/domain/roles'
import { makeRng, FIRST_NAMES, LAST_NAMES, STAFF_TITLES, SUBJECTS, ALLERGENS, LUNCH_DISHES } from '@/data/db/rng'

export interface SeedData {
  organizations: Organization[]
  schools: School[]
  schoolYears: SchoolYear[]
  terms: Term[]
  users: User[]
  memberships: Membership[]
  licenses: License[]
  featureFlags: FeatureFlag[]
  departments: Department[]
  classes: SchoolClass[]
  subjects: Subject[]
  courses: Course[]
  rooms: Room[]
  students: Student[]
  staff: StaffProfile[]
  guardians: GuardianProfile[]
  relations: GuardianStudentRelation[]
  enrollments: Enrollment[]
  scheduleEvents: ScheduleEvent[]
  assignments: Assignment[]
  submissions: Submission[]
  assessments: Assessment[]
  attendance: AttendanceRecord[]
  absences: AbsenceReport[]
  pickups: PickupAuthorization[]
  meals: MealPlan[]
  health: HealthRecord[]
  incidents: Incident[]
  consentTemplates: ConsentTemplate[]
  consentRequests: ConsentRequest[]
  consentResponses: ConsentResponse[]
  conversations: Conversation[]
  messages: Message[]
  announcements: Announcement[]
  documentation: DocumentationPost[]
  notifications: NotificationItem[]
  files: StoredFile[]
  reports: ReportJob[]
  imports: ImportJob[]
  auditLogs: AuditLog[]
  securityEvents: SecurityEvent[]
  gdprRequests: GdprRequest[]
  supportSessions: SupportSession[]
  integrations: Integration[]
  integrationRuns: IntegrationRun[]
  rateLimitEvents: RateLimitEvent[]
  /** Demo-inloggning: en principal-mall per roll. */
  demoAccounts: DemoAccount[]
}

export interface DemoAccount {
  role: RoleKey
  userId: string
  organizationId: string
  schoolIds: string[]
  classIds: string[]
  courseIds: string[]
  guardianStudentIds: string[]
  ownStudentId?: string | null
  validUntil?: string | null
  protectedClearance: boolean
}

const COLORS = ['#1f4e79', '#2f8f83', '#8a5a2d', '#5a4a91', '#2e7d5b', '#b07418', '#9b2c2c', '#3b7ea1']

function iso(d: Date): string {
  return d.toISOString()
}
function daysAgo(now: Date, n: number, hour = 9, min = 0): Date {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  d.setHours(hour, min, 0, 0)
  return d
}

export function generateSeed(now: Date = new Date()): SeedData {
  const rng = makeRng(20260209)
  const nowIso = iso(now)

  // ---- Organisationer ----
  const organizations: Organization[] = [
    { id: 'org-lund', name: 'Lunds kommun – Utbildningsförvaltningen', orgNumber: '212000-1132', kind: 'kommun', createdAt: iso(daysAgo(now, 900)), licenseTier: 'koncern' },
    { id: 'org-nordstjarnan', name: 'Nordstjärnan Utbildning AB', orgNumber: '556734-1298', kind: 'friskola', createdAt: iso(daysAgo(now, 700)), licenseTier: 'plus' },
  ]

  // ---- Skolor ----
  const schools: School[] = [
    { id: 'sch-solskiftet', organizationId: 'org-lund', name: 'Solskiftets förskola', type: 'forskola', municipality: 'Lund', address: 'Tunavägen 12, Lund', lat: 55.712, lng: 13.206, studentCount: 0, createdAt: iso(daysAgo(now, 800)) },
    { id: 'sch-bjorkeberga', organizationId: 'org-lund', name: 'Björkeberga grundskola', type: 'grundskola', municipality: 'Lund', address: 'Björkgatan 4, Lund', lat: 55.705, lng: 13.19, studentCount: 0, createdAt: iso(daysAgo(now, 800)) },
    { id: 'sch-katedral', organizationId: 'org-lund', name: 'Katedralgymnasiet', type: 'gymnasium', municipality: 'Lund', address: 'Stora Södergatan 22, Lund', lat: 55.699, lng: 13.194, studentCount: 0, createdAt: iso(daysAgo(now, 800)) },
    { id: 'sch-vux-nord', organizationId: 'org-nordstjarnan', name: 'Nordstjärnan Vuxenutbildning', type: 'vux', municipality: 'Malmö', address: 'Hamngatan 8, Malmö', lat: 55.606, lng: 13.001, studentCount: 0, createdAt: iso(daysAgo(now, 650)) },
  ]

  // ---- Läsår & terminer ----
  const schoolYears: SchoolYear[] = [
    { id: 'sy-2526', organizationId: 'org-lund', label: '2025/2026', startsOn: '2025-08-18', endsOn: '2026-06-12', current: true },
    { id: 'sy-2425', organizationId: 'org-lund', label: '2024/2025', startsOn: '2024-08-19', endsOn: '2025-06-13', current: false },
  ]
  const terms: Term[] = [
    { id: 'term-ht25', schoolYearId: 'sy-2526', label: 'Höstterminen 2025', startsOn: '2025-08-18', endsOn: '2025-12-19', current: false },
    { id: 'term-vt26', schoolYearId: 'sy-2526', label: 'Vårterminen 2026', startsOn: '2026-01-08', endsOn: '2026-06-12', current: true },
  ]

  const subjects: Subject[] = SUBJECTS.map((s, i) => ({ id: `subj-${i}`, code: s.code, name: s.name }))

  // ---- Rum ----
  const rooms: Room[] = []
  for (const sch of schools) {
    for (let i = 1; i <= 6; i++) rooms.push({ id: `room-${sch.id}-${i}`, schoolId: sch.id, name: `${sch.type === 'forskola' ? 'Avd' : 'Sal'} ${i}`, seats: rng.int(20, 32) })
  }

  const departments: Department[] = [
    { id: 'dep-bj-1', schoolId: 'sch-bjorkeberga', name: 'Lågstadiet' },
    { id: 'dep-bj-2', schoolId: 'sch-bjorkeberga', name: 'Mellanstadiet' },
    { id: 'dep-bj-3', schoolId: 'sch-bjorkeberga', name: 'Högstadiet' },
    { id: 'dep-sol-1', schoolId: 'sch-solskiftet', name: 'Småbarn' },
    { id: 'dep-sol-2', schoolId: 'sch-solskiftet', name: 'Storbarn' },
    { id: 'dep-kat-1', schoolId: 'sch-katedral', name: 'Naturvetenskap' },
    { id: 'dep-kat-2', schoolId: 'sch-katedral', name: 'Samhällsvetenskap' },
  ]

  // ---- Klasser (15) ----
  const classes: SchoolClass[] = [
    // Förskola
    { id: 'cls-sol-solen', organizationId: 'org-lund', schoolId: 'sch-solskiftet', name: 'Solen', gradeLabel: 'Avdelning', departmentId: 'dep-sol-2', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-sol-manen', organizationId: 'org-lund', schoolId: 'sch-solskiftet', name: 'Månen', gradeLabel: 'Avdelning', departmentId: 'dep-sol-1', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    // Grundskola
    { id: 'cls-bj-1a', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '1A', gradeLabel: 'Åk 1', departmentId: 'dep-bj-1', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-2a', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '2A', gradeLabel: 'Åk 2', departmentId: 'dep-bj-1', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-4a', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '4A', gradeLabel: 'Åk 4', departmentId: 'dep-bj-2', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-5b', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '5B', gradeLabel: 'Åk 5', departmentId: 'dep-bj-2', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-7c', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '7C', gradeLabel: 'Åk 7', departmentId: 'dep-bj-3', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-8a', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '8A', gradeLabel: 'Åk 8', departmentId: 'dep-bj-3', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-bj-9a', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', name: '9A', gradeLabel: 'Åk 9', departmentId: 'dep-bj-3', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    // Gymnasium
    { id: 'cls-kat-na22a', organizationId: 'org-lund', schoolId: 'sch-katedral', name: 'NA22a', gradeLabel: 'Åk 3 NA', departmentId: 'dep-kat-1', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-kat-na23b', organizationId: 'org-lund', schoolId: 'sch-katedral', name: 'NA23b', gradeLabel: 'Åk 2 NA', departmentId: 'dep-kat-1', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-kat-sa22a', organizationId: 'org-lund', schoolId: 'sch-katedral', name: 'SA22a', gradeLabel: 'Åk 3 SA', departmentId: 'dep-kat-2', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-kat-sa23a', organizationId: 'org-lund', schoolId: 'sch-katedral', name: 'SA23a', gradeLabel: 'Åk 2 SA', departmentId: 'dep-kat-2', mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    // Vux
    { id: 'cls-vux-sva', organizationId: 'org-nordstjarnan', schoolId: 'sch-vux-nord', name: 'SVA-grund', gradeLabel: 'Grundläggande', departmentId: null, mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
    { id: 'cls-vux-vård', organizationId: 'org-nordstjarnan', schoolId: 'sch-vux-nord', name: 'Vård & omsorg', gradeLabel: 'Yrkesvux', departmentId: null, mentorUserId: null, studentCount: 0, schoolYearId: 'sy-2526' },
  ]

  // ---- Kurser (12, gymnasium/vux) ----
  const courseDefs = [
    ['MATMAT03c', 'Matematik 3c', 'cls-kat-na22a'],
    ['FYSFYS02', 'Fysik 2', 'cls-kat-na22a'],
    ['KEMKEM02', 'Kemi 2', 'cls-kat-na23b'],
    ['BIOBIO02', 'Biologi 2', 'cls-kat-na23b'],
    ['SVESVE03', 'Svenska 3', 'cls-kat-sa22a'],
    ['ENGENG06', 'Engelska 6', 'cls-kat-sa22a'],
    ['SAMSAM02', 'Samhällskunskap 2', 'cls-kat-sa23a'],
    ['HISHIS01b', 'Historia 1b', 'cls-kat-sa23a'],
    ['PSKPSY01', 'Psykologi 1', 'cls-kat-sa22a'],
    ['SVASVA01', 'Svenska som andraspråk grund', 'cls-vux-sva'],
    ['VÅRVÅR0', 'Vård och omsorg 1', 'cls-vux-vård'],
    ['MATMAT01a', 'Matematik 1a', 'cls-vux-vård'],
  ] as const
  const courses: Course[] = courseDefs.map(([code, name, cls], i) => {
    const school = classes.find((c) => c.id === cls)!
    return { id: `crs-${i}`, organizationId: school.organizationId, schoolId: school.schoolId, code, name, points: 100, teacherUserId: null, studentCount: 0, termId: 'term-vt26' }
  })

  // ---- Personal (45) ----
  const users: User[] = []
  const staff: StaffProfile[] = []
  const memberships: Membership[] = []
  const usedNames = new Set<string>()
  const uniqName = () => {
    for (let tries = 0; tries < 50; tries++) {
      const n = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`
      if (!usedNames.has(n)) { usedNames.add(n); return n }
    }
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${usedNames.size}`
  }
  const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g')
  const emailFor = (name: string, domain: string) =>
    name.toLowerCase().normalize('NFD').replace(COMBINING, '').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@' + domain

  const staffSchoolPool = ['sch-bjorkeberga', 'sch-bjorkeberga', 'sch-bjorkeberga', 'sch-katedral', 'sch-katedral', 'sch-solskiftet', 'sch-vux-nord']
  for (let i = 0; i < 45; i++) {
    const name = uniqName()
    const schoolId = i < 7 ? staffSchoolPool[i] : rng.pick(staffSchoolPool)
    const school = schools.find((s) => s.id === schoolId)!
    const uid = `u-staff-${i}`
    users.push({ id: uid, name, email: emailFor(name, 'skola.lund.se'), avatarColor: rng.pick(COLORS), protectedIdentity: false, mfaEnabled: rng.bool(0.4), status: 'aktiv', lastLoginAt: iso(daysAgo(now, rng.int(0, 6), rng.int(7, 16))), createdAt: iso(daysAgo(now, rng.int(200, 800))) })
    const title = school.type === 'forskola' ? rng.pick(['Förskollärare', 'Barnskötare']) : rng.pick(STAFF_TITLES)
    staff.push({ id: `staff-${i}`, userId: uid, title, employmentType: rng.pick(['tillsvidare', 'tillsvidare', 'visstid']), department: undefined, subjects: rng.picks(SUBJECTS.map((s) => s.code), rng.int(1, 3)), active: true, organizationId: school.organizationId, schoolId, createdAt: iso(daysAgo(now, 400)), updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null })
    memberships.push({ id: `mem-staff-${i}`, userId: uid, organizationId: school.organizationId, role: school.type === 'forskola' ? 'pedagog' : 'larare', schoolId, classIds: [], courseIds: [], validUntil: null, createdAt: nowIso })
  }

  // ---- Elever/barn (120) ----
  const students: Student[] = []
  const classStudentPools = classes.map((c) => ({ cls: c, ids: [] as string[] }))
  const gradeFor = (c: SchoolClass) => c.gradeLabel
  for (let i = 0; i < 120; i++) {
    const cls = classes[i % classes.length]
    const school = schools.find((s) => s.id === cls.schoolId)!
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    const protectedId = i === 12 || i === 47 // två skyddade exempel
    const birthYear = school.type === 'forskola' ? 2021 : school.type === 'grundskola' ? 2010 : school.type === 'gymnasium' ? 2007 : 1999
    const pnr = `${birthYear}${String(rng.int(1, 12)).padStart(2, '0')}${String(rng.int(1, 28)).padStart(2, '0')}-${String(rng.int(1000, 9999))}`
    const sid = `stu-${i}`
    const hasAllergy = rng.bool(0.12)
    const hasPickup = school.type === 'forskola' && rng.bool(0.3)
    students.push({
      id: sid, userId: null, firstName: first, lastName: last, personnummer: pnr, birthDate: `${birthYear}-01-01`,
      schoolType: school.type, gradeLabel: gradeFor(cls), classId: cls.id, photoColor: rng.pick(COLORS),
      protectedIdentity: protectedId, status: 'inskriven', hasAllergyFlag: hasAllergy, hasPickupNote: hasPickup,
      organizationId: school.organizationId, schoolId: cls.schoolId, createdAt: iso(daysAgo(now, rng.int(30, 700))), updatedAt: nowIso, deletedAt: null,
      dataClassification: protectedId ? 5 : 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: protectedId ? 60 : 36,
      createdBy: null, updatedBy: null,
    })
    classStudentPools[i % classes.length].ids.push(sid)
  }
  for (const c of classes) c.studentCount = students.filter((s) => s.classId === c.id).length
  for (const s of schools) s.studentCount = students.filter((st) => st.schoolId === s.id).length

  // Tilldela mentorer och kurslärare från personal
  const teacherUsers = memberships.filter((m) => m.role === 'larare')
  classes.forEach((c, i) => { const t = teacherUsers[i % teacherUsers.length]; if (t) c.mentorUserId = t.userId })
  courses.forEach((c, i) => { const t = teacherUsers[(i + 3) % teacherUsers.length]; if (t) { c.teacherUserId = t.userId; t.courseIds.push(c.id) } ; c.studentCount = students.filter((s) => s.classId === courseDefs[i]?.[2]).length })
  // Ge lärare klass-scope efter mentorskap
  for (const c of classes) { const m = memberships.find((mm) => mm.userId === c.mentorUserId); if (m && !m.classIds.includes(c.id)) m.classIds.push(c.id) }

  // ---- Vårdnadshavare (80) + relationer ----
  const guardians: GuardianProfile[] = []
  const relations: GuardianStudentRelation[] = []
  const defaultPerms = (): GuardianPermissions => ({ viewSchedule: true, reportAbsence: true, chatWithStaff: true, signConsents: true, viewDocumentation: true, viewDocuments: true, updateContact: true, pickup: true, urgentNotifications: true, viewAssessments: false, viewIncidents: false })
  const youngStudents = students.filter((s) => s.schoolType === 'forskola' || s.schoolType === 'grundskola')
  for (let i = 0; i < 80; i++) {
    const name = uniqName()
    const uid = `u-guard-${i}`
    users.push({ id: uid, name, email: emailFor(name, 'gmail.com'), phone: `070-${rng.int(1000000, 9999999)}`, avatarColor: rng.pick(COLORS), protectedIdentity: false, mfaEnabled: false, status: rng.bool(0.85) ? 'aktiv' : 'inbjuden', lastLoginAt: rng.bool(0.7) ? iso(daysAgo(now, rng.int(0, 20), rng.int(6, 22))) : null, createdAt: iso(daysAgo(now, rng.int(20, 600))) })
    guardians.push({ id: `guard-${i}`, userId: uid, phone: `070-${rng.int(1000000, 9999999)}`, preferredChannel: rng.pick(['app', 'app', 'epost']), verified: rng.bool(0.8), organizationId: 'org-lund', schoolId: undefined, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36 })
    // Koppla till 1-2 barn
    const kids = rng.picks(youngStudents, rng.int(1, 2))
    kids.forEach((kid, ki) => {
      const perms = defaultPerms()
      let relType: GuardianStudentRelation['relationType'] = 'vardnadshavare'
      let conflict: string | null = null
      let shared = false
      if (i === 3 && ki === 0) { relType = 'begransad_kontakt'; perms.pickup = false; perms.chatWithStaff = false; conflict = 'Domstolsbeslut om begränsad kontakt – kontrollera vid hämtning.' }
      if (i === 9) { shared = true; conflict = 'Delad vårdnad – båda vårdnadshavare ska informeras separat.' }
      if (i === 15 && ki === 0) { relType = 'ej_hamtbehorig'; perms.pickup = false; conflict = 'Ej hämtbehörig enligt överenskommelse.' }
      relations.push({ id: `rel-${i}-${ki}`, guardianUserId: uid, studentId: kid.id, relationType: relType, permissions: perms, sharedCustody: shared, conflictNote: conflict, verifiedAt: rng.bool(0.8) ? nowIso : null, organizationId: 'org-lund', schoolId: kid.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36 })
    })
  }

  // ---- Enrollments ----
  const enrollments: Enrollment[] = students.map((s, i) => ({ id: `enr-${i}`, studentId: s.id, classId: s.classId, courseId: null, startedOn: '2025-08-18' }))

  // ---- Schema ----
  const scheduleEvents: ScheduleEvent[] = []
  const times = [['08:15', '09:00'], ['09:15', '10:00'], ['10:15', '11:00'], ['11:15', '12:00'], ['13:00', '13:45'], ['13:50', '14:35']]
  const gradeClasses = classes.filter((c) => c.schoolId === 'sch-bjorkeberga')
  gradeClasses.forEach((c) => {
    for (let wd = 0; wd < 5; wd++) {
      for (let p = 0; p < rng.int(3, 5); p++) {
        const subj = rng.pick(SUBJECTS)
        scheduleEvents.push({ id: `sch-${c.id}-${wd}-${p}`, schoolId: c.schoolId, title: subj.name, subjectCode: subj.code, classId: c.id, courseId: null, teacherUserId: c.mentorUserId, roomId: `room-${c.schoolId}-${(p % 6) + 1}`, weekday: wd, startsAt: times[p][0], endsAt: times[p][1] })
      }
    }
  })
  courses.forEach((crs) => {
    for (let wd = 0; wd < 5; wd += 2) {
      scheduleEvents.push({ id: `sch-${crs.id}-${wd}`, schoolId: crs.schoolId, title: crs.name, subjectCode: crs.code.slice(0, 3), classId: null, courseId: crs.id, teacherUserId: crs.teacherUserId, roomId: `room-${crs.schoolId}-${(wd % 6) + 1}`, weekday: wd, startsAt: times[rng.int(0, 5)][0], endsAt: times[rng.int(0, 5)][1] })
    }
  })

  // ---- Uppgifter (15) + inlämningar ----
  const assignments: Assignment[] = []
  const submissions: Submission[] = []
  for (let i = 0; i < 15; i++) {
    const crs = courses[i % courses.length]
    const teacher = crs.teacherUserId ?? teacherUsers[0].userId
    const clsStudents = students.filter((s) => s.classId === courseDefs[i % courses.length]?.[2]).slice(0, 12)
    const submitted = rng.int(0, clsStudents.length)
    const graded = rng.int(0, submitted)
    assignments.push({ id: `asg-${i}`, title: rng.pick(['Laboration', 'Inlämningsuppgift', 'Prov', 'Projektarbete', 'Läsförståelse']) + ` ${i + 1}`, description: 'Följ instruktionerna i uppgiftsbeskrivningen.', classId: null, courseId: crs.id, teacherUserId: teacher, dueAt: iso(daysAgo(now, -rng.int(1, 14), 23, 59)), status: 'publicerad', submissionsCount: submitted, gradedCount: graded, organizationId: crs.organizationId, schoolId: crs.schoolId, createdAt: iso(daysAgo(now, rng.int(1, 20))), updatedAt: nowIso, deletedAt: null, dataClassification: 2, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: teacher, updatedBy: teacher })
    clsStudents.forEach((s, si) => { const st: Submission['status'] = si < graded ? 'bedömd' : si < submitted ? 'inlämnad' : 'ej_inlämnad'; submissions.push({ id: `sub-${i}-${si}`, assignmentId: `asg-${i}`, studentId: s.id, submittedAt: st === 'ej_inlämnad' ? null : iso(daysAgo(now, rng.int(0, 3))), status: st, grade: st === 'bedömd' ? rng.pick(['A', 'B', 'C', 'D', 'E']) : null }) })
  }

  // ---- Bedömningar (12) ----
  const assessments: Assessment[] = []
  for (let i = 0; i < 12; i++) {
    const crs = courses[i % courses.length]
    const clsStudents = students.filter((s) => s.classId === courseDefs[i % courses.length]?.[2])
    const stu = clsStudents[i % Math.max(clsStudents.length, 1)] ?? students[i]
    assessments.push({ id: `ass-${i}`, studentId: stu.id, courseId: crs.id, subjectCode: crs.code.slice(0, 3), grade: rng.pick(['A', 'B', 'C', 'D', 'E']), type: rng.pick(['omdöme', 'terminsbetyg', 'prov']), comment: 'Utvecklas väl mot målen.', assessedBy: crs.teacherUserId ?? teacherUsers[0].userId, assessedAt: iso(daysAgo(now, rng.int(1, 30))), organizationId: crs.organizationId, schoolId: crs.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 60, createdBy: crs.teacherUserId, updatedBy: crs.teacherUserId })
  }

  // ---- Närvaro: 25 idag + 60 historiska ----
  const attendance: AttendanceRecord[] = []
  const todayStudents = students.filter((s) => s.schoolId === 'sch-bjorkeberga').slice(0, 25)
  const statusPool: AttendanceStatus[] = ['narvarande', 'narvarande', 'narvarande', 'narvarande', 'franvarande', 'sen', 'hamtad']
  todayStudents.forEach((s, i) => {
    const status = i < 3 ? 'ej_markerad' : rng.pick(statusPool)
    attendance.push({ id: `att-today-${i}`, studentId: s.id, classId: s.classId, courseId: null, date: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 15)), status, markedBy: status === 'ej_markerad' ? null : (classes.find((c) => c.id === s.classId)?.mentorUserId ?? null), markedAt: status === 'ej_markerad' ? null : iso(daysAgo(now, 0, 8, 20)), note: s.hasAllergyFlag ? 'Allergi noterad' : '', fromAbsenceReport: status === 'franvarande' && rng.bool(0.5), organizationId: s.organizationId, schoolId: s.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null })
  })
  for (let i = 0; i < 60; i++) {
    const s = rng.pick(students)
    const status = rng.pick(statusPool)
    attendance.push({ id: `att-hist-${i}`, studentId: s.id, classId: s.classId, courseId: null, date: iso(daysAgo(now, rng.int(1, 30), 8, 15)), status, markedBy: classes.find((c) => c.id === s.classId)?.mentorUserId ?? null, markedAt: iso(daysAgo(now, rng.int(1, 30), 8, 20)), note: '', fromAbsenceReport: rng.bool(0.3), organizationId: s.organizationId, schoolId: s.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null })
  }

  // ---- Frånvaroanmälningar (20) ----
  const absences: AbsenceReport[] = []
  for (let i = 0; i < 20; i++) {
    const rel = rng.pick(relations)
    const status = rng.pick(['inskickad', 'bekraftad', 'bekraftad', 'kraver_atgard', 'avslagen'] as AbsenceReport['status'][])
    absences.push({ id: `abs-${i}`, studentId: rel.studentId, reportedByUserId: rel.guardianUserId, reason: rng.pick(['sjuk', 'sjuk', 'ledig', 'lakarbesok', 'tandlakare', 'okand', 'annan']), status, fullDay: rng.bool(0.7), fromTime: null, toTime: null, date: iso(daysAgo(now, rng.int(0, 7))), comment: rng.bool(0.5) ? 'Återkommer imorgon.' : '', handledBy: status !== 'inskickad' ? teacherUsers[0].userId : null, organizationId: 'org-lund', schoolId: rel.schoolId ?? 'sch-bjorkeberga', createdAt: iso(daysAgo(now, rng.int(0, 7))), updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: rel.guardianUserId, updatedBy: null })
  }

  // ---- Hämtning ----
  const pickups: PickupAuthorization[] = students.filter((s) => s.hasPickupNote).flatMap((s, i) => [
    { id: `pick-${i}-1`, studentId: s.id, personName: uniqName(), relation: 'Mormor', authorized: true, note: '', addedByUserId: relations.find((r) => r.studentId === s.id)?.guardianUserId ?? 'u-guard-0', organizationId: 'org-lund', schoolId: s.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null },
  ])

  // ---- Måltider (veckans luncher) ----
  const meals: MealPlan[] = []
  for (let d = 0; d < 5; d++) meals.push({ id: `meal-${d}`, schoolId: 'sch-bjorkeberga', date: iso(daysAgo(now, -d, 11, 30)), lunch: LUNCH_DISHES[d % LUNCH_DISHES.length], vegetarian: 'Vegetarisk gryta med bröd och sallad', allergens: rng.picks(ALLERGENS, rng.int(1, 3)) })

  // ---- Hälsa/specialkost (8) ----
  const health: HealthRecord[] = []
  const allergyStudents = students.filter((s) => s.hasAllergyFlag).slice(0, 8)
  allergyStudents.forEach((s, i) => health.push({ id: `hlt-${i}`, studentId: s.id, kind: rng.pick(['allergi', 'specialkost', 'medicinsk']), label: rng.pick(['Nötallergi', 'Laktosintolerans', 'Glutenintolerans', 'Astma', 'Diabetes typ 1']), severity: rng.pick(['medel', 'hög', 'kritisk']), instructions: 'Se åtgärdsplan. Adrenalinpenna finns hos skolsköterska.', organizationId: s.organizationId, schoolId: s.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 60, createdBy: null, updatedBy: null }))

  // ---- Incidenter (12) ----
  const incidents: Incident[] = []
  for (let i = 0; i < 12; i++) {
    const s = rng.pick(students)
    incidents.push({ id: `inc-${i}`, title: rng.pick(['Fallolycka på skolgården', 'Konflikt mellan elever', 'Kränkande behandling', 'Skadegörelse', 'Tillbud i slöjdsal']), studentId: rng.bool(0.7) ? s.id : null, category: rng.pick(['tillbud', 'olycka', 'konflikt', 'kränkning', 'skada', 'övrigt']), severity: rng.pick(['låg', 'medel', 'hög', 'allvarlig']), status: rng.pick(['öppen', 'under_utredning', 'åtgärdad', 'avslutad']), description: 'Händelsen dokumenterades och vårdnadshavare informerades.', reportedBy: teacherUsers[i % teacherUsers.length].userId, occurredAt: iso(daysAgo(now, rng.int(0, 40))), organizationId: 'org-lund', schoolId: s.schoolId, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 60, createdBy: null, updatedBy: null })
  }

  // ---- Samtycken (15) ----
  const consentTemplates: ConsentTemplate[] = [
    { id: 'ct-foto', organizationId: 'org-lund', title: 'Fotografering och publicering', description: 'Samtycke till att foton får användas i skolans kanaler.', category: 'foto', requiresBothGuardians: true },
    { id: 'ct-utflykt', organizationId: 'org-lund', title: 'Utflykt och simning', description: 'Medgivande för deltagande i utflykter och simundervisning.', category: 'utflykt', requiresBothGuardians: false },
    { id: 'ct-medicin', organizationId: 'org-lund', title: 'Medicinering under skoltid', description: 'Godkännande för administrering av medicin.', category: 'medicin', requiresBothGuardians: true },
    { id: 'ct-data', organizationId: 'org-lund', title: 'Digitala lärresurser', description: 'Samtycke till behandling av personuppgifter i lärverktyg.', category: 'data', requiresBothGuardians: false },
  ]
  const consentRequests: ConsentRequest[] = []
  const consentResponses: ConsentResponse[] = []
  for (let i = 0; i < 15; i++) {
    const tpl = rng.pick(consentTemplates)
    const s = rng.pick(youngStudents)
    const required = tpl.requiresBothGuardians ? 2 : 1
    const responded = rng.int(0, required)
    const status: ConsentRequest['status'] = responded === 0 ? 'utskickad' : responded < required ? 'delvis' : 'signerad'
    consentRequests.push({ id: `cr-${i}`, templateId: tpl.id, title: tpl.title, studentId: s.id, dueAt: iso(daysAgo(now, -rng.int(3, 20))), status, respondedCount: responded, requiredCount: required, organizationId: 'org-lund', schoolId: s.schoolId, createdAt: iso(daysAgo(now, rng.int(1, 10))), updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null })
    const guardiansOf = relations.filter((r) => r.studentId === s.id)
    guardiansOf.slice(0, responded).forEach((r, ri) => consentResponses.push({ id: `cres-${i}-${ri}`, requestId: `cr-${i}`, guardianUserId: r.guardianUserId, decision: rng.bool(0.9) ? 'godkänt' : 'avböjt', signedAt: nowIso, method: rng.pick(['app', 'e-legitimation']) }))
  }

  // ---- Konversationer (18) + meddelanden ----
  const conversations: Conversation[] = []
  const messages: Message[] = []
  for (let i = 0; i < 18; i++) {
    const kind = rng.pick(['vh_larare', 'vh_larare', 'personal', 'klass', 'direkt'] as Conversation['kind'][])
    const rel = rng.pick(relations)
    const teacher = teacherUsers[i % teacherUsers.length].userId
    const members = kind === 'vh_larare' ? [rel.guardianUserId, teacher] : kind === 'personal' ? [teacher, teacherUsers[(i + 1) % teacherUsers.length].userId] : [teacher]
    const unread = rng.int(0, 3)
    conversations.push({ id: `conv-${i}`, subject: rng.pick(['Fråga om läxa', 'Angående frånvaro', 'Utvecklingssamtal', 'Information till klassen', 'Uppföljning']), kind, memberUserIds: members, studentId: kind === 'vh_larare' ? rel.studentId : null, lastMessageAt: iso(daysAgo(now, rng.int(0, 5), rng.int(8, 18))), unread, archived: rng.bool(0.15), requiresConfirmation: rng.bool(0.2), organizationId: 'org-lund', schoolId: rel.schoolId ?? 'sch-bjorkeberga', createdAt: iso(daysAgo(now, rng.int(1, 20))), updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null })
    const msgCount = rng.int(2, 5)
    for (let m = 0; m < msgCount; m++) messages.push({ id: `msg-${i}-${m}`, conversationId: `conv-${i}`, senderUserId: members[m % members.length], body: rng.pick(['Hej! Jag undrar över dagens läxa.', 'Tack för informationen.', 'Vi ses på mötet.', 'Kan vi boka en tid?', 'Absolut, det ordnar vi.']), sentAt: iso(daysAgo(now, rng.int(0, 5), rng.int(8, 18) + m % 3)), readBy: m < msgCount - unread ? members : [members[0]], confirmed: false, attachmentIds: [] })
  }

  // ---- Anslag ----
  const announcements: Announcement[] = [
    { id: 'ann-0', title: 'Studiedag fredag 13 mars', body: 'Skolan är stängd för elever på grund av kompetensutveckling.', audience: 'skola', urgent: false, publishedBy: 'u-rektor', publishedAt: iso(daysAgo(now, 2, 9)), scheduledFor: null, confirmationsRequired: false, organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 1, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
    { id: 'ann-1', title: 'Vinterkräksjuka – tvätta händerna', body: 'Vi ser ökad frånvaro. Håll sjuka barn hemma tills symtomfria 48 timmar.', audience: 'vardnadshavare', urgent: true, publishedBy: 'u-rektor', publishedAt: iso(daysAgo(now, 1, 8)), scheduledFor: null, confirmationsRequired: true, organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 1, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
  ]

  // ---- Dokumentation (förskola/lärlogg) ----
  const documentation: DocumentationPost[] = []
  for (let i = 0; i < 6; i++) { const kids = rng.picks(students.filter((s) => s.schoolType === 'forskola'), 2); documentation.push({ id: `doc-${i}`, title: rng.pick(['Utforskande i skogen', 'Vi bygger med lera', 'Sångsamling', 'Matematik i vardagen']), body: 'Barnen visade nyfikenhet och samarbetade fint under aktiviteten.', studentIds: kids.map((k) => k.id), classId: 'cls-sol-solen', authorUserId: users.find((u) => u.id.startsWith('u-staff'))!.id, visibleToGuardians: true, postedAt: iso(daysAgo(now, rng.int(0, 14))), organizationId: 'org-lund', schoolId: 'sch-solskiftet', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null }) }

  // ---- Filer (30) ----
  const files: StoredFile[] = []
  for (let i = 0; i < 30; i++) { const cat = rng.pick(['skola', 'elev', 'intern', 'samtycke', 'incident', 'vardnadshavare'] as StoredFile['category'][]); files.push({ id: `file-${i}`, name: rng.pick(['Terminsbrev', 'Åtgärdsprogram', 'Schema', 'Matsedel', 'Samtyckesblankett', 'Incidentrapport', 'Utvecklingsplan']) + `-${i}.pdf`, mimeType: 'application/pdf', sizeBytes: rng.int(40000, 4000000), category: cat, studentId: cat === 'elev' || cat === 'incident' ? rng.pick(students).id : null, uploadedBy: teacherUsers[i % teacherUsers.length].userId, scanStatus: i === 7 ? 'misstänkt' : 'ren', versionCount: rng.int(1, 3), guardianVisible: cat === 'vardnadshavare' || cat === 'samtycke', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: iso(daysAgo(now, rng.int(1, 90))), updatedAt: nowIso, deletedAt: null, dataClassification: cat === 'incident' ? 4 : cat === 'elev' ? 3 : 2, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null }) }

  // ---- Rapporter/exporter + importer ----
  const reports: ReportJob[] = [
    { id: 'rep-0', type: 'attendance', title: 'Närvarorapport 4A – februari', format: 'pdf', status: 'klar', progress: 100, requestedBy: 'u-rektor', requestedAt: iso(daysAgo(now, 1, 10)), reason: 'Uppföljning', expiresAt: iso(daysAgo(now, -7)), rowCount: 480, protectedFiltered: true, organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
    { id: 'rep-1', type: 'gdpr_export', title: 'Registerutdrag – begäran #248', format: 'pdf', status: 'bearbetar', progress: 62, requestedBy: 'u-huvudman', requestedAt: iso(daysAgo(now, 0, 11)), reason: 'GDPR-begäran', expiresAt: null, rowCount: 0, protectedFiltered: true, organizationId: 'org-lund', schoolId: null, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
    { id: 'rep-2', type: 'meal', title: 'Specialkost – vecka 7', format: 'csv', status: 'köad', progress: 0, requestedBy: 'u-kok', requestedAt: iso(daysAgo(now, 0, 9)), reason: '', expiresAt: null, rowCount: 0, protectedFiltered: false, organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
  ]
  const imports: ImportJob[] = [
    { id: 'imp-0', type: 'students', fileName: 'elever-ht25.csv', status: 'klar', total: 118, ok: 118, failed: 0, requestedBy: 'u-skoladmin', requestedAt: iso(daysAgo(now, 30, 8)), organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'csv', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
    { id: 'imp-1', type: 'guardians', fileName: 'vardnadshavare.csv', status: 'delvis', total: 82, ok: 79, failed: 3, requestedBy: 'u-skoladmin', requestedAt: iso(daysAgo(now, 2, 14)), organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 3, sourceSystem: 'csv', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: null, createdBy: null, updatedBy: null },
  ]

  // ---- Granskningslogg (20) ----
  const auditLogs: AuditLog[] = []
  const auditActions = [
    ['attendance.update', 'attendance', 'Ändrade närvaro', 'låg'], ['student.open_sensitive', 'student', 'Öppnade skyddad profil', 'hög'],
    ['login.success', 'security', 'Inloggning', 'låg'], ['export.create', 'export', 'Exporterade rapport', 'medel'],
    ['consent.sign', 'consent', 'Signerade samtycke', 'låg'], ['role.change', 'security', 'Ändrade roll', 'hög'],
    ['guardian.link', 'guardian_relation', 'Kopplade vårdnadshavare', 'medel'], ['support.activate', 'support_access', 'Aktiverade supportåtkomst', 'hög'],
  ] as const
  for (let i = 0; i < 20; i++) { const [action, resource, label, risk] = auditActions[i % auditActions.length]; auditLogs.push({ id: `aud-${i}`, organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', actorUserId: rng.pick(users).id, actorRole: rng.pick(['larare', 'rektor', 'skoladmin', 'it_support']), action, resource, targetId: rng.pick(students).id, targetLabel: label, previousValue: null, newValue: null, reason: risk === 'hög' ? 'Behörig åtkomst enligt uppdrag' : null, ip: `192.168.${rng.int(0, 4)}.${rng.int(2, 254)}`, sessionId: `sess-${rng.int(1000, 9999)}`, device: rng.pick(['Chrome/Win', 'Safari/iPad', 'Edge/Win']), correlationId: `corr-${rng.int(10000, 99999)}`, riskLevel: risk as AuditLog['riskLevel'], at: iso(daysAgo(now, rng.int(0, 20), rng.int(7, 18))) }) }

  // ---- Säkerhetshändelser ----
  const securityEvents: SecurityEvent[] = [
    { id: 'sec-0', organizationId: 'org-lund', type: 'login_fail', userId: 'u-rektor', description: '5 misslyckade inloggningar från ny IP', riskLevel: 'medel', ip: '85.24.10.9', device: 'Chrome/Win', resolved: false, at: iso(daysAgo(now, 0, 7)) },
    { id: 'sec-1', organizationId: 'org-lund', type: 'new_device', userId: 'u-staff-3', description: 'Inloggning från ny enhet (iPad)', riskLevel: 'låg', ip: '192.168.1.20', device: 'Safari/iPad', resolved: true, at: iso(daysAgo(now, 1, 12)) },
    { id: 'sec-2', organizationId: 'org-lund', type: 'rate_limit', userId: null, description: 'Exportgräns nådd för organisationen', riskLevel: 'medel', ip: null, device: null, resolved: false, at: iso(daysAgo(now, 0, 13)) },
    { id: 'sec-3', organizationId: 'org-lund', type: 'suspicious', userId: 'u-guard-9', description: 'Ovanligt exportmönster upptäckt', riskLevel: 'hög', ip: '31.10.4.2', device: 'Chrome/Android', resolved: false, at: iso(daysAgo(now, 0, 15)) },
  ]

  // ---- GDPR-begäranden ----
  const gdprRequests: GdprRequest[] = [
    { id: 'gdpr-0', type: 'registerutdrag', subjectName: 'Familjen Andersson', subjectStudentId: students[0].id, status: 'under_granskning', requestedAt: iso(daysAgo(now, 5)), dueAt: iso(daysAgo(now, -25)), handledBy: 'u-huvudman', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 60, createdBy: null, updatedBy: null },
    { id: 'gdpr-1', type: 'radering', subjectName: 'Tidigare elev (utskriven)', subjectStudentId: null, status: 'kraver_verifiering', requestedAt: iso(daysAgo(now, 2)), dueAt: iso(daysAgo(now, -28)), handledBy: null, organizationId: 'org-lund', schoolId: null, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 60, createdBy: null, updatedBy: null },
    { id: 'gdpr-2', type: 'rättelse', subjectName: 'Vårdnadshavare (kontaktuppgift)', subjectStudentId: null, status: 'fardigstalld', requestedAt: iso(daysAgo(now, 20)), dueAt: iso(daysAgo(now, -10)), handledBy: 'u-huvudman', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, dataClassification: 4, sourceSystem: 'skolnav', externalId: null, version: 1, lastSyncedAt: null, retentionMonths: 36, createdBy: null, updatedBy: null },
  ]

  // ---- Supportsessioner ----
  const supportSessions: SupportSession[] = [
    { id: 'sup-0', organizationId: 'org-lund', schoolId: 'sch-bjorkeberga', supportUserId: 'u-itsupport', reason: 'Felsökning av importfel för vårdnadshavare', modules: ['import', 'guardian'], approvedBy: 'u-rektor', status: 'aktiv', startedAt: iso(daysAgo(now, 0, 10)), expiresAt: iso(daysAgo(now, 0, 14)), actionsLogged: 12, breakGlass: false },
    { id: 'sup-1', organizationId: 'org-lund', schoolId: null, supportUserId: 'u-superadmin', reason: 'Avslutad – prestandaundersökning', modules: ['system_health'], approvedBy: 'u-huvudman', status: 'avslutad', startedAt: iso(daysAgo(now, 3, 9)), expiresAt: iso(daysAgo(now, 3, 11)), actionsLogged: 5, breakGlass: false },
  ]

  // ---- Integrationer (10) ----
  const integrations: Integration[] = [
    { id: 'int-smtp', organizationId: 'org-lund', key: 'smtp', name: 'E-post (SMTP)', category: 'notis', status: 'aktiv', vendorHint: 'SMTP-relä', lastSyncAt: iso(daysAgo(now, 0, 12)), lastError: null, usageDay: 342, usageMonth: 8120, quotaDay: 5000, dataTouched: 'E-postadresser, notisinnehåll', privacyNote: 'Inga känsliga uppgifter i e-postkropp.', fallback: 'Notiser köas lokalt om SMTP är nere.' },
    { id: 'int-webpush', organizationId: 'org-lund', key: 'webpush', name: 'Webbnotiser', category: 'notis', status: 'aktiv', vendorHint: 'Web Push (VAPID)', lastSyncAt: iso(daysAgo(now, 0, 12)), lastError: null, usageDay: 210, usageMonth: 5400, quotaDay: null, dataTouched: 'Push-tokens', privacyNote: 'Maskerat innehåll enligt klassificering.', fallback: 'Faller tillbaka till app-notis.' },
    { id: 'int-gotenberg', organizationId: 'org-lund', key: 'gotenberg', name: 'PDF-generering', category: 'pdf', status: 'aktiv', vendorHint: 'Gotenberg', lastSyncAt: iso(daysAgo(now, 0, 11)), lastError: null, usageDay: 47, usageMonth: 980, quotaDay: 500, dataTouched: 'Rapportinnehåll', privacyNote: 'Metadata rensas, vattenstämpel vid känsligt.', fallback: 'Enkel klientrendering vid otillgänglighet.' },
    { id: 'int-docuseal', organizationId: 'org-lund', key: 'docuseal', name: 'Digital signering', category: 'signering', status: 'kraver_konfiguration', vendorHint: 'DocuSeal', lastSyncAt: null, lastError: null, usageDay: 0, usageMonth: 0, quotaDay: null, dataTouched: 'Samtyckesdokument', privacyNote: 'Signaturer lagras krypterat.', fallback: 'Intern signeringsmotor används.' },
    { id: 'int-meili', organizationId: 'org-lund', key: 'search', name: 'Sök i Skolnav', category: 'sok', status: 'aktiv', vendorHint: 'Meilisearch', lastSyncAt: iso(daysAgo(now, 0, 12)), lastError: null, usageDay: 1290, usageMonth: 33000, quotaDay: null, dataTouched: 'Sökindex (behörighetsfiltrerat)', privacyNote: 'Skyddad data indexeras aldrig.', fallback: 'Lokal filtrering vid otillgänglighet.' } as Integration,
    { id: 'int-posthog', organizationId: 'org-lund', key: 'analytics', name: 'Användningsstatistik', category: 'analys', status: 'inaktiv', vendorHint: 'Plausible', lastSyncAt: null, lastError: null, usageDay: 0, usageMonth: 0, quotaDay: null, dataTouched: 'Anonym användning', privacyNote: 'Ingen spårning av individer.', fallback: 'Avstängd tills aktiverad.' } as Integration,
    { id: 'int-openobserve', organizationId: 'org-lund', key: 'logs', name: 'Loggar & observerbarhet', category: 'logg', status: 'aktiv', vendorHint: 'OpenObserve', lastSyncAt: iso(daysAgo(now, 0, 12)), lastError: null, usageDay: 5400, usageMonth: 140000, quotaDay: null, dataTouched: 'Systemloggar', privacyNote: 'Inga persondata i loggkropp.', fallback: 'Loggar buffras lokalt.' } as Integration,
    { id: 'int-clamav', organizationId: 'org-lund', key: 'scanning', name: 'Filskanning', category: 'skanning', status: 'aktiv', vendorHint: 'ClamAV', lastSyncAt: iso(daysAgo(now, 0, 10)), lastError: null, usageDay: 30, usageMonth: 720, quotaDay: null, dataTouched: 'Uppladdade filer', privacyNote: 'Filer skannas före lagring.', fallback: 'Uppladdning blockeras om skanner saknas.' } as Integration,
    { id: 'int-osm', organizationId: 'org-lund', key: 'maps', name: 'Kartor', category: 'karta', status: 'aktiv', vendorHint: 'OpenStreetMap', lastSyncAt: iso(daysAgo(now, 1)), lastError: null, usageDay: 12, usageMonth: 400, quotaDay: null, dataTouched: 'Adresser', privacyNote: 'Endast skoladresser.', fallback: 'Statisk kartbild.' } as Integration,
    { id: 'int-bankid', organizationId: 'org-lund', key: 'bankid', name: 'E-legitimation', category: 'identitet', status: 'kraver_avtal', vendorHint: 'BankID / Freja', lastSyncAt: null, lastError: 'Avtal saknas', usageDay: 0, usageMonth: 0, quotaDay: null, dataTouched: 'Identitetsuppgifter', privacyNote: 'Aktiveras först efter avtal.', fallback: 'Inloggning via e-post/inbjudan.' } as Integration,
  ]
  const integrationRuns: IntegrationRun[] = [
    { id: 'run-0', integrationId: 'int-gotenberg', startedAt: iso(daysAgo(now, 0, 11)), status: 'ok', itemsProcessed: 3, durationMs: 1840, message: 'Rapporter genererade' },
    { id: 'run-1', integrationId: 'int-smtp', startedAt: iso(daysAgo(now, 0, 12)), status: 'partiell', itemsProcessed: 340, durationMs: 5200, message: '2 leveranser misslyckades, köade för omförsök' },
    { id: 'run-2', integrationId: 'int-bankid', startedAt: iso(daysAgo(now, 1)), status: 'fel', itemsProcessed: 0, durationMs: 120, message: 'Avtal saknas – anslutning nekad' },
  ]

  // ---- Rate limit-händelser ----
  const rateLimitEvents: RateLimitEvent[] = [
    { id: 'rl-0', organizationId: 'org-lund', dimension: 'export', scope: 'org:org-lund', state: 'begransad', count: 48, limit: 50, windowLabel: 'per dag', at: iso(daysAgo(now, 0, 13)) },
    { id: 'rl-1', organizationId: 'org-lund', dimension: 'message.send', scope: 'user:u-guard-9', state: 'narmar_grans', count: 42, limit: 50, windowLabel: 'per timme', at: iso(daysAgo(now, 0, 14)) },
    { id: 'rl-2', organizationId: 'org-lund', dimension: 'login', scope: 'ip:85.24.10.9', state: 'blockerad', count: 10, limit: 5, windowLabel: 'per 15 min', at: iso(daysAgo(now, 0, 7)) },
  ]

  // ---- Licenser (5) ----
  const licenses: License[] = [
    { id: 'lic-0', organizationId: 'org-lund', module: 'Kärnplattform', seats: 2500, seatsUsed: 2180, status: 'aktiv', renewsOn: '2026-08-01' },
    { id: 'lic-1', organizationId: 'org-lund', module: 'Kommunikation', seats: 2500, seatsUsed: 2180, status: 'aktiv', renewsOn: '2026-08-01' },
    { id: 'lic-2', organizationId: 'org-lund', module: 'Elevhälsa', seats: 300, seatsUsed: 214, status: 'aktiv', renewsOn: '2026-08-01' },
    { id: 'lic-3', organizationId: 'org-lund', module: 'Analys & rapporter', seats: 100, seatsUsed: 40, status: 'provperiod', renewsOn: iso(daysAgo(now, -20)) },
    { id: 'lic-4', organizationId: 'org-nordstjarnan', module: 'Kärnplattform', seats: 400, seatsUsed: 405, status: 'aktiv', renewsOn: '2026-07-15' },
  ]

  const featureFlags: FeatureFlag[] = [
    { key: 'ai_assist', label: 'AI-assistent (endast förslag)', enabled: false, scope: 'organisation' },
    { key: 'livekit_meetings', label: 'Videomöten', enabled: false, scope: 'organisation' },
    { key: 'guardian_chat', label: 'Chatt vårdnadshavare–personal', enabled: true, scope: 'organisation' },
    { key: 'swipe_attendance', label: 'Svep-närvaro', enabled: true, scope: 'skola' },
  ]

  // ---- Demo-konton per roll ----
  const larareMembership = memberships.find((m) => m.role === 'larare')!
  const demoGuardian = relations[0]
  const guardianStudentIds = relations.filter((r) => r.guardianUserId === demoGuardian.guardianUserId).map((r) => r.studentId)
  const guardianPerms: Record<string, GuardianPermissions> = {}
  relations.filter((r) => r.guardianUserId === demoGuardian.guardianUserId).forEach((r) => (guardianPerms[r.studentId] = r.permissions))

  // Dedikerade konton
  const dedicated: Array<[string, string, RoleKey]> = [
    ['u-superadmin', 'Sofia Berglund', 'superadmin'],
    ['u-huvudman', 'Anders Lundqvist', 'huvudman'],
    ['u-rektor', 'Karin Holmström', 'rektor'],
    ['u-bitr', 'Peter Nyström', 'bitr_rektor'],
    ['u-skoladmin', 'Marie Fransson', 'skoladmin'],
    ['u-mentor', larareMembership.userId, 'mentor'],
    ['u-vikarie', 'Jonas Ek', 'vikarie'],
    ['u-specped', 'Helena Sjögren', 'specialpedagog'],
    ['u-kurator', 'Ingrid Bergman', 'kurator'],
    ['u-skolskot', 'Birgitta Ahlin', 'skolskoterska'],
    ['u-syv', 'Tomas Wik', 'syv'],
    ['u-kok', 'Leyla Demir', 'koksansvarig'],
    ['u-itsupport', 'David Ohlsson', 'it_support'],
    ['u-granskare', 'Revision Nord AB', 'granskare'],
    ['u-integration', 'Skolverket-integration', 'integration_bot'],
  ]
  for (const [uid, name, role] of dedicated) {
    if (!users.find((u) => u.id === uid) && uid !== larareMembership.userId) {
      users.push({ id: uid, name, email: emailFor(name, 'skola.lund.se'), avatarColor: rng.pick(COLORS), protectedIdentity: false, mfaEnabled: ['superadmin', 'huvudman', 'rektor', 'it_support', 'kurator', 'skolskoterska', 'specialpedagog'].includes(role), status: 'aktiv', lastLoginAt: iso(daysAgo(now, 0, 8)), createdAt: iso(daysAgo(now, 500)) })
    }
  }

  const elevGrund = students.find((s) => s.schoolType === 'grundskola' && !s.protectedIdentity)!
  const elevGy = students.find((s) => s.schoolType === 'gymnasium')!
  const vikarieValidUntil = iso(daysAgo(now, -3, 16))

  const demoAccounts: DemoAccount[] = [
    { role: 'superadmin', userId: 'u-superadmin', organizationId: 'org-lund', schoolIds: schools.map((s) => s.id), classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: true },
    { role: 'huvudman', userId: 'u-huvudman', organizationId: 'org-lund', schoolIds: schools.filter((s) => s.organizationId === 'org-lund').map((s) => s.id), classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'rektor', userId: 'u-rektor', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: true },
    { role: 'bitr_rektor', userId: 'u-bitr', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'skoladmin', userId: 'u-skoladmin', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'larare', userId: larareMembership.userId, organizationId: 'org-lund', schoolIds: [larareMembership.schoolId!], classIds: larareMembership.classIds, courseIds: larareMembership.courseIds, guardianStudentIds: [], protectedClearance: false },
    { role: 'mentor', userId: larareMembership.userId, organizationId: 'org-lund', schoolIds: [larareMembership.schoolId!], classIds: larareMembership.classIds.length ? larareMembership.classIds : ['cls-bj-4a'], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'pedagog', userId: users.find((u) => memberships.find((m) => m.userId === u.id && m.role === 'pedagog'))?.id ?? 'u-staff-5', organizationId: 'org-lund', schoolIds: ['sch-solskiftet'], classIds: ['cls-sol-solen'], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'vikarie', userId: 'u-vikarie', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: ['cls-bj-5b'], courseIds: [], guardianStudentIds: [], validUntil: vikarieValidUntil, protectedClearance: false },
    { role: 'elev_grund', userId: 'u-elev-grund', organizationId: 'org-lund', schoolIds: [elevGrund.schoolId], classIds: elevGrund.classId ? [elevGrund.classId] : [], courseIds: [], guardianStudentIds: [], ownStudentId: elevGrund.id, protectedClearance: false },
    { role: 'elev_gy', userId: 'u-elev-gy', organizationId: 'org-lund', schoolIds: [elevGy.schoolId], classIds: elevGy.classId ? [elevGy.classId] : [], courseIds: courses.slice(0, 3).map((c) => c.id), guardianStudentIds: [], ownStudentId: elevGy.id, protectedClearance: false },
    { role: 'vardnadshavare', userId: demoGuardian.guardianUserId, organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga', 'sch-solskiftet'], classIds: [], courseIds: [], guardianStudentIds, ownStudentId: null, protectedClearance: false },
    { role: 'specialpedagog', userId: 'u-specped', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: true },
    { role: 'kurator', userId: 'u-kurator', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga', 'sch-katedral'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: true },
    { role: 'skolskoterska', userId: 'u-skolskot', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: true },
    { role: 'syv', userId: 'u-syv', organizationId: 'org-lund', schoolIds: ['sch-katedral'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'koksansvarig', userId: 'u-kok', organizationId: 'org-lund', schoolIds: ['sch-bjorkeberga'], classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'it_support', userId: 'u-itsupport', organizationId: 'org-lund', schoolIds: schools.map((s) => s.id), classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'granskare', userId: 'u-granskare', organizationId: 'org-lund', schoolIds: schools.map((s) => s.id), classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
    { role: 'integration_bot', userId: 'u-integration', organizationId: 'org-lund', schoolIds: schools.map((s) => s.id), classIds: [], courseIds: [], guardianStudentIds: [], protectedClearance: false },
  ]

  // Skapa saknade elevanvändare för demo
  for (const [uid, stu] of [['u-elev-grund', elevGrund], ['u-elev-gy', elevGy]] as const) {
    if (!users.find((u) => u.id === uid)) users.push({ id: uid, name: `${stu.firstName} ${stu.lastName}`, email: emailFor(`${stu.firstName} ${stu.lastName}`, 'elev.lund.se'), avatarColor: stu.photoColor, protectedIdentity: false, mfaEnabled: false, status: 'aktiv', lastLoginAt: iso(daysAgo(now, 0, 8)), createdAt: iso(daysAgo(now, 200)) })
    stu.userId = uid
  }

  // ---- Notiser (10) ----
  const notifications: NotificationItem[] = [
    { id: 'ntf-0', userId: demoGuardian.guardianUserId, organizationId: 'org-lund', title: 'Frånvaro bekräftad', body: 'Skolan har bekräftat din frånvaroanmälan.', category: 'franvaro', channel: 'app', urgent: false, read: false, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 0, 8)) },
    { id: 'ntf-1', userId: demoGuardian.guardianUserId, organizationId: 'org-lund', title: 'Nytt samtycke att signera', body: 'Fotografering och publicering väntar på ditt svar.', category: 'samtycke', channel: 'app', urgent: false, read: false, requiresConfirmation: true, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 0, 9)) },
    { id: 'ntf-2', userId: demoGuardian.guardianUserId, organizationId: 'org-lund', title: 'Viktigt: vinterkräksjuka', body: 'Läs skolans information och bekräfta.', category: 'meddelande', channel: 'push', urgent: true, read: false, requiresConfirmation: true, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 1, 8)) },
    { id: 'ntf-3', userId: larareMembership.userId, organizationId: 'org-lund', title: 'Ny frånvaroanmälan', body: 'En vårdnadshavare har anmält frånvaro i din klass.', category: 'franvaro', channel: 'app', urgent: false, read: true, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 0, 7)) },
    { id: 'ntf-4', userId: larareMembership.userId, organizationId: 'org-lund', title: 'Ej markerad närvaro', body: '3 elever saknar närvaromarkering för idag.', category: 'schema', channel: 'app', urgent: false, read: false, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 0, 10)) },
    { id: 'ntf-5', userId: 'u-rektor', organizationId: 'org-lund', title: 'Säkerhetshändelse', body: 'Ovanligt exportmönster upptäckt – granska.', category: 'sakerhet', channel: 'app', urgent: true, read: false, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 0, 15)) },
    { id: 'ntf-6', userId: 'u-rektor', organizationId: 'org-lund', title: 'Rapport klar', body: 'Närvarorapport 4A – februari är färdig.', category: 'rapport', channel: 'app', urgent: false, read: true, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 1, 10)) },
    { id: 'ntf-7', userId: 'u-huvudman', organizationId: 'org-lund', title: 'GDPR-begäran inkommen', body: 'En raderingsförfrågan kräver verifiering.', category: 'system', channel: 'epost', urgent: false, read: false, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'levererad', createdAt: iso(daysAgo(now, 2, 9)) },
    { id: 'ntf-8', userId: 'u-itsupport', organizationId: 'org-lund', title: 'Integration misslyckades', body: 'E-legitimation: avtal saknas – åtgärd krävs.', category: 'system', channel: 'app', urgent: false, read: false, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'misslyckad', createdAt: iso(daysAgo(now, 1, 11)) },
    { id: 'ntf-9', userId: demoGuardian.guardianUserId, organizationId: 'org-lund', title: 'Veckans matsedel', body: 'Måndag: köttbullar med potatismos.', category: 'meddelande', channel: 'digest', urgent: false, read: true, requiresConfirmation: false, confirmedAt: null, deliveryStatus: 'batchad', createdAt: iso(daysAgo(now, 0, 6)) },
  ]

  // Vikariemedlemskap med utgång + fler substitut-uppdrag (10)
  memberships.push({ id: 'mem-vikarie', userId: 'u-vikarie', organizationId: 'org-lund', role: 'vikarie', schoolId: 'sch-bjorkeberga', classIds: ['cls-bj-5b'], courseIds: [], validUntil: vikarieValidUntil, createdAt: nowIso })
  for (let i = 0; i < 9; i++) memberships.push({ id: `mem-vik-${i}`, userId: `u-staff-${30 + i}`, organizationId: 'org-lund', role: 'vikarie', schoolId: 'sch-bjorkeberga', classIds: [rng.pick(gradeClasses).id], courseIds: [], validUntil: iso(daysAgo(now, -rng.int(1, 10), 16)), createdAt: nowIso })

  return {
    organizations, schools, schoolYears, terms, users, memberships, licenses, featureFlags,
    departments, classes, subjects, courses, rooms, students, staff, guardians, relations,
    enrollments, scheduleEvents, assignments, submissions, assessments, attendance, absences,
    pickups, meals, health, incidents, consentTemplates, consentRequests, consentResponses,
    conversations, messages, announcements, documentation, notifications, files, reports,
    imports, auditLogs, securityEvents, gdprRequests, supportSessions, integrations,
    integrationRuns, rateLimitEvents, demoAccounts,
  }
}
