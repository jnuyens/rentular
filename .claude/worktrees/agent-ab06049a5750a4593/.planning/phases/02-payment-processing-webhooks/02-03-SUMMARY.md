---
phase: 02-payment-processing-webhooks
plan: 03
subsystem: payments
tags: [gocardless, sepa, drizzle, hono, crud, rest-api]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Payment schema, state machine, GoCardless client functions"
provides:
  - "Complete payment CRUD endpoints (list, detail, record, collect, retry, cancel)"
  - "Overdue payment summary aggregation"
  - "Ignore/unignore payment marking"
affects: [04-notifications, frontend-payments]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ownership enforcement via innerJoin(leases) + eq(leases.ownerId)"
    - "GoCardless calls wrapped in try/catch with [Payments] prefix logging"
    - "Idempotency key generation via crypto.randomUUID() for GoCardless API calls"

key-files:
  created: []
  modified:
    - "apps/api/src/routes/payments.ts"

key-decisions:
  - "Overdue summary route placed before /:id to avoid Hono route parameter conflict"
  - "Manual payments immediately marked as paid (no state machine transition needed)"
  - "SEPA collect endpoint returns 503 if GoCardless not configured vs 400 for missing mandate"

patterns-established:
  - "Payment CRUD with ownership via lease join: all payment queries join leases table to filter by ownerId"
  - "GoCardless error handling: try/catch with console.error and 500 response including error message"

requirements-completed: [PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 02 Plan 03: Payment CRUD Summary

**Full payment CRUD API with GoCardless SEPA collection, retry, cancel, overdue summary, and ignore/unignore -- replacing all 501 stubs except deferred Phase 4 reminders**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T20:29:06Z
- **Completed:** 2026-03-22T20:32:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced all 501 stubs with working implementations for 8 endpoints (list, detail, record, collect, retry, cancel, ignore, unignore, overdue)
- All endpoints enforce ownership via lease inner join
- GoCardless integration for SEPA collection with idempotency, retry, and cancel
- Overdue payment summary with total amount aggregation

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement payment list, detail, and manual record endpoints** - `bc3883a` (feat)
2. **Task 2: Implement collect, retry, cancel, ignore, and overdue endpoints** - `b67581c` (feat)

## Files Created/Modified
- `apps/api/src/routes/payments.ts` - Complete payment CRUD with GoCardless integration (430 lines)

## Decisions Made
- Overdue summary route registered before /:id parameter route to prevent Hono from matching "summary" as a payment ID
- Manual payment recordings set status to "paid" directly without going through the state machine (no prior state to transition from)
- GoCardless not configured returns 503 (Service Unavailable) while missing mandate returns 400 (Bad Request) to distinguish infrastructure vs data issues

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

- `apps/api/src/routes/payments.ts` line 361: POST /:id/remind returns 501 -- intentionally deferred to Phase 4 per plan specification

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Payment CRUD complete, ready for webhook handlers to update payment statuses
- Remind endpoint deferred to Phase 4 (notifications)
- Frontend can now wire up payment management UI against these endpoints

---
*Phase: 02-payment-processing-webhooks*
*Completed: 2026-03-22*
