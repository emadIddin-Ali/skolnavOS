import type { AppMode } from './roles'

export interface ModeMeta {
  key: AppMode
  label: string
  tagline: string
  icon: string
  /** UI-densitet påverkar radhöjd och textstorlek. */
  density: 'comfortable' | 'compact'
}

export const MODES: Record<AppMode, ModeMeta> = {
  grundskola: {
    key: 'grundskola',
    label: 'Årskurs 1–9',
    tagline: 'Mjukt, varmt och tydligt',
    icon: 'Backpack',
    density: 'comfortable',
  },
  gymnasium: {
    key: 'gymnasium',
    label: 'Gymnasium / Vux',
    tagline: 'Akademiskt och kursfokuserat',
    icon: 'Library',
    density: 'compact',
  },
  admin: {
    key: 'admin',
    label: 'Personal / Admin',
    tagline: 'Operativt och sakligt',
    icon: 'LayoutDashboard',
    density: 'compact',
  },
}

export const MODE_KEYS = Object.keys(MODES) as AppMode[]

export function modeMeta(key: AppMode): ModeMeta {
  return MODES[key]
}
