# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

**Extensive TODO markers throughout API routes:**
- Issue: Over 70+ TODO comments indicating incomplete implementations across payment, property manager, indexation, costs, and communication handlers
- Files: `apps/api/src/routes/` (payments.ts, gocardless.ts, propertyManagers.ts, indexation.ts, costs.ts, rentAdjustments.ts, communications.ts, webhooks.ts, stripe.ts, support.ts, settings.ts)
- Impact: Core business logic is stubbed out. Payments, reporting, and lifecycle events cannot persist state. Application cannot be used for actual payment collection without completing these implementations.
- Fix approach: Systematically implement each TODO, starting with payment persistence (block all other features), then webhook handlers, then report generation. Create a tracking issue per route.

**Webhook handlers return 200 OK without persisting state:**
- Issue: `apps/api/src/routes/webhooks.ts` processes GoCardless events (payment confirmation, mandate state changes, payouts) but all database updates are TODO comments (lines 83-88, 99-102, 118-121, 131-134, 156-159, 179-186, 198-201)
- Files: `apps/api/src/routes/webhooks.ts`
- Impact: High. Payment status updates from GoCardless are ignored. Mandates that fail/expire don't trigger lease state changes. Landlords never receive payment confirmations. Application silently loses critical payment state.
- Fix approach: Implement all TODO handlers immediately. Add idempotency tracking to prevent duplicate processing if webhooks retry. Test webhook delivery with GoCardless sandbox.

**Payment routes return 501 "not implemented" for all operations:**
- Issue: `apps/api/src/routes/payments.ts` stubs all endpoints (list, details, record, collect, retry, cancel, ignore) with `notImplemented()` responses
- Files: `apps/api/src/routes/payments.ts`
- Impact: Critical. Users cannot view payment history, record manual payments, or trigger GoCardless collections. Frontend will crash or show empty states. No payment data flows through system.
- Fix approach: Implement payment CRUD and filtering. Ensure payment persistence in webhooks works first, then implement manual recording and GoCardless triggering.

**Type-safety violations with loose typing:**
- Issue: Dynamic require imports use `let db: any` pattern in multiple routes (`apps/api/src/routes/properties.ts` lines 7-20, similar patterns in tenants.ts, leases.ts). These bypass TypeScript checking for database imports.
- Files: `apps/api/src/routes/properties.ts`, `apps/api/src/routes/tenants.ts`, `apps/api/src/routes/leases.ts`
- Impact: Medium. Breaks at runtime if @rentular/db module structure changes. Hides type errors in database operations. No IDE autocomplete.
- Fix approach: Use proper TypeScript imports. Create a shared database service module that all routes use. Test module resolution in CI.

**Memory store fallback pattern creates data consistency issues:**
- Issue: Routes try database first, catch errors, then fall back to in-memory store (`apps/api/src/routes/properties.ts` lines 96-120, 135-157). Database failures are swallowed and data is lost on process restart.
- Files: `apps/api/src/routes/properties.ts`, potentially other routes
- Impact: Medium. Users think data is saved but it's only in memory. Multi-instance deployments lose data. No audit trail of failures.
- Fix approach: Fail fast on database errors (don't hide them). Remove memory fallback entirely. Make database mandatory. Fix connection pooling issues instead.

**Environment defaults in connection string:**
- Issue: `packages/db/src/connection.ts` uses hardcoded defaults (lines 10-16): `host: "localhost"`, `user: "rentular"`, `password: "rentular"`
- Files: `packages/db/src/connection.ts`
- Impact: Medium. Development credentials in code. Risk of production deployments using wrong defaults if env vars are accidentally unset.
- Fix approach: Require explicit environment variables. Throw error if critical vars are missing (host, user, password). Document in README.

---

## Known Bugs

**Payment fee calculation may not apply correctly:**
- Symptoms: Late payment fees (administrative fees) may be waived incorrectly or charged inconsistently. In `apps/api/src/services/paymentFollowUp.ts` line 100, soft enforcement grace period calculation depends on `feeChargedDate` being set, but this is never recorded in webhook handlers (TODOs).
- Files: `apps/api/src/services/paymentFollowUp.ts` (shouldWaiveFee function), `apps/api/src/routes/webhooks.ts` (TODO handlers)
- Trigger: Create a payment > exceed due date > trigger formal reminder > set late fee > receive webhook that fee was charged > tenant pays within grace period. The waiver logic can't run because feeChargedDate is not in database.
- Workaround: None currently—fees will either never be charged or never waived.

**Health index indexation endpoint is unimplemented stub:**
- Symptoms: `/api/v1/indexation/health-index` returns all-zero values (lines 16-25 in `apps/api/src/routes/indexation.ts`)
- Files: `apps/api/src/routes/indexation.ts`
- Trigger: Rent indexation calculations depend on this endpoint. Any rent adjustment calculations will use 0 as health index.
- Workaround: None. Index values must be hardcoded or API must call external Statbel service.

---

## Security Considerations

**Webhook signature verification exists but handlers are stubbed:**
- Risk: `apps/api/src/routes/webhooks.ts` correctly verifies GoCardless webhook signatures (lines 25-28, 64-86 in gocardless.ts). However, all payload handlers are unimplemented (TODO comments). An attacker's forged webhook could slip through verification and get logged as "received" without state changes.
- Files: `apps/api/src/routes/webhooks.ts`, `apps/api/src/lib/gocardless.ts`
- Current mitigation: Signature verification is present (timingSafeEqual used correctly)
- Recommendations: Implement all TODO handlers so verified events actually update state. Add replay attack protection (idempotency key tracking). Log all webhook events to audit trail with their verification status.

**No CSRF protection on state-changing endpoints:**
- Risk: Routes modify data (PATCH, POST, DELETE) without CSRF token validation. API uses `credentials: true` CORS (apps/api/src/index.ts line 54) which allows cross-origin requests from authenticated sessions.
- Files: `apps/api/src/index.ts` (CORS config), all routes in `apps/api/src/routes/`
- Current mitigation: Uses Hono framework's middleware but no CSRF implementation visible
- Recommendations: Implement CSRF tokens for state-changing requests. Consider SameSite cookie policy. Validate Origin/Referer headers. Document CORS restrictions.

**Auth middleware defers to NextAuth but has fallback logic:**
- Risk: `apps/api/src/lib/authMiddleware.ts` creates users on first login (lines 92-100) using JWT sub ID if email lookup fails. No duplicate prevention if JWT sub changes between sessions. Email normalization is done but not consistently applied to all lookups.
- Files: `apps/api/src/lib/authMiddleware.ts`
- Current mitigation: User lookup by email first, then by ID. Tries to prevent duplicates.
- Recommendations: Use email as primary key for user identity (immutable). Hash/normalize email in database schema. Add unique constraint. Test OAuth provider behavior across session rotations.

**Secrets in error logs:**
- Risk: Errors are logged to console with full stack traces. No sanitization of error objects that may contain API keys, tokens, or PII.
- Files: All routes and services use `console.error()` without filtering
- Current mitigation: None visible
- Recommendations: Create error logging wrapper that strips sensitive fields. Use structured logging with redaction rules. Never log request/response bodies containing passwords or tokens.

**Default database password used in docker-compose:**
- Risk: `docker-compose.yml` sets `MARIADB_PASSWORD: rentular` (line 12). If this is committed as-is, anyone with repo access sees a production-like credential.
- Files: `docker-compose.yml`, `.env.example`
- Current mitigation: docker-compose has variable substitution with defaults
- Recommendations: Never include real secrets in docker-compose. Generate random defaults in scripts. Use .env.local (gitignored) for overrides. Document secure local setup.

---

## Performance Bottlenecks

**Large frontend pages with embedded data:**
- Problem: `apps/web/app/(dashboard)/settings/page.tsx` is 1011 lines. `apps/web/data/belgian-postcodes.ts` is 973 lines of hardcoded postal code data. Landing page `app/page.tsx` is 702 lines. These large components may cause slow initial page loads and excessive re-renders.
- Files: `apps/web/app/(dashboard)/settings/page.tsx`, `apps/web/data/belgian-postcodes.ts`, `apps/web/app/page.tsx`
- Cause: Postal code data bundled into frontend code. No code splitting or lazy loading for settings page. State management with multiple useState calls.
- Improvement path: Extract belgian-postcodes.ts to API endpoint or external JSON file. Code-split settings page. Use React.memo() for expensive child components. Implement virtual scrolling for postal code list.

**Email queue rate limiting via environment variable:**
- Problem: `apps/api/src/index.ts` line 98 logs `${process.env.EMAIL_RATE_LIMIT || 30}/min` but rate limiting implementation is not visible in emailQueueWorker
- Files: `apps/api/src/index.ts`, `apps/api/src/jobs/emailQueueWorker.ts`
- Cause: Rate limiting may not be enforced. If hundreds of payment reminders are queued, SMTP server could be overwhelmed.
- Improvement path: Check rate limiting implementation in emailQueueWorker. Use token bucket algorithm. Test with load test (1000+ emails in queue). Consider batching.

**No database indexing visible in schema:**
- Problem: `packages/db/src/schema/` files define tables but no composite indexes for common queries (e.g., payments by leaseId + status, properties by ownerId)
- Files: `packages/db/src/schema/payments.ts`, `packages/db/src/schema/properties.ts`, `packages/db/src/schema/leases.ts`
- Cause: Drizzle ORM schema files don't show index definitions. Queries like `WHERE ownerId = ? AND status = ?` will full-table scan.
- Improvement path: Add .index() calls in schema for foreign key + status combinations. Profile query performance with `EXPLAIN`. Target sub-100ms for list endpoints.

---

## Fragile Areas

**Property managers functionality is completely unimplemented:**
- Files: `apps/api/src/routes/propertyManagers.ts`
- Why fragile: Endpoint signatures are defined but all business logic is TODO (lines 13, 19, 37, 49, 65, 73). Any frontend call will get empty data or 201 Created with no actual data written. Co-owner/manager roles are referenced in lease schema but role-based access control is not implemented anywhere.
- Safe modification: Cannot modify until all 6 TODO items are implemented and tested. Requires: property ownership verification, role-based access control, invitation email, acceptance flow. Add integration tests for each role's visibility.
- Test coverage: No tests visible. Need fixtures for user/property relationships and role transitions.

**Webhook event handling is skeleton implementation:**
- Files: `apps/api/src/routes/webhooks.ts`
- Why fragile: Handler functions exist for payments, mandates, payouts but have no implementation (TODO on every state change). If GoCardless changes event schema or adds new resource types, code will silently skip them. Event processing has no idempotency mechanism.
- Safe modification: Cannot add new event types or handlers without implementing all existing TODOs first. Changes to webhook payload schema would break without type errors (uses loose typing).
- Test coverage: No webhook tests visible. Need fixtures for all GoCardless event types.

**Complex settings page with multi-language email templates:**
- Files: `apps/web/app/(dashboard)/settings/page.tsx`
- Why fragile: 1011-line component with 4 language variants × 3 reminder levels × 2 message types (email + SMS) = 24 template combinations. Templates are hardcoded in DEFAULT_TEMPLATES object. No validation that template placeholders ({{tenantName}}, {{amount}}) match server implementation. Changes to available placeholders require coordinated updates.
- Safe modification: Extract DEFAULT_TEMPLATES to shared constants file. Add schema validation for template variables. Test that all placeholders are rendered. Document placeholder list.
- Test coverage: No visible tests for template rendering or placeholder substitution.

---

## Scaling Limits

**In-memory data fallback blocks horizontal scaling:**
- Current capacity: Single server instance can cache unlimited records in memory
- Limit: If database is unavailable, each server maintains separate in-memory state. No cross-instance sync. Properties created via Server A are invisible to Server B.
- Scaling path: Remove memory fallback entirely (see Tech Debt). Implement read replicas for database. Add circuit breaker pattern for database connection failures (fail fast instead of hanging). Use Redis for distributed caching.

**Email queue worker is single-threaded:**
- Current capacity: Default 30 emails/minute (from .env.example)
- Limit: BullMQ queue can buffer unlimited messages but single worker thread processes sequentially. If 1000 payment reminders are queued, sending takes 33+ minutes.
- Scaling path: Increase worker concurrency setting in BullMQ. Use multiple queue workers (BullMQ supports distributed workers). Monitor queue depth and alert when backlog grows.

**No connection pooling configuration visible:**
- Current capacity: Default mysql2 pool size (default is 10 connections)
- Limit: 10 concurrent database operations. Under load with 100+ concurrent users, requests queue and timeout.
- Scaling path: Configure pool size in `packages/db/src/connection.ts`. Profile with load test. Set `waitForConnections: true` and reasonable timeout. Add monitoring for pool exhaustion.

---

## Dependencies at Risk

**GoCardless SDK is external dependency without version pinning context:**
- Risk: SDK uses dynamic require pattern (`const GoCardless = require("gocardless-nodejs")` in apps/api/src/lib/gocardless.ts line 2). If major version changes API, code breaks at runtime with no compile-time warning.
- Files: `apps/api/src/lib/gocardless.ts`, `apps/api/src/routes/gocardless.ts`
- Impact: Payment collection stops working silently
- Migration plan: Pin exact version in package.json. Create SDK wrapper with stable internal API. Test upgrade path with GoCardless sandbox before updating. Document required SDK version.

**NextAuth.js cookie decryption is sensitive to configuration changes:**
- Risk: `apps/api/src/lib/authMiddleware.ts` manually implements HKDF key derivation to decrypt NextAuth cookies (lines 11-20). This is fragile to NextAuth version changes. If AUTH_SECRET rotates, all existing tokens become invalid.
- Files: `apps/api/src/lib/authMiddleware.ts`
- Impact: User lockout during AUTH_SECRET rotation
- Migration plan: Use NextAuth provided utilities if available instead of manual HKDF. Test token decryption after any NextAuth upgrade. Document AUTH_SECRET rotation procedure.

---

## Missing Critical Features

**Payment persistence layer is non-functional:**
- Problem: No way to record payments, query history, or calculate overdue amounts. `/api/v1/payments/*` endpoints return 501 Not Implemented. Payment reminders can be triggered (service exists) but paymentId references don't persist.
- Blocks: Payment follow-up feature, landlord reporting, rent indexation (depends on knowing payment status), Stripe/GoCardless integration
- Priority: CRITICAL—blocks MVP usage

**Property manager access control is not implemented:**
- Problem: `apps/api/src/routes/propertyManagers.ts` has route skeleton only. Co-owners and managers cannot be invited or access properties. All other routes assume single owner.
- Blocks: Multi-owner properties, delegation of management tasks, accountant access
- Priority: HIGH—limits product positioning

**Indexation calculations are incomplete:**
- Problem: Health index endpoint returns zeros. Flanders EPC restrictions are partially implemented (function exists but never called). No rent adjustment calculations in API.
- Blocks: Automatic rent indexation, compliance with Belgian rental law
- Priority: HIGH—product is non-compliant without this

**Cost and expense tracking is stubbed:**
- Problem: `apps/api/src/routes/costs.ts` is 95 lines of TODO comments. Maintenance expenses, utilities, ancillary costs have no CRUD operations.
- Blocks: Expense reporting, cost sharing across tenants, payment breakdowns (rent + charges)
- Priority: MEDIUM—affects landlord reporting features

---

## Test Coverage Gaps

**Webhook security and idempotency untested:**
- What's not tested: GoCardless webhook processing. Signature verification works but handlers are stubs. No test for replay attacks (same event processed twice) or out-of-order events.
- Files: `apps/api/src/routes/webhooks.ts`, `apps/api/src/lib/gocardless.ts`
- Risk: Silent payment duplication, missed payment confirmations, mandate lifecycle bugs
- Priority: CRITICAL—payment path must be bulletproof

**Auth middleware token decryption untested:**
- What's not tested: NextAuth cookie decryption with HKDF derivation. Null/invalid tokens. Different OAuth providers. Token expiration.
- Files: `apps/api/src/lib/authMiddleware.ts`
- Risk: Auth bypass, user impersonation, unauthenticated access to protected routes
- Priority: CRITICAL—security feature

**Database fallback/memory store interaction untested:**
- What's not tested: Error handling when database is unavailable. Behavior when database comes back online after memory store used. Data consistency between stores.
- Files: `apps/api/src/routes/properties.ts`, similar patterns in tenants/leases
- Risk: Data loss, orphaned records, inconsistent state across replicas
- Priority: MEDIUM—reliability issue

**Property manager role-based access untested:**
- What's not tested: Everything. No tests for role-based visibility (owner sees all properties, manager sees only assigned properties, accountant sees financial data only).
- Files: All routes that should respect propertyManagers.role
- Risk: Data exposure, unauthorized modifications, broken access control
- Priority: HIGH—fundamental security feature

**Email template variable substitution untested:**
- What's not tested: Placeholder replacement ({{tenantName}}, {{amount}}, etc.). Multi-language rendering. Missing placeholders (should not send broken emails).
- Files: `apps/api/src/services/paymentFollowUp.ts`, `apps/web/app/(dashboard)/settings/page.tsx` (template definitions)
- Risk: Tenants receive emails with unreplaced placeholders like "Hello {{tenantName}}" or get wrong language
- Priority: MEDIUM—user-facing quality issue

---

*Concerns audit: 2026-03-22*
