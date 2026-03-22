# Phase 3: Rent Indexation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate Belgian health index data from Statbel, implement regional indexation calculations with EPC corrections (Brussels, Flanders, Wallonia), and deliver the full indexation workflow: preview, optional landlord override, apply with lease update, and tenant notification email. Landlords get automatic rent indexation — a key differentiator for Rentular.

</domain>

<decisions>
## Implementation Decisions

### Health Index Data Source
- **D-01:** Fetch Belgian health index from Statbel beSTAT API and cache in `healthIndexValues` table
- **D-02:** Refresh cache daily via BullMQ scheduled job
- **D-03:** If Statbel API is down, retry next day — no immediate fallback or error escalation
- **D-04:** Cache considered valid for 7 days before stale
- **D-05:** No manual index entry by landlords — system is the single source of truth for health index values

### Indexation Calculation
- **D-06:** Formula always uses original base rent from lease signing date and base index from month before lease start: `newRent = originalBaseRent * (currentIndex / baseIndex)`
- **D-07:** Landlord overrides (lower amount) do not affect future calculations — the original base rent and base index are permanent anchors
- **D-08:** EPC restrictions are a hard cap — landlord can apply a lower amount but never higher than what the EPC restriction allows
- **D-09:** Indexation records store only the applied rent (not a separate "calculated" field) — keeps it simple

### Indexation Notification
- **D-10:** Email includes numbers + formula + region-specific legal reference (not generic "Belgian law")
- **D-11:** Legal reference determined by property region (flanders/wallonia/brussels), NOT tenant language — a French-speaking tenant in Flanders gets the Vlaams Woninghuurdecreet cited, translated into French
- **D-12:** When landlord chose a lower amount, email shows both: "The indexed rent would be €X, but your landlord has set it to €Y"
- **D-13:** Landlord can fully customize the notification text and numbers before sending (IDX-06)
- **D-14:** Notification sent immediately when landlord clicks "apply" — no delay or cancel window

### Previous Overrides
- **D-15:** Next year's indexation preview does NOT show any reminder of previous overrides — just the fresh calculation from original base rent

### Claude's Discretion
- Statbel beSTAT API client implementation (endpoint URL, response parsing, error handling)
- Health index refresh job scheduling details (time of day, retry logic)
- Cache staleness detection and warning behavior
- Indexation service module structure (route vs service extraction)
- Upcoming indexation detection query logic
- Email template placeholder structure

</decisions>

<specifics>
## Specific Ideas

- The formula always anchors to the original lease: `newRent = baseRent * (currentIndex / baseIndex)` where baseRent and baseIndex never change
- Region-specific legal citations: Brussels → ordonnance on residential leases, Flanders → Vlaams Woninghuurdecreet, Wallonia → Code civil
- EPC restrictions are already fully encoded in shared constants: `BRUSSELS_EPC_INDEXATION_FACTOR`, `FLANDERS_EPC_FREEZE_FACTOR`, `FLANDERS_EPC_NEEDS_CORRECTION`, `FLANDERS_FUTURE_RESTRICTIONS`
- The route file (`indexation.ts`) is architecturally complete with all endpoints and EPC helper functions — just needs data binding to DB and health index

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — IDX-01 through IDX-08 requirement definitions

### Database Schema
- `packages/db/src/schema/indexation.ts` — `healthIndexValues` and `indexationRecords` tables
- `packages/db/src/schema/leases.ts` — `indexationEnabled`, `indexationBaseMonth`, `indexationBaseIndex`, `currentMonthlyRent`, `lastIndexationDate`, `region` fields
- `packages/db/src/schema/properties.ts` — `epcScore`, `epcLabel`, `epcCertificateNumber`, `epcExpiryDate` fields

### Business Logic
- `packages/shared/src/constants/index.ts` — `BRUSSELS_EPC_INDEXATION_FACTOR`, `FLANDERS_EPC_FREEZE_FACTOR`, `FLANDERS_EPC_NEEDS_CORRECTION`, `FLANDERS_FUTURE_RESTRICTIONS`, `REGIONS`, `STATBEL_API`, `EPC_SCORES`
- `packages/shared/src/validation/index.ts` — `calculateIndexedRent()` function
- `packages/shared/src/types/index.ts` — `IndexationResult`, `EpcScore` types

### Existing Routes (Stubbed)
- `apps/api/src/routes/indexation.ts` — 6 endpoints architecturally complete, data fetching stubbed with Phase 3 markers

### Email Infrastructure
- `apps/api/src/jobs/emailQueueWorker.ts` — `queueEmail()`, `queueBatchEmails()`
- `apps/api/src/lib/email.ts` — `renderTemplate()` with `{{placeholder}}` syntax

### Web UI (Scaffolded)
- `apps/web/app/(dashboard)/indexation/page.tsx` — Dashboard page with stats, status badges, EPC warnings
- `apps/web/messages/{en,nl,fr,de}/common.json` — `.indexation` i18n keys

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/routes/indexation.ts` — Full route scaffolding with 6 endpoints, EPC helper functions, template rendering logic
- `packages/shared/src/constants/index.ts` — Complete EPC restriction rules for all 3 regions including future bans
- `packages/shared/src/validation/index.ts` — `calculateIndexedRent(baseRent, baseIndex, currentIndex)` ready to use
- `packages/shared/src/types/index.ts` — `IndexationResult` type with all fields including EPC factors
- `apps/api/src/jobs/emailQueueWorker.ts` — Email queue with rate limiting and retry
- `apps/api/src/lib/email.ts` — Template rendering with placeholder substitution

### Established Patterns
- All routes: Hono router → Zod validation → DB query → JSON response
- Auth: `getRequiredUserId()` for ownership filtering
- Workers: BullMQ with cron scheduling (same pattern as paymentCheckWorker, landlordReportWorker)
- Email: `queueEmail({ to, subject, html })` with `renderTemplate(template, variables)`

### Integration Points
- Health index fetch job follows same BullMQ pattern as existing workers
- Indexation routes wire to `healthIndexValues` and `indexationRecords` tables
- Apply endpoint updates `leases.currentMonthlyRent` and `leases.lastIndexationDate`
- Notification uses existing `queueEmail()` + `renderTemplate()` infrastructure
- EPC data read from `properties.epcLabel` and `properties.epcScore` joined via lease

</code_context>

<deferred>
## Deferred Ideas

- Indexation service module in `packages/indexation/` — could extract calculation logic for reuse, but not required for Phase 3
- Anniversary detection background worker (auto-alert landlord when indexation is due) — could be Phase 4 or Phase 7 polish
- Web UI calculate/apply buttons — Phase 7 UI polish will wire the frontend actions

</deferred>

---

*Phase: 03-rent-indexation*
*Context gathered: 2026-03-22*
