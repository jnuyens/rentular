---
phase: 03-rent-indexation
plan: 02
subsystem: api
tags: [indexation, epc, rent-calculation, email-notification, belgian-law, multilingual]

# Dependency graph
requires:
  - phase: 03-rent-indexation
    plan: 01
    provides: "Health index service (getHealthIndexValue, getLatestHealthIndex, isHealthIndexStale)"
provides:
  - "Full indexation calculation with EPC restrictions (calculateLeaseIndexation helper)"
  - "Indexation email service with region-specific legal references in 4 languages"
  - "6 wired indexation API endpoints: health-index, history, calculate, upcoming, preview, apply"
  - "Indexation record creation and lease rent update on apply"
  - "Tenant notification via email queue with localized templates"
affects: [frontend-indexation-ui, tenant-communication]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Shared calculation helper to reduce endpoint duplication", "Region-specific legal references with tenant language fallback"]

key-files:
  created:
    - apps/api/src/services/indexationEmail.ts
  modified:
    - apps/api/src/routes/indexation.ts

key-decisions:
  - "Shared calculateLeaseIndexation helper avoids duplicating lease/property/index lookup across 3 endpoints"
  - "Legal reference determined by property region, template language by tenant preference (D-11)"
  - "Override rent capped at EPC-restricted maximum, never exceeds calculated indexed rent (D-08)"
  - "Only currentMonthlyRent updated on apply, monthlyRent (base rent) never modified (D-07)"
  - "Notification queued immediately via BullMQ, no delay (D-14)"
  - "Override note only included when calculatedNewRent differs from appliedNewRent (D-12)"

patterns-established:
  - "IndexationEmailParams interface for email generation parameters"
  - "Error thrown as {status, message} objects in shared helpers, caught by endpoints"

requirements-completed: [IDX-02, IDX-03, IDX-04, IDX-05, IDX-06, IDX-07, IDX-08]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 3 Plan 2: Indexation Endpoints and Email Service Summary

**All 6 indexation endpoints wired to real DB queries with EPC restrictions, localized email templates, and indexation record creation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T23:36:37Z
- **Completed:** 2026-03-22T23:41:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Indexation email service provides localized templates with region-specific legal references for all 4 languages (EN, NL, FR, DE) across 3 Belgian regions (Flanders, Wallonia, Brussels)
- GET /health-index returns real cached data from Statbel via getLatestHealthIndex
- GET /health-index/history queries healthIndexValues with date range filtering
- GET /calculate/:leaseId fetches lease with ownership check, retrieves health indices, applies Brussels/Flanders EPC restrictions
- GET /upcoming returns active leases with indexation anniversaries within requested period
- POST /preview/:leaseId validates override cap (D-08), generates localized email preview with renderTemplate
- POST /apply/:leaseId creates indexation record, updates lease currentMonthlyRent (not base rent per D-07), queues email notification (D-14)
- Override note displayed when landlord chooses lower-than-indexed amount (D-12)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create indexation email service with region-specific legal references in 4 languages** - `bc06350` (feat)
2. **Task 2: Wire all 6 indexation route endpoints to real DB queries** - `a7821e0` (feat)

## Files Created/Modified

- `apps/api/src/services/indexationEmail.ts` - LEGAL_REFERENCES, DEFAULT_INDEXATION_TEMPLATES, generateDefaultIndexationEmail with override note support
- `apps/api/src/routes/indexation.ts` - All 6 endpoints wired to real DB queries via shared calculateLeaseIndexation helper

## Decisions Made

- Shared `calculateLeaseIndexation` helper centralizes lease/property/index lookup and EPC restriction logic, used by /calculate, /preview, and /apply endpoints
- Legal reference determined by property region, email template language by tenant preference (D-11)
- Override rent capped at EPC-restricted maximum -- cannot exceed calculated indexed rent (D-08)
- Only `currentMonthlyRent` updated on apply; `monthlyRent` (base rent from lease signing) never modified (D-07)
- Notification queued immediately via BullMQ `queueEmail`, no delay (D-14)
- Override note only included in email when `calculatedNewRent !== appliedNewRent` (D-12)
- Error handling uses `{status, message}` thrown objects caught by endpoint try/catch blocks
- Health index history uses year-level DB filtering with precise month filtering in application code

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Known Stubs

None - all stub comments ("Phase 3: implement") removed and replaced with real implementations.

## User Setup Required

None - uses existing database, Redis, and email infrastructure.

## Next Phase Readiness

- All backend indexation endpoints complete (IDX-01 through IDX-08)
- Ready for frontend indexation UI in a future phase
- Email templates available in all 4 languages for tenant notifications

## Self-Check: PASSED

- All created files exist on disk
- All commit hashes found in git log

---
*Phase: 03-rent-indexation*
*Completed: 2026-03-22*
