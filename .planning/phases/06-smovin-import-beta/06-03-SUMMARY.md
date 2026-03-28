---
phase: 06-smovin-import-beta
plan: 03
subsystem: api
tags: [bullmq, drizzle, data-mapping, import, belgian-addresses]

# Dependency graph
requires:
  - phase: 06-smovin-import-beta
    provides: import_sessions schema, stealth browser factory, discovery worker, import API router
  - phase: 01-security-infrastructure
    provides: database patterns, encryption utilities, routeAuth
provides:
  - smovinMapper.ts with 11 pure mapping functions for Smovin-to-Rentular data conversion
  - importWriteWorker BullMQ worker that writes selected properties to database with duplicate detection
  - Credential cleanup on successful import (D-04)
  - Worker wired into API boot for automatic startup
affects: [06-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure mapping functions for data conversion, address parsing for Belgian formats, duplicate detection by address/email before insert]

key-files:
  created:
    - apps/api/src/services/smovinMapper.ts
    - apps/api/src/jobs/importWriteWorker.ts
  modified:
    - apps/api/src/index.ts

key-decisions:
  - "Belgian address parser handles street/number/box/postal/city with bus/bte/boite/slash box indicators"
  - "Region guessed from postal code: Brussels 1000-1299, Flanders 1500-3999+8000-9999, Wallonia remainder"
  - "Duplicate properties matched by street+streetNumber+postalCode+city for same owner (D-06)"
  - "Duplicate tenants matched by email for same owner; no-email tenants always created new (D-06)"
  - "Payments linked to first lease of property; skipped if property has no leases"
  - "Default language for imported tenants is nl (Belgian Dutch)"

patterns-established:
  - "Pure mapper pattern: all mapping functions have no side effects, no DB access, for testability"
  - "Duplicate detection before insert: query-then-insert pattern for idempotent imports"
  - "Credential cleanup in success path only: failed imports retain credentials for retry"

requirements-completed: [IMP-03, IMP-05]

# Metrics
duration: 3min
completed: 2026-03-28
---

# Plan 06-03: Data Mapper + Import Write Worker Summary

**Pure mapping functions for Smovin-to-Rentular data conversion with BullMQ write worker featuring duplicate detection, per-property progress tracking, and credential cleanup on success**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T09:47:29Z
- **Completed:** 2026-03-28T09:50:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- smovinMapper.ts with 11 exported functions: 4 interfaces (SmovinProperty/Tenant/Lease/Payment), address parser, property/lease type mappers, region guesser, date/amount parsers, payment status mapper, and 4 top-level entity mappers
- importWriteWorker.ts BullMQ worker that reads selected properties from discovered data, maps via smovinMapper, detects duplicates (properties by address, tenants by email), writes to DB, and cleans up credentials on success
- Worker wired into index.ts for automatic startup alongside importDiscoveryWorker

## Task Commits

Each task was committed atomically:

1. **Task 1: Create smovinMapper.ts data mapping service** - `c2d993e` (feat)
2. **Task 2: Create importWriteWorker and wire into API boot** - `0e12bd9` (feat)

## Files Created/Modified
- `apps/api/src/services/smovinMapper.ts` - Pure mapping functions: Belgian address parser, property/lease/tenant/payment type mappers, date/amount parsers, region guesser
- `apps/api/src/jobs/importWriteWorker.ts` - BullMQ worker that imports selected Smovin properties to Rentular DB with duplicate detection, progress tracking, and credential cleanup
- `apps/api/src/index.ts` - Added importWriteWorker import and startup log

## Decisions Made
- Belgian address parser uses regex for street number extraction with support for bus/bte/boite/slash box indicators
- Region guessed from postal code ranges: Brussels 1000-1299, Flanders 1500-3999 + 8000-9999, Wallonia remainder
- Duplicate property detection by address components (street + streetNumber + postalCode + city) for same owner
- Duplicate tenant detection by email only (tenants without email always created as new)
- Payments linked to first lease of property; skipped entirely if property has no leases
- Default language for imported Belgian tenants set to "nl"
- All mapping functions are pure (no side effects) for testability and reuse

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Import write worker ready to process jobs queued by `POST /start-import/:sessionId` endpoint (Plan 02)
- smovinMapper.ts functions available for any future data mapping needs
- Plan 04 (frontend import UI) can now trigger full import flow: credentials -> discovery -> selection -> import

## Self-Check: PASSED

- All 3 created/modified files verified on disk
- Both task commits (c2d993e, 0e12bd9) found in git history
- No stubs (TODO/FIXME/placeholder) found in created files

---
*Phase: 06-smovin-import-beta*
*Completed: 2026-03-28*
