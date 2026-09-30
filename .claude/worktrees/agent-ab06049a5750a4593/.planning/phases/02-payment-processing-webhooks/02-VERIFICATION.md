---
phase: 02-payment-processing-webhooks
verified: 2026-03-22T21:00:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 2: Payment Processing & Webhooks Verification Report

**Phase Goal:** Landlords can collect rent via SEPA direct debit and have complete visibility into payment status, with no data loss from GoCardless events
**Verified:** 2026-03-22
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Landlord can view payments filtered by status (paid, overdue, processing, failed, cancelled) | VERIFIED | `GET /payments` with `zValidator("query", ...)` including status enum filter; joins leases for ownership; `apps/api/src/routes/payments.ts` lines 195-241 |
| 2 | Landlord can trigger SEPA direct debit collection and see payment appear with "processing" status | VERIFIED | `POST /collect` calls `gcCreatePayment`, inserts payment with `status: "processing"` and `gocardlessPaymentId`; `apps/api/src/routes/payments.ts` lines 351-440 |
| 3 | Landlord can record a manual cash/transfer payment and see it in the payment list | VERIFIED | `POST /record` inserts payment with `status: "paid"` and `paidDate`; `apps/api/src/routes/payments.ts` lines 300-349 |
| 4 | GoCardless webhook (payment confirmed, failed, charged back, mandate changed) persists to DB and updates status automatically | VERIFIED | `processEvent` → `handlePaymentEvent` calls `transitionPayment` via state machine; `handleMandateEvent` cascades + flags leases; `apps/api/src/routes/webhooks.ts` lines 61-259 |
| 5 | Sending the same GoCardless webhook event twice does not create duplicates or change state incorrectly | VERIFIED | `db.query.webhookEvents.findFirst({ where: eq(webhookEvents.eventId, event.id) })` check before any mutation; "Skipping duplicate event" log; `webhooks.ts` lines 69-75 |

**Score:** 5/5 success criteria verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/webhookEvents.ts` | Webhook event idempotency tracking table | VERIFIED | 28 lines; `eventId.unique()` constraint; `json("payload")`; status enum with 5 values; 4 indexes |
| `packages/db/src/schema/bankConnections.ts` | Provider-agnostic Open Banking connection table | VERIFIED | 34 lines; `mysqlEnum("provider", ["gocardless_bad", "ponto", "enable_banking"])`; `consentExpiresAt`; PSD2 lifecycle fields |
| `packages/db/src/schema/index.ts` | Re-exports both new tables | VERIFIED | Lines 12-13: `export * from "./webhookEvents"` and `export * from "./bankConnections"` |
| `apps/api/src/services/paymentStateMachine.ts` | Payment status transition logic and GC status mapping | VERIFIED | 130 lines; exports `canTransition`, `transitionPayment`, `cascadeMandateCancellation`, `GC_PAYMENT_STATUS_MAP`, `GC_MANDATE_STATUS_MAP`, `MANDATE_TERMINAL_STATUSES` |
| `apps/api/src/routes/webhooks.ts` | Idempotent webhook handler with DB persistence | VERIFIED | 279 lines; imports from `paymentStateMachine`; inserts to `webhookEvents`; updates status to `processed`/`failed`; no Phase 2 stubs |
| `apps/api/src/routes/gocardless.ts` | GoCardless routes with DB persistence | VERIFIED | 337 lines; `db.update(leases).set({ gocardlessMandateId })` in `/mandates/complete`; `db.update(tenants).set({ gocardlessCustomerId })` in `/customers`; lease flagging on cancel; ownership checks added |
| `apps/api/src/routes/payments.ts` | Complete payment CRUD with GoCardless integration | VERIFIED | 606 lines; all 8 endpoints working (list, detail, record, collect, retry, cancel, ignore/unignore, overdue, overview); only `/:id/remind` returns 501 with explicit Phase 4 comment |
| `apps/api/src/lib/bankAccountData.ts` | Provider-agnostic bank account data interface | VERIFIED | 200 lines; `BankAccountDataProvider` interface; `GoCardlessBadProvider` class; `getBankAccountDataProvider()` factory; `renewConsent` returns null for GoCardless BAD |
| `apps/api/src/services/transactionMatcher.ts` | Belgian structured communication transaction matching | VERIFIED | 144 lines; `matchTransaction` strips non-digits for OGM-VCS comparison; `processIncomingTransactions` auto-marks exact matches as paid; flags mismatches with notes |
| `apps/api/src/jobs/paymentCheckWorker.ts` | Working payment check cron with 3-phase implementation | VERIFIED | 430 lines; Phase A (overdue reminders with escalation); Phase B (bank polling with `processIncomingTransactions`); Phase C (consent expiry with 7/1-day thresholds and email fallback) |
| `apps/api/src/jobs/landlordReportWorker.ts` | Working landlord report cron | VERIFIED | 215 lines; queries monthly payments, enriches with tenant/property, calls `shouldSendReport` + `generateReportEmail` + `sendEmail` |
| `apps/api/src/services/webhookCleanup.ts` | Scheduled webhook event cleanup (12-month retention) | VERIFIED | 65 lines; `db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, twelveMonthsAgo))`; `repeat: { pattern: "0 3 * * 0" }` (Sunday 03:00); exports `setupWebhookCleanupSchedule` |
| `apps/api/src/index.ts` | Webhook cleanup schedule registered | VERIFIED | Line 29: `import { setupWebhookCleanupSchedule } from "./services/webhookCleanup"`; line 148: `setupWebhookCleanupSchedule().catch(...)` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/db/src/schema/index.ts` | `webhookEvents.ts` | `export * from "./webhookEvents"` | WIRED | Line 12 confirmed |
| `packages/db/src/schema/index.ts` | `bankConnections.ts` | `export * from "./bankConnections"` | WIRED | Line 13 confirmed |
| `apps/api/src/routes/webhooks.ts` | `paymentStateMachine.ts` | named imports | WIRED | Lines 9-16: imports `transitionPayment`, `cascadeMandateCancellation`, `GC_PAYMENT_STATUS_MAP`, `GC_MANDATE_STATUS_MAP`, `MANDATE_TERMINAL_STATUSES` — all called in body |
| `apps/api/src/routes/webhooks.ts` | `webhookEvents` schema | `import { webhookEvents } from "@rentular/db"` | WIRED | Line 3; `db.query.webhookEvents.findFirst`, `db.insert(webhookEvents)`, `db.update(webhookEvents)` all present |
| `apps/api/src/routes/gocardless.ts` | `tenants` table | `db.update(tenants)` | WIRED | Lines 163-170 (`/mandates/complete`), lines 257-263 (`/mandates/:id/cancel`), lines 316-320 (`/customers`) |
| `apps/api/src/routes/payments.ts` | `gocardless.ts` | `createPayment`, `retryPayment`, `cancelPayment` | WIRED | Lines 7-12: imports; `gcCreatePayment` called in `/collect`, `gcRetryPayment` in `/:id/retry`, `gcCancelPayment` in `/:id/cancel` |
| `apps/api/src/routes/payments.ts` | `paymentStateMachine.ts` | `transitionPayment` | WIRED | Line 13; called in retry (line 470) and cancel (line 511) |
| `apps/api/src/routes/payments.ts` | `payments` schema | Drizzle queries | WIRED | `db.select().from(payments)`, `db.insert(payments)`, `db.update(payments)` throughout |
| `apps/api/src/routes/payments.ts` | `payments.ts` overview | `gte(payments.dueDate...)`, `payments.amount` | WIRED | Lines 88-103; aggregation uses payment columns directly |
| `apps/api/src/services/transactionMatcher.ts` | `bankAccountData.ts` | `import type { IncomingTransaction }` | WIRED | Line 4; `IncomingTransaction` used as parameter type for `matchTransaction` and `processIncomingTransactions` |
| `apps/api/src/jobs/paymentCheckWorker.ts` | `payments` schema | Drizzle query for overdue | WIRED | Lines 52-68: `db.select().from(payments).where(...)` |
| `apps/api/src/jobs/paymentCheckWorker.ts` | `transactionMatcher.ts` | `processIncomingTransactions` | WIRED | Line 22 import; called at line 279 in Phase B |
| `apps/api/src/jobs/paymentCheckWorker.ts` | `bankAccountData.ts` | `getBankAccountDataProvider` | WIRED | Line 21 import; called at lines 261 and 352 in Phases B and C |
| `apps/api/src/jobs/paymentCheckWorker.ts` | `bankConnections` schema | Drizzle query | WIRED | Lines 254-257 (active connections), lines 330-338 (expiring connections) |
| `apps/api/src/jobs/landlordReportWorker.ts` | `landlordReport.ts` | `shouldSendReport`, `generateReportEmail` | WIRED | Lines 14-17 imports; called at lines 165 and 166 |
| `apps/api/src/services/webhookCleanup.ts` | `webhookEvents` schema | `db.delete(webhookEvents)` | WIRED | Lines 27-29 confirmed |
| `apps/api/src/index.ts` | `webhookCleanup.ts` | `setupWebhookCleanupSchedule` | WIRED | Line 29 import; line 148 call |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PAY-01 | 02-03, 02-04 | Landlord can view list of all payments with status | SATISFIED | `GET /payments` with status filter; ownership via lease join |
| PAY-02 | 02-03 | Landlord can view payment details including GoCardless reference | SATISFIED | `GET /payments/:id` returns full payment row including `gocardlessPaymentId` |
| PAY-03 | 02-03 | Landlord can record a manual payment | SATISFIED | `POST /record` inserts payment with `status: "paid"` immediately |
| PAY-04 | 02-03, 02-04 | Landlord can trigger SEPA direct debit collection via GoCardless | SATISFIED | `POST /collect` calls `gcCreatePayment`; bank monitoring via transaction matcher also satisfies collection watch model |
| PAY-05 | 02-03 | Landlord can retry a failed GoCardless payment | SATISFIED | `POST /:id/retry` calls `gcRetryPayment` + `transitionPayment("processing")` |
| PAY-06 | 02-03 | Landlord can cancel a pending GoCardless payment | SATISFIED | `POST /:id/cancel` calls `gcCancelPayment` + `transitionPayment("cancelled")` |
| PAY-07 | 02-01, 02-02 | GoCardless webhook events persist payment status changes | SATISFIED | `handlePaymentEvent` uses `GC_PAYMENT_STATUS_MAP` + `transitionPayment`; covers confirmed, failed, charged_back, cancelled, late_failure_settled |
| PAY-08 | 02-01, 02-02 | GoCardless webhook events persist mandate status changes | SATISFIED | `handleMandateEvent` uses `GC_MANDATE_STATUS_MAP`; terminal statuses cascade-cancel payments and flag leases with notes |
| PAY-09 | 02-01, 02-02 | Webhook processing is idempotent (duplicate events safely skipped) | SATISFIED | `webhookEvents.eventId.unique()` DB constraint + pre-check with `db.query.webhookEvents.findFirst`; "Skipping duplicate event" log path confirmed |
| PAY-10 | 02-05 | Landlord can view monthly/yearly payment overview report | SATISFIED | `GET /payments/overview` with `period=monthly/yearly`, custom from/to, propertyId/leaseId filter, `detail` mode; summary includes `totalExpected`, `totalCollected`, `totalOverdue`, `currentMonthOverdue`, `countByStatus` |

**All 10 requirements satisfied. Zero orphaned requirements.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api/src/routes/payments.ts` | 536 | `501` in `/:id/remind` | INFO | Intentionally deferred; explicit `// Phase 4: implement payment reminders` comment; no data flowing through this stub |
| `apps/api/src/routes/stripe.ts` | 86, 94, 100, 108, 120 | `// Phase 2: implement subscription persistence` | INFO | Unrelated to this phase (Stripe subscription billing, not rent payment processing); out of scope for Phase 2 |

Neither anti-pattern is a blocker. The remind endpoint stub is explicitly scoped to Phase 4. The stripe.ts comments refer to a different "Phase 2" label in a different context and are not payment processing webhooks.

---

### Human Verification Required

#### 1. GoCardless Sandbox Webhook Flow

**Test:** Configure GOCARDLESS_WEBHOOK_SECRET and submit a simulated webhook payload for a payment.confirmed event via POST /api/v1/webhooks/gocardless
**Expected:** Payment status in DB transitions to "paid"; webhook_events table contains a record with status "processed"; second identical payload returns "Skipping duplicate event"
**Why human:** Requires live or sandbox GoCardless credentials and a real HTTP request; cannot verify cryptographic signature path programmatically

#### 2. SEPA Collection End-to-End

**Test:** POST /api/v1/payments/collect with a valid leaseId that has a gocardlessMandateId
**Expected:** Response contains `status: "processing"` and `gocardlessPaymentId`; DB contains new payment record; GoCardless sandbox shows payment created
**Why human:** Requires configured GOCARDLESS_ACCESS_TOKEN and a real sandbox mandate

#### 3. Payment Overview Date Math

**Test:** GET /api/v1/payments/overview?period=monthly in a month with payments spanning multiple statuses
**Expected:** `totalExpected` = sum of all active (non-ignored) payment amounts; `totalCollected` = sum of paid amounts only; `currentMonthOverdue` reflects actual overdue amounts
**Why human:** Requires real data in DB to verify arithmetic correctness of in-memory aggregation

---

## Gaps Summary

No gaps found. All 10 requirements are satisfied. All artifacts exist, are substantive (no stubs), and are wired to their consumers. Key links verified at all three levels. The only 501 response is the `/:id/remind` endpoint, explicitly deferred to Phase 4 per plan specification.

---

_Verified: 2026-03-22T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
