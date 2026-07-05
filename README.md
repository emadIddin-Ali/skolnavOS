# Skolnav OS

Ett samlat, svenskt **skoloperativsystem** för förskola, grundskola, gymnasium och
vuxenutbildning – byggt för kommuner, friskolor och skolkoncerner. Hela
gränssnittet är på svenska, institutionellt och lugnt i tonen, och behandlar
barns uppgifter som säkerhetskänsliga i varje funktion.

> **Status:** produktionsnära frontend-implementation med ett auktoritativt
> tjänstelager och en utbytbar in-memory-"backend". Arkitekturen är förberedd
> för en riktig backend (PostgreSQL/Supabase) utan att UI behöver ändras.

---

## Snabbstart

```bash
pnpm install
pnpm dev          # startar Vite på http://localhost:5173
```

Andra kommandon:

```bash
pnpm build        # tsc --noEmit + produktionsbygge
pnpm start        # servera produktionsbygget (port 4173)
pnpm typecheck    # endast typkontroll
pnpm lint         # ESLint
pnpm test         # kör Vitest (behörighet, tjänster, render-smoke)
```

Fullständig drift- och deploymentguide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Krav: Node ≥ 20, pnpm ≥ 9 (npm fungerar också).

### Demo: byt roll, läge och skola

Appen har inga externa beroenden i kärnläge. Uppe till vänster finns
**rollväxlaren** – välj mellan alla 20 roller för att se hur navigation,
behörigheter, dashboard och data förändras. **Lägesväxlaren** (Årskurs 1–9 /
Gymnasium-Vux / Personal-Admin) och **skol-/läsårsväxlarna** finns i topbaren.
Den guidade turen startar automatiskt första gången och kan startas om från
användarmenyn.

---

## Vad som ingår

| Område | Innehåll |
| --- | --- |
| **Roller** | 20 roller från superadmin till elev, vårdnadshavare och API-klient – var och en med egen dashboard, navigation och behörighet |
| **Lägen** | Tre globala lägen som retintar och anpassar hela systemet |
| **Behörighet** | Central RBAC + ABAC-motor med tenant-, skol-, klass-, kurs-, elev- och relationsscope, tillfällig behörighet, skyddad identitet och kontrollerad supportåtkomst |
| **Moduler** | Närvaro, frånvaro, schema, elever/barn, vårdnadshavare & relationer, personal, klasser/kurser, uppgifter, bedömning, meddelanden, anslag, dokumentation, incidenter, samtycken, hämtning, måltider, hälsa/specialkost, filer, rapporter, import/export |
| **Styrning** | GDPR-center, säkerhetscenter, granskningslogg, supportåtkomst, integrationscenter, gränser & kvoter, licenser, systemhälsa |
| **Tvärgående** | Notiscenter, global sök, guidade turer, felhantering, tillståndsvyer, responsiv layout, tillgänglighet |

Se [`docs/`](docs/) för djupare dokumentation.

---

## Arkitektur i korthet

```
src/
  app/            Applikationsskal: router, providers, layout, navigation, växlare
  core/           Delade tjänster (systemets auktoritet)
    domain/       Vokabulär: roller, lägen, behörigheter, dataklassificering
    permissions/  Behörighetsmotor (RBAC+ABAC), hooks, <Can>
    audit/        Central granskningslogg
    rate-limit/   Kostnads- och missbruksskydd
    notifications/Notistjänst (batchning, dedupe, klassificeringssäker)
    integrations/ Adapterregister med graceful degradation
    search/       Behörighetssäker global sök
    export/       Rapporter/exporter som säkra bakgrundsjobb
    tours/        Guidat onboarding-system
    state/        Sessionstillstånd (roll/läge/skola/tema) + principal-byggare
  data/
    schema/       Zod-scheman + TS-typer för alla entiteter
    seed/         Rik svensk seed-/mockdata
    db/           In-memory-store (utbytbar "backend")
  ui/             Designsystem (Button, Card, Badge, Table, Ring, Steps, states …)
  modules/        Funktionsmoduler (en katalog per modul)
    _scaffold/    Datadriven generisk modulvy + detaljvy
```

**Principer:** backend-auktoritet före frontend-döljning · integrationsadaptrar
före hårdkodad leverantörslogik · kostnadskontroll (cache, paginering,
batchning, köer, rate limits) · graceful degradation · riktiga flöden före
fejkade knappar.

---

## Säkerhet & dataskydd (sammanfattning)

- **Behörighetsmotorn är auktoritet.** UI döljer åtgärder för UX, men
  tjänstelagret anropar alltid `authorize(...)` och kastar `ForbiddenError` vid
  otillåten åtgärd. Se [`docs/SECURITY-AND-GDPR.md`](docs/SECURITY-AND-GDPR.md).
- **Dataklassificering 1–6** styr synlighet, loggning, export, gallring, sök och
  delning till integrationer.
- **Skyddad identitet** är förstklassig: maskering, exportspärr, extra loggning,
  varning före öppning och separat klarering.
- **Granskningslogg** för alla känsliga åtgärder (vem, roll, objekt, tidigare/nytt
  värde, anledning, IP/session, risknivå).
- **Rate limits** per användare/IP/skola/organisation/åtgärd med tydliga svenska
  tillstånd i stället för hårda fel.
- **Integrationer** wrappas som native moduler – aldrig extern UI. Saknad
  konfiguration ger säker lokal fallback och tydlig status, aldrig fejkad
  leverans.

---

## Miljövariabler

Kärnläge kräver **inga** miljövariabler. För en riktig backend (framtida läge)
läses konfiguration från `.env` (validera vid uppstart):

```
VITE_API_BASE_URL=        # bas-URL för backend-API
VITE_SUPABASE_URL=        # om Supabase används
VITE_SUPABASE_ANON_KEY=
```

Hemligheter får aldrig ligga i frontend eller i loggar. Se
[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) för adapterspecifik konfiguration.

---

## Testning

`pnpm test` kör Vitest. Fokus ligger på det säkerhetskritiska:

- behörighetskontroller och tenant-isolering
- vårdnadshavare ser bara egna barn (relationsscope + per-barn-behörighet)
- lärare når bara tilldelade klasser
- vikariers tillfälliga behörighet går ut
- skyddad identitet maskeras och kan inte bulkexporteras
- systemroller når persondata endast via supportsession/break-glass

---

## Kända begränsningar

- **In-memory-backend:** data återställs vid omladdning. Bytbar mot
  PostgreSQL/Supabase via tjänstelagret.
- **Integrationer är adaptrar med mock/fallback** i denna miljö (Gotenberg,
  DocuSeal, Meilisearch m.fl.) – native UI finns, live-anslutningar kräver
  konfiguration/avtal.
- **Ikonpaket:** ikoner slås upp dynamiskt via namn; kan senare kurateras för
  mindre bundle.
- **E-legitimation (BankID/Freja):** visas som "Kräver avtal / ej aktiverat" tills
  riktig integration konfigureras.

Se även [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
