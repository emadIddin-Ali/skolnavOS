# Integrationer

**Princip:** varje integration är inbäddad som en native del av Skolnav – ingen
extern UI, inga omdirigeringar, ingen främmande produkt. Användaren ser svenska
begrepp; leverantören körs bakom kulisserna via en adapter.

| Användaren ser | Motor bakom (adapter) |
| --- | --- |
| Notiser, Viktiga bekräftelser, Leveransstatus | Novu / ntfy / Web Push / SMTP |
| Exportera PDF | Gotenberg |
| Samtycken (signering) | DocuSeal / intern signeringsmotor |
| Sök i Skolnav | Meilisearch / Typesense |
| Användningsstatistik | Plausible / PostHog |
| Loggar & observerbarhet | OpenObserve |
| Systemhälsa | Prometheus/Grafana-liknande vyer |
| Kartor | OpenStreetMap |
| Filskanning | ClamAV |
| Lagring | MinIO / S3-kompatibel |
| E-legitimation | BankID / Freja (kräver avtal) |

## Adaptermodell

`src/core/integrations/registry.ts` hanterar status, användning, körningar och
`withIntegration(key, org, live, fallback)` som ger **graceful degradation**: om en
integration inte är konfigurerad eller nere används en säker lokal fallback och
resultatet flaggas – aldrig fejkad leverans.

Statuslägen: Aktiv, Inaktiv, Kräver nyckel, Kräver avtal, Kräver konfiguration,
Testad, Fel, Pausad, Kommande.

Varje integration exponerar: användningsmätare (dag/månad + kvot), senaste synk,
senaste fel, retry-policy, dataomfattning, integritetsnotis, aktivera/inaktivera,
testa anslutning, setup-status och fallback-beteende.

## Om en integration inte är konfigurerad

- visa native setup-status och exakt vad som saknas
- använd säker lokal/mock-fallback där det är lämpligt
- påstå aldrig att produktionsleverans lyckades
- krascha inte, läck inte data, blockera inte orelaterade kärnfunktioner

## Kostnadskontroll

Idempotensnycklar för omförsök, exponentiell backoff med jitter, circuit breakers
för fallerande integrationer, dedupe för notiser, delta-sync i stället för full
sync, dagliga/månatliga kvoträknare och tenant-kvoter. Realtidsprenumerationer
begränsas och avslutas vid vybyte.

## Miljövariabler (per adapter, framtida live-läge)

Konfigureras via `.env` och valideras vid uppstart. Exempel:

```
SMTP_URL=            GOTENBERG_URL=
MEILISEARCH_HOST=    MEILISEARCH_KEY=
DOCUSEAL_URL=        DOCUSEAL_TOKEN=
STORAGE_ENDPOINT=    STORAGE_BUCKET=
```

Hemligheter lagras aldrig i frontend eller i loggar.
