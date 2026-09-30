# Architecture Research

**Domain:** Belgian rental property management platform -- integration of missing components
**Researched:** 2026-03-22
**Confidence:** HIGH

## System Overview

The existing Rentular monorepo has solid foundations: Next.js frontend, Hono REST API, Drizzle ORM on MySQL, BullMQ job queues via Redis. Five missing subsystems need to integrate: payment processing with GoCardless webhook state persistence, Belgian health index integration, property manager RBAC, Smovin data import, and guided onboarding. All five fit cleanly into the existing architecture without requiring new infrastructure.

```
                              EXISTING                              NEW INTEGRATION POINTS
                           ============                          ==========================

  ┌──────────────────────────────────────────────────────────────────────────────────────────┐
  │                               Frontend (apps/web - Next.js 15)                           │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐  │
  │  │Dashboard │ │Property  │ │Lease     │ │* Onboarding  │ │Payments  │ │* Smovin      │  │
  │  │Layout    │ │CRUD      │ │CRUD      │ │  Wizard      │ │Views     │ │  Import UI   │  │
  │  └─────┬────┘ └─────┬────┘ └────┬─────┘ └──────┬───────┘ └─────┬────┘ └──────┬───────┘  │
  │        │            │           │               │               │             │          │
  ├────────┴────────────┴───────────┴───────────────┴───────────────┴─────────────┴──────────┤
  │                    Auth: NextAuth.js JWT cookie on every request                          │
  └──────────────────────────────────────┬───────────────────────────────────────────────────┘
                                         │ HTTP (cookie-based auth)
  ┌──────────────────────────────────────┴───────────────────────────────────────────────────┐
  │                             API (apps/api - Hono on port 4000)                           │
  │                                                                                          │
  │  Middleware Chain: logger -> cors -> authMiddleware -> requireAuth -> * RBAC guard        │
  │                                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ Route Handlers (existing + new)                                                     │ │
  │  │                                                                                     │ │
  │  │  EXISTING:        properties, tenants, leases, bankAccounts, settings, gocardless   │ │
  │  │                                                                                     │ │
  │  │  * TO IMPLEMENT:  payments (CRUD + collect/retry/cancel)                            │ │
  │  │                   webhooks/gocardless (persist state, idempotency)                   │ │
  │  │                   indexation (Statbel fetch, calculate, apply)                       │ │
  │  │                   propertyManagers (invite, accept, RBAC enforcement)                │ │
  │  │                   import/smovin (credential-based scrape + mapping)                  │ │
  │  │                   onboarding (wizard state tracking)                                 │ │
  │  └──────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                                                                          │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ Services Layer (apps/api/src/services/)                                            │   │
  │  │                                                                                    │   │
  │  │  EXISTING:  paymentFollowUp.ts, landlordReport.ts                                  │   │
  │  │  * NEW:     paymentService.ts, indexationService.ts, rbacService.ts,               │   │
  │  │             smovinImporter.ts, webhookProcessor.ts                                  │   │
  │  └────────────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                          │
  │  ┌──────────────────────────────────────────────────────────┐                            │
  │  │ Background Jobs (BullMQ via Redis)                       │                            │
  │  │                                                          │                            │
  │  │  EXISTING:  emailQueueWorker, smsQueueWorker,           │                            │
  │  │             paymentCheckWorker, landlordReportWorker     │                            │
  │  │  * NEW:     webhookProcessorWorker (async event handling)│                            │
  │  │             smovinImportWorker (long-running scrape)     │                            │
  │  │             indexFetchWorker (monthly Statbel fetch)     │                            │
  │  └──────────────────────────────────────────────────────────┘                            │
  └──────────────┬──────────────────────┬────────────────────────────────────────────────────┘
                 │                      │
     ┌───────────┴──────────┐  ┌────────┴────────┐
     │  MySQL (Drizzle ORM) │  │  Redis (BullMQ)  │
     │  packages/db         │  │  Job queues +    │
     │                      │  │  rate limiting    │
     └──────────────────────┘  └──────────────────┘

  External Services:
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ GoCardless   │  │ Statbel      │  │ Smovin.app   │  │ SMTP / SMS   │
  │ (payments +  │  │ (health      │  │ (scrape user │  │ (email +     │
  │  webhooks)   │  │  index data) │  │  account)    │  │  SMS queues) │
  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### Component Responsibilities

| Component | Responsibility | Talks To |
|-----------|----------------|----------|
| **Webhook Handler** (route) | Verify signature, parse events, return 200 fast, enqueue for async processing | Redis queue, webhook_events table |
| **Webhook Processor** (worker) | Dequeue events, check idempotency, update payment/mandate state in DB, trigger notifications | MySQL, email/SMS queues |
| **Payment Service** | Create/list/update payments, trigger GoCardless collections, reconcile with webhook data | GoCardless API, MySQL, BullMQ |
| **Indexation Service** | Fetch Statbel health index, cache in DB, calculate indexed rents per region/EPC rules | Statbel API, MySQL |
| **RBAC Guard** (middleware) | Check property-level permissions before route handlers execute | MySQL (propertyManagers table) |
| **Smovin Importer** (worker) | Authenticate to Smovin, scrape properties/tenants/leases, map to Rentular schema, insert | Smovin.app (HTTP), MySQL |
| **Onboarding Wizard** | Track wizard step completion per user, guide through property -> tenant -> lease -> payment setup | MySQL (user metadata), frontend state |

## Recommended Project Structure

Current structure is sound. New components fit within existing folders. No restructuring needed.

```
apps/api/src/
├── routes/                     # HTTP route handlers (thin, delegate to services)
│   ├── payments.ts             # IMPLEMENT: wire to paymentService
│   ├── webhooks.ts             # IMPLEMENT: verify + enqueue (keep thin)
│   ├── indexation.ts           # IMPLEMENT: wire to indexationService
│   ├── propertyManagers.ts     # IMPLEMENT: wire to rbacService
│   ├── import.ts               # NEW: Smovin import trigger endpoint
│   └── onboarding.ts           # NEW: wizard state endpoints
├── services/                   # Business logic (testable, no HTTP concerns)
│   ├── paymentService.ts       # NEW: payment CRUD + GoCardless collection
│   ├── webhookProcessor.ts     # NEW: event state machine + idempotency
│   ├── indexationService.ts    # NEW: Statbel fetch + rent calculation
│   ├── rbacService.ts          # NEW: permission checks + invitation logic
│   ├── smovinImporter.ts       # NEW: scrape + map + insert
│   ├── paymentFollowUp.ts      # EXISTS: reminder escalation
│   └── landlordReport.ts       # EXISTS: payment overview emails
├── jobs/                       # BullMQ queue definitions + workers
│   ├── webhookProcessorWorker.ts  # NEW: async webhook event processing
│   ├── smovinImportWorker.ts      # NEW: long-running import job
│   ├── indexFetchWorker.ts        # NEW: monthly health index fetch
│   ├── emailQueueWorker.ts        # EXISTS
│   ├── smsQueueWorker.ts          # EXISTS
│   ├── paymentCheckWorker.ts      # EXISTS (needs DB queries implemented)
│   └── landlordReportWorker.ts    # EXISTS (needs DB queries implemented)
├── lib/                        # Utilities and middleware
│   ├── gocardless.ts           # EXISTS: GoCardless client
│   ├── authMiddleware.ts       # EXISTS: JWT extraction
│   ├── routeAuth.ts            # EXISTS: requireAuth
│   ├── rbacMiddleware.ts       # NEW: property-level permission guard
│   └── statbel.ts              # NEW: Statbel API client
└── types/                      # TypeScript type definitions
    └── index.ts                # EXISTS

packages/db/src/schema/
├── payments.ts                 # EXISTS: payments, paymentReminders, paymentFollowUpSettings
├── indexation.ts               # EXISTS: healthIndexValues, indexationRecords
├── propertyManagers.ts         # EXISTS: propertyManagers with roles
├── communications.ts           # EXISTS: communications log
├── webhookEvents.ts            # NEW: idempotency tracking for GoCardless events
├── smovinImports.ts            # NEW: import job tracking
└── ... (existing schemas)
```

### Structure Rationale

- **Routes stay thin:** Route handlers validate input and delegate to services. No business logic in routes. This is partially violated today (e.g., indexation.ts has EPC calculation logic inline) -- refactor into services during implementation.
- **Services are the core:** All business logic lives in `services/`. Services are testable in isolation without HTTP context. Services call the DB directly using Drizzle.
- **Jobs handle async work:** Anything that takes more than 200ms or should survive server restarts goes through BullMQ. Webhook processing, Smovin import, and index fetching all qualify.
- **New schema files for new tables:** `webhookEvents.ts` and `smovinImports.ts` need their own schema files, following the existing convention in `packages/db/src/schema/`.

## Architectural Patterns

### Pattern 1: Webhook Verify-Enqueue-ACK

**What:** The webhook endpoint verifies the GoCardless signature, stores the raw event in a `webhook_events` table with `status: 'pending'`, enqueues a BullMQ job referencing the event ID, and returns HTTP 200 immediately. The async worker picks up the job, checks idempotency (has this `gc_event_id` been processed?), performs the state transition, and marks the event as `processed`.

**When to use:** All GoCardless webhook events. This pattern prevents timeouts and ensures at-least-once processing even if the server crashes mid-processing.

**Trade-offs:** Adds slight complexity (extra table, extra worker) but eliminates the two biggest webhook risks: timeout-induced retries and lost events during crashes.

**Example:**

```typescript
// routes/webhooks.ts - Keep this THIN
webhooksRouter.post("/gocardless", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("Webhook-Signature");

  if (!verifyWebhookSignature(body, signature, webhookSecret)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload: GoCardlessWebhookPayload = JSON.parse(body);

  // Store raw events and enqueue for async processing
  for (const event of payload.events) {
    const eventId = crypto.randomUUID();
    await db.insert(webhookEvents).values({
      id: eventId,
      gcEventId: event.id,
      resourceType: event.resource_type,
      action: event.action,
      payload: JSON.stringify(event),
      status: "pending",
    });
    await webhookQueue.add("process-event", { eventId });
  }

  return c.json({ status: "received" }); // 200 fast
});

// jobs/webhookProcessorWorker.ts - Does the real work
const worker = new Worker("webhook-events", async (job) => {
  const { eventId } = job.data;
  const event = await db.select().from(webhookEvents)
    .where(eq(webhookEvents.id, eventId)).limit(1);

  if (!event[0] || event[0].status === "processed") return; // Idempotent

  const gcEvent = JSON.parse(event[0].payload);
  await processWebhookEvent(gcEvent); // State transitions in paymentService

  await db.update(webhookEvents)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(webhookEvents.id, eventId));
});
```

### Pattern 2: RBAC as Middleware, Not Inline Checks

**What:** Replace the current `ownerId` checks scattered across route handlers with a centralized RBAC middleware that resolves the user's permission level for the requested resource before the handler executes. The middleware attaches `permissionLevel` to the Hono context.

**When to use:** All property-scoped routes (properties, leases, payments, tenants, indexation, costs).

**Trade-offs:** Requires extracting the `propertyId` from different request locations (path param, query param, or via leaseId lookup). Moderate refactoring of existing routes. Worth it because the current `ownerId`-only check will break once property managers exist.

**Example:**

```typescript
// lib/rbacMiddleware.ts
export function requirePropertyAccess(minRole: PropertyRole) {
  return createMiddleware(async (c, next) => {
    const userId = getRequiredUserId(c);
    const propertyId = await resolvePropertyId(c); // From param, query, or via lease

    const access = await getPropertyAccess(userId, propertyId);
    // access is: "owner" | "co_owner" | "manager" | "accountant" | "viewer" | null

    if (!access || !hasMinimumRole(access, minRole)) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    c.set("propertyAccess", access);
    c.set("resolvedPropertyId", propertyId);
    await next();
  });
}

// Usage in routes:
paymentsRouter.post("/collect", requirePropertyAccess("manager"), async (c) => {
  // Handler knows the user has at least "manager" role
});
```

### Pattern 3: Service Layer for Business Logic

**What:** Extract all business logic from route handlers into service modules. Routes handle HTTP (parse request, call service, format response). Services handle business rules (validation, state transitions, external API calls, DB mutations).

**When to use:** Every new feature. Retrofit existing routes during implementation.

**Trade-offs:** Adds files but dramatically improves testability. Services can be unit tested without spinning up Hono.

**Example:**

```typescript
// services/paymentService.ts
export async function collectPayment(params: {
  leaseId: string;
  amount?: number;
  chargeDate?: string;
  userId: string;
}): Promise<{ paymentId: string; gcPaymentId: string; chargeDate: string }> {
  const lease = await getLeaseWithMandate(params.leaseId);
  if (!lease.gocardlessMandateId) {
    throw new AppError("No active mandate for this lease", 400);
  }

  const amount = params.amount ?? calculateTotalRent(lease);
  const idempotencyKey = `payment-${params.leaseId}-${new Date().toISOString().slice(0, 7)}`;

  // Create local payment record first
  const paymentId = crypto.randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    leaseId: params.leaseId,
    amount: amount.toString(),
    dueDate: calculateDueDate(lease),
    method: "gocardless",
    status: "processing",
  });

  // Then trigger GoCardless collection
  const result = await createPayment({
    mandateId: lease.gocardlessMandateId,
    amount,
    description: `Rent for ${lease.propertyName}`,
    chargeDate: params.chargeDate,
    idempotencyKey,
    metadata: { payment_id: paymentId, lease_id: params.leaseId },
  });

  // Link GoCardless payment ID back to our record
  await db.update(payments)
    .set({ gocardlessPaymentId: result.paymentId })
    .where(eq(payments.id, paymentId));

  return { paymentId, gcPaymentId: result.paymentId, chargeDate: result.chargeDate };
}
```

## Data Flow

### Payment Collection Flow (GoCardless)

```
Landlord clicks "Collect Rent"
    |
    v
Frontend POST /api/v1/payments/collect { leaseId, amount? }
    |
    v
payments route -> paymentService.collectPayment()
    |
    +---> Insert payment record (status: "processing") into MySQL
    |
    +---> GoCardless API: payments.create() with idempotency key
    |
    +---> Update payment record with gocardlessPaymentId
    |
    v
Return { paymentId, chargeDate } to frontend

... Days later (async) ...

GoCardless POST /api/v1/webhooks/gocardless
    |
    v
Verify HMAC signature -> Store raw event -> Enqueue BullMQ job -> Return 200
    |
    v (async worker)
webhookProcessor: check idempotency (gcEventId already processed?)
    |
    +---> "confirmed": UPDATE payments SET status='paid', paidDate=today
    |                  -> Log communication
    |
    +---> "failed": UPDATE payments SET status='failed'
    |               -> Queue landlord notification email
    |               -> Trigger payment follow-up escalation
    |
    +---> "late_failure_settled": UPDATE payments SET status='failed', paidDate=null
    |                            -> Queue landlord notification (chargeback)
    |
    +---> "cancelled": UPDATE payments SET status='cancelled'
    |
    v
Mark webhook_event as processed
```

### Health Index Fetch + Rent Indexation Flow

```
Monthly cron (indexFetchWorker)
    |
    v
Fetch Statbel be.STAT API: /bestat/api/views/{viewId}/result/JSON
    |
    v
Parse response -> Extract health index value for current month
    |
    v
UPSERT into healthIndexValues table (year + month as natural key)
    |
    v
Done (index data cached in DB)

... Landlord views indexation page or anniversary approaches ...

Frontend GET /api/v1/indexation/calculate/:leaseId
    |
    v
indexationService.calculateIndexation(leaseId)
    |
    +---> Load lease (baseRent, startDate, region, indexationBaseMonth, indexationBaseIndex)
    +---> Load property (epcLabel for Brussels/Flanders restrictions)
    +---> Load healthIndexValues for base month and current month
    |
    +---> Apply standard formula: newRent = baseRent * (currentIndex / baseIndex)
    +---> Apply regional EPC restrictions (Brussels permanent, Flanders correction)
    |
    v
Return { baseRent, newRent, difference, epcRestrictions, effectiveDate }

... Landlord approves and sends notification ...

Frontend POST /api/v1/indexation/apply/:leaseId
    |
    v
indexationService.applyIndexation()
    +---> Verify newRent <= calculated indexed rent
    +---> UPDATE leases SET currentMonthlyRent, lastIndexationDate
    +---> INSERT indexationRecords
    +---> Queue notification email to tenant (via emailQueue)
    +---> INSERT communications log entry
```

### Smovin Import Flow

```
User enters Smovin credentials in Import UI
    |
    v
Frontend POST /api/v1/import/smovin { email, password }
    |
    v
API validates credentials are present, creates import job record
    +---> INSERT smovin_imports { id, userId, status: 'pending' }
    +---> Enqueue BullMQ job: smovinImportWorker
    |
    v
Return { importId } -- frontend polls for status

... Background worker (may take 30-120 seconds) ...

smovinImportWorker:
    +---> Authenticate to smovin.app (HTTP session, cookies)
    +---> Scrape properties list page
    +---> For each property: scrape detail page
    +---> Scrape tenants/contacts
    +---> Scrape lease data
    +---> Scrape payment history
    |
    +---> Map Smovin data model to Rentular schema
    |     (property types, lease types, address format, etc.)
    |
    +---> INSERT properties, tenants, leaseTenants, leases, payments
    |     (within a transaction, skip duplicates by address match)
    |
    +---> UPDATE smovin_imports SET status='completed', summary={counts}
    |
    v
Frontend polls GET /api/v1/import/smovin/:importId -> sees "completed"
```

### RBAC Authorization Flow

```
Any authenticated request to a property-scoped resource
    |
    v
authMiddleware: extract userId from JWT cookie
    |
    v
requireAuth: reject if no userId
    |
    v
rbacMiddleware (requirePropertyAccess):
    +---> Resolve propertyId from request (param, query, or via leaseId)
    +---> Query: is userId the owner? (properties.ownerId = userId)
    |     YES -> access = "owner", continue
    |
    +---> Query: propertyManagers WHERE userId AND propertyId AND acceptedAt IS NOT NULL
    |     FOUND -> access = role from record, check against minRole
    |     NOT FOUND -> 403 Forbidden
    |
    v
Route handler executes with c.get("propertyAccess") available
```

### Key Data Flows Summary

1. **Payment lifecycle:** Landlord triggers collection -> local record created -> GoCardless API called -> webhook updates status async -> follow-up escalation on failures
2. **Health index:** Monthly cron fetches from Statbel -> cached in DB -> used on-demand for indexation calculations -> landlord approves -> lease rent updated
3. **Property access:** Every property-scoped request checks ownership OR propertyManagers table -> role determines allowed operations
4. **Import:** User provides credentials -> background job scrapes -> data mapped and inserted -> user sees imported data

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-500 landlords (launch) | Current architecture is sufficient. Single API process, single Redis, single MySQL. Focus on correctness, not performance. |
| 500-5,000 landlords | Add database indexes on hot paths: `payments(lease_id, status)`, `payments(gocardless_payment_id)`, `properties(owner_id)`, `propertyManagers(user_id)`, `healthIndexValues(year, month)`. Consider connection pool sizing. |
| 5,000+ landlords | Move webhook processing to dedicated worker process (separate from API). Consider read replicas for reporting queries. Payment check cron may need sharding by owner batch. |

### Scaling Priorities

1. **First bottleneck:** Database queries without indexes. The payment check worker queries ALL overdue payments 3x/day. At 5,000 landlords with ~20 leases each, that is 100,000 payment records to scan. Index on `(status, due_date, is_ignored)` is critical.
2. **Second bottleneck:** Email queue throughput. Current rate limit is 30/min. At scale, payment reminders for 1,000 overdue payments would take 33 minutes. Increase rate limit or switch to batch-capable email provider (e.g., Postmark, SendGrid).

## Anti-Patterns

### Anti-Pattern 1: Processing Webhooks Synchronously in the HTTP Handler

**What people do:** Parse the GoCardless webhook, run database updates, send notification emails, and then return 200.
**Why it's wrong:** GoCardless has a timeout on webhook delivery. If your processing takes too long, GoCardless marks the delivery as failed and retries, causing duplicate processing. If your server crashes mid-processing, the event is lost (GoCardless got no response, it will retry, but your partial DB state is now inconsistent).
**Do this instead:** Verify signature, store raw event, enqueue for async processing, return 200 immediately. The worker handles the actual processing with idempotency checks.

### Anti-Pattern 2: In-Memory Store Fallbacks in Production

**What people do:** The current codebase has `try { db } catch { memoryStore }` patterns in route handlers. This means a transient database error silently falls back to an empty in-memory store, returning empty results instead of errors.
**Why it's wrong:** Users see empty data and think their properties/tenants disappeared. The in-memory store loses data on restart. It masks database connectivity issues that should be detected and fixed.
**Do this instead:** Remove all in-memory fallbacks. If the database is unavailable, return 503 Service Unavailable. Fail fast so the issue surfaces immediately.

### Anti-Pattern 3: Checking Only ownerId for Authorization

**What people do:** Every route currently does `WHERE ownerId = userId`. This works for single-owner properties but breaks entirely when property managers exist.
**Why it's wrong:** A property manager with "manager" role would see zero properties because they are not the owner. Conversely, there is no way to restrict a co-owner from deleting the property.
**Do this instead:** Use the RBAC middleware pattern. Resolve property access through both the `properties.ownerId` check AND the `propertyManagers` table. Replace all inline `ownerId` checks.

### Anti-Pattern 4: Stateless Webhook Events

**What people do:** Process webhook events without recording which events have been handled.
**Why it's wrong:** GoCardless sends webhooks at-least-once. Without an idempotency check, a "payment confirmed" event processed twice could double-update state or send duplicate notifications.
**Do this instead:** Store every GoCardless event ID in a `webhook_events` table. Before processing, check if `gc_event_id` already exists with status `processed`. Skip if so.

## Integration Points

### External Services

| Service | Integration Pattern | Endpoint / Notes |
|---------|---------------------|------------------|
| **GoCardless** (payments) | REST API via `gocardless-nodejs` SDK v4.8.2 | Singleton client in `lib/gocardless.ts`. Use idempotency keys for payment creation. Sandbox available for testing. |
| **GoCardless** (webhooks) | Inbound POST to `/api/v1/webhooks/gocardless` | HMAC-SHA256 signature verification. Events are `at-least-once`. Must handle duplicates. Current handler exists but does not persist state. |
| **Statbel** (health index) | HTTP GET to be.STAT API | `https://bestat.statbel.fgov.be/bestat/api/views/{viewId}/result/JSON` -- Returns health index values. Available in JSON, CSV, XML. No auth required. View ID: `208b69bd-05c5-4947-b7f9-2d2300f517b8`. Fetch monthly via cron, cache in `healthIndexValues` table. |
| **Smovin** (import) | HTTP scraping with session cookies | No official API confirmed. Scrape user's own account after they provide credentials. Session-based auth. Pages to scrape: property list, property details, tenant list, lease details, payment history. Run as background job (30-120s). Credentials NOT stored -- used once for the import job then discarded. |
| **SMTP** (email) | Direct SMTP via `sendEmail()` in `lib/email.ts` | Rate-limited through BullMQ (30/min default). Domain-specific SMTP config needed for production deliverability. |
| **SMS Provider** | Via `queueSms()` in `smsQueueWorker.ts` | Provider configurable (Twilio/MessageBird/OVH). Rate-limited (10/min default). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Route -> Service** | Direct function call | Routes import service functions. Services return typed results or throw `AppError`. |
| **Route -> BullMQ** | Queue job via `queue.add()` | For async work: webhook processing, import jobs, scheduled tasks. |
| **Service -> Database** | Drizzle ORM queries | Services import `getDb()` and schema from `@rentular/db`. All DB access goes through Drizzle. |
| **Service -> GoCardless** | Via `lib/gocardless.ts` functions | Thin wrapper around SDK. Services never import the SDK directly. |
| **Service -> Notifications** | Via `queueEmail()` / `queueSms()` | Services never send emails directly. Always enqueue through BullMQ. |
| **Webhook -> Worker** | BullMQ job queue | Webhook handler enqueues event ID. Worker fetches event from DB and processes. Decoupled. |
| **Frontend -> API** | HTTP REST with cookie auth | All API calls include the NextAuth session cookie. API validates JWT on every request. |

### New Database Tables Needed

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `webhook_events` | Idempotency tracking for GoCardless webhook events | `id`, `gc_event_id` (unique), `resource_type`, `action`, `payload` (JSON), `status` (pending/processed/failed), `processed_at` |
| `smovin_imports` | Track import job state and results | `id`, `user_id`, `status` (pending/running/completed/failed), `properties_imported`, `tenants_imported`, `leases_imported`, `error_message`, `started_at`, `completed_at` |
| `onboarding_progress` | Track wizard completion per user (optional -- could use user metadata JSON column instead) | `user_id`, `step` (property/tenant/lease/payment), `completed_at` |

### New Database Indexes Needed

| Table | Index | Purpose |
|-------|-------|---------|
| `payments` | `(lease_id, status)` | Fast lookup of overdue payments per lease |
| `payments` | `(gocardless_payment_id)` | Webhook event -> payment record lookup |
| `properties` | `(owner_id, is_archived)` | Property listing for owner |
| `property_managers` | `(user_id, accepted_at)` | Property listing for managers |
| `health_index_values` | `(year, month)` UNIQUE | Prevent duplicate index entries, fast lookup |
| `webhook_events` | `(gc_event_id)` UNIQUE | Idempotency check |
| `indexation_records` | `(lease_id, effective_date)` | History lookup per lease |

## Suggested Build Order

The dependencies between components dictate build order. Payment webhook processing depends on the payments table being populated. RBAC depends on the propertyManagers table already having the schema (which it does). Indexation is independent. Import is independent.

### Build Order with Dependencies

```
Phase 1: Payment Foundation
  payments route implementation (CRUD + collect)
  paymentService.ts
  webhook state persistence + idempotency table
  webhookProcessorWorker
  Remove in-memory fallbacks (fail fast)
  Database indexes for payments

  WHY FIRST: Everything else (follow-up, reports, dashboard) depends on
  payments being persisted. The payment check worker and landlord report
  worker already exist but have no data to process. Webhooks currently
  log but don't persist -- this is the #1 gap.

Phase 2: RBAC + Property Manager Flow
  rbacMiddleware.ts (centralized permission guard)
  rbacService.ts (invitation, acceptance, permission resolution)
  propertyManagers route implementation
  Refactor existing routes to use RBAC middleware instead of ownerId checks

  WHY SECOND: Must happen before adding more features because every
  new route needs the RBAC pattern. Retrofitting later is harder than
  building it in now. Also unblocks the property manager dashboard.

Phase 3: Health Index + Rent Indexation
  statbel.ts (Statbel API client)
  indexFetchWorker (monthly cron)
  indexationService.ts (calculation + application)
  indexation route implementation (calculate, preview, apply)

  WHY THIRD: Independent of payments and RBAC. The indexation schema
  and route stubs already exist. Mostly about wiring the Statbel API
  and implementing the already-designed calculation logic.

Phase 4: Notifications + Follow-Up Wiring
  Wire paymentCheckWorker to actual DB queries (uses payment data from Phase 1)
  Wire landlordReportWorker to actual DB queries
  Email template rendering with tenant language
  SMS provider integration
  Communication logging

  WHY FOURTH: Depends on Phase 1 (needs payment data to exist).
  The services and queue infrastructure already exist -- this phase
  is about connecting the dots.

Phase 5: Smovin Import
  smovinImporter.ts (scraper + mapper)
  smovinImportWorker (BullMQ job)
  import route + frontend UI
  smovin_imports tracking table

  WHY FIFTH: Completely independent feature. Can be parallelized
  with Phase 4 if resources allow. Requires careful testing with
  real Smovin accounts. Highest uncertainty -- Smovin's page structure
  may change without notice.

Phase 6: Onboarding + Polish
  Onboarding wizard (frontend-heavy, minimal backend)
  Visual polish and responsive design
  Security hardening (CSRF, remove in-memory stores, error sanitization)

  WHY LAST: Depends on all other features working. The wizard guides
  users through property -> tenant -> lease -> payment setup, so all
  those flows must be complete first.
```

### Cross-Cutting Concerns Per Phase

| Concern | When to Address |
|---------|-----------------|
| Database migrations | Each phase that adds/modifies tables runs its own migration |
| i18n (translations) | Phase 4 (notification templates) and Phase 6 (new UI screens) |
| Error handling cleanup | Phase 1 (remove in-memory fallbacks) |
| Type safety | Phase 1 (remove `any` types on DB imports) |
| Testing | Each phase should include integration tests for its service layer |

## Sources

- [GoCardless API Reference](https://developer.gocardless.com/api-reference/)
- [GoCardless Webhooks Guide](https://developer.gocardless.com/getting-started/stay-up-to-date-with-webhooks-v2/)
- [GoCardless Mandate Events](https://developer.gocardless.com/mandates/responding-to-mandate-events/)
- [Statbel Health Index Open Data](https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index)
- [Statbel be.STAT API](https://bestat.statbel.fgov.be/bestat/crosstable.xhtml?view=208b69bd-05c5-4947-b7f9-2d2300f517b8) (JSON/CSV/XML export available)
- [Smovin Property Management](https://www.smovin.app/en-be/) (no confirmed public API)
- [Webhook Best Practices](https://hookdeck.com/blog/webhooks-at-scale)
- Existing codebase analysis: `apps/api/src/`, `packages/db/src/schema/`, `packages/shared/src/`

---
*Architecture research for: Rentular Belgian rental property management platform*
*Researched: 2026-03-22*
