# Phase 6: Smovin Import (Beta) - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate data from a user's Smovin account into Rentular — properties, tenants, leases, and payment history — via authenticated Playwright scraping. Users can selectively import discovered data. Credentials are temporarily persisted and cleaned up after import. This is a beta feature with known risk (Cloudflare anti-bot).

</domain>

<decisions>
## Implementation Decisions

### Scraping Strategy
- **D-01:** Use Playwright (with stealth plugin) as the scraping engine. No browser extension, no CSV upload.
- **D-02:** Include an early spike test (Task 0) that logs into Smovin and scrapes one property page. If Cloudflare blocks it, STOP and reassess before building the full pipeline. Do not pre-build a fallback — decide the pivot at that point.
- **D-03:** Use playwright-extra with stealth plugin, real browser fingerprint, human-like delays between actions to maximize success against Cloudflare detection.

### Credential Handling
- **D-04:** Smovin credentials (email + password) are encrypted and stored in the database during the import process. They are deleted immediately after successful import completion.
- **D-05:** If the import fails, credentials remain in the database so the user can retry without re-entering. A cleanup mechanism is needed (manual delete button or TTL-based expiry) for permanently failed imports.

### Data Mapping & Conflicts
- **D-06:** Skip duplicates — match on property address for properties and email for tenants. If a match exists in Rentular, skip silently. Do not overwrite or prompt.
- **D-07:** Smovin data is mapped to Rentular's existing schema (properties, tenants, leases, payments). No new tables needed for imported data — it becomes regular Rentular data.

### Import Scope
- **D-08:** Selective import — scrape all data from Smovin first, then present a list of discovered properties with their associated tenants/leases/payments. User picks which properties to import.
- **D-09:** The scrape-then-select flow means two phases: (1) discovery/scraping phase that collects everything, (2) import phase that writes selected data to the database.

### Progress UX
- **D-10:** Real-time log with progress bar on the import page. User stays on the page and sees live updates ("Importing property 3/12...", "Found 5 tenants...").
- **D-11:** Use BullMQ job for the scraping/import work. Push updates to the frontend via polling or SSE.

### Claude's Discretion
- Polling vs SSE for progress updates — choose based on existing patterns (BullMQ workers already exist, choose the simpler integration)
- Encryption algorithm for stored credentials — use existing patterns (jose/bcrypt already in stack)
- Smovin page navigation strategy and DOM selector design — researcher will determine based on Smovin's actual page structure
- Whether scraping and import run as one BullMQ job or two separate jobs

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, tech stack
- `.planning/REQUIREMENTS.md` — IMP-01 through IMP-05 requirements
- `.planning/ROADMAP.md` — Phase 6 goal and success criteria

### Existing Patterns
- `apps/api/src/jobs/emailQueueWorker.ts` — BullMQ worker pattern for background jobs
- `apps/api/src/jobs/paymentCheckWorker.ts` — Cron-scheduled BullMQ job pattern
- `packages/db/src/schema/` — All current database schemas for data mapping targets

### Risk Context
- `.planning/STATE.md` — Contains LOW confidence flag on Smovin scraping approach

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- BullMQ infrastructure: email, SMS, payment check workers — pattern for the import job
- `jose` library: already in API deps for JWT handling — could be used for credential encryption
- `bcrypt`: already in stack but one-way hash, not suitable for credentials that need decryption
- Zod validation: used throughout for request validation — use for import data validation
- `queueEmail`: send import completion/failure notifications

### Established Patterns
- BullMQ workers auto-start on import, process jobs with retry logic
- Route handlers follow Hono pattern with Zod validation
- Database operations use Drizzle ORM with getDb() singleton
- Background jobs log with context prefix: `[ImportWorker]`

### Integration Points
- New route: `apps/api/src/routes/import.ts` mounted on `/api/v1/import`
- New worker: `apps/api/src/jobs/importWorker.ts`
- New schema: `packages/db/src/schema/imports.ts` (import sessions table — tracks status, stores encrypted credentials)
- Frontend: new page under `apps/web/app/(dashboard)/import/` or `apps/web/app/(dashboard)/settings/import/`
- Sidebar: import link in navigation (settings area or standalone)
- Playwright: new dependency in `apps/api/package.json`

</code_context>

<specifics>
## Specific Ideas

- Spike test must be the first task — validates the entire approach before any pipeline work
- "Prepare for failure" — the spike test is a hard gate. If it fails, no further implementation proceeds. The team reassesses strategy at that point.
- Beta label — this feature should be clearly marked as beta in the UI

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-smovin-import-beta*
*Context gathered: 2026-03-25*
