import { db, nextId, byId } from '@/data/db/store'
import type { StoredFile } from '@/data/schema'
import { authorize, type Principal } from '@/core/permissions/engine'
import { checkRateLimit, RateLimitedError } from '@/core/rate-limit/rateLimit'
import { logAudit, actorFromPrincipal } from '@/core/audit/audit'
import { fmtBytes, fmtDateTime } from '@/lib/format'

/**
 * Tjänstelager för filer & dokument. Auktoriserar ALLTID via behörighets-
 * motorn innan store:t rörs, tillämpar kostnadsskydd (uppladdnings-/
 * nedladdningsgränser) och loggar alla känsliga åtgärder.
 */

// ---------------------------------------------------------------------------
// Kategorier och valideringsregler
// ---------------------------------------------------------------------------

export const FILE_CATEGORY_LABEL: Record<StoredFile['category'], string> = {
  skola: 'Skola',
  elev: 'Elev',
  intern: 'Intern',
  samtycke: 'Samtycke',
  incident: 'Incident',
  vardnadshavare: 'Vårdnadshavare',
}

export const FILE_CATEGORIES = Object.keys(FILE_CATEGORY_LABEL) as StoredFile['category'][]

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

export const ALLOWED_EXTENSIONS = Object.keys(EXT_MIME)

/** Returnerar svensk feltext, eller null om filen är godkänd. */
export function validateUpload(file: { name: string; size: number }): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!EXT_MIME[ext]) {
    return 'Otillåten filtyp. Tillåtna format: PDF, DOCX, XLSX, PNG och JPG.'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Filen är för stor (${fmtBytes(file.size)}). Maxstorlek är 10 MB.`
  }
  return null
}

export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Uppladdning
// ---------------------------------------------------------------------------

export interface UploadFileInput {
  name: string
  sizeBytes: number
  category: StoredFile['category']
  guardianVisible: boolean
  classification: 2 | 3 | 4
}

export function uploadFile(principal: Principal, input: UploadFileInput): StoredFile {
  const schoolId = principal.schoolIds[0] ?? null

  authorize(principal, 'create', 'file', {
    organizationId: principal.organizationId,
    schoolId,
    dataClassification: input.classification,
  })

  const rl = checkRateLimit('file.upload', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const now = new Date().toISOString()
  const file: StoredFile = {
    id: nextId('file'),
    name: input.name,
    mimeType: mimeForName(input.name),
    sizeBytes: input.sizeBytes,
    category: input.category,
    studentId: null,
    uploadedBy: principal.userId,
    scanStatus: 'väntar',
    versionCount: 1,
    guardianVisible: input.guardianVisible,
    organizationId: principal.organizationId,
    schoolId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dataClassification: input.classification,
    sourceSystem: 'skolnav',
    externalId: null,
    version: 1,
    lastSyncedAt: null,
    retentionMonths: null,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  }
  db.data.files.unshift(file)

  logAudit(actorFromPrincipal(principal, schoolId), {
    action: 'file.upload',
    resource: 'file',
    targetId: file.id,
    targetLabel: file.name,
    riskLevel: input.classification >= 4 ? 'medel' : 'låg',
  })

  return file
}

/** Virusskanningen är klar – markera filen som ren. */
export function markFileScanned(fileId: string): void {
  const file = db.data.files.find((f) => f.id === fileId)
  if (file && file.scanStatus === 'väntar') {
    file.scanStatus = 'ren'
    file.updatedAt = new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// Nedladdning
// ---------------------------------------------------------------------------

function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadStoredFile(principal: Principal, fileId: string): string {
  const file = db.data.files.find((f) => f.id === fileId)
  if (!file || file.deletedAt) throw new Error('Filen kunde inte hittas.')
  if (file.scanStatus === 'misstänkt') {
    throw new Error('Filen är spärrad: virusskanningen har flaggat den som misstänkt.')
  }

  const student = byId(db.data.students, file.studentId)
  authorize(principal, 'read', 'file', {
    organizationId: file.organizationId,
    schoolId: file.schoolId,
    studentId: file.studentId,
    dataClassification: file.dataClassification,
    protectedIdentity: student?.protectedIdentity,
  })

  const rl = checkRateLimit('file.download', `user:${principal.userId}`, principal.organizationId)
  if (!rl.allowed) throw new RateLimitedError(rl)

  const uploader = byId(db.data.users, file.uploadedBy)
  const content = [
    'SKOLNAV OS – DOKUMENT (DEMOMILJÖ)',
    '=================================',
    '',
    `Namn:            ${file.name}`,
    `Kategori:        ${FILE_CATEGORY_LABEL[file.category]}`,
    `Storlek:         ${fmtBytes(file.sizeBytes)}`,
    `Version:         ${file.versionCount}`,
    `Klassificering:  Nivå ${file.dataClassification}`,
    `Uppladdad av:    ${uploader?.name ?? 'Okänd'}`,
    `Uppladdad:       ${fmtDateTime(file.createdAt)}`,
    `Skanningsstatus: ${file.scanStatus}`,
    '',
    'Detta är ett demonstrationsinnehåll som ersätter det riktiga dokumentet',
    'i demomiljön. I produktion levereras originalfilen från säker lagring.',
  ].join('\n')

  const base = file.name.replace(/\.[^.]+$/, '')
  const fileName = `${base}.txt`
  downloadBlob(content, fileName, 'text/plain;charset=utf-8')

  logAudit(actorFromPrincipal(principal, file.schoolId), {
    action: 'file.download',
    resource: 'file',
    targetId: file.id,
    targetLabel: file.name,
    riskLevel: file.dataClassification >= 4 ? 'medel' : 'låg',
  })

  return fileName
}

// ---------------------------------------------------------------------------
// Ny version och borttagning
// ---------------------------------------------------------------------------

export function addFileVersion(principal: Principal, fileId: string): StoredFile {
  const file = db.data.files.find((f) => f.id === fileId)
  if (!file || file.deletedAt) throw new Error('Filen kunde inte hittas.')

  const student = byId(db.data.students, file.studentId)
  authorize(principal, 'update', 'file', {
    organizationId: file.organizationId,
    schoolId: file.schoolId,
    studentId: file.studentId,
    dataClassification: file.dataClassification,
    protectedIdentity: student?.protectedIdentity,
  })

  file.versionCount += 1
  file.version += 1
  file.updatedAt = new Date().toISOString()
  file.updatedBy = principal.userId

  logAudit(actorFromPrincipal(principal, file.schoolId), {
    action: 'file.version',
    resource: 'file',
    targetId: file.id,
    targetLabel: file.name,
    previousValue: `v${file.versionCount - 1}`,
    newValue: `v${file.versionCount}`,
    riskLevel: 'låg',
  })

  return file
}

export function softDeleteFile(principal: Principal, fileId: string): StoredFile {
  const file = db.data.files.find((f) => f.id === fileId)
  if (!file || file.deletedAt) throw new Error('Filen kunde inte hittas.')

  const student = byId(db.data.students, file.studentId)
  authorize(principal, 'delete', 'file', {
    organizationId: file.organizationId,
    schoolId: file.schoolId,
    studentId: file.studentId,
    dataClassification: file.dataClassification,
    protectedIdentity: student?.protectedIdentity,
  })

  file.deletedAt = new Date().toISOString()
  file.updatedAt = file.deletedAt
  file.updatedBy = principal.userId

  logAudit(actorFromPrincipal(principal, file.schoolId), {
    action: 'file.delete',
    resource: 'file',
    targetId: file.id,
    targetLabel: file.name,
    riskLevel: 'medel',
  })

  return file
}
