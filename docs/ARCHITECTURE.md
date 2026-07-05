# Arkitektur

## Lager

```
UI-komponenter (moduler)         Presentera, samla in, visa tillstånd
        │  använder hooks
Behörighet + tjänstelager        AUKTORITET: authorize(), audit, rate limit
        │  läser/muterar
Datastore (in-memory / backend)  Tenant-isolerad "databas"
```

Ett UI-lager anropar aldrig en integration eller muterar data utan att gå via
tjänstelagret. Tjänstelagret är den auktoritativa gränsen: det anropar
behörighetsmotorn, loggar i granskningsloggen och tillämpar rate limits.

## Kärnkoncept

### Domänvokabulär (`src/core/domain`)
Kanoniska enum:er med svenska etiketter: `roles`, `modes`, `permissions`
(åtgärder, scope, resurser) och `classification` (nivå 1–6). Allt annat refererar
hit – ingen sträng-magi i UI.

### Behörighetsmotor (`src/core/permissions`)
- `matrix.ts` – RBAC-baslinje: vad varje roll får göra på varje resurs, och på
  vilken maximal räckvidd.
- `engine.ts` – `can(principal, action, resource, target)` lägger ABAC ovanpå:
  tenant-isolering, skol-/klass-/kurs-/elev-scope, relationsbaserad
  vårdnadshavaråtkomst med per-barn-behörighet, tillfällig behörighet som går ut,
  skyddad identitet, dataklassificering och supportsession/break-glass. Returnerar
  ett `Decision` med `masked`, `logRead`, `requiresReason`, `requiresMfa`.
- `authorize(...)` kastar `ForbiddenError` – används i tjänstelagret.
- `usePermission` / `useCan` / `<Can>` – React-bindningar för UX-döljning.

### Sessionstillstånd (`src/core/state`)
`useSession` (Zustand, persistad) håller roll, läge, aktiv skola, läsår, tema och
säkerhetsflaggor (MFA, supportsession, break-glass, uppkoppling). `principal.ts`
bygger en `Principal` från sessionen + demokonton. I produktion kommer principal
från JWT/DB-medlemskap i stället för seed.

### Datalager (`src/data`)
- `schema/` – Zod-scheman och TS-typer för ~50 entiteter. Känsliga entiteter bär
  `organizationId`, `schoolId`, spårningsfält, `dataClassification`, `sourceSystem`,
  `externalId`, `version`, `lastSyncedAt`, `retentionMonths`.
- `seed/` – deterministisk, rik svensk seed-data (2 organisationer, 4 skolor, 120
  elever, 80 vårdnadshavare, 45 personal, m.m., inklusive skyddad identitet,
  vårdnadskonflikter, misslyckade integrationer och rate limit-varningar).
- `db/store.ts` – in-memory-store med samma form som en riktig backend skulle ha.
  Bytbar utan att UI berörs.

### Designsystem (`src/ui`)
Tokendrivet (CSS-variabler i `src/styles/tokens.css`) så att de tre lägena och
ljust/mörkt tema retintar allt. Primitiv: `Button`, `Card`, `Badge`/`StatusBadge`/
`ClassificationBadge`, `Avatar`, `ProgressRing`/`ProgressBar`, `StatCard`,
`StepIndicator`/`Checklist`, `Segmented`/`Tabs`/`TextInput`/`Select`, `Modal`,
`Popover`, `DataTable`, `PageHeader` och tillståndsvyer (`EmptyState`,
`ErrorState`, `DeniedState`, `OfflineState`, `ConflictState`, `LoadingRows`).

### Moduler (`src/modules`)
En katalog per modul. Router (`src/app/router.tsx`) lazy-laddar sidor för
route-nivå-kodklyvning. Rutter utan skräddarsydd modul använder
`_scaffold/ModuleScaffold` – en datadriven, behörighetsfiltrerad vy som direkt
visar verklig aktiv data plus demonstrerbara tillståndsflikar.

## Navigering
`src/app/navigation.ts` är enda källan för menyn. `buildNav(principal, mode)`
filtrerar objekt på behörighet (`can(read, resource)`) och aktuellt läge, vilket
ger varje roll en egen meny utan separat kod per roll.

## Prestanda & kostnad
- Route-nivå-kodklyvning via `React.lazy`, manuella vendor-chunks.
- TanStack Query med lång `staleTime`, ingen refetch vid fönsterfokus.
- Paginering/virtualisering och debounce i tunga vyer.
- Rapporter/exporter som bakgrundsjobb, aldrig stora synkrona operationer.
- Notiser batchas och avdupliceras; inga oändliga polling-loopar.
- Rate limits och kvoter skyddar mot att slå i leverantörsgränser.

## Väg till riktig backend
Byt ut `src/data/db/store.ts` mot API-/Supabase-anrop och låt `principal.ts` läsa
från autentisering. Tjänstefunktionerna och behörighetsmotorn ligger redan mellan
UI och data, så UI-lagret påverkas inte.
