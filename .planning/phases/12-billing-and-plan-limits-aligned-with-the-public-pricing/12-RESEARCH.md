# Phase 12: Billing and plan limits aligned with the public pricing - Research

**Researched:** 2026-11-04
**Domain:** Stripe Billing (subscriptions with a fixed item plus a per-unit quantity item), server-side plan enforcement in a Hono API, per-month usage counting, i18n legal copy
**Confidence:** HIGH for codebase findings and Stripe SDK shapes (verified against the installed `stripe@20.4.1` types), MEDIUM for Stripe product behaviour verified through docs, LOW/ASSUMED items are listed in the Assumptions Log.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Existing accounts
- The owner's account is exempt from every limit and charge (jnuyens@gmail.com, user id a1e2c837-8130-438a-9a12-c285dda5cf27 on prod). Make exemption a per-user flag (e.g. `users.billing_exempt`), not a hardcoded id, so more accounts can be marked later.
- All other hosted accounts over 3 properties keep all their data (never delete or hide anything) but cannot add another property until they subscribe to Onbeperkt.

#### SMS
- SMS only on Onbeperkt (and exempt accounts).
- Fair-use limit: **50 SMS per calendar month** per landlord account, counted on actually sent SMS. At the limit, sending stops with a clear message; the reminder falls back to the other channels (email/WhatsApp) instead of failing silently.
- Free accounts must not be able to pick SMS as a usable channel (show it disabled with an upgrade hint).

#### Bank tracking extra
- Available on **both** plans: a free account can buy bank tracking as its only paid item.
- 5 euro per monitored bank account per month, **excl. VAT** (same as the 19 euro plan).
- Billed by Rentular through Stripe (quantity on a subscription item that follows the number of active monitored accounts; adding/removing a bank connection updates the quantity).
- The public footnote must say excl. VAT: NL "5 euro per opgevolgd rekeningnummer per maand, excl. btw" (and EN/FR/DE equivalents).

#### Stripe
- Replace Starter/Standard/Professional (apps/api/src/routes/stripe.ts PLANS, STRIPE_PRICE_* env on m1) with one product "Onbeperkt" (EUR 19/month excl. VAT) and one per-account bank tracking price (5 euro/month excl. VAT).
- Creating or changing products/prices in the live Stripe account is an outward action: the executor prepares it, the owner confirms before anything is created in Stripe. Prefer test mode first.

#### Legal text
- Rewrite `bankConnectionsClause` (terms) and `pricingDisclosure` (Bank Connections pages) in EN/NL/FR/DE: Rentular bills the bank tracking extra (5 euro per monitored account per month excl. VAT); the separate PSD2 service relationship with the licensed AIS provider stays described as it is.
- The owner must approve the final wording before deploy (checkpoint).

#### Self-hosted
- When billing is not configured (no STRIPE_SECRET_KEY), no limits or charges apply anywhere.

### Claude's Discretion
- Where the plan check helper lives and how it caches subscription state.
- UI placement of upgrade hints and the billing/subscription page details.
- How SMS usage is counted (communications log vs counter table), as long as it is per calendar month in the account's timezone.

### Specific Ideas (from CONTEXT.md)
- Standing project rules: no em/en-dashes anywhere, no Co-Authored-By lines, human-sounding copy, all UI in EN/NL/FR/DE, back up the prod DB before deploys or data changes, never run `db:generate` (Drizzle baseline is stale: use manual ALTER/`db:push`-style DDL on prod).
- Testing happens in production (pre-release), with confirmation before outward actions.

### Deferred Ideas (OUT OF SCOPE)
- Changing the marketing page layout (already done), GoCardless SEPA collection, new features. (CONTEXT.md has no separate Deferred section; this is its "Out of scope" line.)
</user_constraints>

<phase_requirements>
## Phase Requirements

Note: BILL-01..06 are NOT yet in `.planning/REQUIREMENTS.md` (grep finds no `BILL` entries). The planner should add them there (or the roadmap row is the only source). [VERIFIED: grep of REQUIREMENTS.md]

| ID | Description | Research Support |
|----|-------------|------------------|
| BILL-01 | One Onbeperkt Stripe plan (EUR 19/month excl. VAT), subscribe via Checkout, manage/cancel; old plans gone | Stripe model section (one subscription per customer, up to two items), Checkout + Customer Portal patterns, webhook persistence (currently missing entirely), setup script with lookup keys |
| BILL-02 | Free hosted account limited to 3 properties; clear message + upgrade link; nothing deleted/hidden | Two insert paths found: `POST /properties` and `importWriteWorker`; `canAddProperty()` helper; 402 error contract |
| BILL-03 | SMS only on Onbeperkt, fair-use 50/calendar month, fallback to other channels, disabled channel for free | Seven SMS entry points mapped; gate inside `queueSms` + final check in worker; count from `communications`; Brussels month-start helper |
| BILL-04 | Bank tracking billed per monitored account; connect adds, disconnect removes | `syncBankTrackingQuantity(ownerId)` from DB count, hooked at callback, delete, expiry; Checkout for users without a subscription |
| BILL-05 | Terms clause + Bank Connections notice rewritten EN/NL/FR/DE, owner-approved | Current strings extracted; nl/fr/de `pricingDisclosure` is still English; draft wording provided for owner approval |
| BILL-06 | Self-hosted: no limits when billing not configured | `isBillingEnabled()` = key + both price IDs present; every gate short-circuits on it |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Stack is fixed: Next.js 15, Hono, Drizzle ORM, MySQL/MariaDB, GoCardless for rent, **Stripe for Rentular subscription billing only**. No new billing provider.
- All UI in EN, NL, FR, DE (next-intl, `apps/web/messages/{locale}/common.json`).
- Belgian context; hosting on the m1 VPS (PM2, not compose; see memory note).
- No em-dashes or en-dashes in any output (code, comments, copy, commit messages). No Co-Authored-By lines in commits (user global rule overrides the attribution reminder).
- Human-sounding copy; avoid "seamless/robust/leverage/ensures/powerful" style words.
- Conventions: camelCase files for libs/services, named exports for routers, `[Prefix]` log context, `c.json({ error }, status)`, Zod via `@hono/zod-validator`, strict TS, explicit return types on exported functions.
- Work goes through GSD commands (`/gsd:execute-phase`).
- Schema changes: never `db:generate`; `drizzle-kit push` also fails on this MariaDB (`checkConstraint` TypeError, per deployment memory). Apply hand-written idempotent DDL (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `utf8mb4_unicode_ci`) after `mysqldump rentular`.
- Testing happens in production pre-release; outward actions (Stripe product creation, deploy) need owner confirmation.
- No project skills directory (`.claude/skills`, `.agents/skills` absent). [VERIFIED: ls]

## Summary

Rentular has almost no billing implementation today. `apps/api/src/routes/stripe.ts` offers three old plans, creates a Checkout session with no customer linkage, and its webhook only `console.log`s events ("Phase 2: implement subscription persistence" TODOs). There is no subscriptions table, no Stripe customer id on users, no web UI that calls `/stripe/checkout` (the marketing CTAs link to `/login`), and `GET /stripe/subscription` returns a hard-coded `status: "none"`. So this phase is a greenfield billing layer plus enforcement hooks in existing code paths, not a migration of existing subscription data. [VERIFIED: codebase read]

The recommended Stripe model is **one Stripe Customer per Rentular user and at most one active subscription per customer, holding up to two items**: the Onbeperkt price (quantity 1) and the bank tracking price (quantity = number of monitored accounts). A free user who only buys bank tracking has a subscription containing only the bank item; upgrading later adds the Onbeperkt item to the same subscription, so there is always one invoice per month. Stripe documents that multiple prices on one subscription produce one combined invoice and must share currency and interval. [CITED: docs.stripe.com/billing/subscriptions/quantities] Local state lives in a new `billing_accounts` table synced from webhooks (re-fetching the subscription from Stripe on each event), and every gate reads that row, so there is no in-process cache to go stale.

Enforcement must be server-side at every write path: `POST /properties` and the Smovin `importWriteWorker` for properties; `queueSms` (used by 6 call sites) plus the direct `sendSms` in `POST /sms/test` for SMS; the bank-connection create/callback/delete/expiry paths for quantity. All gates short-circuit to "allowed" when `isBillingEnabled()` is false (self-hosted) or `users.billing_exempt` is true. Important operational risk: prod already has `STRIPE_SECRET_KEY` set (with an unusual `mk_` prefix that Stripe's key docs do not list), so if enablement were keyed on the secret alone, limits would switch on in prod the moment this deploys, possibly with a key that cannot create Checkout sessions.

**Primary recommendation:** Build `apps/api/src/lib/billing.ts` (enablement, state lookup, `canAddProperty`, `getSmsAllowance`, `syncBankTrackingQuantity`) backed by a new `billing_accounts` table and `users.billing_exempt`; enable it only when `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ONBEPERKT` and `STRIPE_PRICE_BANK_TRACKING` are all set; verify the prod key in Stripe test mode before any live product creation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plan state (free / onbeperkt / exempt) | API / Backend (`lib/billing.ts`) | Database (`billing_accounts`, `users.billing_exempt`) | Must be authoritative and unforgeable; client only displays it |
| Subscription lifecycle | External (Stripe) | API webhook handler | Stripe is the source of truth; API mirrors it via signed webhooks |
| Checkout / portal sessions | API (session-only route) | Browser redirect to Stripe-hosted pages | Price ids and customer id chosen server-side only |
| Property limit | API (`POST /properties`, import worker) | Web (disable button, show hint) | Web hint is UX; API 402 is the control |
| SMS gate + fair-use count | API (`queueSms`, SMS worker) | Database (`communications` rows) | Every SMS path funnels through `queueSms` except `/sms/test` |
| Bank tracking quantity | API (`syncBankTrackingQuantity`) | Stripe subscription item | Quantity recomputed from DB count, pushed as absolute value |
| SMS channel disabled for free | Web (tenants, communications, settings) | API (`GET /billing/status`) | UI reads one status endpoint |
| Legal copy | Web (i18n messages) | none | Static text, owner approval gate |
| Self-hosted unlimited | API (`isBillingEnabled`) | Web (hide billing UI when disabled) | Single switch checked by every gate |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe (node SDK) | 20.4.1 installed (pins API `2026-02-25.clover`); latest on npm is 23.1.0 | Checkout, Customer Portal, subscriptions, subscription items, webhooks | Already a dependency; locked by CLAUDE.md [VERIFIED: node_modules/stripe/package.json, cjs/apiVersion.js, npm view] |
| drizzle-orm | 0.36 | New `billing_accounts` schema, count queries | Existing ORM |
| zod + @hono/zod-validator | 3.24 / 0.4 | Validate billing route bodies | Existing pattern |
| vitest | 4.1.2 | Unit/route tests | Existing; 46 files / 410 tests pass in 2.5 s [VERIFIED: ran `npx vitest run`] |

### Supporting
| Item | Purpose | When to Use |
|------|---------|-------------|
| `Intl.DateTimeFormat` (built-in) | Month start in Europe/Brussels | SMS monthly window; no date library needed |
| Existing `webhook_events` table | Stripe event idempotency (unique `event_id`) | Insert-or-skip on every Stripe webhook |
| Existing `lib/timezone.ts` `resolveTimezone()` | Account timezone (falls back to Europe/Brussels) | Pass to month-start helper |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One subscription, two items | Two separate subscriptions (plan + bank) | Two invoices and two billing anchors per month; more webhook state. Rejected. |
| Licensed quantity item for bank tracking | Metered usage price | Metered bills in arrears and needs usage reporting; the decision explicitly says "quantity on a subscription item". Rejected. |
| `billing_accounts` table | Columns on `users` | `users` is also the NextAuth adapter table; a separate table keeps Stripe ids out of auth reads. Only `billing_exempt` goes on `users` (as CONTEXT suggests). |
| Count SMS from `communications` | Dedicated counter table | `communications` already records every queued SMS with `owner_id`, `channel`, `status`, `sent_at`; a counter would duplicate it and drift on retries. Use `communications` + an index. |
| Upgrade stripe SDK to 23.x | Stay on 20.4.1 | Upgrading changes the pinned API version mid-phase; not needed for any feature used here. Stay. |

**Installation:** none. No new packages.

## Package Legitimacy Audit

No new external packages are installed in this phase. `stripe` is an existing dependency (20.4.1). slopcheck not run because there is nothing new to check.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| stripe (existing) | npm | many years | very high | github.com/stripe/stripe-node | n/a (already installed) | Approved, no change |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Codebase Findings (current state)

### Stripe today [VERIFIED: codebase read]
- `apps/api/src/lib/stripe.ts`: lazy `getStripeClient()` + `isStripeConfigured()` (Phase 10 boot guard, tested in `lib/__tests__/stripe.test.ts`). Keep this; add nothing that constructs Stripe at import.
- `apps/api/src/routes/stripe.ts`: `PLANS` (starter/standard/professional from `STRIPE_PRICE_*`), `GET /plans` (static fallback when no key), `POST /checkout` (no customer, `customer_email` from the request body, `payment_method_types: ["card","bancontact","ideal"]`, `success_url .../properties?subscribed=true&plan=`), `POST /webhook` (signature verified with `constructEvent` on `c.req.text()`, then only logs), `GET /subscription` (stub).
- `index.ts` mounts `/stripe` outside `protectedPrefixes`; only `/stripe/checkout` and `/stripe/subscription` get `requireAuth, requireWriteScope`. CSRF is skipped for `/api/v1/stripe/webhook` in `lib/csrfPolicy.ts`. Any new authenticated billing endpoint must be added to the auth wiring explicitly (recommend a new `/billing` prefix in `protectedPrefixes`).
- Nothing in `apps/web` calls `/stripe/*` (only privacy/terms mention Stripe). Marketing CTAs (`pricingFreeCta`, `pricingUnlimitedCta`) link to `/login`.
- Prod (m1) `.env` has `STRIPE_SECRET_KEY` (reported prefix `mk_`), old `STRIPE_PRICE_*` live ids and `STRIPE_WEBHOOK_SECRET`. [CITED: deployment memory note; key prefix from orchestrator]

### Property insert paths [VERIFIED: grep `insert(properties)`]
1. `apps/api/src/routes/properties.ts` `POST /` (owner = authenticated user; also the MCP/PAT path since PATs hit the same HTTP route; the MCP server has no `create_property` tool today).
2. `apps/api/src/jobs/importWriteWorker.ts` line ~194 (Smovin import; reuses duplicates via `findExistingProperty`, inserts the rest in a loop).
There is no unarchive route; `DELETE /properties/:id` sets `isArchived = true`. Count only `ownerId = user AND isArchived = false`.

### SMS entry points [VERIFIED: grep `queueSms|sendSms`]
| # | Path | File | Owner id available |
|---|------|------|--------------------|
| 1 | Reminder via preferred channel (19:15 worker + manual send-reminder + MCP `send_reminder`) | `services/reminderChannel.ts` `sendReminderViaPreferredChannel` / `resolveReminderChannel` | `ownerId` param |
| 2 | Extra SMS alongside email when `settings.smsEnabled` | `services/paymentFollowUp.ts` ~line 297 | `ownerId` |
| 3 | Due-date nudge (SMS or WhatsApp) | `jobs/paymentCheckWorker.ts` `sendDueDateTenantSms` ~line 275 | `lease.ownerId` |
| 4 | Landlord magic-link "remind by SMS" | `routes/landlordActions.ts` `sendSmsReminder` ~line 293, button HTML ~line 241 | `ctx.ownerId` |
| 5 | Custom message | `routes/communications.ts` `POST /send` ~line 253 | `lease.ownerId` |
| 6 | Resend failed communication | `routes/communications.ts` ~line 188 | `original.ownerId` |
| 7 | Test SMS | `routes/sms.ts` `POST /test` calls `sendSms` directly, no `communications` row, any authenticated user | user id |

All `queueSms` callers already pass `meta.ownerId`, so `queueSms` is the natural single gate; #7 bypasses it and must be gated separately.

### Bank connections [VERIFIED: routes/bankConnections.ts, schema]
- One `bank_connections` row = one monitored account (callback takes `accounts[0]`, stores `iban`, `externalAccountId`).
- Lifecycle: `POST /` inserts `pending`; `GET /callback` sets `active` (new or renewal via `payload.connectionId`); `DELETE /:id` sets `revoked`; `services/bankConnectionSync.ts` ~line 177 sets `expired`. Statuses: pending, active, expired, revoked, error.
- Hooks for quantity sync: after callback success, after delete, after the sync service marks expired, plus a daily reconcile.

### i18n strings [VERIFIED: messages/*/common.json]
- `terms.bankConnectionsClause` (all 4 locales translated) says Ibanity bills up to EUR 4 per account directly.
- `bankConnections.pricingDisclosure` says the same and "Rentular receives no portion"; **in nl/fr/de it is still the English text**. In fact 36 of 42 `bankConnections.*` keys in nl/fr/de are identical to English (untranslated namespace). At minimum `pricingDisclosure` and `tosNotice` must be translated in this phase; translating the rest is a cheap win the planner can include.
- `marketing.pricingBankNote` lacks "excl. btw / excl. VAT" in all locales. `marketing.pricingSmsNote` is "(**) Binnen redelijke limieten." (could name 50/month; owner call).
- Used at `app/terms/page.tsx:95`, `app/(dashboard)/bank-connections/page.tsx:144`, `app/(dashboard)/bank-connections/connect/page.tsx:66`.

### SMS UI controls [VERIFIED: grep]
- `app/(dashboard)/tenants/page.tsx:624` preferred channel `<option value="sms">`.
- `app/(dashboard)/communications/page.tsx` channel `sms` for custom messages (~line 312).
- `components/SmsSettingsCard.tsx` (settings, follow-up tab) due-date reminder toggle + test send.
- Settings tabs: follow-up, landlord-reports, bank-accounts, gocardless, profile, api-tokens (`app/(dashboard)/settings/page.tsx:855`). A new "billing" / "Abonnement" tab fits here.

## Architecture Patterns

### System Architecture Diagram

```
                 Browser (dashboard)                         Stripe
                        |                                      ^  |
   GET /billing/status  |  POST /billing/checkout|portal       |  | signed webhook
                        v                                      |  v
   +----------------- Hono API (/api/v1) --------------------------------+
   |  requireAuth (session only for /billing writes)                      |
   |                                                                      |
   |  routes/billing.ts --> lib/billing.ts --(create session)--> Stripe   |
   |                          ^    |                                      |
   |  POST /properties -------+    | read                                 |
   |  importWriteWorker ------+    v                                      |
   |  queueSms (6 callers) ---+  billing_accounts, users.billing_exempt   |
   |  POST /sms/test ---------+  communications (sms count)               |
   |  bank-connections -------+  bank_connections (active count)          |
   |   callback/delete/expire      |                                      |
   |          |                    |                                      |
   |          +--> syncBankTrackingQuantity --(subscriptionItems.update)-->|
   |                                                                      |
   |  routes/stripe.ts POST /webhook --> webhook_events (dedupe)          |
   |        --> stripe.subscriptions.retrieve --> upsert billing_accounts |
   +----------------------------------------------------------------------+
   Decision at every gate:
     isBillingEnabled()? no  -> allow (self-hosted)
     users.billing_exempt?   -> allow
     plan / count check      -> allow, or 402 { code } / channel fallback
```

### Recommended Project Structure
```
packages/db/src/schema/billing.ts        # billingAccounts table (export from schema/index.ts)
packages/db/src/schema/users.ts          # + billingExempt boolean
packages/db/sql/phase-12-billing.sql     # hand-written idempotent DDL for m1
packages/shared/src/billing.ts           # FREE_PROPERTY_LIMIT=3, SMS_FAIR_USE_LIMIT=50, display prices
apps/api/src/lib/billing.ts              # isBillingEnabled, getBillingState, canAddProperty,
                                         # getSmsAllowance, monthStartInTz, syncBankTrackingQuantity
apps/api/src/routes/billing.ts           # GET /status, POST /checkout, POST /portal,
                                         # POST /cancel-onbeperkt (session only)
apps/api/src/routes/stripe.ts            # webhook rewritten to persist; /plans + old /checkout removed
apps/api/src/jobs/billingReconcileWorker.ts  # daily quantity reconcile (BullMQ cron, tz from getScheduleTimezone)
apps/api/src/scripts/stripeSetup.ts      # idempotent product/price creation (owner-run, test mode first)
apps/web/components/BillingCard.tsx      # settings "billing" tab
apps/web/lib/useBillingStatus.ts         # shared hook for SMS/property/bank hints
```

### Pattern 1: Single enablement switch (BILL-06)
**What:** Billing and all limits are on only when the key and both new price ids exist.
```typescript
// apps/api/src/lib/billing.ts
export function isBillingEnabled(): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_PRICE_ONBEPERKT &&
    !!process.env.STRIPE_PRICE_BANK_TRACKING
  );
}
```
Why not the key alone: prod already has a key set, so a key-only switch would turn limits on at deploy time even before prices exist, leaving free users blocked with no working upgrade path. CONTEXT says "no STRIPE_SECRET_KEY means no limits"; requiring the prices too is strictly more permissive and keeps that promise. Log one `[Billing]` warning at boot if the key is set but a price id is missing.

### Pattern 2: Plan state from one DB row, no cache
```typescript
export type Plan = "free" | "onbeperkt";
export interface BillingState {
  enabled: boolean;
  exempt: boolean;
  plan: Plan;               // onbeperkt when the Onbeperkt item exists on a live subscription
  status: string | null;    // Stripe subscription status
  bankTrackingQuantity: number;
}
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]); // past_due = grace while Stripe retries
```
`getBillingState(userId)` does one PK lookup on `billing_accounts` joined with `users.billing_exempt`. No in-memory cache: the API is one PM2 process today but a cache adds staleness right after checkout for no measurable gain. `isUnlimited(state) = !state.enabled || state.exempt || state.plan === "onbeperkt"`.

### Pattern 3: Stripe model (BILL-01, BILL-04)
- Products/prices created once by `scripts/stripeSetup.ts` (owner runs it, test mode first): product "Rentular Onbeperkt", price EUR 1900 cents monthly, `tax_behavior: "exclusive"`, `lookup_key: "rentular_onbeperkt_monthly"`; product "Rentular bank tracking", price EUR 500 cents monthly per unit, `recurring.usage_type: "licensed"`, `tax_behavior: "exclusive"`, `lookup_key: "rentular_bank_tracking_monthly"`. Script looks up by lookup key first so reruns create nothing. Output: the two price ids for `STRIPE_PRICE_ONBEPERKT` / `STRIPE_PRICE_BANK_TRACKING`. [VERIFIED: `tax_behavior`, `lookup_key` exist in installed PricesResource types]
- One Stripe Customer per user, created on first billing action with `metadata.userId`, id stored in `billing_accounts.stripe_customer_id`. Checkout always passes `customer` (never `customer_email` from the request body as today) and `client_reference_id: userId`.
- Flows:
  | Situation | Action |
  |-----------|--------|
  | No subscription, wants Onbeperkt | Checkout `mode: "subscription"`, line items: Onbeperkt x1 (+ bank item x activeCount if > 0) |
  | No subscription, connects first bank account | Checkout `mode: "subscription"`, bank item x1, `metadata.intent = "bank_tracking"`, success_url back to `/bank-connections/connect?billing=ok`; Ponto consent starts after |
  | Has subscription, wants Onbeperkt | `subscriptionItems.create({ subscription, price: ONBEPERKT, quantity: 1, proration_behavior: "always_invoice" })` |
  | Has subscription, bank count changes | `subscriptionItems.update(itemId, { quantity: n })` or `.create` if no bank item yet; `create_prorations` |
  | Bank count reaches 0 | delete the bank item; if it is the only item, cancel the subscription instead |
  | Stops Onbeperkt but keeps bank tracking | delete the Onbeperkt item (prorated credit) |
  | Stops Onbeperkt and has no bank item | Customer Portal cancel (at period end) or `subscriptions.update({ cancel_at_period_end: true })` |
- Customer Portal: configure with `payment_method_update`, `invoice_history`, `customer_update` (address, tax id) and `subscription_cancel` enabled, **`subscription_update` disabled** so customers cannot edit the bank quantity themselves. [VERIFIED: Features keys in installed BillingPortal/ConfigurationsResource types]
- Payment methods: drop the hard-coded `payment_method_types` and rely on Dashboard-managed dynamic payment methods, or keep `card` + `bancontact`. Whether Bancontact/iDEAL work for subscriptions in this account is [ASSUMED]; test in test mode.
- VAT: prices are excl. VAT, so the invoice must add Belgian VAT. Either Stripe Tax (`automatic_tax: { enabled: true }` on Checkout and subscription updates) or a manual 21% BE `TaxRate` (`inclusive: false`) passed as `subscription_data.default_tax_rates`. Collect business VAT ids with `tax_id_collection: { enabled: true }`. Which one the owner's Stripe account uses is an open question. [CITED: docs.stripe.com/billing/taxes/tax-rates; VERIFIED: `automatic_tax`, `tax_id_collection`, `subscription_data.default_tax_rates` in installed Checkout types]

### Pattern 4: Webhook persistence with re-fetch
```typescript
// routes/stripe.ts POST /webhook (after constructEvent succeeds)
// 1. INSERT webhook_events(event_id unique, resource_type 'stripe', ...) ; duplicate key -> return 200
// 2. Resolve the subscription id from the event:
//    checkout.session.completed      -> session.subscription, session.client_reference_id (userId)
//    customer.subscription.created/updated/deleted -> event.data.object.id
//    invoice.paid / invoice.payment_failed -> invoice.parent?.subscription_details?.subscription
// 3. const sub = await stripe.subscriptions.retrieve(id)  // source of truth, ignores event ordering
// 4. upsert billing_accounts by stripe_customer_id:
//    status, onbeperkt_item_id, bank_tracking_item_id, bank_tracking_quantity,
//    current_period_end = item.current_period_end, cancel_at_period_end
```
API `2026-02-25.clover` facts that bite older tutorials: `current_period_end` lives on subscription **items**, not on `Subscription`; the invoice's subscription is under `invoice.parent.subscription_details`, not `invoice.subscription`. [VERIFIED: installed types `SubscriptionItems.d.ts:53`, `Invoices.d.ts:336,1041`; `Subscriptions.d.ts` has no top-level `current_period_end`]
Never grant a plan from the `success_url` query string (`?subscribed=true`); only the webhook writes plan state. The success page can poll `GET /billing/status` for a few seconds.

### Pattern 5: Property limit (BILL-02)
```typescript
export async function canAddProperty(userId: string, adding = 1):
  Promise<{ allowed: boolean; count: number; limit: number | null }> {
  const state = await getBillingState(userId);
  if (isUnlimited(state)) return { allowed: true, count: 0, limit: null };
  const count = await countActiveOwnedProperties(userId); // ownerId = userId AND is_archived = false
  return { allowed: count + adding <= FREE_PROPERTY_LIMIT, count, limit: FREE_PROPERTY_LIMIT };
}
// POST /properties
if (!(await canAddProperty(ownerId)).allowed)
  return c.json({ error: "Free plan is limited to 3 properties", code: "PROPERTY_LIMIT", limit: 3 }, 402);
```
Import worker: compute remaining slots once before the loop (`limit - count`), import new (non-duplicate) properties until slots run out, then skip the remaining new properties together with their tenants and leases, and report `skippedPlanLimit: n` in the import session progress/result so the UI can show an upgrade message. Reused duplicates do not consume a slot. Extract the slot logic as a pure function for testing.
The web catches `code === "PROPERTY_LIMIT"` and shows a translated message with a link to the billing tab; it also disables the "add property" button when `status.propertyCount >= status.propertyLimit`.

### Pattern 6: SMS gate (BILL-03)
```typescript
export class SmsNotAllowedError extends Error {
  constructor(public reason: "plan" | "limit", public used = 0) { super(`SMS not allowed: ${reason}`); }
}
export async function getSmsAllowance(ownerId: string, now = new Date()):
  Promise<{ allowed: boolean; reason: "plan" | "limit" | null; used: number; limit: number | null }> {
  const state = await getBillingState(ownerId);
  if (!state.enabled || state.exempt) return { allowed: true, reason: null, used: 0, limit: null };
  if (state.plan !== "onbeperkt") return { allowed: false, reason: "plan", used: 0, limit: SMS_FAIR_USE_LIMIT };
  const since = monthStartInTz(now, resolveTimezone());
  const used = await countSmsThisMonth(ownerId, since); // see below
  return { allowed: used < SMS_FAIR_USE_LIMIT, reason: used < SMS_FAIR_USE_LIMIT ? null : "limit", used, limit: SMS_FAIR_USE_LIMIT };
}
```
- Counting: `communications WHERE owner_id = ? AND channel = 'sms' AND ((status IN ('sent','delivered') AND sent_at >= since) OR (status = 'queued' AND queued_at >= since))`. Queued rows are counted at queue time so a burst of 60 reminders in one 19:15 run cannot all pass while none is sent yet; the worker re-checks with only sent rows before calling the provider (worker concurrency is 1, so that check is serial). "Counted on actually sent SMS" holds: failed rows never count.
- Where: `queueSms` calls `getSmsAllowance(meta.ownerId)` and throws `SmsNotAllowedError` before inserting the row. Make `meta` required (all callers already pass it). The worker calls a sent-only check before `sendSms`; if over, mark the row `failed` with `errorMessage: "fair-use limit reached"` and do not retry (`UnrecoverableError` from bullmq).
- Fallbacks per caller:
  - `resolveReminderChannel` gains an `smsAllowed` input; if SMS is preferred but not allowed, fall back to email (the existing fallback). The landlord gets told once (see open question on WhatsApp fallback).
  - `paymentFollowUp` extra SMS: skip the SMS (email already sent), log `[PaymentFollowUp] SMS skipped: limit`.
  - Due-date nudge: skip for free/over-limit accounts unless the tenant prefers WhatsApp.
  - Landlord magic-link: new result `"notallowed"`/`"limit"` with 4-language HTML text; hide the SMS button in the email when not allowed.
  - `POST /communications/send` and resend: 402 `{ code: "SMS_PLAN" | "SMS_LIMIT" }`.
  - `POST /sms/test`: same gate, and count it (or restrict to exempt/self-hosted only).
- UI: `GET /billing/status` returns `smsAllowed`, `smsUsed`, `smsLimit`; tenants page renders the SMS option `disabled` with an upgrade hint, communications page disables SMS, `SmsSettingsCard` disables the due-date toggle.

### Pattern 7: Month start in the account timezone
```typescript
// No library: compute the UTC instant of local midnight on the 1st.
function tzOffsetMinutes(at: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - at.getTime()) / 60000;
}
export function monthStartInTz(now: Date, tz: string): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const guess = Date.UTC(+p.year, +p.month - 1, 1);
  return new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60000);
}
// Europe/Brussels: 2026-11-01 local midnight -> 2026-10-31T23:00:00Z; 2026-07-01 -> 2026-06-30T22:00:00Z
```
Brussels DST switches happen on the last Sunday of March/October at 02:00/03:00, never at midnight on the 1st, so the single-offset correction is exact there. [ASSUMED: standard EU DST rule]

### Pattern 8: Bank tracking quantity sync (BILL-04)
```typescript
export async function syncBankTrackingQuantity(ownerId: string): Promise<void> {
  if (!isBillingEnabled()) return;
  const state = await getBillingState(ownerId);
  if (state.exempt) return;
  const n = await countMonitoredAccounts(ownerId); // bank_connections WHERE owner_id=? AND status IN ('active','error')
  // set absolute quantity (never +1/-1), so concurrent calls converge on the DB truth
  // n > 0 and item exists -> subscriptionItems.update(item, { quantity: n })
  // n > 0 and no item     -> subscriptionItems.create({ subscription, price, quantity: n })
  // n = 0 and item exists -> subscriptionItems.del(item) or subscriptions.cancel if it is the only item
  // pass idempotencyKey `bank-qty-${ownerId}-${n}-${minuteBucket}`
}
```
- Gate in `POST /bank-connections` (before the Ponto redirect): if billing enabled, not exempt, and there is no live subscription, return 402 `{ code: "BANK_TRACKING_CHECKOUT", url }` with a Checkout URL for bank item x1. If a live subscription exists, proceed; quantity follows on callback.
- Call sync after: callback success (new and renewal), `DELETE /:id`, the expiry write in `bankConnectionSync.ts`, and from a daily `billingReconcileWorker` (BullMQ repeatable, `tz: getScheduleTimezone()`) over all users with a `billing_accounts` row or monitored connections.
- Sync failures must not break the bank flow: catch, log `[Billing]`, let the daily reconcile fix it.
- Reconcile grace: skip setting quantity to 0 for subscriptions created in the last 24 h, so a user who paid at checkout and is still in the Ponto consent screen is not cancelled immediately.

### Anti-Patterns to Avoid
- **Trusting `success_url` params** to activate a plan (current code redirects with `?subscribed=true&plan=`). Only the webhook writes state.
- **Incrementing/decrementing Stripe quantity** on connect/disconnect. Always push the absolute DB count.
- **Checking the plan only in the web UI.** PAT/MCP clients and the import worker go straight to the API.
- **Hard-coding the owner's user id.** Use `users.billing_exempt` and a one-off `UPDATE`.
- **Gating on `isStripeConfigured()` alone** (see Pattern 1).
- **Letting the customer portal change subscription items** (quantity would no longer match monitored accounts).
- **Deleting or hiding data when over the limit.** The check is only on create.
- **Using `request body email` for Checkout** (current `customer_email: email`): lets a user attach a subscription to someone else's email. Use the stored customer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payment page, SCA, card/Bancontact entry | Own payment form | Stripe Checkout (hosted) | PCI scope, 3DS, SEPA mandates handled |
| Cancel / update card / download invoices | Own billing screens | Stripe Customer Portal session | Free, localized, compliant invoices |
| Proration when quantity or items change | Own credit math | `proration_behavior` on Stripe calls | Stripe computes per-second proration |
| VAT calculation and invoice legends | Own VAT lines | Stripe Tax or a Stripe `TaxRate` + `tax_id_collection` | Reverse-charge legends, VIES validation |
| Webhook signature check | HMAC code | `stripe.webhooks.constructEvent` (already used) | Timestamp tolerance, replay window |
| Test signed webhook payloads | Fake headers | `stripe.webhooks.generateTestHeaderString` | Exists in installed SDK [VERIFIED: Webhooks.d.ts:92] |
| Timezone month boundary | String slicing of ISO dates in UTC | `Intl.DateTimeFormat` helper (Pattern 7) | UTC month start is off by 1-2 h for Brussels |

**Key insight:** Rentular should only mirror Stripe state and decide "allowed or not". Everything money-related (amounts, tax, proration, dunning, receipts) stays in Stripe.

## Runtime State Inventory

This phase replaces the old plans, so the rename/migration inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No subscription data exists in the DB (webhook never persisted). Existing `bank_connections` rows with `status='active'` on non-exempt accounts would start being billed: count unknown, must be checked on prod. Users over 3 properties: unknown count, check on prod. | Data check queries before deploy; owner decides on grandfathering existing bank connections (open question). One-off `UPDATE users SET billing_exempt=1 WHERE id='a1e2c837-...'`. |
| Live service config | Stripe live account: old Starter/Standard/Professional products/prices and a webhook endpoint (`/api/v1/stripe/webhook`) whose subscribed event list is unknown. No customer portal config known. | Owner-confirmed: create new products/prices (script), archive old prices (not delete), add events `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` to the endpoint, create a portal configuration. |
| OS-registered state | PM2 `rentular-api` env is captured from `.env` at start; the ecosystem file re-reads `.env` only when restarted via `pm2 restart /var/www/rentular.com/ecosystem.config.cjs`. | Restart via the ecosystem file after editing `.env`, then confirm with `/proc/<pid>/environ` grep. |
| Secrets/env vars | Remove `STRIPE_PRICE_STARTER/STANDARD/PROFESSIONAL`; add `STRIPE_PRICE_ONBEPERKT`, `STRIPE_PRICE_BANK_TRACKING`, optionally `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_TAX_RATE_ID` (if manual VAT). `STRIPE_SECRET_KEY` value starts with `mk_`: verify. `.env.example` has no STRIPE entries today. | Update m1 `.env` and `.env.example`; verify key in Stripe Dashboard (Developers > API keys) and with a harmless call (`stripe.accounts.retrieve()` or `balance.retrieve()`) reporting `livemode`. |
| Build artifacts | Web needs `next build` with env sourced (NEXT_PUBLIC_* baked in); API runs via tsx, no build. | Standard deploy path; no new artifacts. |

## Common Pitfalls

### Pitfall 1: Limits switch on in prod at deploy with a broken key
**What goes wrong:** Prod has `STRIPE_SECRET_KEY` set; with a key-only switch the 3-property limit and SMS block apply instantly while Checkout fails (bad key or missing prices). Free users with 4+ properties and SMS users are stuck.
**How to avoid:** Pattern 1 (key + both price ids), verify the key first, deploy code before setting the new price env vars, then flip by adding env + ecosystem restart.
**Warning signs:** `[Stripe]` errors in PM2 logs on checkout; `GET /billing/status` shows `enabled: true` before the prices exist.

### Pitfall 2: Webhook ordering and duplicates
**What goes wrong:** `customer.subscription.updated` arrives before `checkout.session.completed`, or twice; state flips back.
**How to avoid:** Dedupe on `webhook_events.event_id`; on every event re-fetch the subscription and write the full state. Map customer to user via `billing_accounts.stripe_customer_id` (created before Checkout), not via the session event.

### Pitfall 3: SMS burst exceeds the limit
**What goes wrong:** The 19:15 job queues many reminders; counting only `sent` rows lets all pass.
**How to avoid:** Count queued + sent at queue time, re-check sent-only in the worker (concurrency 1).

### Pitfall 4: Silent channel downgrade
**What goes wrong:** Tenant prefers SMS, account is free; reminder goes to email but nobody knows.
**How to avoid:** `payment_reminders.channel` already records the channel used; surface "sent by email (SMS needs Onbeperkt / limit reached)" in the UI or landlord report, and log it.

### Pitfall 5: Bank-only subscription cancelled by reconcile right after checkout
**How to avoid:** 24 h grace in reconcile; sync on callback sets quantity to the real count.

### Pitfall 6: Deleting the last subscription item
**What goes wrong:** Stripe rejects deleting the only item on a subscription. [ASSUMED]
**How to avoid:** If the item to remove is the only one, cancel the subscription instead.

### Pitfall 7: Wrong billing owner for manager actions
**What goes wrong:** A property manager (not owner) sends an SMS on a co-managed lease; counting against the manager.
**How to avoid:** Always use `lease.ownerId` / `property.ownerId` / `bankConnection.ownerId` as the billing account, which the existing call sites already pass as `meta.ownerId`.

### Pitfall 8: Untranslated legal copy
**What goes wrong:** Only EN gets updated; nl/fr/de `pricingDisclosure` is already English today.
**How to avoid:** i18n test asserting the four values differ from each other and contain "5" and the excl. VAT phrase (`excl. VAT`, `excl. btw`, `HTVA` or `hors TVA`, `zzgl. MwSt.`), and no U+2013 or U+2014 characters.

### Pitfall 9: New billing routes not behind auth
**What goes wrong:** `/stripe` is not in `protectedPrefixes`; a new `/stripe/portal` would be public.
**How to avoid:** New `/billing` prefix in `protectedPrefixes`; reject PAT callers on billing writes (session only, like `/api-tokens`), so a leaked PAT cannot start purchases.

### Pitfall 10: Old /plans and /checkout still callable
**How to avoid:** Remove `PLANS`, `GET /plans`, old `POST /checkout`, and `GET /subscription` stub (or redirect to `/billing/*`). Add a test that `starter|standard|professional` no longer appear in `apps/api/src`.

## Code Examples

### Checkout for Onbeperkt (server-chosen prices)
```typescript
// Source: Stripe Checkout API; params verified in installed stripe@20.4.1 types
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: account.stripeCustomerId,          // created earlier with metadata.userId
  client_reference_id: userId,
  line_items: [
    { price: process.env.STRIPE_PRICE_ONBEPERKT!, quantity: 1 },
    ...(bankCount > 0 ? [{ price: process.env.STRIPE_PRICE_BANK_TRACKING!, quantity: bankCount }] : []),
  ],
  // pick one VAT approach (open question):
  automatic_tax: { enabled: true },             // Stripe Tax
  // subscription_data: { default_tax_rates: [process.env.STRIPE_TAX_RATE_ID!] }, // manual 21% BE
  tax_id_collection: { enabled: true },
  customer_update: { address: "auto", name: "auto" },
  subscription_data: { metadata: { userId } },
  locale: userLocale,                            // "nl" | "fr" | "de" | "en"
  success_url: `${webUrl}/settings?tab=billing&checkout=success`,
  cancel_url: `${webUrl}/settings?tab=billing&checkout=cancelled`,
}, { idempotencyKey: `checkout-onbeperkt-${userId}-${tenMinuteBucket}` });
```

### Portal session
```typescript
const portal = await stripe.billingPortal.sessions.create({
  customer: account.stripeCustomerId,
  return_url: `${webUrl}/settings?tab=billing`,
  configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
  locale: userLocale,
});
```

### Additive DDL for m1 (apply after mysqldump)
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id VARCHAR(255) NOT NULL PRIMARY KEY,
  stripe_customer_id VARCHAR(255) NULL UNIQUE,
  stripe_subscription_id VARCHAR(255) NULL,
  subscription_status VARCHAR(32) NULL,
  onbeperkt_item_id VARCHAR(255) NULL,
  bank_tracking_item_id VARCHAR(255) NULL,
  bank_tracking_quantity INT NOT NULL DEFAULT 0,
  current_period_end TIMESTAMP NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT billing_accounts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS communications_owner_channel_sent_idx
  ON communications (owner_id, channel, sent_at);

UPDATE users SET billing_exempt = TRUE WHERE id = 'a1e2c837-8130-438a-9a12-c285dda5cf27';
```
Mirror this exactly in `packages/db/src/schema/billing.ts` and `users.ts` (Drizzle `boolean("billing_exempt").default(false).notNull()`), keep it in `packages/db/sql/phase-12-billing.sql`. Check the `users.id` column charset/collation matches before adding the FK (if it differs, the FK fails; drop the FK rather than alter `users`).

### Prod data checks before go-live (read-only)
```sql
SELECT owner_id, COUNT(*) n FROM properties WHERE is_archived = 0 GROUP BY owner_id HAVING n > 3;
SELECT owner_id, COUNT(*) n FROM bank_connections WHERE status IN ('active','error') GROUP BY owner_id;
SELECT owner_id, COUNT(*) n FROM communications WHERE channel = 'sms' AND sent_at >= '2026-10-31 23:00:00' GROUP BY owner_id;
SELECT COUNT(*) FROM tenants WHERE preferred_channel = 'sms';
```

### Draft legal wording (for owner approval, not final)
Keep the existing PSD2 sentences ("separate service agreement with Ibanity SA/NV ... Rentular is not party to that agreement") and replace only the billing sentence(s).

- `pricingDisclosure`
  - EN: "Automatic bank tracking costs 5 euro per monitored bank account per month, excl. VAT. Rentular adds it to your Rentular subscription and stops charging as soon as you disconnect the account."
  - NL: "Automatische bankopvolging kost 5 euro per opgevolgd rekeningnummer per maand, excl. btw. Rentular rekent dit aan via je Rentular-abonnement en stopt zodra je de rekening loskoppelt."
  - FR: "Le suivi bancaire automatique coûte 5 euros par compte suivi et par mois, hors TVA. Rentular l'ajoute à votre abonnement Rentular et arrête de le facturer dès que vous déconnectez le compte."
  - DE: "Der automatische Bankabgleich kostet 5 Euro pro überwachtem Konto und Monat, zzgl. MwSt. Rentular rechnet dies über Ihr Rentular-Abonnement ab und beendet die Abrechnung, sobald Sie das Konto trennen."
- `bankConnectionsClause` (replace "Ibanity bills you directly ... (up to EUR 4 ...)" with):
  - EN: "Rentular charges a bank tracking fee of 5 euro per monitored account per month, excl. VAT, through your Rentular subscription."
  - NL: "Rentular rekent voor bankopvolging 5 euro per opgevolgde rekening per maand aan, excl. btw, via uw Rentular-abonnement."
  - FR: "Rentular facture le suivi bancaire 5 euros par compte suivi et par mois, hors TVA, via votre abonnement Rentular."
  - DE: "Rentular berechnet für den Bankabgleich 5 Euro pro überwachtem Konto und Monat, zzgl. MwSt., über Ihr Rentular-Abonnement."
- `marketing.pricingBankNote`: append ", excl. btw" / ", excl. VAT" / ", hors TVA" / ", zzgl. MwSt."; NL exact text is locked: "5 euro per opgevolgd rekeningnummer per maand, excl. btw".
Note the terms page uses formal "u" in NL while the dashboard uses "je"; the drafts follow each surface's existing register.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `subscription.current_period_end` | `subscription.items.data[i].current_period_end` | Stripe API 2025-03-31 (basil) and later; installed SDK pins 2026-02-25.clover | Read period end from the item [VERIFIED: installed types] |
| `invoice.subscription` | `invoice.parent.subscription_details.subscription` | same | Webhook mapping for invoice events [VERIFIED: installed types] |
| `payment_method_types` lists | Dashboard dynamic payment methods | gradual | Prefer omitting the list [ASSUMED] |
| Secret keys `sk_` for everything | Stripe recommends restricted keys `rk_` | current docs | Consider an `rk_live_` key with Checkout, Customers, Subscriptions, Portal, Prices, Products (read), Tax write [CITED: docs.stripe.com/keys] |

**Deprecated/outdated in this repo:** `PLANS` / `STRIPE_PRICE_STARTER|STANDARD|PROFESSIONAL`, `GET /stripe/plans`, `GET /stripe/subscription` stub, success URL `?subscribed=true&plan=`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mk_` is not a standard Stripe secret key prefix (docs list `pk_`, `sk_`, `rk_`, `sk_org_`; "managed API keys" exist for hosting platforms but their prefix is not documented) | Runtime State, Pitfall 1 | If the key is invalid, Checkout and quantity sync fail in prod; verify before go-live |
| A2 | Stripe rejects deleting the only item of a subscription | Pitfall 6, Pattern 8 | Minor: code path would error; handled by cancel-instead logic anyway |
| A3 | Bancontact / iDEAL usable in subscription-mode Checkout for this account | Pattern 3 | Checkout error; fall back to card only |
| A4 | Rentular invoices must add 21% Belgian VAT and the owner's Stripe account has (or will set up) Stripe Tax or a manual tax rate | Pattern 3 | Wrong totals on invoices; legal/tax issue. Owner must confirm the billing entity and VAT setup |
| A5 | Counting `active` and `error` bank connections as "monitored" (not `pending`, `expired`, `revoked`) | Pattern 8 | Over- or under-billing; owner may prefer `active` only |
| A6 | Treating `past_due` as still Onbeperkt (grace while Stripe retries) | Pattern 2 | Users keep SMS a few days after a failed payment |
| A7 | Fallback channel when SMS is blocked is email (WhatsApp only if the tenant prefers it) | Pattern 6 | CONTEXT says "email/WhatsApp"; owner may want WhatsApp first |
| A8 | Ibanity no longer bills landlords directly once Rentular charges 5 euro (the clause removes the "up to EUR 4" sentence) | Draft legal wording | Legal text inaccurate; owner approval checkpoint covers this |
| A9 | Brussels DST never switches at midnight on the 1st | Pattern 7 | Off-by-one-hour month boundary; negligible |

## Open Questions (RESOLVED)

1. **Is the prod `STRIPE_SECRET_KEY` (`mk_...`) valid, and live or test?**
   - Known: Stripe docs list `pk_`, `sk_`, `rk_`, `sk_org_` prefixes; no `mk_`.
   - Recommendation: Owner checks Dashboard > Developers > API keys; executor runs a read-only `stripe.accounts.retrieve()` from m1 and reports `livemode`. Create test-mode products first with an `sk_test_`/`rk_test_` key.
   - RESOLVED: owner verifies the key in the Stripe dashboard at the first checkpoint of 12-01 (CONTEXT round 2); billing stays off until key and both price ids are set.
2. **VAT handling: Stripe Tax or manual 21% tax rate? Which legal entity is the merchant (Linux Belgium BV?)**
   - Recommendation: Ask the owner at the Stripe setup checkpoint; code supports both via env (`STRIPE_TAX_RATE_ID` set means manual, else `automatic_tax`).
   - RESOLVED: fixed 21% Belgian VAT tax rate (CONTEXT round 2); no Stripe Tax for now.
3. **Existing active bank connections on non-exempt accounts: bill from now, grandfather, or ask them to subscribe?**
   - Recommendation: Run the data check query; if any exist, owner decides. Default: no billing until the user goes through checkout; show a banner asking them to start bank tracking billing, and block new connections until then.
   - RESOLVED: prod check 2026-11-04 shows the only bank connection belongs to the exempt owner; nothing to grandfather (CONTEXT round 2).
4. **Proration policy** for mid-month bank account changes and Onbeperkt upgrades.
   - Recommendation: `create_prorations` for quantity changes (credit/charge on next invoice), `always_invoice` for Onbeperkt added to an existing bank-only subscription.
   - RESOLVED: create_prorations for bank tracking quantity changes; always_invoice when Onbeperkt is added to an existing bank-only subscription (plan 12-03).
5. **Stopping Onbeperkt while keeping bank tracking:** immediate item removal with prorated credit (recommended, simple) vs at period end (needs a scheduled job or subscription schedule).
   - RESOLVED: at period end (cancel_at_period_end), no prorated refunds (CONTEXT round 2); bank-only re-create handled in 12-03.
6. **Should `marketing.pricingSmsNote` mention "50 SMS per month"?** Owner wording call; trivial either way.
   - RESOLVED: yes, "Tot 50 sms per maand." and EN/FR/DE equivalents (CONTEXT round 2, plan 12-02).
7. **Translate the whole `bankConnections` namespace (36 untranslated keys in nl/fr/de)?** Recommended since the phase touches those pages anyway.
   - RESOLVED: yes, translated in plan 12-02 (CONTEXT round 2).
8. **UI spec:** `workflow.ui_phase` is true; the billing tab and upgrade hints are new UI. The planner may want a `/gsd:ui-phase` pass or keep the UI minimal (one settings card, inline hints) and specify it in the plan.
   - RESOLVED: minimal UI (one Settings billing card plus inline hints), specified concretely in plans 12-09 and 12-10 instead of a separate UI-SPEC.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | API/tests | yes | v22.22.3 locally (prod volta pin 20.19) | none needed |
| stripe SDK | Billing | yes | 20.4.1 | none |
| vitest | Tests | yes | 4.1.2, suite green (410 tests) | none |
| Stripe CLI | Local webhook forwarding | no (`command -v stripe` empty) | none | Use `generateTestHeaderString` in tests; prod UAT uses the real webhook endpoint |
| Stripe test-mode key | Safe UAT | unknown | none | Owner provides `sk_test_`/`rk_test_` |
| MariaDB on m1 | DDL | yes (host MariaDB, per memory) | unknown | Hand-written DDL; `drizzle-kit push` does not work there |
| Local MySQL | Integration tests | no (Phase 9 note: ECONNREFUSED in sandbox) | none | Mock `@rentular/db` like existing route tests |

**Missing dependencies with no fallback:** Stripe test-mode credentials (owner must supply for the safe path).
**Missing dependencies with fallback:** Stripe CLI, local DB.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (API only; `apps/web` has no test runner) |
| Config file | `apps/api/vitest.config.ts` (`src/**/__tests__/**/*.test.ts`, node env) |
| Quick run command | `cd apps/api && npx vitest run src/lib/__tests__/billing.test.ts` |
| Full suite command | `pnpm --filter @rentular/api test` (plus `pnpm lint` for tsc on api and web) |

Mocking pattern to copy: `routes/__tests__/bankConnections.test.ts` and `settings.test.ts` (vi.mock `@rentular/db` with a fake `getDb()`, mock `drizzle-orm`, inject `userId` via a wrapper Hono app). Mock `../lib/stripe` `getStripeClient` to return an object with `checkout.sessions.create`, `subscriptions.retrieve`, `subscriptionItems.*`, `billingPortal.sessions.create`, and use the real `Stripe.webhooks.generateTestHeaderString` + `constructEvent` for signed webhook tests.

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-06 | `isBillingEnabled` false without key or either price id; every gate returns allowed when disabled | unit | `npx vitest run src/lib/__tests__/billing.test.ts` | no, Wave 0 |
| BILL-06 | exempt flag bypasses property, SMS, bank gates | unit | same file | no, Wave 0 |
| BILL-01 | `POST /billing/checkout` uses stored customer, server price ids, `client_reference_id`; rejects PAT callers | route | `npx vitest run src/routes/__tests__/billing.test.ts` | no, Wave 0 |
| BILL-01 | Webhook: bad signature 400; duplicate event id skipped; subscription upsert maps items/status/period end from item | route | `npx vitest run src/routes/__tests__/stripeWebhook.test.ts` | no, Wave 0 |
| BILL-01 | Old plan names gone from API source | unit (grep) | `npx vitest run src/__tests__/noLegacyPlans.test.ts` | no, Wave 0 |
| BILL-02 | `POST /properties` 402 `PROPERTY_LIMIT` at 3 active owned (archived ignored); allowed for onbeperkt/exempt/disabled | route | `npx vitest run src/routes/__tests__/propertiesLimit.test.ts` | no, Wave 0 |
| BILL-02 | Import slot planner: duplicates free, new beyond slots skipped with their tenants/leases, count reported | unit | `npx vitest run src/services/__tests__/importPlanLimit.test.ts` | no, Wave 0 |
| BILL-03 | `getSmsAllowance`: free -> plan; onbeperkt 49 -> allowed, 50 -> limit; queued counted; month boundary uses Brussels | unit | `npx vitest run src/lib/__tests__/billing.test.ts` | no, Wave 0 |
| BILL-03 | `monthStartInTz` for Nov (UTC+1) and Jul (UTC+2) | unit | same | no, Wave 0 |
| BILL-03 | `resolveReminderChannel` falls back to email when SMS not allowed | unit | `npx vitest run src/services/__tests__/reminderChannel.test.ts` | yes, extend |
| BILL-03 | `paymentFollowUp` skips SMS when not allowed, still emails | unit | `npx vitest run src/services/__tests__/paymentFollowUp.test.ts` | yes, extend |
| BILL-03 | `queueSms` throws `SmsNotAllowedError` and inserts no row; `/sms/test` and `/communications/send` return 402 | unit/route | `npx vitest run src/jobs/__tests__/smsGate.test.ts` | no, Wave 0 |
| BILL-04 | `syncBankTrackingQuantity`: sets absolute qty, creates item if missing, cancels when last item hits 0, no-op when disabled/exempt, swallows Stripe errors | unit | `npx vitest run src/lib/__tests__/bankTrackingSync.test.ts` | no, Wave 0 |
| BILL-04 | `POST /bank-connections` returns 402 + checkout URL with no live subscription; callback and delete call sync | route | `npx vitest run src/routes/__tests__/bankConnections.test.ts` | yes, extend |
| BILL-05 | `pricingDisclosure`, `bankConnectionsClause`, `pricingBankNote` exist in 4 locales, differ per locale, contain "5" and excl. VAT phrase, no "Rentular receives no portion", no en/em dash | unit | `npx vitest run src/__tests__/i18n-completeness.test.ts` | yes, extend |
| BILL-05 | New `billing.*` UI keys present in all 4 locales | unit | same | yes, extend |
| All | Type safety api + web | static | `pnpm lint` | yes |
| BILL-01/04 | Real Stripe test-mode checkout, portal cancel, bank qty change visible on upcoming invoice | manual UAT in prod with test key | n/a (owner checkpoint) | manual |
| BILL-05 | Owner approves final wording | manual checkpoint | n/a | manual |

### Sampling Rate
- **Per task commit:** the specific test file(s) above (each runs in well under 30 s).
- **Per wave merge:** `pnpm --filter @rentular/api test` and `pnpm lint`.
- **Phase gate:** full suite green, then prod UAT in Stripe test mode before switching live price ids.

### Wave 0 Gaps
- [ ] `apps/api/src/lib/__tests__/billing.test.ts` (enablement, exempt, canAddProperty, getSmsAllowance, monthStartInTz)
- [ ] `apps/api/src/lib/__tests__/bankTrackingSync.test.ts`
- [ ] `apps/api/src/routes/__tests__/billing.test.ts`
- [ ] `apps/api/src/routes/__tests__/stripeWebhook.test.ts`
- [ ] `apps/api/src/routes/__tests__/propertiesLimit.test.ts`
- [ ] `apps/api/src/services/__tests__/importPlanLimit.test.ts` (requires extracting a pure slot-planning function from `importWriteWorker`)
- [ ] `apps/api/src/jobs/__tests__/smsGate.test.ts` (new `jobs/__tests__` dir exists already)
- [ ] Shared stripe mock helper (e.g. `src/__tests__/helpers/stripeMock.ts`)
- No framework install needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (indirect) | Existing NextAuth session; billing writes session-only (reject `tokenId`/PAT like `/api-tokens`) |
| V3 Session Management | no change | existing |
| V4 Access Control | yes | Billing state keyed on authenticated user; portal session uses stored customer id only; limits enforced server-side on owner id |
| V5 Input Validation | yes | Zod on billing bodies (no client-supplied price ids, emails or quantities) |
| V6 Cryptography | yes (webhooks) | `stripe.webhooks.constructEvent` on raw body (already in place) |
| V11 Business Logic | yes | Limit checks on every create path; SMS race handled by queue-time + worker-time checks |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged/replayed Stripe webhook | Spoofing/Tampering | Signature verify (existing) + `webhook_events.event_id` unique dedupe + re-fetch subscription from Stripe |
| Plan activation via `?subscribed=true` | Elevation | Only webhook writes plan state |
| Bypass limit via PAT/MCP or Smovin import | Elevation | Gate in API route and import worker, not UI |
| Attach subscription to another user's email | Tampering | Stored customer per user, `client_reference_id`, ignore body email |
| Customer edits bank quantity in portal | Tampering | Portal `subscription_update` disabled; daily reconcile resets quantity |
| SMS cost abuse via `/sms/test` | DoS / financial | Gate + count; restrict to Onbeperkt/exempt |
| Leaked PAT starts purchases | Elevation | Billing write routes session-only |
| Stripe secret in logs | Info disclosure | Never log key or full Stripe errors with request headers; log `err.message` only |

## Sources

### Primary (HIGH confidence)
- Installed `apps/api/node_modules/stripe` 20.4.1 type definitions: `apiVersion.js` (2026-02-25.clover), `SubscriptionItems.d.ts`, `Subscriptions.d.ts` (status union, no top-level period end), `Invoices.d.ts` (`parent.subscription_details`), `Checkout/SessionsResource.d.ts` (`automatic_tax`, `tax_id_collection`, `subscription_data.default_tax_rates`), `PricesResource.d.ts` (`tax_behavior`), `BillingPortal/ConfigurationsResource.d.ts` (features), `Webhooks.d.ts` (`generateTestHeaderString`)
- Codebase: `apps/api/src/routes/stripe.ts`, `lib/stripe.ts`, `index.ts`, `routes/properties.ts`, `jobs/importWriteWorker.ts`, `jobs/smsQueueWorker.ts`, `services/reminderChannel.ts`, `services/paymentFollowUp.ts`, `jobs/paymentCheckWorker.ts`, `routes/communications.ts`, `routes/landlordActions.ts`, `routes/sms.ts`, `routes/bankConnections.ts`, `lib/timezone.ts`, `packages/db/src/schema/{users,communications,bankConnections,webhookEvents}.ts`, `apps/web/messages/*/common.json`
- `npm view stripe version` (23.1.0 latest)

### Secondary (MEDIUM confidence)
- https://docs.stripe.com/billing/subscriptions/quantities (multiple items one invoice, licensed quantities, proration on quantity change)
- https://docs.stripe.com/billing/taxes/tax-rates (manual tax rates, exclusive vs inclusive, reverse charge)
- https://docs.stripe.com/keys (key prefixes: pk_, sk_, rk_, sk_org_; restricted keys recommended)
- https://docs.stripe.com/keys/managed-api-keys (platform-managed keys exist; prefix not documented)

### Tertiary (LOW confidence)
- Web search on "mk_" Stripe prefix: no reference found.
- Project memory notes (deployment, drizzle baseline, timezone) for operational facts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages; SDK shapes checked in installed types)
- Architecture: HIGH for codebase hook points, MEDIUM for Stripe flow choices (several are owner policy calls listed as open questions)
- Pitfalls: HIGH for codebase-derived ones, MEDIUM for Stripe behaviour (A2, A3)

**Research date:** 2026-11-04
**Valid until:** 2026-12-04 (Stripe docs move fast; re-check if the SDK is upgraded)
