---
phase: 03-rent-indexation
plan: 01
subsystem: api
tags: [statbel, health-index, bullmq, cron, belgian-law, indexation]

# Dependency graph
requires:
  - phase: 01-hardening
    provides: "Database schema with healthIndexValues table, BullMQ infrastructure"
provides:
  - "Statbel health index fetch/parse/cache service (fetchAndCacheHealthIndex)"
  - "Health index lookup by year/month (getHealthIndexValue)"
  - "Latest health index query (getLatestHealthIndex)"
  - "Cache staleness detection (isHealthIndexStale)"
  - "Daily BullMQ cron worker for health index refresh at 06:00 UTC"
affects: [03-rent-indexation, indexation-calculations]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Statbel beSTAT API JSON integration", "Daily cron BullMQ worker pattern"]

key-files:
  created:
    - apps/api/src/services/healthIndex.ts
    - apps/api/src/jobs/healthIndexWorker.ts
  modified:
    - apps/api/src/index.ts

key-decisions:
  - "Skip-if-exists upsert strategy: health index values never change once published by Statbel"
  - "Silent failure on API errors with retry-next-day via daily cron (D-03)"
  - "7-day staleness threshold for cache freshness detection (D-04)"

patterns-established:
  - "Statbel beSTAT API integration: fetch JSON, parse month strings, upsert with dedup"
  - "Service + Worker separation: service holds business logic, worker handles scheduling"

requirements-completed: [IDX-01]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 3 Plan 1: Health Index Data Pipeline Summary

**Statbel beSTAT API client with daily BullMQ cron worker for Belgian health index caching**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T23:32:45Z
- **Completed:** 2026-03-22T23:34:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Health index service fetches and caches Belgian health index values from Statbel beSTAT API
- Daily BullMQ cron worker refreshes cache at 06:00 UTC following established project patterns
- API failures handled gracefully with silent fail and retry-next-day behavior (D-03)
- Cache staleness detectable after 7 days (D-04)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Statbel health index service with fetch, parse, and cache logic** - `bb6e469` (feat)
2. **Task 2: Create BullMQ health index worker and wire into API startup** - `06d9545` (feat)

## Files Created/Modified
- `apps/api/src/services/healthIndex.ts` - Statbel API client with fetch, parse, upsert, lookup, and staleness check
- `apps/api/src/jobs/healthIndexWorker.ts` - BullMQ daily cron worker for health index refresh
- `apps/api/src/index.ts` - Added import and startup registration for health index schedule

## Decisions Made
- Skip-if-exists upsert strategy: health index values never change once published by Statbel, so existing rows are skipped rather than updated
- Silent failure on API errors: if Statbel is down, the job logs an error and returns without throwing, retrying next day via daily cron (D-03)
- 7-day staleness threshold: cache is considered stale if the latest fetchedAt is older than 7 days (D-04)
- No manual index entry capability exists in the service (D-05)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required. The health index service uses the existing database and Redis infrastructure.

## Next Phase Readiness
- Health index data pipeline complete, ready for indexation calculation logic (Plan 2)
- getHealthIndexValue() available for downstream rent indexation calculations
- isHealthIndexStale() available for monitoring/alerting

## Self-Check: PASSED

- All created files exist on disk
- All commit hashes found in git log

---
*Phase: 03-rent-indexation*
*Completed: 2026-03-22*
