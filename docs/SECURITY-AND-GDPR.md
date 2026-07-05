# Säkerhet & dataskydd

Barns uppgifter behandlas som säkerhetskänsliga i varje funktion.

## Behörighetsmodell

**Backend/tjänstelager är auktoritet.** Frontend döljer åtgärder för UX, men varje
känslig åtgärd går via `authorize(principal, action, resource, target)` som kastar
`ForbiddenError` vid otillåtet försök.

- **Åtgärder:** Läs, Skapa, Redigera, Radera, Exportera, Signera, Administrera
  (plus *Ingen åtkomst*).
- **Scope:** Organisation, Skola, Avdelning, Klass, Kurs, Elev/barn, Egen profil,
  Relation till barn, Tillfällig period.
- **RBAC-baslinje** per roll definieras i `permissions/matrix.ts`.
- **ABAC-lager** i `permissions/engine.ts`: tenant-isolering, scope-kontroll,
  relationsbaserad vårdnadshavaråtkomst med per-barn-behörighet, tillfällig
  behörighet som går ut, skyddad identitet, dataklassificering och supportsession.

Varje känslig åtgärd besvarar: vem ser, skapar, redigerar, raderar, exporterar,
delar? vad loggas? vad händer vid skyddad identitet, avvikande vårdnad,
skolbyte, felaktig integrationsdata eller upptäckt missbruk?

## Dataklassificering (1–6)

| Nivå | Etikett | Bulkexport | Loggas läsning | I notiskropp | Sökbar |
| --- | --- | --- | --- | --- | --- |
| 1 | Publik data | ✔ | – | ✔ | ✔ |
| 2 | Intern skoldata | ✔ | – | ✔ | ✔ |
| 3 | Personuppgifter | ✔ | – | – | ✔ |
| 4 | Känslig/skyddsvärd | blockeras | ✔ | – | ✔ |
| 5 | Särskilt skyddad | blockeras | ✔ | – | – |
| 6 | Säkerhetsdata | blockeras | ✔ | – | – |

Nivån styr synlighet, loggning, export, gallring, kryptering, sök, notiser,
filåtkomst, supportåtkomst och delning till integrationer.

## Skyddad identitet (förstklassig)

- Maskerat namn/personnummer/adress i listor, sök och notiser.
- Exportspärr och blockerad bulkexport.
- Dold i klasslistor om inte behörig; varning innan profil öppnas; anledning kan
  krävas.
- Extra granskningsloggning; separat klarering (`protectedClearance`).
- Skyddat beteende för notiser, dokument och vårdnadshavarrelationer.
- Break-glass-nödflöde med hög risklogg.

## Granskningslogg

Loggar bl.a. inloggning, MFA-/roll-/behörighetsändringar, öppnad (känslig) profil,
vårdnadskoppling, närvaromarkering/-korrigering, frånvaro, fil upp-/nedladdning,
export, signerat samtycke, incident, integrationskörning, nyckeländring,
supportläge, break-glass, GDPR-export, radering och triggade rate limits.

Varje post: tid, användare, roll, organisation, skola, åtgärd, objekt,
tidigare/nytt värde, anledning, IP/session/enhet, korrelations-id, risknivå.
Sökbar, filtrerbar och exporterbar endast av behöriga administratörer.

## Rate limits & kostnadskontroll

Per användare/IP/session/skola/organisation/åtgärd. Tillstånd visas på svenska:
Normal → Närmar sig gräns → Begränsad → Blockerad tillfälligt → Kräver
verifiering → Eskalerad. Meddelanden t.ex. "För många försök. Vänta en stund och
försök igen." och "Exportgränsen är nådd för idag."

## Kontrollerad supportåtkomst

Ingen fri browsing av elevdata. Flöde: begär → välj tenant/skola → anledning →
moduler → tidsgräns → (godkännande) → aktiv session med banner, giltighetstid och
full spårning → avslut. Break-glass är en separat, tydligt markerad nödåtkomst.

## Autentitet & webbsäkerhet (förberett)

E-post/lösenord, magisk länk, inbjudan; MFA för admin/personal; OIDC/SAML/
Keycloak- och SCIM-redo arkitektur; enhets-/sessionshantering; kontolås; skydd mot
brute force och credential stuffing. E-legitimation (BankID/Freja) visas som
"Kräver avtal / ej aktiverat" tills riktig integration konfigureras.

Förberett/planerat på webbnivå: CSP, HSTS, säkra cookies, CSRF-skydd, strikt CORS,
in-/utdatavalidering, XSS-skydd via escaping/sanering, SSRF-säkra
integrationsanrop, webhook-signaturverifiering, nyckelrotation, hemligheter aldrig
i frontend eller loggar, signerade URL:er och säkra filuppladdningar.

## GDPR-center

Riktiga arbetsflöden (inte bara text): begäranden (registerutdrag, radering,
rättelse, begränsning, dataportabilitet) med statusflöde
(Mottagen → Under granskning → Kräver verifiering → Godkänd/Avslagen →
Färdigställd → Arkiverad), behandlingsregister med rättslig grund och gallring,
underbiträden, dataflöde, DPIA-underlag, supportåtkomstlogg och åtkomstöversikt
per elev/barn. Registerutdrag skapas som ett säkert, rate-limitat exportjobb med
skyddad-identitet-filter.

## AI

AI är valfritt och aldrig kärna. Inga automatiska beslut om betyg, risk, placering
eller disciplin. AI får endast vara assisterande och tydligt märkt, med mänsklig
granskning. Ingen träning på elevdata; ingen loggning av känsliga prompts.
