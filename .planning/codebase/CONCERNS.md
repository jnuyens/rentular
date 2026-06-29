# Codebase Concerns

**Analysis Date:** 2026-06-28

---

## Tech Debt

**`db as any` casts on Phase 9 tables:**
- Issue: `bankConnections`, `bankStatements`, and `bankConnectionSync` insert/update operations cast the Drizzle client to `any` to bypass type inference failures on the newly-added schema tables.
- Files: `apps/api/src/routes/bankConnections.ts` (lines 126, 234, 268, 399), `apps/api/src/services/bankConnectionSync.ts` (line 197), `apps/api/src/services/bankStatementImporter.ts` (line 112)
- Impact: TypeScript stops checking the shape of rows being inserted/updated on these tables. Schema drift between the Drizzle table definition and actual insert objects goes undetected at compile time.
- Fix approach: Investigate why Drizzle type inference fails (likely nullable column handling or the `mode: "default"` connection option). Use `InferInsertModel<typeof bankConnections>` to produce explicit insert types and remove all casts.

**Module-level `db = getDb()` at module load:**
- Issue: Ten route files and `authMiddleware.ts` call `getDb()` at module load time and store the result in a module-level `const db`. This means the database connection pool is created before the application has finished starting and before environment variables are validated.
- Files: `apps/api/src/routes/auth.ts:16`, `apps/api/src/routes/payments.ts:20`, `apps/api/src/routes/settings.ts:12`, `apps/api/src/routes/tenants.ts:15`, `apps/api/src/routes/costs.ts:13`, `apps/api/src/routes/rentAdjustments.ts:13`, `apps/api/src/routes/bankAccounts.ts:7`, `apps/api/src/routes/maintenance.ts:15`, `apps/api/src/routes/communications.ts:15`, `apps/api/src/lib/authMiddleware.ts:11`
- Impact: If `DB_*` env vars are missing at startup the pool silently uses defaults (`localhost`/`rentular`/`rentular`). Unit tests that import these modules without a live DB will fail at module load rather than at the call site.
- Fix approach: Call `getDb()` inside each handler function instead of at module level. The singleton pattern in `connection.ts` ensures no extra pool is created.

**PDF generation stub:**
- Issue: The final-reminder email attaches a `late-payment-overview.pdf` that is actually a plain UTF-8 text buffer with a `.pdf` filename.
- Files: `apps/api/src/services/paymentFollowUp.ts:252-308` (comment `TODO: Replace with proper PDF generation`)
- Impact: Tenants receive a file named `.pdf` that is not a valid PDF. Email clients and PDF viewers will reject it. This undermines the legal value of a "final notice" document in Belgian rent disputes.
- Fix approach: Integrate `pdfkit` or `puppeteer` HTML-to-PDF. The TODO is explicit.

**Stripe subscription persistence not implemented:**
- Issue: All four Stripe webhook handlers (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`) and the `GET /stripe/subscription` endpoint are stubbed with `// Phase 2: implement subscription persistence`.
- Files: `apps/api/src/routes/stripe.ts:133-168`
- Impact: Stripe correctly charges customers but Rentular has no record of who has which plan. Every user effectively has unlimited access to all features regardless of their subscription status. There is no enforcement of plan tier limits on the number of leases, properties, or features.
- Fix approach: Add a `subscriptions` table or a `plan`/`subscriptionStatus` column on `users`. Write the Stripe webhook handler to persist the active plan, and add a `checkSubscription` middleware to enforce plan limits.

**Email verification not enforced:**
- Issue: The `emailVerified` column on `users` is set to `null` when a user changes their email address, and a message says "Please verify your new email address." But no verification flow exists and there is no enforcement gating API access on email verification status.
- Files: `apps/api/src/routes/auth.ts:195-208`
- Impact: Email change is cosmetic; no actual email confirmation is required. An attacker who changes their email to a victim's address gains no extra access but the platform's email-change audit trail is broken.
- Fix approach: Implement an email-verification token flow (similar to the existing `passwordResetTokens` pattern) and store the verification result in `emailVerified`.

**Settings page duplicates DEFAULT_EMAIL_TEMPLATES from `@rentular/shared`:**
- Issue: `apps/web/app/(dashboard)/settings/page.tsx` defines a local `DEFAULT_TEMPLATES` constant (line 69) that mirrors `DEFAULT_EMAIL_TEMPLATES` from the shared package instead of importing it.
- Files: `apps/web/app/(dashboard)/settings/page.tsx:69-70`
- Impact: Template defaults can drift between the frontend display and the backend `paymentFollowUp.ts` which imports from `@rentular/shared`. A template change in shared will not update the settings UI.
- Fix approach: Import `DEFAULT_EMAIL_TEMPLATES` from `@rentular/shared` and remove the local copy.

---

## Known Bugs

**Payment reminder channel recorded as `email` even when SMS is also sent:**
- Symptoms: `paymentCheckWorker` inserts only one `paymentReminders` row with `channel: "email"` per reminder level per payment, even when SMS is also dispatched (lines 222-229 in `paymentCheckWorker.ts`). The dedup check at line 180 queries `paymentReminders.type`, not the channel. So the SMS channel is never independently tracked.
- Files: `apps/api/src/jobs/paymentCheckWorker.ts:222-229`, `apps/api/src/services/paymentFollowUp.ts:229-249`
- Trigger: SMS-enabled owner setting (`smsEnabled: true`) with an overdue payment.
- Workaround: None. The current bug suppresses duplicate email reminders correctly, but if the reminder record is somehow missing, both email and SMS can re-fire.
- Fix approach: Insert separate `paymentReminders` rows per channel (email + sms) so each channel's dedup is independent, or add a `channel` dimension to the dedup query.

**Ponto transaction listing fetches only the first page:**
- Symptoms: `listTransactions` in `apps/api/src/lib/pontoConnect.ts` calls `getJson` once on `/accounts/{id}/transactions` and returns `json.data`. The Ponto JSON:API response includes `links.next` for cursor-based pagination but the `JsonApiList<T>` interface only declares `data: Array<...>` — `links` and `meta` are absent. No follow-next-page loop exists.
- Files: `apps/api/src/lib/pontoConnect.ts:291-317`
- Trigger: A landlord's bank account has more transactions in the sync window than the provider's default page size (typically 100).
- Impact: Transactions beyond the first page are silently dropped. Rent payments that land in the second page are never matched, leaving payments stuck in `pending`.
- Fix approach: Implement cursor pagination by reading `links.next` from the response and looping until no next page is present.

**GoCardless webhook idempotency has a TOCTOU race:**
- Symptoms: `processEvent` checks for an existing `webhookEvents` row, then inserts a new one in a separate statement. If GoCardless delivers the same event twice within milliseconds and both requests reach the API simultaneously, both pass the existence check before either insert completes.
- Files: `apps/api/src/routes/webhooks.ts:69-93`
- Trigger: GoCardless webhook retries when the API is slow; concurrent delivery to two API instances (future horizontal scaling).
- Impact: The same payment status transition runs twice. The state machine's `canTransition` guard prevents a double-transition of the payment row, but two `webhookEvents` rows are inserted for the same `eventId`, and any side effects in `handlePaymentEvent` run twice.
- Fix approach: Add a `UNIQUE` constraint on `webhookEvents.eventId` in the schema and catch `ER_DUP_ENTRY` in the insert call, replacing the check-then-act pattern.

**Auto-created payments from webhook have `amount: "0.00"`:**
- Symptoms: When the webhook handler receives an event for a GoCardless payment ID that has no matching `payments` row, it auto-creates a payment with `amount: "0.00"` and a note requesting review (line 179-196 in `webhooks.ts`). This payment is immediately visible in the landlord's payment list with a zero amount.
- Files: `apps/api/src/routes/webhooks.ts:179-196`
- Trigger: GoCardless creates and pays a direct debit before the landlord has manually created the payment record in Rentular, or when the `gocardlessPaymentId` link is missing from the local `payments` row.
- Impact: Landlord sees ghost payments with 0.00 amount in their dashboard requiring manual cleanup.
- Fix approach: Either pre-seed payment rows when a GoCardless payment is initiated via `POST /gocardless/payments`, or look up the expected amount from GoCardless before auto-creating the row.

---

## Security Considerations

**Encryption key derived from `AUTH_SECRET` shared with NextAuth JWT:**
- Risk: `apps/api/src/lib/encryption.ts` derives the AES-256-GCM key by applying SHA-256 to `process.env.AUTH_SECRET`. The same `AUTH_SECRET` is used by NextAuth for session JWT signing (`apps/api/src/lib/authMiddleware.ts:9` and `bankOAuthState.ts:21`). A compromise of `AUTH_SECRET` simultaneously breaks all three security boundaries: session authentication, OAuth state tokens, and bank token encryption at rest.
- Files: `apps/api/src/lib/encryption.ts:3-8`, `apps/api/src/lib/authMiddleware.ts:9`, `apps/api/src/lib/bankOAuthState.ts:21`
- Current mitigation: `AUTH_SECRET` is noted as mandatory in `.env.example`. Startup logs a warning if empty.
- Recommendations: Introduce a dedicated `ENCRYPTION_KEY` environment variable (32 bytes of random data, Base64-encoded) for the AES key. Reserve `AUTH_SECRET` exclusively for NextAuth. Rotate the bank connection tokens after introducing the new key.

**No rate limiting on `/auth/forgot-password` or `/auth/register`:**
- Risk: An unauthenticated caller can submit unlimited password-reset requests or registration attempts. Password-reset abuse causes email flooding of victims; uncapped registration opens user enumeration and spam.
- Files: `apps/api/src/routes/auth.ts:77-121` (forgot-password), `apps/api/src/routes/auth.ts:28-73` (register)
- Current mitigation: None. Hono has no global rate-limiting middleware configured.
- Recommendations: Apply per-IP rate limiting to `/auth/forgot-password` and `/auth/register` using `hono-rate-limiter` or a Redis-backed counter. Return 429 after 5 requests per IP per 15 minutes.

**CORS `origin` callback falls back to `allowedOrigins[0]` for unknown origins:**
- Risk: When a request arrives with an `Origin` header not in `allowedOrigins`, the CORS middleware returns `allowedOrigins[0]` (the web app URL) in the `Access-Control-Allow-Origin` response header instead of omitting the header. Browsers interpret this as allowing the response to be read from the listed origin, not the requesting origin — so cross-origin reads from attacker origins are still blocked by the browser. However, this is a misconfiguration that may cause confusing debugging and could interact unexpectedly with some browser preflight logic.
- Files: `apps/api/src/index.ts:71-75`
- Current mitigation: Session cookie is `__Secure-` prefixed (HTTPS-only) and CSRF middleware is applied.
- Recommendations: Return `null` (or omit the header) for unknown origins: `origin: (origin) => allowedOrigins.includes(origin) ? origin : null`.

**Smovin credentials persist in DB until user explicitly calls `DELETE /import/credentials`:**
- Risk: Third-party Smovin credentials (email + password, AES-256-GCM encrypted) are stored in `import_sessions` rows. If the discovery job fails per D-05 ("do NOT delete credentials per D-05 — user can retry"), credentials remain in the database indefinitely unless the user calls the credential-deletion endpoint.
- Files: `apps/api/src/jobs/importDiscoveryWorker.ts:372`, `apps/api/src/routes/import.ts:239-253`
- Current mitigation: Credentials are encrypted at rest. The frontend should call `DELETE /import/credentials` after import completes.
- Recommendations: Automatically wipe credentials in the discovery worker immediately after a successful login (before scraping begins), keeping only enough state to allow retries without re-entering credentials. Add a TTL-based cleanup job to remove credential columns from sessions older than 24 hours regardless of status.

**`authMiddleware` creates users from any valid NextAuth JWT, including social OAuth:**
- Risk: `ensureUser` in `apps/api/src/lib/authMiddleware.ts` creates a new `users` row if neither the email nor the `sub` claim matches an existing user. The generated fallback email is `${jwtUserId}@unknown` when the JWT has no email. This means a manipulated JWT that carries a novel `sub` would create a new user row.
- Files: `apps/api/src/lib/authMiddleware.ts:47-95`
- Current mitigation: The JWT must be valid (signed with `AUTH_SECRET` and decryptable), so forgery requires knowledge of the secret.
- Recommendations: Log the creation event clearly (already done), but also validate that the `sub` claim format matches expected NextAuth patterns before auto-creating. Consider requiring `emailVerified` for OAuth-created accounts before granting access to data-mutation routes.

---

## Performance Bottlenecks

**`paymentCheckWorker` Phase A: N+1 database queries per overdue payment:**
- Problem: For each overdue payment, the worker executes 4 separate `SELECT` queries sequentially: lease, tenant, property, owner, then settings. With N overdue payments across M owners, this produces up to 5N database round trips per cron run.
- Files: `apps/api/src/jobs/paymentCheckWorker.ts:73-216`
- Cause: Payments are fetched in bulk, then enriched one-by-one inside a `for...of` loop.
- Improvement path: Replace the inner loop with JOIN queries that pre-load lease, tenant, property, and owner data in a single query. Group payments by `ownerId` to load follow-up settings once per owner, not once per payment.

**`GET /gocardless/mandates` N+1 query + live GoCardless API call per mandate:**
- Problem: For each lease with a mandate, the handler executes 2 DB queries (tenant + property) and 1 live GoCardless API call (`getMandate`). With N mandates, this is 3N sequential I/O operations in a request that the landlord views in their dashboard.
- Files: `apps/api/src/routes/gocardless.ts:88-163`
- Cause: No batch mandate fetch from GoCardless. GoCardless does not support bulk mandate retrieval per their public API.
- Improvement path: Cache mandate status in a `mandateStatus` column on `leases`, refreshed by webhook events. Pre-join tenant and property in the initial query using Drizzle relations.

**DB connection pool has no configured `connectionLimit`:**
- Problem: `mysql.createPool` in `packages/db/src/connection.ts` uses mysql2 defaults (`connectionLimit: 10`). Under concurrent cron jobs (payment check + health index + landlord report all run as concurrent BullMQ workers sharing the same pool), 10 connections may be exhausted.
- Files: `packages/db/src/connection.ts:10-16`
- Cause: No explicit pool sizing.
- Improvement path: Set `connectionLimit`, `waitForConnections: true`, `queueLimit: 0` explicitly. Monitor pool usage via `pool.pool.totalConnections()`.

**Missing index on `payments.gocardlessPaymentId`:**
- Problem: The webhook handler looks up `payments` rows by `gocardlessPaymentId` (line 145 in `webhooks.ts`) with no dedicated index. The `payments` table has indexes on `(leaseId, status)` and `leaseId` only.
- Files: `packages/db/src/schema/payments.ts:58-61`, `apps/api/src/routes/webhooks.ts:144-146`
- Cause: Index was not added when the GoCardless payment ID column was introduced.
- Improvement path: Add `gocardlessPaymentIdx: index("payments_gocardless_idx").on(table.gocardlessPaymentId)` to the payments schema and run a migration.

**Missing index on `payments.dueDate`:**
- Problem: `paymentCheckWorker` filters `payments` with `lt(payments.dueDate, today)` on every cron invocation. There is no index on `dueDate`, causing a full table scan of `payments` three times per day.
- Files: `packages/db/src/schema/payments.ts`, `apps/api/src/jobs/paymentCheckWorker.ts:64`
- Cause: Index was not added to the payments schema.
- Improvement path: Add a composite index on `(status, dueDate)` to support the `status = "pending" AND dueDate < ?` query pattern used by the worker.

---

## Fragile Areas

**Ponto OAuth callback auth exemption via path-suffix check:**
- Files: `apps/api/src/index.ts:88-95`
- Why fragile: The exemption uses `c.req.path.endsWith("/bank-connections/callback")`. If a future route is added at any path ending with `/bank-connections/callback` (e.g., `/admin/bank-connections/callback`), it would inadvertently skip authentication. The exemption also runs inside a `for...of` loop over `protectedPrefixes`, so the middleware is registered once per prefix, creating multiple `use` handler layers — only the `/bank-connections` prefix fires the callback check, but the logic is easy to misread.
- Safe modification: Replace the string suffix check with an exact path constant check: `c.req.path === "/api/v1/bank-connections/callback"`.
- Test coverage: `apps/api/src/routes/__tests__/bankConnections.test.ts` covers the callback route, but the test likely mocks auth, so the middleware bypass logic itself is untested at the integration level.

**In-memory sync rate limiter resets on process restart:**
- Files: `apps/api/src/routes/bankConnections.ts:49-50`
- Why fragile: `lastSyncCallByConnection` is a `Map` in the process heap. A process restart (deployment, crash) resets all rate-limit state. With multiple API replicas the limiter provides no cross-instance protection. The comment on line 47-48 acknowledges this as a known limitation.
- Safe modification: Replace with a Redis-backed counter using `INCR` + `EXPIRE` (the `ioredis` client is already available). Key: `sync_rate:{connectionId}`, TTL: 60 seconds.

**Smovin scraper fragility against Cloudflare and UI changes:**
- Files: `apps/api/src/services/smovinScraper.ts`, `apps/api/src/jobs/importDiscoveryWorker.ts`
- Why fragile: The scraper depends on DOM selectors (`input[type="email"]`, `button:has-text(...)`) and a 30-second Cloudflare challenge timeout. Smovin can break the import silently by updating their SPA or tightening Cloudflare bot detection. The scraper carries the legal risk of violating Smovin's ToS.
- Safe modification: Do not make further investment in the scraper logic without first confirming Cloudflare bypass still works (`spikeTest.ts`). Treat the Smovin import as a best-effort, non-critical path. Add circuit-breaker logic to fail fast if Cloudflare blocks on the first page load rather than waiting 30 seconds.
- Test coverage: No tests exist for `smovinScraper.ts` or `smovinMapper.ts`.

**`bankConnectionSync.ts` matchStatus update is approximate ("best-effort"):**
- Files: `apps/api/src/services/bankConnectionSync.ts:183-215`
- Why fragile: The service updates `bank_statements.matchStatus` for all newly-inserted rows that have a structured communication, using the aggregate `matchResult.matched > 0` count rather than per-row payment linkage. A row may be marked `matched` even if it was not the specific row that matched, and `matchedPaymentId` is never populated (remains `null`).
- Safe modification: Refactor `processIncomingTransactions` to return per-row match results including `paymentId`, then link them back to `bank_statements` rows precisely. The comment in `bankConnectionSync.ts:183` documents this limitation explicitly.
- Test coverage: `apps/api/src/services/__tests__/bankStatementImporter.test.ts` covers import but not the matchStatus update path.

**`propertyAccess.ts` uses a local `db()` wrapper with `as any` casts:**
- Files: `apps/api/src/lib/propertyAccess.ts:47-58, 77, 106, 124, 149`
- Why fragile: A custom function wraps `getDb()` with a hand-typed interface (select, insert, from, where) to work around Drizzle's type inference. This is a parallel and incorrect type layer that will diverge from the actual Drizzle API as the ORM upgrades. Four call sites cast to `as any` inside this wrapper.
- Safe modification: Use the actual Drizzle return type from `getDb()` directly. If Drizzle's relational query builder is needed, use `db.query.propertyManagers.findFirst(...)`.

---

## Scaling Limits

**BullMQ workers share the same Redis connection config as the API health check:**
- Current capacity: Redis is used for BullMQ queues (4 separate queues: `email`, `sms`, `payment-check`, `import-discovery`/`import-write`, `health-index`). All workers use the same `REDIS_HOST`/`REDIS_PORT` env vars with no connection pooling or namespace separation.
- Limit: A Redis memory limit or network partition will simultaneously kill all background job queues and the health check endpoint.
- Scaling path: Use Redis connection namespacing for BullMQ (key prefix per queue). Consider a dedicated Redis instance for job queues separate from the session/cache Redis.

**Ponto sync is serial across all active connections:**
- Current capacity: `paymentCheckWorker` Phase B iterates `activeConnections` sequentially with `for...of conn of activeConnections`. Each connection calls out to the Ponto API synchronously.
- Limit: With N active connections, each taking ~2-5 seconds for the Ponto API call, the cron job duration scales linearly. At ~100 connections the worker may run longer than the 10-minute cron interval.
- Scaling path: Use `Promise.allSettled` with a concurrency limit (e.g., 5 simultaneous syncs) or push each connection sync to a dedicated BullMQ job so failures are isolated and retried independently.

---

## Dependencies at Risk

**`nordigen-node` / GoCardless Bank Account Data (BAD):**
- Risk: GoCardless closed new registrations for their Bank Account Data (formerly Nordigen) product in mid-2025 (noted in `apps/api/src/lib/bankAccountData.ts:63`). The `GoCardlessBadProvider` class is a dormant reference implementation for existing accounts only.
- Impact: No new landlords can connect via `GoCardlessBadProvider`. The `nordigen-node` package is a dynamic import; if it is removed from `package.json` the error only surfaces at runtime when `BANK_DATA_PROVIDER=gocardless_bad` is set.
- Migration plan: `PontoConnectProvider` is the active provider for Phase 9. Remove `GoCardlessBadProvider` from `bankAccountData.ts` and `BANK_DATA_PROVIDER=gocardless_bad` from `getBankAccountDataProvider()` after confirming no existing accounts use it.

**`playwright-extra` + `puppeteer-extra-plugin-stealth` for Smovin import:**
- Risk: Browser automation against a Cloudflare-protected target is inherently fragile. Cloudflare updates detection heuristics regularly. The stealth plugin (`puppeteer-extra-plugin-stealth`) is a community project with no commercial support.
- Impact: The Smovin import feature (`apps/api/src/jobs/importDiscoveryWorker.ts`) silently fails if Cloudflare blocks the browser. The spike test (`spikeTest.ts`) must be run manually to verify viability.
- Migration plan: Evaluate Smovin's potential API (private API reverse-engineering) or a manual CSV export flow instead of browser automation.

**NextAuth.js 5.0.0-beta.25:**
- Risk: NextAuth 5 is still in beta as of the analysis date. The `authMiddleware.ts` manually replicates NextAuth's JWT decryption algorithm (`A256CBC-HS512` via HKDF) and depends on internal implementation details of `@auth/core/jwt.js`.
- Impact: A breaking beta-to-stable migration in NextAuth 5 could change the JWT encryption scheme without notice, breaking all session authentication.
- Migration plan: Pin to the current beta in `package.json` and test a migration when NextAuth 5 reaches stable. The custom HKDF decryption in `authMiddleware.ts` (lines 15-24) must be retested after any NextAuth upgrade.

---

## Test Coverage Gaps

**Core route handlers: zero test coverage:**
- What's not tested: `properties`, `tenants`, `leases`, `payments`, `indexation`, `webhooks`, `gocardless`, `stripe`, `import`, `propertyManagers` route files have no test files under `routes/__tests__/`.
- Files: `apps/api/src/routes/properties.ts`, `apps/api/src/routes/tenants.ts`, `apps/api/src/routes/leases.ts`, `apps/api/src/routes/payments.ts`, `apps/api/src/routes/indexation.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/routes/gocardless.ts`, `apps/api/src/routes/stripe.ts`, `apps/api/src/routes/import.ts`, `apps/api/src/routes/propertyManagers.ts`
- Risk: Payment state machine transitions, rent indexation calculations (Belgian health index), GoCardless webhook handling, and the mandate cascade cancellation run with no automated regression protection.
- Priority: High. Particularly `webhooks.ts` (payment state) and `indexation.ts` (financial calculations with Belgian law constraints).

**Critical services: zero test coverage:**
- What's not tested: `paymentStateMachine.ts` (state transition logic), `transactionMatcher.ts` (structured communication matching), `smovinMapper.ts` (data import mapping), `bankConnectionSync.ts` (token decrypt + fetch + match pipeline), `indexationEmail.ts` (Belgian rent indexation emails), `landlordReport.ts`, `healthIndex.ts`.
- Files: `apps/api/src/services/paymentStateMachine.ts`, `apps/api/src/services/transactionMatcher.ts`, `apps/api/src/services/smovinMapper.ts`, `apps/api/src/services/bankConnectionSync.ts`, `apps/api/src/services/indexationEmail.ts`
- Risk: `transactionMatcher.ts` auto-marks payments as `paid` based on structured communication matching. A bug here directly impacts landlord revenue. `paymentStateMachine.ts`'s `cascadeMandateCancellation` modifies multiple rows atomically without a database transaction.
- Priority: High for `transactionMatcher.ts` and `paymentStateMachine.ts`; Medium for the rest.

**`paymentStateMachine.cascadeMandateCancellation` has no database transaction:**
- What's not tested: The cascade cancel updates `payments`, `leases`, and `tenants` in three separate `UPDATE` statements. If the second or third update fails, the data is left in a partially-cancelled state.
- Files: `apps/api/src/services/paymentStateMachine.ts:99-129`, `apps/api/src/routes/webhooks.ts:218-247`
- Risk: Partially-cancelled mandate cascade leaves `payments` in `cancelled` while `leases.gocardlessMandateId` still points to the (cancelled) mandate or vice-versa.
- Priority: High.

**No frontend component tests:**
- What's not tested: None of the Next.js page components (`settings/page.tsx` at 1,225 lines, `leases/page.tsx` at 913 lines, `maintenance/page.tsx` at 867 lines) have associated test files. There is no Playwright/Cypress setup for E2E testing.
- Files: `apps/web/app/(dashboard)/settings/page.tsx`, `apps/web/app/(dashboard)/leases/page.tsx`, `apps/web/app/(dashboard)/payments/page.tsx`
- Risk: UI regressions in complex forms (lease creation, rent indexation wizard, mandate setup) go undetected.
- Priority: Medium.

---

## Missing Critical Features

**Subscription enforcement gate:**
- Problem: Stripe webhook handlers log events but do not persist subscription status. No middleware checks whether a user's subscription is active before allowing data creation (properties, leases, payments). Any registered user can create unlimited records regardless of payment.
- Blocks: Revenue model enforcement; plan-based feature gating (SMS reminders, unlimited leases, etc.).

**Manual payment reminder trigger:**
- Problem: `POST /payments/:id/remind` returns HTTP 501 with `"Payment reminders are not implemented yet."`.
- Files: `apps/api/src/routes/payments.ts:575-581`
- Blocks: Landlords cannot manually trigger a reminder outside the automated cron schedule.

**Support chat persistence:**
- Problem: The support chat routes at `apps/api/src/routes/support.ts` return placeholder responses (comments: `// Phase 7: implement support chat persistence`). Messages are not stored.
- Files: `apps/api/src/routes/support.ts:59, 169, 178`
- Blocks: Support conversation history.

**`GET /stripe/subscription` always returns `{ plan: null, status: "none" }`:**
- Problem: The subscription status endpoint always returns no plan regardless of what Stripe holds. The UI cannot show the current plan or gating messages.
- Files: `apps/api/src/routes/stripe.ts:166-173`
- Blocks: Plan display in settings UI; subscription management.

---

*Concerns audit: 2026-06-28*
