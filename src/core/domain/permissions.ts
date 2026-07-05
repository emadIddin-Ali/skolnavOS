/**
 * Behörighetsvokabulär: åtgärder, räckvidder och resurser.
 * Själva behörighetsmotorn (som räknar ut vad en roll får göra i en viss
 * kontext) ligger i src/core/permissions. Denna fil definierar orden.
 */

/** Behörighetsnivåer (åtgärder). Not: export/signera/administrera är
 * ortogonala – de ingår inte automatiskt i "redigera". */
export type PermissionAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'sign'
  | 'admin'

export const ACTION_LABEL: Record<PermissionAction, string> = {
  read: 'Läs',
  create: 'Skapa',
  update: 'Redigera',
  delete: 'Radera',
  export: 'Exportera',
  sign: 'Signera',
  admin: 'Administrera',
}

export const ACTION_ORDER: PermissionAction[] = [
  'read',
  'create',
  'update',
  'delete',
  'export',
  'sign',
  'admin',
]

export const NO_ACCESS_LABEL = 'Ingen åtkomst'

/** Räckvidder för en behörighet. */
export type PermissionScope =
  | 'organisation'
  | 'skola'
  | 'avdelning'
  | 'klass'
  | 'kurs'
  | 'elev'
  | 'egen'
  | 'relation'
  | 'tillfallig'

export const SCOPE_LABEL: Record<PermissionScope, string> = {
  organisation: 'Organisation',
  skola: 'Skola',
  avdelning: 'Avdelning',
  klass: 'Klass',
  kurs: 'Kurs',
  elev: 'Elev/barn',
  egen: 'Egen profil',
  relation: 'Relation till barn',
  tillfallig: 'Tillfällig period',
}

/**
 * Resurser (moduler/objekttyper) som behörighetsmotorn styr. Varje känslig
 * åtgärd i systemet frågar motorn: får {roll} göra {action} på {resource} i
 * {kontext}?
 */
export type ResourceKey =
  | 'dashboard'
  | 'student'
  | 'guardian'
  | 'guardian_relation'
  | 'staff'
  | 'class'
  | 'course'
  | 'enrollment'
  | 'schedule'
  | 'attendance'
  | 'absence'
  | 'assignment'
  | 'assessment'
  | 'message'
  | 'announcement'
  | 'documentation'
  | 'incident'
  | 'consent'
  | 'pickup'
  | 'meal'
  | 'health' // allergier, specialkost, medicinsk info
  | 'file'
  | 'report'
  | 'export'
  | 'import'
  | 'notification'
  | 'audit_log'
  | 'gdpr'
  | 'security'
  | 'support_access'
  | 'integration'
  | 'rate_limit'
  | 'license'
  | 'organization'
  | 'school'
  | 'settings'
  | 'system_health'
  | 'feature_flag'
  | 'protected_identity'

export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  dashboard: 'Översikt',
  student: 'Elever & barn',
  guardian: 'Vårdnadshavare',
  guardian_relation: 'Relationer',
  staff: 'Personal',
  class: 'Klasser & grupper',
  course: 'Kurser',
  enrollment: 'Inskrivningar',
  schedule: 'Schema',
  attendance: 'Närvaro',
  absence: 'Frånvaro',
  assignment: 'Uppgifter',
  assessment: 'Bedömning & resultat',
  message: 'Meddelanden',
  announcement: 'Anslag',
  documentation: 'Dokumentation',
  incident: 'Incidenter',
  consent: 'Samtycken',
  pickup: 'Hämtning',
  meal: 'Måltider',
  health: 'Hälsa & specialkost',
  file: 'Filer & dokument',
  report: 'Rapporter',
  export: 'Exporter',
  import: 'Importer',
  notification: 'Notiser',
  audit_log: 'Granskningslogg',
  gdpr: 'GDPR & dataskydd',
  security: 'Säkerhet',
  support_access: 'Supportåtkomst',
  integration: 'Integrationer',
  rate_limit: 'Gränser & kvoter',
  license: 'Licenser',
  organization: 'Organisation',
  school: 'Skola',
  settings: 'Inställningar',
  system_health: 'Systemhälsa',
  feature_flag: 'Funktionsflaggor',
  protected_identity: 'Skyddad identitet',
}
