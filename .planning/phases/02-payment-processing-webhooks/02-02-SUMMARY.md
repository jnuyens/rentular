---
phase: 02-payment-processing-webhooks
plan: 02
subsystem: payments
tags: [gocardless, webhooks, sepa, idempotency, state-machine, drizzle]

# Dependency graph
requires:
  - phase: 02-payment-processing-webhooks plan 01
    provides: paymentStateMachine service, webhookEvents schema, bank_connections schema
provides:
  - Idempotent webhook event processing with DB persistence
  - Payment status transitions via state machine from webhook events
  - Mandate cascade cancellation with lease flagging (D-13)
  - Auto-creation of unknown payments from webhooks (D-12)
  - GoCardless mandate and customer ID persistence to tenant and lease records
  - Ownership checks on GoCardless mandate setup and complete routes
affects: [02-payment-processing-webhooks plan 03, 02-payment-processing-webhooks plan 04, 02-payment-processing-webhooks plan 05]

# Tech tracking
tech-stack:
  added: []
  patterns: [idempotent webhook processing via webhookEvents table, lease flagging with notes on mandate cancellation]

key-files:
  created: []
  modified:
    - apps/api/src/routes/webhooks.ts
    - apps/api/src/routes/gocardless.ts

key-decisions:
  - "Webhook events inserted as 'processing' before handler runs, updated to 'processed' or 'failed' after"
  - "Unknown payments auto-created with amount 0.00 and review note per D-12"
  - "Mandate terminal events flag leases with timestamped notes before clearing mandateId per D-13"
  - "Ownership checks added to mandates/setup and mandates/complete routes"

patterns-established:
  - "Idempotent webhook pattern: check webhookEvents for duplicate eventId, insert before processing, update status after"
  - "Lease flagging pattern: append timestamped note to lease.notes field for visible landlord notification"

requirements-completed: [PAY-07, PAY-08, PAY-09]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 02 Plan 02: Webhook Persistence Summary

**Idempotent GoCardless webhook handler with payment state machine transitions, mandate cascade cancellation with lease flagging, and mandate/customer ID persistence to DB**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T20:28:50Z
- **Completed:** 2026-03-22T20:32:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Webhook events are now deduplicated via webhookEvents table before processing, preventing duplicate state mutations
- Payment status changes from GoCardless webhooks flow through the paymentStateMachine for validated transitions
- Mandate cancellation/failure/expiry cascades: cancels pending payments, flags affected leases with visible notes, and clears mandateId from leases and tenants
- Unknown payments from webhooks are auto-created with review notes (D-12)
- Mandate setup completion persists mandateId and customerId to lease and tenant records
- All Phase 2 TODO stubs removed from both webhooks.ts and gocardless.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement idempotent webhook handler with payment and mandate persistence** - `bc3883a` (feat)
2. **Task 2: Wire GoCardless mandate and customer routes to persist IDs in database** - `2d01578` (feat)

## Files Created/Modified
- `apps/api/src/routes/webhooks.ts` - Idempotent webhook handler with payment status persistence via state machine, mandate cascade cancellation with lease flagging, unknown payment auto-creation
- `apps/api/src/routes/gocardless.ts` - Mandate complete persists IDs to lease/tenant, mandate cancel flags leases and clears IDs, customer create persists customerId, ownership checks added

## Decisions Made
- Webhook events are inserted with status "processing" before the handler runs, then updated to "processed" or "failed" -- this ensures events are always recorded even if processing crashes
- Unknown payments (GoCardless payment IDs not found in DB) are auto-created with amount "0.00" and a review note, rather than silently discarding them (D-12)
- Mandate terminal events (cancelled, failed, expired) append a timestamped note to lease.notes before clearing the mandateId, ensuring landlords see a visible indicator that SEPA collection stopped (D-13)
- Added ownership checks (getRequiredUserId + lease.ownerId verification) to mandates/setup and mandates/complete routes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all Phase 2 stubs have been replaced with real implementations.

## Next Phase Readiness
- Webhook persistence is complete, ready for payment CRUD routes (Plan 03)
- Payment state machine is wired and tested via webhook flow
- Mandate and customer IDs now persist to DB, enabling payment collection routes

## Self-Check: PASSED

All files exist, all commits verified, all acceptance criteria met.

---
*Phase: 02-payment-processing-webhooks*
*Completed: 2026-03-22*
