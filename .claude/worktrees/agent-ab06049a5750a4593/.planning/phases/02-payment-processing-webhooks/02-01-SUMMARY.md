---
phase: 02-payment-processing-webhooks
plan: 01
subsystem: payments, database
tags: [drizzle, mysql, state-machine, gocardless, webhooks, psd2, open-banking]

# Dependency graph
requires:
  - phase: 01-backend-hardening
    provides: "Type-safe DB access, fail-fast error handling, CSRF protection"
provides:
  - "webhook_events table for idempotent webhook processing"
  - "bank_connections table for PSD2 Open Banking connections"
  - "Payment state machine with validated transitions"
  - "GoCardless payment/mandate status mapping"
  - "Mandate cascade cancellation logic"
affects: [02-02, 02-03, 02-04, 02-05, 03-rent-indexation, 04-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Payment state machine for webhook-driven status transitions", "Provider-agnostic bank connection schema"]

key-files:
  created:
    - packages/db/src/schema/webhookEvents.ts
    - packages/db/src/schema/bankConnections.ts
    - apps/api/src/services/paymentStateMachine.ts
  modified:
    - packages/db/src/schema/index.ts

key-decisions:
  - "eventId unique constraint for DB-level idempotency (reject duplicate GoCardless events)"
  - "Provider-agnostic bank_connections table supporting GoCardless BAD, Ponto, Enable Banking"
  - "Forward-jump transitions allowed in state machine to handle out-of-order webhook events"
  - "canTransition returns boolean (not throw) for invalid transitions -- caller decides severity"
  - "charged_back and late_failure_settled both map to failed (reversal = failure from landlord perspective)"

patterns-established:
  - "State machine pattern: canTransition guard + transitionPayment mutator"
  - "GoCardless status mapping as const records (GC_PAYMENT_STATUS_MAP, GC_MANDATE_STATUS_MAP)"
  - "Cascade cancellation via mandate -> lease -> payment chain"

requirements-completed: [PAY-07, PAY-08, PAY-09]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 2 Plan 1: Schema Foundations & Payment State Machine Summary

**Webhook events table with idempotency constraint, bank connections table for PSD2 Open Banking, and payment state machine with GoCardless status mapping and mandate cascade logic**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T20:23:40Z
- **Completed:** 2026-03-22T20:26:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- webhook_events table with unique eventId for idempotent webhook processing, JSON payload storage, and processing status lifecycle
- bank_connections table with provider-agnostic design (GoCardless BAD, Ponto, Enable Banking) and PSD2 consent lifecycle tracking
- Payment state machine with validated transitions, forward-jump support for out-of-order events, and GoCardless status mapping for 9 payment actions and 7 mandate actions
- Mandate cascade cancellation logic that cancels pending/processing payments when a mandate terminates

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook_events and bank_connections schema tables** - `94d1fad` (feat)
2. **Task 2: Create payment state machine service with GoCardless status mapping** - `1517578` (feat)

## Files Created/Modified
- `packages/db/src/schema/webhookEvents.ts` - Webhook event idempotency tracking table with eventId unique constraint, JSON payload, processing status lifecycle, and indexes
- `packages/db/src/schema/bankConnections.ts` - Provider-agnostic Open Banking connection table with PSD2 consent lifecycle fields
- `packages/db/src/schema/index.ts` - Added re-exports for webhookEvents and bankConnections
- `apps/api/src/services/paymentStateMachine.ts` - Payment status transition logic, GoCardless status mapping, and mandate cascade cancellation

## Decisions Made
- eventId unique constraint enforces DB-level idempotency (duplicate GoCardless event IDs rejected at insert)
- bank_connections provider enum covers three providers (gocardless_bad, ponto, enable_banking) for future flexibility
- State machine allows forward jumps (e.g., pending -> paid) to handle out-of-order webhook delivery
- cancelled -> paid transition allowed for rare case where mandate cascade runs before GC confirmation arrives
- transitionPayment returns boolean for invalid transitions rather than throwing, letting callers decide severity
- GoCardless charged_back and late_failure_settled both map to "failed" (both are reversals from landlord perspective)
- paid_out maps to "paid" (not a separate state -- payout timing is informational only)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all code is fully implemented with real logic.

## Next Phase Readiness
- webhook_events and bankConnections tables are importable from `@rentular/db` for use by webhook handler (02-02) and bank connection routes
- paymentStateMachine exports are ready for webhook processing (02-02), payment routes (02-03), and follow-up logic (02-04)
- GC_PAYMENT_STATUS_MAP and GC_MANDATE_STATUS_MAP ready for event processing
- MANDATE_TERMINAL_STATUSES and cascadeMandateCancellation ready for mandate webhook handling

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 02-payment-processing-webhooks*
*Completed: 2026-03-22*
