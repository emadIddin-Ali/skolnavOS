import type { LucideProps } from 'lucide-react'
import { ICONS } from './iconRegistry'

/**
 * Formell SVG-ikon via namn. Endast ikoner som används importeras statiskt
 * (se iconRegistry.ts) för att hålla nere bundlestorleken. Okänt namn faller
 * tillbaka på en neutral cirkel.
 */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = ICONS[name] ?? ICONS.Circle
  return <Cmp aria-hidden {...props} />
}
