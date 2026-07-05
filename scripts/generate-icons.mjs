/**
 * Genererar src/ui/iconRegistry.ts från ikonnamn som faktiskt används i src/.
 * Endast giltiga lucide-namn importeras statiskt → trädskakning håller nere
 * bundlestorleken (hela lucide-react är ~700 kB, registret ~70 kB).
 *
 * Kör: node scripts/generate-icons.mjs
 */
import { icons } from 'lucide-react'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const OUT = path.join(SRC, 'ui', 'iconRegistry.ts')

// Alla citerade PascalCase-tokens (inkl. enbokstaviga som "X")
const TOKEN_RE = /["']([A-Z][A-Za-z0-9]*)["']/g

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('iconRegistry.ts')) yield p
  }
}

const found = new Set()
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(TOKEN_RE)) found.add(m[1])
}

const valid = new Set(Object.keys(icons))
const used = [...found].filter((t) => valid.has(t))
if (!used.includes('Circle')) used.push('Circle') // fallback-ikon
used.sort()

const header = `// GENERERAD FIL – kör "node scripts/generate-icons.mjs" för att uppdatera.
// Endast ikoner som faktiskt används importeras statiskt (trädskakning).
`
const body = `import {
${used.map((n) => `  ${n},`).join('\n')}
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

export const ICONS: Record<string, ComponentType<LucideProps>> = { ${used.join(', ')} }
`
fs.writeFileSync(OUT, header + body)
console.error(`iconRegistry.ts: ${used.length} ikoner`)
