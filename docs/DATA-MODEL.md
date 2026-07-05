# Datamodell

Scheman och typer definieras med Zod i `src/data/schema/` (barrel: `index.ts`).
Varje känslig entitet blandar in gemensamma fält.

## Gemensamma fält (`base.ts`)

**Spårning (`auditableFields`):** `organizationId`, `schoolId`, `createdBy`,
`updatedBy`, `createdAt`, `updatedAt`, `deletedAt`.

**Datastyrning (`governedFields`):** `dataClassification` (1–6), `sourceSystem`,
`externalId`, `version`, `lastSyncedAt`, `retentionMonths`.

`sensitiveBase = auditableFields + governedFields`.

## Entitetsgrupper

- **Kärna (`core.ts`):** organizations, schools, schoolYears, terms, users,
  memberships, licenses, featureFlags.
- **Personer (`people.ts`):** students, staffProfiles, guardianProfiles,
  guardianStudentRelations (med relationstyp + per-barn-behörigheter, delad
  vårdnad, konfliktnotis).
- **Akademiskt (`academic.ts`):** departments, classes, subjects, courses, rooms,
  enrollments, scheduleEvents, assignments, submissions, assessments.
- **Verksamhet (`operations.ts`):** attendance, absenceReports, pickup­
  Authorizations, mealPlans, healthRecords, incidents, consentTemplates/
  Requests/Responses.
- **Kommunikation (`comms.ts`):** conversations, messages, announcements,
  documentationPosts, notifications, notificationPreferences.
- **Styrning (`governance.ts`):** files, reportJobs, importJobs, auditLogs,
  securityEvents, gdprRequests, supportSessions, integrations, integrationRuns,
  rateLimitEvents.

## Relationen vårdnadshavare ↔ barn

En vårdnadshavare kan ha flera barn; ett barn kan ha flera vårdnadshavare. Varje
`guardianStudentRelation` bär en **relationstyp** (Vårdnadshavare, Kontaktperson,
Nödkontakt, Hämtbehörig, Begränsad kontakt, Endast information, Ej hämtbehörig,
Skyddad/restriktion) och **per-barn-behörigheter** (se schema, se schema
`guardianPermissionsSchema`). Motorn kontrollerar dessa i relations-scope.

## Statusmaskiner (urval)

- **Närvaro:** Närvarande · Frånvarande · Sen ankomst · Hämtad/gått hem · Ej
  markerad.
- **Frånvaro:** Inskickad → Bekräftad / Avslagen / Kräver åtgärd.
- **Samtycke:** Utkast → Utskickad → Delvis → Signerad / Avböjd / Utgången.
- **Rapportjobb:** Köad → Bearbetar → Klar / Misslyckad / Utgången.
- **GDPR-begäran:** Mottagen → Under granskning → Kräver verifiering → Godkänd /
  Avslagen → Färdigställd → Arkiverad.
- **Supportsession:** Begärd → Aktiv → Avslutad / Nekad.
- **Integration:** Aktiv, Inaktiv, Kräver nyckel/avtal/konfiguration, Testad, Fel,
  Pausad, Kommande.

## Seed-data (`seed/seed.ts`)

Deterministisk generering (mulberry32 + svenska namnpooler): 2 organisationer, 4
skolor (förskola/grundskola/gymnasium/vux), läsår + terminer, 15 klasser/grupper,
12 kurser, 120 elever, 80 vårdnadshavare, 45 personal, 10 vikariat, dagens + 60
historiska närvaroposter, 20 frånvaroanmälningar, uppgifter, bedömningar,
konversationer, samtycken, incidenter, hälso-/kostposter, filer, granskningsposter,
notiser, 10 integrationer, 5 licenser samt exempel på **skyddad identitet**,
**vårdnadskonflikter**, **misslyckade integrationer** och **rate limit-varningar**.
Ett demokonto per roll genereras för rollväxlaren.
