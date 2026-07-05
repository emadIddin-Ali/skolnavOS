# Driftsättning

Skolnav OS är i nuläget en statisk SPA (Vite-bygge) med ett auktoritativt
tjänstelager och en in-memory-"backend". Den kan driftsättas på valfri statisk
värd i demoläge, och är förberedd för riktig backend (PostgreSQL/Supabase).

## Krav

| Verktyg | Version |
| --- | --- |
| Node.js | ≥ 20 |
| pnpm (rekommenderas) eller npm | pnpm ≥ 9 |

## Installera & kör lokalt

```bash
pnpm install          # eller: npm install
pnpm dev              # utvecklingsserver på http://localhost:5173
```

## Bygg & starta

```bash
pnpm build            # tsc --noEmit + vite build → dist/
pnpm start            # serverar produktionsbygget på http://localhost:4173
```

Motsvarande npm-kommandon: `npm run dev`, `npm run build`, `npm run start`.

## Kvalitetsgrindar

```bash
pnpm typecheck        # TypeScript strikt, inga fel tillåtna
pnpm lint             # ESLint (typescript-eslint + react-hooks)
pnpm test             # Vitest: behörighet, tjänster, render-smoke
```

Kör alla tre före varje release. CI-förslag: `pnpm install --frozen-lockfile
&& pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Miljövariabler

**Kärnläget kräver inga miljövariabler** – appen körs helt lokalt med seedad
data. För framtida backend-läge (adaptrarna är förberedda):

| Variabel | Beskrivning |
| --- | --- |
| `VITE_API_BASE_URL` | Bas-URL till backend-API |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Om Supabase används |

Serverhemligheter (SMTP, Gotenberg, DocuSeal, Meilisearch m.fl.) hör hemma i
backendmiljön – **aldrig** i `VITE_`-variabler (allt med `VITE_`-prefix bäddas
in i klientbygget). Se [`INTEGRATIONS.md`](INTEGRATIONS.md).

## Statisk värd (demo-/pilotläge)

`dist/` kan läggas på Netlify, Vercel, Cloudflare Pages, S3+CDN eller nginx.
Appen använder klientrouting – konfigurera **SPA-fallback** så alla vägar
serverar `index.html`:

- **Netlify:** `/_redirects` → `/* /index.html 200`
- **Vercel:** `vercel.json` → `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **nginx:** `try_files $uri /index.html;`

### Säkerhetsrubriker (rekommenderas på värden)

```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Väg till produktion med riktig backend

1. Provisionera PostgreSQL (eller Supabase). Datamodellen i
   [`DATA-MODEL.md`](DATA-MODEL.md) mappar 1:1 mot tabeller; scheman finns som
   Zod i `src/data/schema/`.
2. Ersätt `src/data/db/store.ts` med API-anrop (tjänstelagret är redan enda
   vägen till data).
3. Låt `src/core/state/principal.ts` bygga principal från JWT/serversession i
   stället för seed-demokonton.
4. Flytta `authorize()`-kontrollerna till server-side middleware (samma
   regelverk – motorn är ren TypeScript utan browserberoenden).
5. Aktivera integrationsadaptrar (SMTP, Gotenberg, Meilisearch …) via
   integrationscentret; utan konfiguration används säker lokal fallback.

## Backup & återställning (backend-läge)

- PostgreSQL: dagliga `pg_dump` + WAL-arkivering; testa återläsning kvartalsvis.
- Fillagring (S3/MinIO): versionering + livscykelregler enligt gallringsbeslut.
- Hemligheter: hanteras i värdens secret manager, roteras enligt säkerhetscentret.

## Vanliga fel

| Symptom | Orsak / lösning |
| --- | --- |
| Vit sida efter deploy | SPA-fallback saknas – konfigurera rewrites enligt ovan |
| `pnpm build` klagar på typer | Kör `pnpm typecheck` lokalt; inga fel får ignoreras |
| Data "försvinner" vid omladdning | Väntat i demoläge (in-memory). Riktig backend krävs för persistens |
| Ikon visas som cirkel | Ikonnamnet saknas i `src/ui/iconRegistry.ts` – regenerera registret |
| Porten upptagen | `pnpm dev -- --port 5174` |
