import type { ResourceKey, PermissionAction } from '@/core/domain/permissions'
import type { AppMode, RoleKey } from '@/core/domain/roles'
import { can, type Principal } from '@/core/permissions/engine'

export type NavSection =
  | 'oversikt'
  | 'vardag'
  | 'personer'
  | 'dokument'
  | 'styrning'
  | 'organisation'

export const SECTION_LABEL: Record<NavSection, string> = {
  oversikt: 'Översikt',
  vardag: 'Vardag',
  personer: 'Personer',
  dokument: 'Dokument & rapporter',
  styrning: 'Styrning & säkerhet',
  organisation: 'Organisation',
}

export interface NavItem {
  to: string
  label: string
  icon: string
  resource: ResourceKey
  action?: PermissionAction
  section: NavSection
  /** Visas endast i dessa lägen (utöver behörighet). Saknas = alla lägen. */
  modes?: AppMode[]
  /** Rollspecifika etikettbyten. */
  roleLabels?: Partial<Record<RoleKey, string>>
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Översikt', icon: 'LayoutDashboard', resource: 'dashboard', section: 'oversikt', end: true },

  // Vardag
  { to: '/schema', label: 'Schema', icon: 'CalendarDays', resource: 'schedule', section: 'vardag' },
  { to: '/narvaro', label: 'Närvaro', icon: 'UserCheck', resource: 'attendance', section: 'vardag' },
  { to: '/franvaro', label: 'Frånvaro', icon: 'CalendarX', resource: 'absence', section: 'vardag' },
  { to: '/uppgifter', label: 'Uppgifter', icon: 'ClipboardCheck', resource: 'assignment', section: 'vardag' },
  { to: '/bedomning', label: 'Bedömning & resultat', icon: 'GraduationCap', resource: 'assessment', section: 'vardag', modes: ['gymnasium', 'admin'] },
  { to: '/meddelanden', label: 'Meddelanden', icon: 'MessageSquare', resource: 'message', section: 'vardag' },
  { to: '/anslag', label: 'Anslag', icon: 'Megaphone', resource: 'announcement', section: 'vardag' },
  { to: '/dokumentation', label: 'Dokumentation', icon: 'NotebookPen', resource: 'documentation', section: 'vardag', modes: ['grundskola', 'admin'] },
  { to: '/maltider', label: 'Måltider', icon: 'UtensilsCrossed', resource: 'meal', section: 'vardag', modes: ['grundskola', 'admin'] },
  { to: '/hamtning', label: 'Hämtning', icon: 'DoorOpen', resource: 'pickup', section: 'vardag', modes: ['grundskola', 'admin'] },
  { to: '/notiser', label: 'Notiser', icon: 'Bell', resource: 'notification', section: 'vardag' },

  // Personer
  { to: '/elever', label: 'Elever & barn', icon: 'Users', resource: 'student', section: 'personer', roleLabels: { vardnadshavare: 'Mina barn' } },
  { to: '/vardnadshavare', label: 'Vårdnadshavare', icon: 'Heart', resource: 'guardian', section: 'personer' },
  { to: '/personal', label: 'Personal', icon: 'Briefcase', resource: 'staff', section: 'personer' },
  { to: '/klasser', label: 'Klasser & grupper', icon: 'Grid2x2', resource: 'class', section: 'personer' },
  { to: '/kurser', label: 'Kurser', icon: 'BookOpen', resource: 'course', section: 'personer', modes: ['gymnasium', 'admin'] },
  { to: '/halsa', label: 'Hälsa & specialkost', icon: 'Stethoscope', resource: 'health', section: 'personer' },
  { to: '/incidenter', label: 'Incidenter', icon: 'ShieldAlert', resource: 'incident', section: 'personer' },
  { to: '/samtycken', label: 'Samtycken', icon: 'FileSignature', resource: 'consent', section: 'personer' },

  // Dokument & rapporter
  { to: '/dokument', label: 'Filer & dokument', icon: 'FolderOpen', resource: 'file', section: 'dokument' },
  { to: '/rapporter', label: 'Rapporter & exporter', icon: 'FileBarChart', resource: 'report', section: 'dokument' },
  { to: '/import', label: 'Importer', icon: 'Upload', resource: 'import', section: 'dokument' },

  // Styrning & säkerhet
  { to: '/gdpr', label: 'GDPR & dataskydd', icon: 'ShieldCheck', resource: 'gdpr', section: 'styrning' },
  { to: '/sakerhet', label: 'Säkerhet', icon: 'Lock', resource: 'security', section: 'styrning' },
  { to: '/granskningslogg', label: 'Granskningslogg', icon: 'ScrollText', resource: 'audit_log', section: 'styrning' },
  { to: '/support', label: 'Supportåtkomst', icon: 'LifeBuoy', resource: 'support_access', section: 'styrning' },
  { to: '/integrationer', label: 'Integrationer', icon: 'Plug', resource: 'integration', section: 'styrning' },
  { to: '/granser', label: 'Gränser & kvoter', icon: 'Gauge', resource: 'rate_limit', section: 'styrning' },
  { to: '/licenser', label: 'Licenser', icon: 'BadgeCheck', resource: 'license', section: 'styrning' },

  // Organisation
  { to: '/organisation', label: 'Organisation', icon: 'Building2', resource: 'organization', section: 'organisation' },
  { to: '/skola', label: 'Skola', icon: 'School', resource: 'school', section: 'organisation' },
  { to: '/systemhalsa', label: 'Systemhälsa', icon: 'Activity', resource: 'system_health', section: 'organisation' },
  { to: '/installningar', label: 'Inställningar', icon: 'Settings', resource: 'settings', section: 'organisation' },
]

export interface BuiltNavSection {
  section: NavSection
  label: string
  items: (NavItem & { resolvedLabel: string })[]
}

/** Bygger rollens navigation: filtrerar på behörighet och aktuellt läge. */
export function buildNav(principal: Principal, mode: AppMode): BuiltNavSection[] {
  const order: NavSection[] = ['oversikt', 'vardag', 'personer', 'dokument', 'styrning', 'organisation']
  const bySection = new Map<NavSection, (NavItem & { resolvedLabel: string })[]>()

  for (const item of NAV_ITEMS) {
    if (item.modes && !item.modes.includes(mode)) continue
    const decision = can(principal, item.action ?? 'read', item.resource, {
      organizationId: principal.organizationId,
    })
    if (!decision.allowed) continue
    const resolvedLabel = item.roleLabels?.[principal.role] ?? item.label
    const list = bySection.get(item.section) ?? []
    list.push({ ...item, resolvedLabel })
    bySection.set(item.section, list)
  }

  return order
    .filter((s) => (bySection.get(s)?.length ?? 0) > 0)
    .map((s) => ({ section: s, label: SECTION_LABEL[s], items: bySection.get(s)! }))
}

/** Slår upp navigeringsobjekt via path (för sidhuvud/brödsmulor). */
export function navItemByPath(path: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.to === path)
}
