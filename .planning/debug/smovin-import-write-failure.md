---
status: awaiting_human_verify
trigger: "Smovin import discovery succeeds (finds 12 contracts) but the import/write step fails with a generic 'Import Mislukt' error."
created: 2026-03-29T00:00:00Z
updated: 2026-03-29T00:00:00Z
---

## Current Focus

hypothesis: Import write fails because scraped data contains empty strings for required DB fields (dates, decimals). Discovery scrapes partial data (empty startDate, empty monthlyRent) which maps to empty strings for date/decimal NOT NULL columns, causing MySQL insert errors. Additionally, the frontend error display swallows the actual errorMessage from the session, showing only a generic message instead.
test: Trace empty-value paths through mapper functions and verify MySQL rejects empty string for date/decimal columns. Also check frontend error display logic.
expecting: Empty strings for date/decimal fields cause MySQL insert failure; frontend doesn't show session.errorMessage
next_action: Verify hypothesis by checking all mapper edge cases and frontend error display

## Symptoms

expected: After discovery finds contracts, clicking import should write properties/tenants/leases/payments into the Rentular database and show success
actual: Import fails with generic "Import Mislukt" (Dutch for "Import Failed") message. No error details visible in the UI.
errors: Only generic message shown - "Er ging iets mis tijdens het importeren. U kunt het opnieuw proberen met uw opgeslagen inloggegevens of deze verwijderen en opnieuw beginnen."
reproduction: Run Smovin import - discovery completes, then import write step fails
started: Has been failing since Phase 7 deployment. Discovery works, write doesn't.

## Eliminated

## Evidence

- timestamp: 2026-03-29T00:10:00Z
  checked: Discovery worker output shape
  found: Discovery can produce empty strings for critical fields - startDate (line 278), monthlyRent (line 280), address (line 224). When no regex match is found, fields default to empty string "".
  implication: Empty strings flow into mapper functions and then into DB inserts

- timestamp: 2026-03-29T00:11:00Z
  checked: Mapper functions with empty input
  found: parseDate("") returns "". parseAmount("") returns "". These empty strings are inserted into date NOT NULL and decimal NOT NULL columns.
  implication: MySQL rejects empty strings for date and decimal columns, causing INSERT to fail

- timestamp: 2026-03-29T00:12:00Z
  checked: Frontend error display (page.tsx lines 708-713)
  found: Frontend maps errorMessage to 3 categories (login, cloudflare, generic) but NEVER shows the actual errorMessage text. The errorMessage IS stored in DB (importWriteWorker line 264-274 stores it), but frontend ignores it.
  implication: Even when specific errors are captured server-side, user only sees generic Dutch message

- timestamp: 2026-03-29T00:13:00Z
  checked: Migration files
  found: import_sessions table not in migration file (0000_futuristic_the_initiative.sql). Only 1 migration exists. Table was likely created via drizzle-kit push.
  implication: Table exists on server (discovery works), but migration is out of sync - not the cause of write failure

## Resolution

root_cause: Discovery scraper produces empty strings for dates (startDate) and amounts (monthlyRent) when regex matches fail. These empty strings flow through mapper functions unchanged and are inserted into MySQL date/decimal NOT NULL columns, which rejects them. Additionally, the frontend error display never shows the actual errorMessage from the session -- it only categorizes by keyword (login/cloudflare) or shows a generic message.
fix: (1) parseDate() returns null for empty/unparseable dates instead of empty string -- prevents MySQL DATE insert errors. (2) parseAmount() returns "0.00" for empty/non-numeric amounts instead of empty string -- prevents MySQL DECIMAL insert errors. (3) mapSmovinLease/mapSmovinPayment throw descriptive errors for missing required dates so the write worker can handle them per-entity. (4) Import write worker has per-property, per-tenant, per-lease, per-payment try-catch blocks -- one bad record no longer crashes the entire import. (5) Frontend shows actual errorMessage in expandable details section for both failed and completed-with-errors states. (6) Added structured logging throughout the write pipeline and API route.
verification: API builds successfully (tsup). Frontend builds successfully (tsc --noEmit). No new TypeScript errors introduced. Awaiting human verification of the import flow on real Smovin data.
files_changed:
  - apps/api/src/services/smovinMapper.ts
  - apps/api/src/jobs/importWriteWorker.ts
  - apps/api/src/routes/import.ts
  - apps/web/app/(dashboard)/import/page.tsx
  - apps/web/messages/en/common.json
  - apps/web/messages/nl/common.json
  - apps/web/messages/fr/common.json
  - apps/web/messages/de/common.json
