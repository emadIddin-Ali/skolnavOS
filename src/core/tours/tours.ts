import type { RoleKey } from '@/core/domain/roles'

export interface TourStep {
  /** CSS-selektor för elementet som ska belysas (data-tour="..."). Saknas = centrerad. */
  target?: string
  title: string
  body: string
}

export interface Tour {
  id: string
  steps: TourStep[]
}

/** Grundtur för appen – lugn, formell, kort svensk mikrocopy. */
const baseSteps: TourStep[] = [
  {
    title: 'Välkommen till Skolnav OS',
    body: 'Ett samlat, svenskt skoloperativsystem. Den här korta turen visar hur du hittar rätt. Du kan hoppa över när som helst.',
  },
  {
    target: '[data-tour="role"]',
    title: 'Byt perspektiv',
    body: 'Här väljer du roll. Rollen styr din navigation, dina behörigheter och vilken data du ser.',
  },
  {
    target: '[data-tour="mode"]',
    title: 'Läge',
    body: 'Växla mellan Årskurs 1–9, Gymnasium/Vux och Personal/Admin. Läget anpassar innehåll och täthet.',
  },
  {
    target: '[data-tour="search"]',
    title: 'Sök i Skolnav',
    body: 'Sök efter elever, personal, klasser och dokument. Resultaten filtreras alltid efter din behörighet.',
  },
  {
    target: '[data-tour="notifications"]',
    title: 'Notiser',
    body: 'Viktiga händelser, bekräftelser och leveransstatus samlas här. Känsligt innehåll visas aldrig i pushnotiser.',
  },
  {
    target: '[data-tour="nav"]',
    title: 'Din meny',
    body: 'Menyn är rollanpassad. Du ser bara de moduler du har behörighet till.',
  },
  {
    title: 'Då kör vi',
    body: 'Du kan alltid starta om turen från användarmenyn uppe till höger. Lycka till!',
  },
]

/** Rollspecifika tillägg kan läggas här; annars används bastur. */
const roleTours: Partial<Record<RoleKey, TourStep[]>> = {
  vardnadshavare: [
    baseSteps[0],
    { target: '[data-tour="nav"]', title: 'Dina barn i fokus', body: 'Som vårdnadshavare når du schema, frånvaroanmälan, meddelanden och samtycken för dina barn.' },
    baseSteps[3],
    baseSteps[4],
    baseSteps[6],
  ],
  larare: [
    baseSteps[0],
    { title: 'Din vardag', body: 'Närvaro, uppgifter, bedömning och kommunikation för dina klasser och kurser – samlat och snabbt.' },
    baseSteps[2],
    baseSteps[3],
    baseSteps[5],
    baseSteps[6],
  ],
}

export function tourForRole(role: RoleKey): Tour {
  return { id: `tour-${role}`, steps: roleTours[role] ?? baseSteps }
}
