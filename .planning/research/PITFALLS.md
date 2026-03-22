# Pitfalls Research

**Domain:** Belgian rental property management platform (SEPA payments, rent indexation, multi-region compliance)
**Researched:** 2026-03-22
**Confidence:** HIGH (verified against GoCardless docs, Belgian regulatory sources, and codebase analysis)

## Critical Pitfalls

### Pitfall 1: GoCardless webhook handlers ACK without persisting state -- silent payment data loss

**What goes wrong:**
The current webhook handler (`apps/api/src/routes/webhooks.ts`) returns HTTP 200 for every valid webhook but never writes to the database. GoCardless sees the 200 and considers the event delivered. Payment confirmations, failures, chargebacks, and mandate state changes are permanently lost. The landlord never knows a payment was collected. The tenant is never notified of a failure. Late failures (chargebacks) silently disappear, meaning the landlord's payout balance becomes negative with no explanation in the system.

**Why it happens:**
The handler was scaffolded with TODOs as placeholders. Because it returns 200 and logs to console, manual testing appears to "work" -- the webhook arrives, the signature verifies, and no errors appear. The silent data loss only becomes apparent when a landlord asks "where are my payment confirmations?"

**How to avoid:**
1. Implement every TODO handler before going live. The payment state machine must handle: `created`, `submitted`, `confirmed`, `paid_out`, `failed`, `late_failure_settled`, `charged_back`, `cancelled`.
2. Add an idempotency table (`webhook_events`) with columns: `event_id VARCHAR(255) PRIMARY KEY, resource_type, action, processed_at, payload JSON`. Before processing, INSERT with ON DUPLICATE KEY to prevent replays.
3. Use a database transaction for each event: update payment status + insert communication log + insert webhook event record atomically.
4. If any handler TODO remains unimplemented, return HTTP 500 for that event type so GoCardless retries rather than losing the event.

**Warning signs:**
- Console shows "[Webhook] Payment PM123 confirmed" but the payments table has no record with status "paid"
- Landlord dashboard shows all payments as "pending" despite GoCardless dashboard showing "confirmed"
- GoCardless sandbox webhook test logs arrive in console but no database rows change
- No entries in a `webhook_events` tracking table

**Phase to address:**
Phase 1 (Payment persistence) -- this is the foundation. No other payment feature works without it.

---

### Pitfall 2: SEPA chargeback window creates up to 13 months of financial uncertainty

**What goes wrong:**
Under SEPA Direct Debit Core rules, tenants can request a no-questions-asked refund within 8 weeks of any collection. For unauthorized debits (no valid mandate), the window extends to 13 months. A payment marked "confirmed" and even "paid_out" can be reversed months later. If the system treats "confirmed" as final (marking rent as fully paid, closing overdue tracking, stopping reminders), a chargeback leaves the landlord with a negative payout balance and no record in the system of what happened.

**Why it happens:**
Developers treat payment confirmation as equivalent to "money received." In card payments, this is roughly true. In SEPA direct debit, confirmation means "the bank hasn't said no yet." The `late_failure_settled` and `charged_back` webhook events are the real risk -- they arrive days to months after confirmation.

**How to avoid:**
1. Model payment status as a proper state machine with transitions: `pending -> processing -> confirmed -> paid_out`, and allow reversals: `confirmed -> failed` (late failure), `paid_out -> refunded` (chargeback).
2. Never delete or archive payment records. Chargebacks reference the original payment ID.
3. Store `confirmedAt`, `paidOutAt`, and a boolean `isSettled` flag. Only mark as truly settled after the 8-week chargeback window expires (calculate from `charge_date`).
4. When a `late_failure_settled` or `charged_back` webhook arrives, revert the payment to failed/refunded status AND re-enable overdue tracking for that lease period.
5. Show landlords a "settlement pending" indicator for payments within the 8-week window.

**Warning signs:**
- The `charged_back` handler in webhooks.ts is a TODO
- No `late_failure_settled` -> revert logic exists
- Payment status enum doesn't include a "chargeback" or "reversed" state (current schema has `refunded` which is close but the transition logic is missing)
- Landlord reports show payments as "paid" that were later reversed

**Phase to address:**
Phase 1 (Payment persistence) -- the state machine design must account for reversals from day one. Retrofitting reversals onto a "confirmed = done" model is a rewrite.

---

### Pitfall 3: Belgian health index -- wrong base month selection invalidates every rent calculation

**What goes wrong:**
The Belgian rent indexation formula is: `new_rent = base_rent * (current_index / base_index)`. The base index is the health index of the month PRECEDING the contract signing date (Flanders) or the month preceding the lease entry into force date (Brussels). Getting the "preceding month" wrong by even one month produces a different index value, and every subsequent indexation is then permanently wrong. Belgian law states that overcharged indexation amounts can be reclaimed by the tenant for up to 5 years.

**Why it happens:**
Three different rules exist:
- **Flanders**: base index = month preceding the month the contract came into force
- **Brussels**: base index = month preceding the date of conclusion (signing date)
- **Wallonia**: base index = month preceding the month of conclusion

The codebase has `indexationBaseMonth` on the lease but the calculate endpoint (`/indexation/calculate/:leaseId`) currently returns all zeros because it never fetches real data. The distinction between `signingDate` and `startDate` in the lease schema exists but the indexation code doesn't use the correct one per region.

**How to avoid:**
1. Implement region-aware base month selection: for a lease signed on 2024-03-15 in Flanders with start date 2024-04-01, the base index month is March 2024 (month preceding April, the start month). In Brussels, the base month is February 2024 (month preceding March, the signing month).
2. Store the computed `indexationBaseMonth` on the lease at creation time with validation against the region rule. Don't recompute it each time.
3. The "current index" is always the month preceding the anniversary month of the lease coming into force.
4. Use Statbel's published health index data. Statbel publishes in TXT and XLSX format (no REST API exists). Cache the downloaded data in the database, updating monthly.
5. Validate calculations against Statbel's official rent calculator at https://rentcalculator.economie.fgov.be/ for at least 10 test cases across all 3 regions.

**Warning signs:**
- `indexationBaseMonth` is null on lease records
- Health index endpoint returns zeros (current state: `apps/api/src/routes/indexation.ts` line 19)
- No Statbel data import mechanism exists
- Calculated rent differs from Statbel's official calculator for the same inputs
- No distinction between signing date and start date in base month calculation

**Phase to address:**
Phase 2 (Indexation) -- but the lease creation flow (Phase 1 scope) must correctly set `indexationBaseMonth` based on region when creating leases, so the data is ready.

---

### Pitfall 4: Flanders EPC correction factor -- a permanent penalty that compounds across years

**What goes wrong:**
The Flanders EPC correction factor is not a temporary measure. For leases started before October 1, 2022 with EPC labels D/E/F/G or no label, the health index growth during the freeze period (October 2022 - September 2023) must be permanently subtracted from all future indexation calculations. This correction compounds: each year's calculation must exclude the frozen growth, not just the first year after the freeze ended. The codebase has a `applyFlandersEpcRestriction` function that looks correct for the correction math, but it depends on `freezePeriodIndexStart` and `freezePeriodIndexEnd` parameters that are hardcoded to 0.

Additionally, from 2028, EPC labels E/F are banned from indexation entirely in Flanders. From 2030, label D joins the ban. The code references `FLANDERS_FUTURE_RESTRICTIONS` but these dates are approaching fast and the entire calculation pipeline is non-functional.

**Why it happens:**
The correction factor math is complex and region-specific. Developers implement the formula but don't have access to the actual health index values (Statbel data) needed to compute the frozen growth period values. The function exists but is never called with real data.

**How to avoid:**
1. Download and store Statbel health index data monthly. The specific values needed: September 2022 index and September 2023 index (the freeze period boundaries).
2. Store the freeze period index values as system constants or in a config table -- they are fixed historical values that never change.
3. For Flanders leases started before October 1, 2022 with labels D/E/F/G/none: always apply the correction. This is a permanent condition for the lifetime of the lease.
4. Build an integration test that computes indexation for a Flanders D-label lease started in 2021 and verifies against a known-correct value from the Flemish government's tool.
5. Implement the 2028/2030 future ban dates -- these are already in the code as `FLANDERS_FUTURE_RESTRICTIONS` but never tested.

**Warning signs:**
- `freezePeriodIndexStart` and `freezePeriodIndexEnd` are 0 in the calculate endpoint
- No Statbel data is loaded into the system
- The `applyFlandersEpcRestriction` function is never reached because `baseIndex` is 0 (short-circuits the formula)
- No test cases for Flanders D/E/F label leases

**Phase to address:**
Phase 2 (Indexation) -- requires Statbel data import to be completed first.

---

### Pitfall 5: Smovin web scraping is legally risky and technically fragile by nature

**What goes wrong:**
The planned Smovin import feature involves the user providing their Smovin credentials, Rentular logging in on their behalf, and scraping properties/tenants/leases/payment history. This is fragile in three dimensions: (1) Smovin can change their HTML/API at any time, breaking the scraper silently, (2) Smovin's Terms of Service likely prohibit automated access, and (3) under Belgian database law (1998) and GDPR, systematic extraction from a third-party platform has legal implications even when the user authorizes it -- because the user authorizes access to their data, not to Smovin's database structure.

**Why it happens:**
Smovin does not offer a public data export API (conflicting reports exist; XLS/PDF export is available for some data). The motivation is sound -- reducing migration friction for switching users. But the implementation path (credential-based scraping) carries disproportionate risk for a launch feature.

**How to avoid:**
1. Deprioritize in-app scraping for launch. Instead, build a CSV/XLS import that accepts Smovin's export format. Smovin does offer XLS export for rental invoices and potentially other data.
2. If scraping is pursued: never store Smovin credentials. Use them in a single session, then discard. Process data in memory, map to Rentular schema, and persist only the mapped data.
3. Document that the user is importing THEIR OWN data and include consent language. The user must explicitly confirm they have the right to export this data.
4. Build the scraper as a separate, isolated service that can be updated independently when Smovin changes their UI. Version it separately from the main app.
5. Add health checks: if the scraper encounters unexpected HTML structure, abort and notify the user rather than importing garbled data.
6. Consider reaching out to Smovin to ask if they have a data portability API -- GDPR Article 20 (right to data portability) may compel them to provide one.

**Warning signs:**
- Smovin updates their UI and the scraper silently imports incorrect/partial data
- Users report "missing properties" after import
- Smovin sends a cease-and-desist letter
- Scraped data contains HTML fragments or garbled text in property names

**Phase to address:**
Phase 3 or later -- this is explicitly NOT a launch blocker. Build CSV import first (lower risk, broader utility). Scraping can be a post-launch enhancement if demand justifies the maintenance burden.

---

### Pitfall 6: In-memory store fallback silently swallows production data

**What goes wrong:**
Routes in `apps/api/src/routes/properties.ts` (and likely tenants, leases) catch database errors and fall back to an in-memory store. A user creates a property, sees a success response, but the data only lives in process memory. On the next deployment, server restart, or crash, all in-memory data vanishes. In multi-instance deployments, Server A and Server B have different data.

**Why it happens:**
This was a development convenience to allow the frontend to work before the database was fully set up. The fallback was never removed. Because errors are caught silently (`catch {}` blocks), there are no alerts when the database is actually failing.

**How to avoid:**
1. Remove ALL in-memory store imports and fallback logic from every route. Make database availability a hard requirement.
2. If `getDb()` fails, throw immediately. The API should return HTTP 503 (Service Unavailable), not silently degrade.
3. Add a startup health check: if the database is unreachable when the API starts, refuse to start (exit with error code).
4. Add the `/health` endpoint's database connectivity check: `SELECT 1` against the database.

**Warning signs:**
- Console shows "[Properties] Database unavailable, using in-memory store" (this log line exists in properties.ts line 19)
- Data created via the API is visible but disappears after server restart
- Different API instances return different data for the same user
- The `mem` import from `../lib/memoryStore` is used anywhere in production routes

**Phase to address:**
Phase 1 (Security hardening) -- this must be fixed before any real user data enters the system. It is a data loss risk, not a convenience trade-off.

---

### Pitfall 7: No CSRF protection on state-changing endpoints with credentials CORS

**What goes wrong:**
The API uses `credentials: true` CORS configuration (allowing cookies to be sent cross-origin) but has no CSRF protection. An attacker can craft a malicious page that makes POST/PATCH/DELETE requests to the Rentular API while the user's auth cookie is automatically included. This could create payments, modify lease terms, delete properties, or change notification settings.

**Why it happens:**
The Hono API was built with the assumption that CORS restrictions are sufficient. But `credentials: true` combined with a specific allowed origin still permits CSRF attacks if the attacker can trick the user into visiting a page. The Hono framework has built-in CSRF middleware (`hono/csrf`) but it is not imported or used anywhere in `apps/api/src/index.ts`.

**How to avoid:**
1. Import and apply Hono's built-in CSRF middleware: `import { csrf } from "hono/csrf"` then `app.use("*", csrf({ origin: process.env.WEB_URL }))`. Apply it to all routes EXCEPT the webhook endpoint (GoCardless webhooks are server-to-server and use signature verification instead).
2. Be aware of CVE-2024-48913: Hono's CSRF middleware can be bypassed with crafted Content-Type headers (uppercase MIME types like `Application/x-www-form-urlencoded`). Verify the Hono version includes the fix.
3. Set `SameSite=Lax` or `SameSite=Strict` on auth cookies as defense-in-depth.
4. Exclude `/api/v1/webhooks/*` from CSRF middleware since GoCardless sends server-to-server requests without browser cookies.

**Warning signs:**
- No import of `csrf` from `hono/csrf` in `apps/api/src/index.ts`
- The webhook route is in the same middleware chain as authenticated routes
- The CORS config allows `credentials: true` without CSRF tokens

**Phase to address:**
Phase 1 (Security hardening) -- a single-line middleware addition with route exclusion for webhooks. Low effort, high impact.

---

### Pitfall 8: Auth middleware creates ghost users and lacks duplicate prevention

**What goes wrong:**
The `ensureUser` function in `apps/api/src/lib/authMiddleware.ts` creates a new user if neither email lookup nor JWT sub lookup finds an existing user (lines 92-100). If the JWT sub changes between sessions (e.g., OAuth provider rotates sub claims), a duplicate user is created with a synthetic email like `${jwtUserId}@unknown`. The original user's properties, leases, and payments become orphaned.

**Why it happens:**
OAuth providers sometimes change the `sub` claim format. NextAuth may assign a different internal ID when the user re-authenticates. Without a UNIQUE constraint on email in the database, duplicate user rows accumulate silently. The catch block on line 101 swallows errors, including unique constraint violations.

**How to avoid:**
1. Add a UNIQUE constraint on `users.email` in the database schema.
2. Never create users with synthetic emails (`@unknown`). If no email is available from the JWT, reject the authentication.
3. Use email as the canonical user identity for lookups. The JWT sub is secondary.
4. Make the user creation a proper upsert (INSERT ... ON DUPLICATE KEY UPDATE) rather than separate SELECT + INSERT.
5. Log all user creation events to an audit table for debugging identity issues.
6. Test the auth flow with all configured OAuth providers (Google, Facebook, Twitter) to verify sub claim stability.

**Warning signs:**
- Multiple rows in the `users` table with the same email but different IDs
- Users with emails ending in `@unknown`
- A user reports "my properties are gone" after logging in with a different method
- Error logs showing "[Auth] User upsert failed" (line 102, currently caught and silently ignored)

**Phase to address:**
Phase 1 (Security hardening) -- fix before real users sign up. Ghost users corrupt the entire ownership model.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `let db: any` dynamic require pattern | Avoids TypeScript module resolution issues at dev time | No compile-time type checking on DB operations, runtime crashes instead of build errors, no IDE autocomplete | Never in production. Fix module resolution properly. |
| In-memory store fallback | Frontend development proceeds without database | Silent data loss, impossible horizontal scaling, inconsistent state | Only in local development with an explicit `DEV_MODE=true` guard. Never in production. |
| `console.error()` without sanitization | Fast to write, shows full context | API keys, tokens, PII leak to logs | Never for errors that may contain request bodies, headers, or environment variables |
| Hardcoded default DB credentials | Quick local setup | Production uses wrong credentials if env vars are unset | Only in docker-compose.yml for local dev with clear documentation |
| Returning 200 from unimplemented webhook handlers | GoCardless stops retrying during development | Permanent data loss of payment events in production | Never once any real GoCardless mandates exist |
| Payment follow-up PDF as plain text Buffer | Avoids PDF library dependency | Tenants receive a .pdf file that is actually plain text; some email clients will refuse it | Only for initial testing. Replace before sending real reminders. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GoCardless webhooks | Returning HTTP 200 before persisting to database (current state). If the server crashes between 200 response and DB write, the event is permanently lost. | Persist to database FIRST in a transaction, THEN return 200. If DB write fails, return 500 so GoCardless retries. |
| GoCardless payments.create | Using floating-point EUR amounts. `0.1 + 0.2 = 0.30000000000000004` causes cent rounding errors. | The codebase uses `Math.round(params.amount * 100)` which is correct for simple cases, but use integer cents throughout the application. Store amounts as cents, convert only for display. |
| GoCardless idempotency | Generating a new idempotency key on retry, defeating the purpose. | Generate the key ONCE when the payment intent is created (e.g., `lease-{leaseId}-{yearMonth}`), store it, and reuse on retries. The existing `idempotencyKey` parameter in `createPayment` is correct but calling code must generate stable keys. |
| Statbel health index | Expecting a REST API that doesn't exist. Statbel provides downloadable TXT/XLSX files only. | Build a monthly cron job that downloads the Statbel data file, parses it, and upserts into a `health_index_values` table. Cache aggressively -- the index for a given month never changes after publication. |
| NextAuth cookie decryption | Hardcoding the HKDF salt or algorithm. Auth.js can change encryption between major versions. | The current implementation correctly uses the cookie name as salt and A256CBC-HS512. Pin the Auth.js version exactly. Test decryption after any Auth.js upgrade. Note: AUTH_SECRET rotation invalidates all sessions -- implement secret rotation support (Auth.js supports an array of secrets for gradual rotation). |
| BullMQ + Redis | Not configuring `maxmemory-policy: noeviction` in Redis. BullMQ stores job metadata as Redis keys; if Redis evicts them, jobs are silently lost. | Set `maxmemory-policy noeviction` in redis.conf. Enable AOF persistence. Monitor queue depth. Configure `maxRetriesPerRequest: null` on connections (already done correctly in the codebase). |
| Self-hosted SMTP (Hetzner) | Sending production emails immediately after setup without IP warm-up. Gmail and Outlook will classify all emails as spam. | Configure SPF, DKIM, DMARC records first. Warm up the IP gradually (start with 10-20 emails/day, increase over 2-4 weeks). Monitor delivery rates. Consider using a transactional email service (Postmark, Amazon SES) for the first 3-6 months while the IP reputation builds. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No database indexes on payment queries | Payment listing and overdue calculations slow down linearly with payment count | Add composite indexes: `(lease_id, status)`, `(due_date, status)`, `(gocardless_payment_id)`. The schema files show no `.index()` calls. | ~1000 payments (10 properties x 12 months x ~8 years) |
| Email queue single worker with 30/min rate limit | Payment check at month-end queues hundreds of reminders. At 30/min, 300 reminders take 10 minutes. Combined with SMS queue (10/min), notifications are severely delayed. | Increase worker concurrency for email to 3-5. Use separate Redis queues for urgent (payment failure alerts) vs. batch (monthly reminders). Consider priority queues (already supported in the codebase). | ~50 leases with overdue payments in a single check run |
| 1011-line settings page with 24 template combinations | Page load becomes sluggish on mobile. Re-renders cascade through all template fields on any state change. | Extract template editor as a separate lazy-loaded component. Load templates from API on demand rather than embedding all 24 in the initial render. | Immediately on mobile devices; noticeable on desktop with ~4 languages |
| Belgian postcodes data (973 lines) bundled in frontend | Increases JavaScript bundle size unnecessarily. Every page load downloads 973 lines of postal code data even when not needed. | Move to an API endpoint or lazy-loaded JSON file. Only fetch when the postal code field is focused. | Affects Time-to-Interactive for all users on every page load |
| MySQL connection pool default (10 connections) | Under concurrent load, requests queue waiting for database connections. Timeouts cascade into 500 errors. | Configure pool size in `packages/db/src/connection.ts`: `connectionLimit: 20` for production, with `waitForConnections: true` and `queueLimit: 0`. Monitor with `SHOW STATUS LIKE 'Threads_connected'`. | ~20 concurrent users doing database operations |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Webhook endpoint in same auth middleware chain as user routes | GoCardless webhooks don't carry auth cookies. If the auth middleware becomes stricter (e.g., rejecting null userId), webhooks break silently. | Webhook routes should be mounted BEFORE the auth middleware or excluded explicitly. Currently `webhooksRouter` is outside `protectedPrefixes` which is correct, but `authMiddleware` still runs on `*` including webhooks -- unnecessary overhead and coupling. |
| Storing Smovin credentials even temporarily in memory | If the API process dumps core or logs request bodies, third-party credentials leak. | Never store Smovin credentials. Receive them, use them in a single scraping session, discard. Never log them. Use HTTPS-only communication. Better yet: accept Smovin's XLS export file instead of credentials. |
| AUTH_SECRET as single point of failure | If AUTH_SECRET leaks (via error logs, env dump, or CVE-2025-55182 React2Shell attack), an attacker can forge auth cookies for any user. | Rotate AUTH_SECRET periodically. Use Auth.js secret rotation (array of secrets). Monitor for unusual login patterns. Never log AUTH_SECRET. Ensure it is at least 32 characters of cryptographic randomness. |
| No rate limiting on authentication endpoints | Brute force attacks on login, or credential stuffing via OAuth callback flooding. | Add rate limiting middleware to `/api/v1/auth/*` routes. Consider IP-based limits (e.g., 10 login attempts per minute per IP). |
| Error handler logs full error objects to console | `apps/api/src/index.ts` line 106: `console.error("Unhandled error:", err)` -- this can include stack traces containing database queries (with data), API tokens in request headers, and PII. | Create a sanitized error logger that strips sensitive fields. Redact `authorization`, `cookie`, `x-api-key` headers. Strip SQL queries from stack traces. |
| Belgian structured communication (+++xxx/xxxx/xxxxx+++) generation | If two leases generate the same structured communication, bank reconciliation becomes impossible. Tenant pays the wrong lease's rent. | Generate structured communications using the modulo-97 check digit algorithm (Belgian standard). Use a unique counter or lease ID hash as the base number. Verify uniqueness in the database with a UNIQUE constraint. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Indexation calculated but not explained | Landlord doesn't trust the calculated rent because they can't verify the formula. | Show the full breakdown: base rent, base index value, current index value, EPC factor, correction factor, formula applied. Link to Statbel's official calculator for verification. The calculate endpoint response structure already includes this -- the frontend must display it clearly. |
| Payment reminders sent in the wrong language | Tenant receives a reminder in the landlord's language (EN) instead of their own (NL/FR/DE). | The `paymentFollowUp.ts` already has language-aware template selection. Ensure the tenant's `language` field is set during tenant creation and that the frontend enforces language selection. |
| Indexation notification without landlord preview/edit | Landlord sends an auto-generated email they can't customize. Tenant receives an impersonal or incorrect notification. | The codebase already has a preview endpoint (`/indexation/preview/:leaseId`). Ensure the UI flow is: calculate -> preview -> edit -> confirm -> send. Never auto-send indexation notifications. |
| No onboarding -- user creates a property but doesn't know to create a lease next | User creates 5 properties, gets stuck, doesn't understand why they can't set up payment collection. | Implement a guided wizard: Property -> Tenant -> Lease -> Bank Account -> Payment Method. Show progress and explain each step's purpose. The PROJECT.md lists onboarding as an active requirement. |
| GoCardless mandate setup failure without clear recovery path | Tenant starts mandate authorization, something fails (wrong bank, timeout, declined), and the UI shows a generic error. | Capture the mandate failure reason from GoCardless. Show tenant-friendly messages: "Your bank declined the authorization. Please try again or use a different bank account." Provide a "retry mandate setup" button. |
| Overdue payment dashboard shows amounts but not what to do | Landlord sees "3 overdue payments" but has no clear action path. | For each overdue payment, show: (1) days overdue, (2) reminder history (which reminders were already sent), (3) next escalation step, (4) one-click actions: send reminder / record manual payment / ignore. |

## "Looks Done But Isn't" Checklist

- [ ] **Webhook handler:** Returns 200 and logs to console, but zero database writes. Verify: check for INSERT/UPDATE statements in `webhooks.ts`. Currently zero.
- [ ] **Payment routes:** Zod schemas are defined (validation "works") but all endpoints return 501. Verify: call `GET /api/v1/payments/` -- if it returns 501, it's not done.
- [ ] **Indexation calculation:** The formula logic and EPC restriction functions exist and look correct, but they operate on hardcoded zeros. Verify: call `/api/v1/indexation/calculate/:leaseId` -- if `baseRent`, `baseIndex`, `currentIndex` are all 0, it's not done.
- [ ] **Email templates:** 24 template combinations exist in the settings page UI, but template variable substitution is untested. Verify: send a test reminder and check that `{{tenantName}}` is replaced, not displayed literally.
- [ ] **Payment follow-up PDF:** The `generateLatePaymentPdf` function outputs plain text as a Buffer with a `.pdf` extension. Verify: open the attachment in a PDF reader -- it will fail.
- [ ] **Property manager routes:** All 6 endpoints return 201/200 with empty responses. Verify: POST to create a property manager, then GET to list -- the created manager won't appear.
- [ ] **CSRF protection:** No `csrf` import exists in `apps/api/src/index.ts`. Verify: search for `csrf` in the codebase.
- [ ] **Database indexes:** Schema files define tables but no composite indexes. Verify: run `SHOW INDEX FROM payments` in MySQL -- only the primary key exists.
- [ ] **Rate limiting on email queue:** BullMQ limiter is configured, but test with a batch of 100+ emails to verify the rate is actually enforced (BullMQ limiter requires Redis and specific configuration to work).
- [ ] **Structured communication generation:** The field exists in both lease and payment schemas but no generation function is visible. Verify: create a lease and check if `structured_communication` is populated.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Lost webhook events (returned 200, no DB write) | HIGH | Fetch payment/mandate status directly from GoCardless API for all active mandates. Reconcile against local database. Replay missing events manually. This is a full audit -- there is no "replay webhooks" button in GoCardless. |
| Chargeback not tracked | HIGH | Query GoCardless API for all payments with status `charged_back` or `late_failure_settled`. Cross-reference with local payment records. Update statuses. Calculate payout balance discrepancies. Notify affected landlords. |
| Wrong base month for indexation | MEDIUM | Recalculate all historical indexations with correct base months. Issue correction notices to tenants for any overcharges. Belgian law allows tenants to reclaim overcharged indexation for 5 years. |
| Ghost/duplicate users | MEDIUM | Query for duplicate emails in users table. Merge user accounts (transfer properties, leases, payments to the canonical user). Delete ghost accounts. Add UNIQUE constraint after cleanup. |
| In-memory data loss | HIGH (if discovered late) | Data is gone. No recovery possible for data that was only in memory. The only mitigation is detecting this early (monitoring for memory store usage in logs) and switching to database-only before real users are on the platform. |
| Smovin scraper breaks | LOW | Users re-export from Smovin and re-import via CSV/XLS fallback. The scraper is a convenience, not a data source of truth. |
| Email deliverability (spam classification) | MEDIUM | Switch to a transactional email service (Postmark/SES). Request removal from spam lists. Re-warm the IP. This takes 2-4 weeks to resolve. During this time, critical payment notifications may not reach tenants. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Webhook handlers ACK without persisting | Phase 1: Payment persistence | Every webhook event type has a corresponding database write. Integration test with GoCardless sandbox. `webhook_events` table has rows after test. |
| SEPA chargeback window | Phase 1: Payment state machine | Payment status can transition from `confirmed` -> `failed` and `paid_out` -> `refunded`. Test with sandbox `late_failure_settled` event. |
| Wrong base month selection | Phase 1: Lease creation + Phase 2: Indexation | Unit tests for base month calculation per region. Cross-check with Statbel calculator for 3+ test cases per region. |
| Flanders EPC correction factor | Phase 2: Indexation | Integration test with real Statbel data for D/E/F label leases started before Oct 2022. Verify correction factor matches Flemish government tool. |
| Smovin scraping fragility | Phase 3+: Data import | Ship CSV/XLS import first. Scraper is optional enhancement with independent versioning and health checks. |
| In-memory store fallback | Phase 1: Security hardening | `grep -r "memoryStore\|mem\." apps/api/src/routes/` returns zero results. API returns 503 when database is down, not 200 with stale data. |
| No CSRF protection | Phase 1: Security hardening | `csrf` middleware is imported and applied in `index.ts`. Webhook routes are excluded. Test: cross-origin POST without CSRF token is rejected with 403. |
| Ghost/duplicate users | Phase 1: Security hardening | UNIQUE constraint on `users.email`. Auth middleware rejects tokens without email. No `@unknown` emails in production users table. |
| Email deliverability | Phase 2: Notifications | SPF/DKIM/DMARC records configured. Test delivery to Gmail, Outlook, Yahoo. Consider transactional email service for initial period. |
| BullMQ/Redis reliability | Phase 1: Infrastructure | Redis configured with `maxmemory-policy: noeviction` and AOF persistence. Queue depth monitoring in place. |

## Sources

- [GoCardless Overview of Payment Statuses](https://support.gocardless.com/hc/en-gb/articles/213146225-Overview-of-payment-statuses) -- payment lifecycle and state transitions
- [GoCardless Late Failures](https://support.gocardless.com/hc/en-us/articles/17143479940892-Late-failures) -- timing and handling of late failures
- [GoCardless SEPA Chargeback Process](https://support.gocardless.com/hc/en-gb/articles/115002883945-SEPA-Chargeback-Process) -- 8-week and 13-month chargeback windows
- [GoCardless Idempotency Keys](https://gocardless.com/blog/idempotency-keys/) -- API request idempotency best practices
- [GoCardless SEPA Direct Debit Failures Guide](https://gocardless.com/guides/sepa/receiving-sepa-dd-messages/) -- failure types and notification handling
- [Statbel Health Index](https://statbel.fgov.be/en/themes/consumer-prices/health-index) -- official Belgian health index publication
- [Statbel Rent Calculator](https://statbel.fgov.be/en/themes/consumer-prices/rent-calculator) -- official validation tool for indexation calculations
- [Statbel Consumer Price Index Open Data](https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index) -- data format (TXT/XLSX, no API)
- [Brussels Rental Price Indexation](https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation) -- Brussels-specific indexation rules and EPC restrictions
- [Brussels Indexation Correction Factor](https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor) -- correction factor for E/F/G properties
- [FPS Economy Rent Calculator](https://rentcalculator.economie.fgov.be/) -- federal rent indexation calculator
- [Hono CSRF Middleware Documentation](https://hono.dev/docs/middleware/builtin/csrf) -- built-in CSRF protection configuration
- [CVE-2024-48913 Hono CSRF Bypass](https://github.com/honojs/hono/security/advisories/GHSA-rpfr-3m35-5vx5) -- known CSRF middleware bypass via Content-Type
- [SEPA Direct Debit Customer Protection](https://gocardless.com/guides/sepa/protection/) -- SEPA refund and chargeback rules
- [BullMQ Going to Production](https://docs.bullmq.io/guide/going-to-production) -- Redis configuration and reliability requirements
- [IAPP Web Scraping in the EU](https://iapp.org/news/a/the-state-of-web-scraping-in-the-eu) -- GDPR implications of web scraping
- [Belgian Database Law and Web Scraping](https://siriuslegaladvocaten.be/en/blogs/recent-ecj-decision-confirms-be-careful-with-online-scrapers-and-crawlers-they-are-often-illegal/) -- Belgian legal framework for automated data extraction
- [Webhook Idempotency Best Practices](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) -- database-level idempotency patterns
- Codebase analysis: `apps/api/src/routes/webhooks.ts`, `payments.ts`, `apps/api/src/lib/gocardless.ts`, `apps/api/src/lib/authMiddleware.ts`, `apps/api/src/routes/indexation.ts`, `apps/api/src/index.ts`, `packages/db/src/schema/payments.ts`, `packages/db/src/schema/leases.ts`, `packages/db/src/connection.ts`

---
*Pitfalls research for: Belgian rental property management platform (Rentular)*
*Researched: 2026-03-22*
