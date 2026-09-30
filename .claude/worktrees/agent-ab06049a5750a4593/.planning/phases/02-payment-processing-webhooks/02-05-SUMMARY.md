---
phase: 02-payment-processing-webhooks
plan: 05
subsystem: payments
tags: [hono, drizzle, bullmq, payment-overview, webhook-cleanup, aggregation]

# Dependency graph
requires:
  - phase: 02-payment-processing-webhooks/plan-03
    provides: "Payment CRUD endpoints with ownership checks and Drizzle queries"
  - phase: 02-payment-processing-webhooks/plan-01
    provides: "webhookEvents schema with receivedAt index for cleanup queries"
provides:
  - "GET /payments/overview endpoint with summary stats, period filtering, property/lease scoping"
  - "Webhook event cleanup scheduled job (12-month retention, weekly Sunday 03:00)"
affects: [frontend-dashboard, reports, webhook-maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns: ["BullMQ scheduled cleanup job pattern", "Drizzle aggregation with in-memory computation"]

key-files:
  created:
    - apps/api/src/services/webhookCleanup.ts
  modified:
    - apps/api/src/routes/payments.ts
    - apps/api/src/index.ts

key-decisions:
  - "Payment overview uses in-memory aggregation after single Drizzle query rather than SQL-level GROUP BY for flexibility with ignored payment filtering"
  - "Webhook cleanup runs weekly on Sunday 03:00 to minimize off-peak database load"

patterns-established:
  - "Scheduled cleanup service pattern: Queue + Worker + setup function following paymentCheckWorker convention"

requirements-completed: [PAY-10]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 02 Plan 05: Payment Overview & Webhook Cleanup Summary

**Payment overview endpoint with monthly/yearly/custom filtering, summary stats (expected/collected/overdue/fees), and weekly webhook event cleanup job with 12-month retention**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T20:37:49Z
- **Completed:** 2026-03-22T20:40:53Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Payment overview endpoint (GET /payments/overview) with period filtering, property/lease scoping, and summary stats including currentMonthOverdue
- Webhook event cleanup service with BullMQ scheduled job deleting events older than 12 months
- Cleanup schedule registered in API startup alongside existing payment check and landlord report schedules

## Task Commits

Each task was committed atomically:

1. **Task 1: Add payment overview endpoint with period filtering and stats** - `35e7d08` (feat)
2. **Task 2: Create webhook event cleanup job with 12-month retention** - `0355075` (feat)

## Files Created/Modified
- `apps/api/src/routes/payments.ts` - Added GET /overview endpoint with resolveDateRange helper, summary stats aggregation, currentMonthOverdue calculation, and detail mode
- `apps/api/src/services/webhookCleanup.ts` - New BullMQ cleanup service deleting webhook events older than 12 months, scheduled weekly on Sunday 03:00
- `apps/api/src/index.ts` - Imported and registered webhookCleanupSchedule alongside existing scheduled jobs

## Decisions Made
- Payment overview uses in-memory aggregation after a single Drizzle query rather than SQL-level GROUP BY -- this allows flexible filtering of ignored payments and status-based breakdowns without complex SQL
- Webhook cleanup runs weekly (Sunday 03:00) to minimize database load during off-peak hours, following the same BullMQ pattern as paymentCheckWorker
- Skipped adding GOCARDLESS_BAD env vars to .env.example since those belong to Plan 04's bank account data scope, not this plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 payment processing is now complete (all 5 plans done)
- Payment overview endpoint ready for frontend dashboard integration
- Webhook cleanup ensures unbounded table growth is prevented
- Ready for Phase 3 (rent indexation) or any downstream phase

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 02-payment-processing-webhooks*
*Completed: 2026-03-22*
