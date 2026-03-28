---
phase: 06-smovin-import-beta
plan: 02
subsystem: api
tags: [hono, bullmq, playwright, encryption, scraping, import]

# Dependency graph
requires:
  - phase: 06-smovin-import-beta
    provides: import_sessions schema, stealth browser factory, loginToSmovin, encryption.ts
  - phase: 01-security-infrastructure
    provides: routeAuth, database patterns, encryption utilities
provides:
  - Import API router with 6 endpoints at /api/v1/import/*
  - BullMQ discovery worker that scrapes Smovin via stealth Playwright
  - Credential encryption/decryption flow for import sessions
  - Progress reporting to DB for frontend polling
affects: [06-03, 06-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [BullMQ discovery worker with Playwright scraping, dynamic import for deferred dependencies, session public fields pattern to exclude credentials from API responses]

key-files:
  created:
    - apps/api/src/routes/import.ts
    - apps/api/src/jobs/importDiscoveryWorker.ts
  modified:
    - apps/api/src/index.ts

key-decisions:
  - "Dynamic import for importWriteWorker to avoid compile-time dependency on Plan 03 (concurrent execution)"
  - "sessionPublicFields object excludes all 6 credential columns from GET responses"
  - "Discovery worker uses per-section try-catch so partial scraping failures preserve discovered data"
  - "Property links discovered via three selector strategies (patrimony/, property/, table rows) for resilience"
  - "Discovery from failed status allowed (D-05 retry) in addition to pending"

patterns-established:
  - "sessionPublicFields: explicit field selection object to prevent credential leakage in API responses"
  - "Dynamic import pattern for cross-plan deferred dependencies"
  - "Multi-strategy DOM selector approach for scraping resilience"

requirements-completed: [IMP-01, IMP-02, IMP-04, IMP-05]

# Metrics
duration: 4min
completed: 2026-03-28
---

# Plan 06-02: Import API + Discovery Worker Summary

**Import API with 6 encrypted-credential endpoints and BullMQ discovery worker that scrapes Smovin properties/tenants/leases/payments via stealth Playwright**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-28T08:59:44Z
- **Completed:** 2026-03-28T09:03:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Import Hono router with 6 endpoints: credential submission (encrypted), status polling, start-discovery, start-import, delete-credentials, latest-session
- BullMQ discovery worker that decrypts credentials, launches stealth browser, logs into Smovin, scrapes properties/tenants/leases/payments
- Import route mounted in index.ts with requireAuth protection and auto-started worker

## Task Commits

Each task was committed atomically:

1. **Task 1: Create import Hono router with all API endpoints** - `9312575` (feat)
2. **Task 2: Create importDiscoveryWorker BullMQ worker and wire import route in index.ts** - `53ac32a` (feat)

## Files Created/Modified
- `apps/api/src/routes/import.ts` - Import API router with 6 endpoints (credential submission, status, discovery, import, delete, latest)
- `apps/api/src/jobs/importDiscoveryWorker.ts` - BullMQ worker that scrapes Smovin via stealth Playwright with progress reporting
- `apps/api/src/index.ts` - Import route mounted at /import, worker auto-started, /import added to protectedPrefixes

## Decisions Made
- Dynamic import for importWriteWorker (`await import("../jobs/importWriteWorker")`) avoids compile-time dependency on Plan 03 which may execute concurrently
- sessionPublicFields pattern explicitly lists non-credential fields to prevent accidental credential leakage in API responses
- Per-section try-catch in discovery worker ensures partial scraping failures (e.g., can't access payments) don't lose already-discovered data
- Three selector strategies for property discovery (patrimony links, property links, table rows) for resilience against Smovin DOM changes
- Worker concurrency 1 with 30-minute timeout per D-03 resource management (one browser instance at a time)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Import API endpoints ready for Plan 04 (frontend import UI) to consume
- importDiscoveryQueue ready for import route to dispatch jobs
- importWriteWorker (Plan 03) expected as dynamic import -- will resolve at runtime when Plan 03 completes
- Key insight for Plan 03: discoveredData stored as JSON array of SmovinDiscoveredProperty objects

## Self-Check: PASSED

- All 3 created/modified files verified on disk
- Both task commits (9312575, 53ac32a) found in git history
- No stubs (TODO/FIXME/placeholder) found in created files

---
*Phase: 06-smovin-import-beta*
*Completed: 2026-03-28*
