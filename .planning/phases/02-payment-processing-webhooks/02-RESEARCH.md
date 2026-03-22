# Phase 2: Payment Processing & Webhooks - Research

**Researched:** 2026-03-22
**Domain:** GoCardless SEPA Direct Debit, Open Banking (PSD2), webhook idempotency, payment state machines
**Confidence:** HIGH (Direct Debit / webhooks) / LOW (Bank Account Data API -- registration closed)

## Summary

Phase 2 implements the core payment value of Rentular: SEPA direct debit collection via GoCardless, webhook-driven payment/mandate state persistence, manual payment recording, and payment overview reporting. The codebase has extensive scaffolding already in place -- route handlers returning 501, webhook handlers that log but don't persist, worker stubs with commented-out flow, and fully implemented services for payment follow-up and landlord reports.

The most critical discovery is that **GoCardless Bank Account Data API (formerly Nordigen) has closed new registrations as of mid-2025**. This means the D-03 decision (bank account monitoring via Open Banking PSD2) cannot be implemented using GoCardless Bank Account Data unless Rentular already has an existing account. The research recommends an **abstracted bank monitoring interface** that can be wired to alternative providers (Ponto/Ibanity, Enable Banking) without changing the core reconciliation logic. The Direct Debit integration (D-02) is unaffected -- `gocardless-nodejs` 4.2.0 is already integrated and the Payments API is fully operational.

**Primary recommendation:** Implement Direct Debit collection, webhook persistence, and manual payments first (PAY-01 through PAY-10). Design the bank monitoring integration with a provider-agnostic interface, and defer the actual Open Banking provider selection to a follow-up decision since GoCardless BAD is no longer available for new signups.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Both Direct Debit (pull) and Bank Account Monitoring (watch) are equally supported -- landlord chooses per lease
- **D-02:** Direct Debit uses existing GoCardless Payments API (`gocardless-nodejs` 4.2.0) -- tenant signs mandate, landlord triggers collection
- **D-03:** Bank Account Monitoring uses GoCardless Bank Account Data API (formerly Nordigen) -- landlord connects their bank via Open Banking PSD2, system polls for incoming transfers
- **D-04:** Incoming bank transfers are matched to expected payments by Belgian structured communication (`+++xxx/xxxx/xxxxx+++`)
- **D-05:** Exact amount + structured communication match -> auto-mark payment as paid (no landlord action needed)
- **D-06:** Partial payment or amount mismatch -> flagged for landlord review/confirmation in dashboard
- **D-07:** Polling frequency reuses existing `BALANCE_CHECK_CRON` schedule (3x daily: midnight, 10:00, 17:00), already configurable in settings
- **D-08:** PSD2 bank connections expire after 90 days (EU regulation)
- **D-09:** System attempts silent consent renewal first; if that fails, falls back to notifying landlord (email + dashboard warning at 7 days and 1 day before expiry)
- **D-10:** Track every GoCardless event ID in a `webhook_events` table -- check before processing, skip duplicates
- **D-11:** Retain webhook events for 12 months, then clean up via scheduled job
- **D-12:** When a webhook arrives for a payment/mandate not in the database, auto-create the record and mark it for landlord review
- **D-13:** Mandate lifecycle events cascade -- when a mandate is cancelled/failed/expired, also cancel all pending payments for that mandate and flag the affected lease
- **D-14:** API returns summary stats by default, detailed per-payment breakdown when `?detail=true`
- **D-15:** Filterable by `?propertyId=xxx` and/or `?leaseId=xxx`, or full portfolio if no filter
- **D-16:** Supports named periods (`?period=monthly`, `?period=yearly`) as shortcuts plus custom date range (`?from=2026-01&to=2026-03`)
- **D-17:** Key stats prioritized: current month overdue rent and total overdue across all contracts

### Claude's Discretion
- Webhook event table schema design (columns, indexes)
- Bank Account Data API client implementation details
- Payment state machine transition logic (pending -> processing -> paid/failed/cancelled/refunded)
- PSD2 consent renewal implementation approach
- Transaction matching algorithm details (fuzzy matching on structured communication)
- Overview endpoint response shape and aggregation queries
- Cleanup job scheduling for 12-month event retention

### Deferred Ideas (OUT OF SCOPE)
- PDF generation for payment overviews -- Phase 7 polish
- Payment reminder escalation (automated sending) -- Phase 4
- SMS delivery for payment reminders -- Phase 4
- Email template customization per reminder level -- Phase 4
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAY-01 | Landlord can view list of all payments with status | Existing `payments` table schema, payments route GET `/` stub, Drizzle ORM queries with ownership filtering |
| PAY-02 | Landlord can view payment details including GoCardless reference | Existing `gocardlessPaymentId` column, payments route GET `/:id` stub |
| PAY-03 | Landlord can record a manual payment | Existing POST `/record` stub with Zod schema, method enum includes `bank_transfer`, `cash`, `other` |
| PAY-04 | Landlord can trigger SEPA direct debit collection | Existing `createPayment()` in gocardless.ts, POST `/collect` stub, mandateId on leases table |
| PAY-05 | Landlord can retry a failed GoCardless payment | Existing `retryPayment()` in gocardless.ts, POST `/:id/retry` stub |
| PAY-06 | Landlord can cancel a pending GoCardless payment | Existing `cancelPayment()` in gocardless.ts, POST `/:id/cancel` stub |
| PAY-07 | GoCardless webhooks persist payment status changes | Webhook handler exists with Phase 2 markers, needs DB persistence + state transitions |
| PAY-08 | GoCardless webhooks persist mandate status changes | Webhook handler exists with Phase 2 markers, needs DB persistence + cascade logic |
| PAY-09 | Webhook processing is idempotent | Requires new `webhook_events` table, event ID check-before-process pattern |
| PAY-10 | Landlord can view monthly/yearly payment overview | New GET endpoint with aggregation queries, D-14 through D-17 shape the response |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| gocardless-nodejs | ^4.2.0 (installed) | GoCardless Payments API client (SEPA Direct Debit) | Already integrated; singleton in `apps/api/src/lib/gocardless.ts` |
| drizzle-orm | ^0.36.0 (installed) | Type-safe SQL queries, schema definitions | Project standard ORM; all route handlers use it |
| drizzle-kit | ^0.31.9 (installed) | Schema migrations | Project standard for schema changes |
| bullmq | ^5.25.0 (installed) | Background job queue (cron workers) | Already powers email/SMS queues and payment check schedule |
| zod | ^3.24.0 (installed) | Request validation | Used in all existing route handlers |
| uuid | (Node crypto) | Generate UUIDs for new records | Use `crypto.randomUUID()` (Node 20 built-in) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nordigen-node | 1.4.1 | GoCardless Bank Account Data API client | **BLOCKED: New registrations closed mid-2025** -- see Open Questions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nordigen-node (GoCardless BAD) | Ponto/Ibanity API | Belgian-focused, Isabel Group backed, paid service, excellent Belgian bank coverage |
| nordigen-node (GoCardless BAD) | Enable Banking | Free tier mentioned in community, less mature, coverage TBD for Belgian banks |
| nordigen-node (GoCardless BAD) | Direct bank PSD2 APIs | No aggregator needed, but each Belgian bank has its own API (STET vs Berlin Group), enormous integration effort |
| Custom webhook dedup | Database unique constraint | Simpler but less observable; dedicated table gives audit trail per D-10/D-11 |

**No new packages to install for the core Direct Debit + webhook work.** The entire PAY-01 through PAY-10 scope can be implemented with already-installed dependencies. Bank Account Monitoring (D-03) requires a provider decision first.

## CRITICAL: GoCardless Bank Account Data API Status

**Finding (HIGH confidence):** GoCardless Bank Account Data API (formerly Nordigen) has **closed new registrations as of mid-2025**. The API itself remains operational for existing customers, but no new accounts can be created.

**Evidence:**
- Multiple community reports (InvoiceNinja, Actual Budget, Firefly III) confirm signup closure
- GoCardless developer portal does not show deprecation notice on docs, but registration is unavailable
- The `nordigen-node` npm package (v1.4.1) is still published but last updated 10+ months ago

**Impact on D-03:** The decision to use GoCardless Bank Account Data API cannot proceed unless Rentular already holds an existing account. If no existing account exists, an alternative Open Banking provider must be selected.

**Recommendation:** Design a `BankAccountDataProvider` interface that abstracts away the specific provider. Implement the transaction matching and reconciliation logic (D-04, D-05, D-06) against this interface. The actual provider (Ponto, Enable Banking, or GoCardless BAD if account exists) becomes a configuration choice. This avoids blocking PAY-01--PAY-10 and keeps the bank monitoring feature provider-agnostic.

## Architecture Patterns

### Recommended Project Structure
```
packages/db/src/schema/
  payments.ts           # EXISTING: payments, paymentReminders, paymentFollowUpSettings
  webhookEvents.ts      # NEW: webhook event idempotency tracking
  bankConnections.ts    # NEW: Open Banking PSD2 connections (provider-agnostic)

apps/api/src/
  lib/
    gocardless.ts       # EXISTING: Payments API client (Direct Debit)
    bankAccountData.ts  # NEW: Bank Account Data provider interface + implementation
  routes/
    payments.ts         # EXISTING: Replace 501 stubs with real implementations
    webhooks.ts         # EXISTING: Add DB persistence to event handlers
    gocardless.ts       # EXISTING: Add DB persistence to mandate/customer handlers
  services/
    paymentStateMachine.ts  # NEW: Payment status transition logic
    transactionMatcher.ts   # NEW: Structured communication matching for bank transfers
    webhookCleanup.ts       # NEW: 12-month retention cleanup job
  jobs/
    paymentCheckWorker.ts   # EXISTING: Fill in the stubbed query+process loop
    landlordReportWorker.ts # EXISTING: Fill in the stubbed report generation loop
```

### Pattern 1: Webhook Idempotency via Event Table
**What:** Every GoCardless webhook event is stored in `webhook_events` before processing. The event ID is checked for duplicates before any state change occurs.
**When to use:** All incoming GoCardless webhooks
**Example:**
```typescript
// In webhooks.ts - processEvent wrapper
async function processEvent(event: GoCardlessEvent): Promise<void> {
  const db = getDb();

  // Check if already processed (idempotency)
  const existing = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.eventId, event.id),
  });
  if (existing) {
    console.log(`[Webhook] Skipping duplicate event ${event.id}`);
    return;
  }

  // Insert event record BEFORE processing
  await db.insert(webhookEvents).values({
    id: crypto.randomUUID(),
    eventId: event.id,
    resourceType: event.resource_type,
    action: event.action,
    resourceId: event.links[event.resource_type] || event.links.payment || event.links.mandate,
    payload: JSON.stringify(event),
    status: "processing",
    receivedAt: new Date(),
  });

  try {
    // Process the event
    await handleEvent(event);

    // Mark as processed
    await db.update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookEvents.eventId, event.id));
  } catch (err) {
    await db.update(webhookEvents)
      .set({ status: "failed", errorMessage: String(err) })
      .where(eq(webhookEvents.eventId, event.id));
    throw err;
  }
}
```

### Pattern 2: Payment State Machine
**What:** Explicit state transitions prevent invalid status changes. Each transition validates the current state before applying.
**When to use:** All payment status updates (webhook-driven and manual)
**Example:**
```typescript
// Valid transitions for each payment status
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:     ["processing", "cancelled"],
  processing:  ["paid", "failed", "cancelled"],
  paid:        ["refunded", "charged_back"],    // charged_back maps to "failed" in our model
  failed:      ["processing", "cancelled"],      // retry -> processing
  cancelled:   [],                                // terminal state
  refunded:    [],                                // terminal state
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionPayment(
  paymentId: string,
  newStatus: PaymentStatus,
  metadata?: { paidDate?: string; gocardlessPaymentId?: string }
): Promise<void> {
  const db = getDb();
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
  });

  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  if (!canTransition(payment.status, newStatus)) {
    throw new Error(`Invalid transition: ${payment.status} -> ${newStatus}`);
  }

  await db.update(payments)
    .set({
      status: newStatus,
      paidDate: metadata?.paidDate || payment.paidDate,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));
}
```

### Pattern 3: GoCardless Webhook -> Internal Status Mapping
**What:** Map GoCardless payment statuses to Rentular's internal status model.
**When to use:** Webhook event processing
```typescript
// GoCardless payment.action -> Rentular PaymentStatus
const GC_PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  "created":                "processing",
  "submitted":              "processing",
  "confirmed":              "paid",
  "paid_out":               "paid",       // Already paid, just payout info
  "failed":                 "failed",
  "cancelled":              "cancelled",
  "charged_back":           "failed",     // Reversal -- treat as failed
  "late_failure_settled":   "failed",     // Late reversal
  "customer_approval_denied": "cancelled",
};

// GoCardless mandate.action -> impact
const GC_MANDATE_STATUS_MAP: Record<string, string> = {
  "active":      "active",
  "cancelled":   "cancelled",
  "failed":      "failed",
  "expired":     "expired",
  "created":     "pending",
  "submitted":   "pending",
  "reinstated":  "active",
};
```

### Pattern 4: Transaction Matching (Bank Account Monitoring)
**What:** Match incoming bank transactions to expected payments using Belgian structured communication.
**When to use:** After polling Open Banking API for new transactions
```typescript
interface IncomingTransaction {
  transactionId: string;
  amount: number;           // positive = credit
  currency: string;
  bookingDate: string;
  remittanceStructured?: string;   // Belgian +++xxx/xxxx/xxxxx+++
  remittanceUnstructured?: string; // Free text
  debtorName?: string;
}

interface MatchResult {
  paymentId: string;
  confidence: "exact" | "partial" | "amount_mismatch" | "unmatched";
  matchedAmount: number;
  expectedAmount: number;
}

function matchTransaction(tx: IncomingTransaction, expectedPayments: Payment[]): MatchResult | null {
  if (!tx.remittanceStructured) return null;

  // Normalize: strip +++ and / characters, compare 12 digits
  const txDigits = tx.remittanceStructured.replace(/[^0-9]/g, "");

  for (const payment of expectedPayments) {
    if (!payment.structuredCommunication) continue;
    const paymentDigits = payment.structuredCommunication.replace(/[^0-9]/g, "");

    if (txDigits === paymentDigits) {
      const expectedAmount = Number(payment.amount);
      if (Math.abs(tx.amount - expectedAmount) < 0.01) {
        return { paymentId: payment.id, confidence: "exact", matchedAmount: tx.amount, expectedAmount };
      }
      return { paymentId: payment.id, confidence: "amount_mismatch", matchedAmount: tx.amount, expectedAmount };
    }
  }
  return null;
}
```

### Anti-Patterns to Avoid
- **Processing webhooks synchronously before responding:** Always return 200 immediately after signature verification; process events asynchronously or within the same request but catch errors individually. GoCardless retries on non-2xx responses, which can cause duplicate processing.
- **Relying on webhook order:** GoCardless does not guarantee event delivery order. A `confirmed` event may arrive before `submitted`. The state machine must handle out-of-order transitions gracefully.
- **Using INSERT for idempotency instead of SELECT-then-INSERT:** A race condition exists if two identical webhooks arrive simultaneously. Use a unique constraint on `event_id` and handle duplicate key errors as "already processed."
- **Storing amounts as floating point:** The existing schema correctly uses `DECIMAL(10,2)`. Continue this pattern for all monetary values.
- **Forgetting ownership checks on payment operations:** All payment queries must filter by `ownerId` via the lease relationship. A landlord must not see or modify another landlord's payments.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Custom HMAC implementation | Existing `verifyWebhookSignature()` in `gocardless.ts` | Already implements constant-time comparison, tested |
| Structured communication validation | Regex-only check | Existing `validateStructuredCommunication()` in `@rentular/shared` | Handles mod-97 check digit validation correctly |
| Structured communication generation | Manual formatting | Existing `generateStructuredCommunication()` in `@rentular/shared` | Handles zero-padding and check digit edge cases |
| UUID generation | uuid package | `crypto.randomUUID()` | Built into Node 20, zero dependencies |
| Payment idempotency on GoCardless | Custom dedup logic | GoCardless `Idempotency-Key` header | Existing `createPayment()` already supports it |
| Cron scheduling | Custom setTimeout loops | BullMQ repeatable jobs | Already used for payment check and landlord report schedules |
| Email queuing | Direct SMTP sending | Existing `queueEmail()` from emailQueueWorker | Rate-limited, retried, logged |

**Key insight:** Most of the infrastructure is already built. Phase 2 is primarily about filling in the database persistence that the stubs are waiting for, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: GoCardless Webhook Replay on Server Restart
**What goes wrong:** If the server restarts while processing a webhook batch, GoCardless may redeliver the same events. Without idempotency, payments get double-updated.
**Why it happens:** GoCardless considers a webhook "delivered" only after receiving a 200 response. Server crash before response = redelivery.
**How to avoid:** The `webhook_events` table with unique constraint on `event_id` prevents double processing. Insert the event record before processing; if the insert fails with duplicate key, skip.
**Warning signs:** Duplicate log entries for the same event ID; payment status flickering between states.

### Pitfall 2: GoCardless Event Ordering
**What goes wrong:** Events arrive out of order -- e.g., `payment.confirmed` before `payment.submitted`. Strict state machine rejects the transition.
**Why it happens:** GoCardless batches events and does not guarantee delivery order. Network delays can reorder events.
**How to avoid:** The state machine should accept any "forward" transition. If `confirmed` arrives and current status is `pending` (we never saw `submitted`), treat it as valid since it's a progression. Map: `pending -> processing -> paid` but also allow `pending -> paid` directly.
**Warning signs:** "Invalid transition" errors in webhook processing logs.

### Pitfall 3: Mandate Cascade Timing
**What goes wrong:** A mandate cancellation webhook arrives, but pending payments for that mandate are mid-processing in GoCardless. Cancelling them in Rentular's DB creates a mismatch.
**Why it happens:** GoCardless processes mandate cancellation and payment cancellation as separate events. The payment cancellation events will follow, but with a delay.
**How to avoid:** When a mandate is cancelled/failed/expired, mark pending payments as `cancelled` in our DB immediately (D-13). If a subsequent `payment.confirmed` webhook arrives for one of those payments, the state machine should handle the transition from `cancelled` back to `paid` -- though this is extremely rare.
**Warning signs:** Payments stuck in `pending` status for cancelled mandates; landlords seeing payments they can't collect on.

### Pitfall 4: Decimal Precision in Amount Comparisons
**What goes wrong:** Comparing `750.00` (from DB as string decimal) with `750` (from API as number) fails due to type mismatch.
**Why it happens:** Drizzle returns MySQL DECIMAL columns as strings. GoCardless API returns amounts in cents (integer). Bank APIs return amounts as numbers.
**How to avoid:** Always convert to numbers with `Number()` before comparison. Use a tolerance of 0.01 EUR for matching. Convert GoCardless amounts from cents: `amount / 100`.
**Warning signs:** Exact-match reconciliation missing obvious matches; payment amounts showing as `"750.00"` instead of `750`.

### Pitfall 5: Missing Ownership Check on Webhook-Created Records
**What goes wrong:** D-12 says auto-create payment records from webhooks when they don't exist in DB. But without an `ownerId`, the payment is orphaned -- no landlord can see it.
**Why it happens:** Webhook payloads contain GoCardless IDs but not Rentular user IDs. The mapping requires looking up the mandate -> lease -> owner chain.
**How to avoid:** When processing a webhook for an unknown payment: (1) look up the mandate from GoCardless links, (2) find the lease with that `gocardlessMandateId`, (3) use the lease's `ownerId`. If no lease found, still store the event in `webhook_events` but flag it as `unresolvable` for manual review.
**Warning signs:** Payments visible in `webhook_events` but not in the landlord's payment list.

### Pitfall 6: 90-Day PSD2 Consent Expiry (Bank Monitoring)
**What goes wrong:** Open Banking connections expire silently. Bank transaction polling stops returning data. Payments appear "missing" from reconciliation.
**Why it happens:** EU PSD2 regulation requires explicit consent renewal every 90 days. The system must track expiry and re-initiate consent before it lapses.
**How to avoid:** Store consent expiry date in `bank_connections` table. Run a daily check. At 7 days and 1 day before expiry, notify the landlord (D-09). Attempt silent renewal first if the provider supports it.
**Warning signs:** Bank polling returns empty transactions for accounts that should have activity; no error but no data.

## Code Examples

### New Schema: webhook_events Table
```typescript
// packages/db/src/schema/webhookEvents.ts
import {
  mysqlTable, varchar, text, timestamp, mysqlEnum, json, index,
} from "drizzle-orm/mysql-core";

export const webhookEvents = mysqlTable("webhook_events", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  // GoCardless event ID -- unique constraint for idempotency
  eventId: varchar("event_id", { length: 255 }).notNull().unique(),
  // Event classification
  resourceType: varchar("resource_type", { length: 50 }).notNull(), // payments, mandates, payouts
  action: varchar("action", { length: 100 }).notNull(),              // confirmed, failed, etc.
  resourceId: varchar("resource_id", { length: 255 }),               // GC payment/mandate ID
  // Full event payload for audit
  payload: json("payload").notNull(),
  // Processing status
  status: mysqlEnum("status", ["pending", "processing", "processed", "failed", "skipped"])
    .default("pending").notNull(),
  errorMessage: text("error_message"),
  // Timestamps
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
}, (table) => ({
  eventIdIdx: index("webhook_events_event_id_idx").on(table.eventId),
  resourceIdx: index("webhook_events_resource_idx").on(table.resourceType, table.resourceId),
  statusIdx: index("webhook_events_status_idx").on(table.status),
  receivedAtIdx: index("webhook_events_received_at_idx").on(table.receivedAt),
}));
```

### New Schema: bank_connections Table (Provider-Agnostic)
```typescript
// packages/db/src/schema/bankConnections.ts
import {
  mysqlTable, varchar, text, timestamp, mysqlEnum, date, index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const bankConnections = mysqlTable("bank_connections", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  // Provider-agnostic fields
  provider: mysqlEnum("provider", ["gocardless_bad", "ponto", "enable_banking"])
    .notNull(),
  // Provider-specific identifiers
  externalRequisitionId: varchar("external_requisition_id", { length: 255 }),
  externalAccountId: varchar("external_account_id", { length: 255 }),
  // Bank info
  institutionId: varchar("institution_id", { length: 255 }).notNull(),
  institutionName: varchar("institution_name", { length: 255 }),
  iban: varchar("iban", { length: 34 }),
  // Status
  status: mysqlEnum("status", ["pending", "active", "expired", "revoked", "error"])
    .default("pending").notNull(),
  // PSD2 consent lifecycle
  consentExpiresAt: timestamp("consent_expires_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncCursor: varchar("last_sync_cursor", { length: 255 }), // Provider-specific pagination cursor
  errorMessage: text("error_message"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("bank_connections_owner_idx").on(table.ownerId),
  statusIdx: index("bank_connections_status_idx").on(table.status),
}));
```

### Webhook Handler: Payment Event with Persistence
```typescript
async function handlePaymentEvent(event: GoCardlessEvent): Promise<void> {
  const db = getDb();
  const gcPaymentId = event.links.payment;
  const internalStatus = GC_PAYMENT_STATUS_MAP[event.action];

  if (!internalStatus) {
    console.log(`[Webhook] No status mapping for payment.${event.action}`);
    return;
  }

  // Find the payment by GoCardless ID
  const payment = await db.query.payments.findFirst({
    where: eq(payments.gocardlessPaymentId, gcPaymentId),
  });

  if (payment) {
    // Update existing payment
    if (canTransition(payment.status, internalStatus)) {
      await db.update(payments).set({
        status: internalStatus,
        paidDate: internalStatus === "paid" ? new Date().toISOString().split("T")[0] : payment.paidDate,
        updatedAt: new Date(),
      }).where(eq(payments.id, payment.id));
      console.log(`[Webhook] Payment ${payment.id} -> ${internalStatus}`);
    }
  } else {
    // D-12: Unknown payment -- auto-create if we can resolve the mandate
    console.log(`[Webhook] Unknown payment ${gcPaymentId}, attempting auto-create`);
    // Look up mandate from GC, find lease, create payment record marked for review
  }
}
```

### Payment Overview Aggregation Query
```typescript
// GET /payments/overview endpoint
async function getPaymentOverview(ownerId: string, options: OverviewOptions) {
  const db = getDb();

  // Base query: all payments for this owner's leases
  const ownerPayments = await db
    .select({
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      leaseId: payments.leaseId,
      latePaymentFee: payments.latePaymentFee,
      interestCharged: payments.interestCharged,
    })
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(
      and(
        eq(leases.ownerId, ownerId),
        // Date range filter
        gte(payments.dueDate, options.from),
        lte(payments.dueDate, options.to),
        // Optional property/lease filter
        options.propertyId ? eq(leases.propertyId, options.propertyId) : undefined,
        options.leaseId ? eq(payments.leaseId, options.leaseId) : undefined,
      )
    );

  // Aggregate
  const summary = {
    totalExpected: ownerPayments.reduce((sum, p) => sum + Number(p.amount), 0),
    totalCollected: ownerPayments.filter(p => p.status === "paid").reduce((sum, p) => sum + Number(p.amount), 0),
    totalOverdue: ownerPayments.filter(p => p.status === "pending" || p.status === "failed").reduce((sum, p) => sum + Number(p.amount), 0),
    totalFees: ownerPayments.reduce((sum, p) => sum + Number(p.latePaymentFee || 0), 0),
    totalInterest: ownerPayments.reduce((sum, p) => sum + Number(p.interestCharged || 0), 0),
    countByStatus: {
      paid: ownerPayments.filter(p => p.status === "paid").length,
      pending: ownerPayments.filter(p => p.status === "pending").length,
      processing: ownerPayments.filter(p => p.status === "processing").length,
      failed: ownerPayments.filter(p => p.status === "failed").length,
      cancelled: ownerPayments.filter(p => p.status === "cancelled").length,
    },
  };

  return options.detail ? { summary, payments: ownerPayments } : { summary };
}
```

## GoCardless Payment Lifecycle Reference

### Payment Status Flow (GoCardless)
```
pending_submission -> submitted -> confirmed -> paid_out
                  \-> cancelled   \-> failed
                                  \-> charged_back -> late_failure_settled
                                  \-> customer_approval_denied
```

### Mapping to Rentular Internal Status
| GoCardless Status | Webhook Action | Rentular Status | Notes |
|---|---|---|---|
| pending_submission | created | processing | Payment created, awaiting submission |
| submitted | submitted | processing | Sent to bank |
| confirmed | confirmed | paid | Successfully collected |
| paid_out | paid_out | paid | Funds transferred to landlord (info only) |
| failed | failed | failed | Collection failed (insufficient funds, etc.) |
| cancelled | cancelled | cancelled | Cancelled before collection |
| charged_back | charged_back | failed | Customer reversed payment |
| late_failure_settled | late_failure_settled | failed | Bank reported late failure |

### Mandate Status Flow (GoCardless)
```
created -> submitted -> active
                     \-> failed
       \-> cancelled
active -> cancelled / failed / expired
```

### Mandate Cascade (D-13)
When mandate status becomes cancelled/failed/expired:
1. Update the lease's `gocardlessMandateId` status (or clear it)
2. Find all payments with `status = 'pending'` or `status = 'processing'` for that mandate's lease
3. Set those payments to `status = 'cancelled'`
4. Flag the lease for landlord attention

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GoCardless Bank Account Data (Nordigen) free API | Registrations closed mid-2025 | 2025 | Must use alternative Open Banking provider for new accounts |
| gocardless-nodejs v4.x | Latest is v8.1.0 on npm | Recent | Project uses ^4.2.0; upgrading optional but not required for Phase 2 functionality |
| Polling-only bank data | Webhooks + polling hybrid | Standard | Direct Debit uses webhooks; bank monitoring uses polling -- different patterns |

**Deprecated/outdated:**
- GoCardless Bank Account Data API new registrations: Closed as of mid-2025. Existing accounts still functional.
- `nordigen-node` v1.4.1: Last updated 10+ months ago. Functional but no active development visible.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test config, no test files in project |
| Config file | none -- see Wave 0 |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | List payments with status filter | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-02 | Payment detail with GC reference | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-03 | Manual payment recording | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-04 | Trigger SEPA collection | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-05 | Retry failed payment | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-06 | Cancel pending payment | integration | `npx vitest run tests/payments.test.ts` | Wave 0 |
| PAY-07 | Webhook persists payment status | unit | `npx vitest run tests/webhooks.test.ts` | Wave 0 |
| PAY-08 | Webhook persists mandate status | unit | `npx vitest run tests/webhooks.test.ts` | Wave 0 |
| PAY-09 | Webhook idempotency | unit | `npx vitest run tests/webhooks.test.ts` | Wave 0 |
| PAY-10 | Payment overview report | integration | `npx vitest run tests/paymentOverview.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** Full suite
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest` -- framework not installed; needs `pnpm add -D vitest` in api package
- [ ] `vitest.config.ts` -- test configuration file
- [ ] `tests/webhooks.test.ts` -- covers PAY-07, PAY-08, PAY-09 (unit tests for state machine + idempotency)
- [ ] `tests/payments.test.ts` -- covers PAY-01 through PAY-06 (integration tests, may need DB mock)
- [ ] `tests/paymentOverview.test.ts` -- covers PAY-10

## Open Questions

1. **Does Rentular have an existing GoCardless Bank Account Data account?**
   - What we know: The `.env.example` shows `GOCARDLESS_ACCESS_TOKEN` and `GOCARDLESS_ENVIRONMENT` but these are for the Payments API. Bank Account Data uses separate credentials (`SECRET_ID` and `SECRET_KEY`).
   - What's unclear: Whether the project holder already has a Nordigen/GoCardless BAD account from before the registration closure.
   - Recommendation: Ask the user. If YES, proceed with `nordigen-node`. If NO, implement the provider-agnostic interface and defer provider selection (Ponto or Enable Banking are the strongest alternatives for Belgium).

2. **gocardless-nodejs version: stay on 4.x or upgrade to 8.x?**
   - What we know: Project uses ^4.2.0. Latest on npm is 8.1.0. The existing client works.
   - What's unclear: Whether 8.x has breaking changes that affect the existing wrapper.
   - Recommendation: Stay on 4.x for Phase 2. The existing wrapper abstracts all GoCardless calls; upgrading is a separate task that can be done after Phase 2 if needed.

3. **Drizzle migration strategy: push vs generate-then-migrate?**
   - What we know: `drizzle-kit` is installed, `drizzle.config.ts` exists, but `packages/db/drizzle/` directory is empty (no migration files).
   - What's unclear: Whether the project uses `drizzle-kit push` (direct schema push) or `drizzle-kit generate` + `drizzle-kit migrate` (migration file workflow).
   - Recommendation: Use `drizzle-kit push` for development and generate migration files for production deployment. The schema changes for Phase 2 (new tables, no altering existing columns) are safe for push.

## Sources

### Primary (HIGH confidence)
- GoCardless Payments API reference: [developer.gocardless.com/api-reference](https://developer.gocardless.com/api-reference/)
- GoCardless payment statuses: [support.gocardless.com/hc/en-us/articles/213146225](https://support.gocardless.com/hc/en-us/articles/213146225-Overview-of-payment-statuses)
- GoCardless mandate events: [developer.gocardless.com/mandates/responding-to-mandate-events](https://developer.gocardless.com/mandates/responding-to-mandate-events/)
- GoCardless Bank Account Data overview: [developer.gocardless.com/bank-account-data/overview](https://developer.gocardless.com/bank-account-data/overview)
- GoCardless Bank Account Data quickstart: [developer.gocardless.com/bank-account-data/quick-start-guide](https://developer.gocardless.com/bank-account-data/quick-start-guide/)
- GoCardless Bank Account Data transactions: [developer.gocardless.com/bank-account-data/transactions](https://developer.gocardless.com/bank-account-data/transactions)
- Belgian structured communication standard: [Febelfin OGM-VCS specification](https://www.europeanpaymentscouncil.eu/sites/default/files/inline-files/Febelfin%20-%20AOS-OGMVCS_0.pdf)
- npm registry: `gocardless-nodejs` v8.1.0, `nordigen-node` v1.4.1

### Secondary (MEDIUM confidence)
- GoCardless BAD registration closure: [InvoiceNinja forum thread](https://forum.invoiceninja.com/t/gocardless-nordigen-service-no-longer-available-alternative-needed/22576) + [Actual Budget docs](https://actualbudget.org/docs/advanced/bank-sync/gocardless/)
- Ponto/Ibanity Open Banking: [myponto.com](https://myponto.com/en/) + [documentation.ibanity.com/ponto-connect](https://documentation.ibanity.com/ponto-connect)
- Enable Banking as alternative: Community mentions in InvoiceNinja forum

### Tertiary (LOW confidence)
- Enable Banking free tier availability for Belgium -- needs direct verification
- Exact Ponto pricing for SaaS integrators -- not found in public documentation

## Metadata

**Confidence breakdown:**
- Standard stack (Direct Debit + webhooks): HIGH -- all libraries installed, patterns established, GoCardless Payments API well-documented
- Standard stack (Bank Account Monitoring): LOW -- GoCardless BAD closed to new signups, alternative provider not yet selected
- Architecture (webhook idempotency): HIGH -- well-established pattern, Drizzle schema design straightforward
- Architecture (transaction matching): HIGH -- Belgian structured communication format is standardized, validation utilities exist in shared package
- Architecture (bank monitoring provider): MEDIUM -- provider-agnostic interface design is solid, but actual provider integration details depend on selection
- Pitfalls: HIGH -- GoCardless webhook behavior well-documented, out-of-order events are a known issue
- Payment state machine: HIGH -- GoCardless payment lifecycle fully documented, mapping to internal statuses is clear

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days -- stable domain, GoCardless API is mature)
