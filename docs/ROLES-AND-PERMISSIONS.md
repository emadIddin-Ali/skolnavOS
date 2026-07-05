# Roller & behörigheter

20 roller, var och en med egen dashboard, navigation, behörighet och seedad data.
Definieras i `src/core/domain/roles.ts`; RBAC-baslinjen i
`src/core/permissions/matrix.ts`.

| # | Roll | Kategori | Naturlig räckvidd | MFA |
| --- | --- | --- | --- | --- |
| 1 | Superadmin | System | Plattform | ✔ |
| 2 | Huvudman / organisationsadmin | Organisation | Organisation | ✔ |
| 3 | Rektor | Skolledning | Skola | ✔ |
| 4 | Biträdande rektor | Skolledning | Skola | ✔ |
| 5 | Skoladministratör | Skolledning | Skola | – |
| 6 | Lärare | Personal | Klass/kurs | – |
| 7 | Mentor | Personal | Klass | – |
| 8 | Pedagog (förskola/fritids) | Personal | Klass/avdelning | – |
| 9 | Vikarie | Personal | Tillfällig period | – |
| 10 | Elev (Årskurs 1–9) | Elev | Egen profil | – |
| 11 | Elev (Gymnasium/Vux) | Elev | Egen profil | – |
| 12 | Vårdnadshavare | Vårdnadshavare | Relation till barn | – |
| 13 | Specialpedagog | Elevhälsa | Elev | ✔ |
| 14 | Kurator | Elevhälsa | Elev | ✔ |
| 15 | Skolsköterska | Elevhälsa | Elev | ✔ |
| 16 | SYV | Personal | Skola | – |
| 17 | Köksansvarig | Personal | Skola (utan persondata) | – |
| 18 | IT-support | System | Skola (via supportsession) | ✔ |
| 19 | Extern granskare | System | Organisation (endast läs) | ✔ |
| 20 | Integration / API-klient | System | Organisation (maskinkonto) | – |

## Hur en rolls meny och dashboard uppstår

Menyn byggs av `buildNav(principal, mode)` som filtrerar alla navigeringsobjekt på
`can(read, resource)` och aktuellt läge. Dashboarden komponeras utifrån
principalens behörigheter (t.ex. visas närvarowidget bara om rollen får läsa
närvaro) plus rollspecifika hjältesektioner (vårdnadshavare ser barnkort, elev ser
nästa lektion, personal ser operativa nyckeltal). Därför blir varje roll unik utan
20 separata implementationer.

## Beslutsgången i `can()`

1. Granskare + export → nekas alltid (läsbehörig roll).
2. RBAC: har rollen en grant för resursen och ingår åtgärden?
3. Tenant-isolering (annan organisation → nekas, utom superadmin via support).
4. Tillfällig behörighet utgången → nekas.
5. Scope: organisation/skola/klass/kurs/elev/egen/relation/tillfällig.
6. Systemroller mot persondata → kräver aktiv supportsession (annars break-glass
   med hög risklogg).
7. Skyddad identitet → maskering/anledning/exportspärr.
8. Dataklassificering → bulkexport-spärr, loggkrav.
9. MFA-rekommendation för administrativa åtgärder.

Beslutet (`Decision`) bär `masked`, `logRead`, `requiresReason`, `requiresMfa`,
`breakGlass` som UI och tjänstelager agerar på.

## Behörighetsnivåer & scope

- **Nivåer:** Ingen åtkomst · Läs · Skapa · Redigera · Radera · Exportera ·
  Signera · Administrera.
- **Scope:** Organisation · Skola · Avdelning · Klass · Kurs · Elev/barn · Egen
  profil · Relation till barn · Tillfällig period.

Se testerna i `src/core/permissions/engine.test.ts` för verifierat beteende.
