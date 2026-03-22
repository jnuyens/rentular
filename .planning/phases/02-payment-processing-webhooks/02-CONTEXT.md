# Phase 2: Payment Processing & Webhooks - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement full payment processing: SEPA Direct Debit collection via GoCardless, bank account monitoring via GoCardless Bank Account Data API (Open Banking/PSD2) for automatic reconciliation of incoming transfers, webhook persistence with idempotency, manual payment recording, and payment overview reporting. Landlords get complete visibility into payment status with no data loss from GoCardless events.

</domain>

<decisions>
## Implementation Decisions

### Payment Collection — Dual Model
- **D-01:** Both Direct Debit (pull) and Bank Account Monitoring (watch) are equally supported — landlord chooses per lease
- **D-02:** Direct Debit uses existing GoCardless Payments API (`gocardless-nodejs` 4.2.0) — tenant signs mandate, landlord triggers collection
- **D-03:** Bank Account Monitoring uses GoCardless Bank Account Data API (formerly Nordigen) — landlord connects their bank via Open Banking PSD2, system polls for incoming transfers
- **D-04:** Incoming bank transfers are matched to expected payments by Belgian structured communication (`+++xxx/xxxx/xxxxx+++`)

### Transaction Matching & Reconciliation
- **D-05:** Exact amount + structured communication match → auto-mark payment as paid (no landlord action needed)
- **D-06:** Partial payment or amount mismatch → flagged for landlord review/confirmation in dashboard
- **D-07:** Polling frequency reuses existing `BALANCE_CHECK_CRON` schedule (3x daily: midnight, 10:00, 17:00), already configurable in settings

### Open Banking Connection Lifecycle
- **D-08:** PSD2 bank connections expire after 90 days (EU regulation)
- **D-09:** System attempts silent consent renewal first; if that fails, falls back to notifying landlord (email + dashboard warning at 7 days and 1 day before expiry)

### Webhook Idempotency
- **D-10:** Track every GoCardless event ID in a `webhook_events` table — check before processing, skip duplicates
- **D-11:** Retain webhook events for 12 months, then clean up via scheduled job
- **D-12:** When a webhook arrives for a payment/mandate not in the database, auto-create the record and mark it for landlord review
- **D-13:** Mandate lifecycle events cascade — when a mandate is cancelled/failed/expired, also cancel all pending payments for that mandate and flag the affected lease

### Payment Overview Report (PAY-10)
- **D-14:** API returns summary stats by default, detailed per-payment breakdown when `?detail=true`
- **D-15:** Filterable by `?propertyId=xxx` and/or `?leaseId=xxx`, or full portfolio if no filter
- **D-16:** Supports named periods (`?period=monthly`, `?period=yearly`) as shortcuts plus custom date range (`?from=2026-01&to=2026-03`)
- **D-17:** Key stats prioritized: current month overdue rent and total overdue across all contracts — these are the most actionable numbers for landlords

### Claude's Discretion
- Webhook event table schema design (columns, indexes)
- Bank Account Data API client implementation details
- Payment state machine transition logic (pending → processing → paid/failed/cancelled/refunded)
- PSD2 consent renewal implementation approach
- Transaction matching algorithm details (fuzzy matching on structured communication)
- Overview endpoint response shape and aggregation queries
- Cleanup job scheduling for 12-month event retention

</decisions>

<specifics>
## Specific Ideas

- The `BALANCE_CHECK_CRON` (3x daily) already exists and is configurable — reuse for bank monitoring polling, not just payment follow-up
- Structured communication (`+++xxx/xxxx/xxxxx+++`) is already a field on the payments table — use it as the primary matching key for incoming transfers
- The payment follow-up service (`paymentFollowUp.ts`) and landlord report service (`landlordReport.ts`) are fully implemented — Phase 2 wires the workers that call them
- Payment check worker and landlord report worker have their scheduling infrastructure ready, just need the core query→process loops implemented
- GoCardless Bank Account Data API is a separate product from their Direct Debit API — needs its own API key and client setup

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — PAY-01 through PAY-10 requirement definitions

### Phase 1 Decisions
- `.planning/phases/01-security-infrastructure/01-CONTEXT.md` — D-05/D-06/D-08: webhook stubs preserved with phase markers, route scaffolding intact

### Codebase Analysis
- `.planning/codebase/INTEGRATIONS.md` — GoCardless, Stripe, BullMQ integration details
- `.planning/codebase/ARCHITECTURE.md` — Layer structure, error handling patterns

### Database Schema
- `packages/db/src/schema/payments.ts` — payments, paymentReminders, paymentFollowUpSettings tables
- `packages/db/src/schema/tenants.ts` — gocardlessCustomerId, gocardlessMandateId fields
- `packages/db/src/schema/leases.ts` — gocardlessMandateId, paymentMethod, structuredCommunication fields

### Existing Services
- `apps/api/src/services/paymentFollowUp.ts` — Reminder escalation logic, email/SMS rendering, interest calculation (fully implemented)
- `apps/api/src/services/landlordReport.ts` — Report generation, email rendering (fully implemented)

### Existing Routes & Workers
- `apps/api/src/routes/webhooks.ts` — Webhook event routing with signature verification (persistence stubbed)
- `apps/api/src/routes/payments.ts` — Payment CRUD endpoints (all return 501)
- `apps/api/src/routes/gocardless.ts` — Mandate/customer endpoints (DB persistence stubbed)
- `apps/api/src/jobs/paymentCheckWorker.ts` — 3x daily cron (core logic stubbed)
- `apps/api/src/jobs/landlordReportWorker.ts` — Daily 08:00 cron (core logic stubbed)

### GoCardless Client
- `apps/api/src/lib/gocardless.ts` — Full client with customer/mandate/payment functions, webhook signature verification

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/gocardless.ts` — Complete GoCardless Payments client (createCustomer, createMandateSetupFlow, createPayment, retryPayment, cancelPayment, verifyWebhookSignature)
- `apps/api/src/services/paymentFollowUp.ts` — Full reminder escalation: determineReminderLevel(), sendReminder(), calculateInterest(), shouldWaiveFee()
- `apps/api/src/services/landlordReport.ts` — Full report generation: shouldSendReport(), generateReportEmail(), shouldRunOnDay()
- `packages/shared/src/constants/index.ts` — REMINDER_DEFAULTS, DEFAULT_INTEREST_RATE, DEFAULT_LATE_PAYMENT_FEE, BALANCE_CHECK_CRON, DEFAULT_EMAIL_TEMPLATES, DEFAULT_SMS_TEMPLATES
- `apps/api/src/routes/settings.ts` — Payment follow-up and landlord report settings CRUD (fully wired to DB)

### Established Patterns
- All routes: Hono router → Zod validation → DB query → JSON response
- Auth: `getRequiredUserId()` for ownership filtering on all queries
- Workers: BullMQ with connection pooling, error logging, auto-start on import
- GoCardless: singleton client pattern, idempotency key support on createPayment()

### Integration Points
- Webhook persistence fills the Phase 2 stubs in `webhooks.ts` (13 TODOs now marked as "Phase 2")
- GoCardless data persistence fills stubs in `gocardless.ts` (4 TODOs marked as "Phase 2")
- Payment CRUD replaces 501 stubs in `payments.ts`
- Worker logic fills commented-out flow in `paymentCheckWorker.ts` and `landlordReportWorker.ts`
- Bank Account Data API needs new client library alongside existing `gocardless.ts`
- New `webhook_events` table needed for idempotency tracking

</code_context>

<deferred>
## Deferred Ideas

- PDF generation for payment overviews — currently uses text format, proper PDF library (pdfkit/puppeteer) deferred to Phase 7 polish
- Payment reminder escalation (automated sending) — Phase 4: Notifications & Payment Follow-Up
- SMS delivery for payment reminders — Phase 4
- Email template customization per reminder level — Phase 4 (settings CRUD already exists)

</deferred>

---

*Phase: 02-payment-processing-webhooks*
*Context gathered: 2026-03-22*
