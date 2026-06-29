<!-- refreshed: 2026-06-28 -->
# Architecture

**Analysis Date:** 2026-06-28

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js 15 SSR + React 19)                            │
│                            apps/web/app/                                                │
│   (marketing)/   (auth)/login   (dashboard)/*   onboarding/   /api/auth/[...nextauth]  │
└────────────────────────────────────┬────────────────────────────────────────────────────┘
                                     │ HTTPS + session cookie
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        Hono API  /api/v1/*   (apps/api/src/index.ts)                    │
│  Middleware: logger → prettyJSON → CORS → CSRF → authMiddleware → requireAuth           │
├──────────┬────────────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│properties│  tenants   │  leases  │ payments │ indexation│ webhooks │  bank-   │ import  │
│ /tenants │  /leases   │          │          │ /settings │ /stripe  │connections│        │
│ /costs   │            │          │          │ /gocardless│/comms  │/bank-accts│         │
│ /prop-   │            │          │          │ /rent-adj │ /maint  │           │         │
│  managers│            │          │          │           │ /support│           │         │
└────────┬─┴────────────┴──────────┴────────┬─┴──────────┴──────────┴─────┬─────┴────────┘
         │                                   │                              │
         ▼                                   ▼                              ▼
┌──────────────────┐  ┌──────────────────────────────────┐  ┌─────────────────────────────┐
│   Services layer │  │         BullMQ Job Queues         │  │   External Providers        │
│ apps/api/src/    │  │   email-queue   sms-queue         │  │   Ponto (Ibanity) OAuth     │
│ services/        │  │   payment-check health-index-     │  │   GoCardless SEPA DD        │
│                  │  │   refresh   landlord-report        │  │   Stripe billing            │
│ paymentState-    │  │   webhook-cleanup                  │  │   Statbel health index API  │
│   Machine.ts     │  │   import-discovery import-write   │  │   Smovin (Playwright scrape)│
│ bankConnectionS- │  └──────────────────────────────────┘  │   SMTP email / SMS providers│
│   ync.ts         │                                         └─────────────────────────────┘
│ transactionMat-  │
│   cher.ts        │
│ bankStatement-   │
│   Importer.ts    │
│ healthIndex.ts   │
│ paymentFollowUp  │
│ smovinScraper/   │
│   Mapper.ts      │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                     packages/db  (Drizzle ORM + MySQL)                                   │
│  getDb() → singleton connection pool                                                     │
│  Schema: users · properties · tenants · leases · payments · indexation · costs           │
│          bankAccounts · bankConnections · bankStatements · webhookEvents                  │
│          propertyManagers · communications · smtpSettings · maintenance · imports         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                    +
                         Redis (BullMQ job queue)
```

## Component Responsibilities

| Component | Responsibility | Entry File |
|-----------|----------------|------------|
| `apps/web` | Next.js 15 SSR frontend; auth, dashboard UI, onboarding, i18n | `apps/web/app/layout.tsx` |
| `apps/web/middleware.ts` | Request guard: locale routing, auth redirect, onboarding gate | `apps/web/middleware.ts` |
| `apps/api/src/index.ts` | Hono server; mounts all routers, applies global middleware, starts job schedules | `apps/api/src/index.ts` |
| `apps/api/src/routes/` | Domain REST routers (one file per resource) | `apps/api/src/routes/*.ts` |
| `apps/api/src/services/` | Stateless business logic called by routes and workers | `apps/api/src/services/*.ts` |
| `apps/api/src/jobs/` | BullMQ workers + schedule setup | `apps/api/src/jobs/*.ts` |
| `apps/api/src/lib/` | Cross-cutting utilities: auth, encryption, SMTP, SMS, bank providers | `apps/api/src/lib/*.ts` |
| `packages/db` | Drizzle schema, `getDb()` singleton, migrations | `packages/db/src/` |
| `packages/shared` | TypeScript types, domain constants, Belgian rental law constants | `packages/shared/src/` |

## Pattern Overview

**Overall:** Turborepo monorepo with a clean API-first, domain-layered backend and a Next.js SSR frontend.

**Key Characteristics:**
- One Hono router file per resource domain; routers are pure HTTP concerns only.
- Business logic lives in `services/` and is imported by both routes and BullMQ workers.
- Background jobs (`jobs/`) orchestrate scheduling and queue management; heavy computation delegates to services.
- Database access is direct Drizzle ORM — no repository abstraction layer.
- Auth state is shared via a NextAuth.js cookie that the API decrypts with the same `AUTH_SECRET`.

## Layers

**Frontend (Next.js):**
- Purpose: Render UI, handle NextAuth sessions, serve translated pages.
- Location: `apps/web/app/`
- Contains: Route groups `(auth)`, `(dashboard)`, `(marketing)`; server components; client components under `apps/web/components/`.
- Depends on: NextAuth.js cookie session, Hono API via `fetch`.
- Used by: Browser.

**API (Hono):**
- Purpose: Validate requests, enforce auth, dispatch to services, return JSON.
- Location: `apps/api/src/routes/`
- Contains: 19 domain routers mounted at `/api/v1/*`.
- Depends on: `services/`, `lib/`, `@rentular/db`.
- Used by: Frontend and external webhook callers (GoCardless, Stripe).

**Services:**
- Purpose: Business logic that is reusable across routes and workers.
- Location: `apps/api/src/services/`
- Contains: `paymentStateMachine.ts`, `bankConnectionSync.ts`, `transactionMatcher.ts`, `bankStatementImporter.ts`, `paymentFollowUp.ts`, `healthIndex.ts`, `landlordReport.ts`, `indexationEmail.ts`, `smovinScraper.ts`, `smovinMapper.ts`, `webhookCleanup.ts`.
- Depends on: `@rentular/db`, `lib/`.
- Used by: Routes and BullMQ workers.

**Jobs (BullMQ workers):**
- Purpose: Async background processing on Redis queues; scheduled cron tasks.
- Location: `apps/api/src/jobs/`
- Contains: `emailQueueWorker.ts`, `smsQueueWorker.ts`, `paymentCheckWorker.ts`, `landlordReportWorker.ts`, `healthIndexWorker.ts`, `importDiscoveryWorker.ts`, `importWriteWorker.ts`.
- Depends on: Services, `@rentular/db`.
- Used by: Auto-imported by `index.ts`; schedules registered at startup.

**Lib (utilities):**
- Purpose: Cross-cutting concerns with no domain logic.
- Location: `apps/api/src/lib/`
- Contains: `authMiddleware.ts`, `routeAuth.ts`, `propertyAccess.ts`, `encryption.ts`, `email.ts`, `sms.ts`, `gocardless.ts`, `bankAccountData.ts`, `pontoConnect.ts`, `bankOAuthState.ts`, `bankAccountData.ts`, `adminNotify.ts`.
- Depends on: `@rentular/db`, external SDKs.
- Used by: Routes, services, jobs.

**Database package:**
- Purpose: Single Drizzle ORM client instance; schema definitions; migrations.
- Location: `packages/db/src/`
- Contains: 17 schema files exported via `packages/db/src/schema/index.ts`; `getDb()` factory.
- Depends on: `mysql2`, `drizzle-orm`.
- Used by: API app; `web` app (NextAuth adapter).

**Shared package:**
- Purpose: Types and constants shared between API and web without runtime coupling.
- Location: `packages/shared/src/`
- Contains: `types/index.ts` (domain types), `constants/index.ts` (Belgian law constants, cron schedules, email templates), `validation/index.ts` (Zod schemas).
- Depends on: `zod`.
- Used by: Both `apps/api` and `apps/web`.

## Data Flow

### Authenticated REST Request

1. Browser sends request with `__Secure-authjs.session-token` cookie to `apps/api/src/index.ts`.
2. `authMiddleware` (`apps/api/src/lib/authMiddleware.ts`) decrypts the NextAuth JWE using HKDF-derived key, resolves `userId` and attaches it to Hono context.
3. `requireAuth` (`apps/api/src/lib/routeAuth.ts`) rejects unauthenticated calls with 401.
4. Domain router handler calls `getRequiredUserId(c)` and queries the DB via `getDb()`.
5. Response returned as `c.json(data)`.

### Payment Follow-up Flow (Cron, 3x/day)

1. `setupPaymentCheckSchedule()` (`apps/api/src/jobs/paymentCheckWorker.ts`) registers BullMQ cron at 00:00, 10:00, 17:00 from `BALANCE_CHECK_CRON` (`packages/shared/src/constants/index.ts`).
2. **Phase A:** Worker queries overdue `payments` rows. `determineReminderLevel()` and `sendReminder()` from `apps/api/src/services/paymentFollowUp.ts` select escalation level (friendly/formal/final).
3. **Phase B:** Worker iterates active `bank_connections`, calls `syncBankConnection(conn.id)` from `apps/api/src/services/bankConnectionSync.ts` for each.
   - `bankConnectionSync` decrypts OAuth tokens via `apps/api/src/lib/encryption.ts`, calls `PontoConnectProvider.getTransactions()`.
   - New transactions persisted to `bank_statements` by `apps/api/src/services/bankStatementImporter.ts` (AES-256-GCM encrypted PII, MySQL dedup key).
   - `processIncomingTransactions()` from `apps/api/src/services/transactionMatcher.ts` matches Belgian OGM-VCS structured communications to pending payments.
   - Exact amount matches auto-mark payment `paid` via DB update.
4. **Phase C:** Consent expiry check — warns landlords 7 and 1 day before PSD2 consent expires via `queueEmail()`.

### Ponto OAuth Connection Flow

1. Landlord POSTs `institutionId` to `POST /api/v1/bank-connections` (`apps/api/src/routes/bankConnections.ts`).
2. Route signs 10-minute OAuth state JWT via `signOAuthState()` (`apps/api/src/lib/bankOAuthState.ts`), creates pending `bank_connections` row, returns Ponto authorization URL.
3. Landlord authorizes at Ponto. Browser redirects to `GET /api/v1/bank-connections/callback` with `code` + `state`.
4. Callback verifies state JWT, exchanges authorization code via `exchangeAuthorizationCode()` (`apps/api/src/lib/pontoConnect.ts`), encrypts tokens with AES-256-GCM, updates `bank_connections` row to `active`.
5. Browser redirected to `/dashboard/bank-connections/{id}?connected=1`.

### Smovin Import Flow

1. Landlord submits credentials via `POST /api/v1/import` — credentials encrypted and stored in `import_sessions`.
2. `importDiscoveryQueue` job (`apps/api/src/jobs/importDiscoveryWorker.ts`) launches stealth Playwright browser, scrapes Smovin's `web.smovin.app/nl/patrimony/contracts/` pages.
3. Discovered properties stored as JSON in `import_sessions.discoveredData`.
4. Landlord selects which properties to import; `importWriteQueue` job (`apps/api/src/jobs/importWriteWorker.ts`) maps data via `smovinMapper.ts` and inserts into Drizzle tables.

### Health Index Refresh (Daily Cron)

1. `setupHealthIndexSchedule()` registers daily 06:00 UTC BullMQ job.
2. `healthIndexWorker.ts` calls `fetchAndCacheHealthIndex()` from `apps/api/src/services/healthIndex.ts`.
3. Service fetches Statbel beSTAT API, upserts into `healthIndexValues` table.

**State Management:**
- Server state: MySQL database via Drizzle ORM is single source of truth.
- Client state: React `useState` / `fetch` for transient UI; `@tanstack/react-query` for server cache.
- Job state: BullMQ Redis queues for async work; `import_sessions` table for import progress.

## Key Abstractions

**`BankAccountDataProvider` interface:**
- Purpose: Provider-agnostic PSD2 bank data access (Ponto, GoCardless BAD).
- File: `apps/api/src/lib/bankAccountData.ts`
- Pattern: Interface + factory `getBankAccountDataProvider(tokens?)`. `PontoConnectProvider` is default; `GoCardlessBadProvider` is legacy dormant fallback.

**`getDb()` singleton:**
- Purpose: Returns a cached Drizzle ORM instance; initializes connection pool on first call.
- File: `packages/db/src/` (connection factory).
- Pattern: Module-level singleton; never call `new Pool()` directly.

**`encrypt()` / `decrypt()` triplet:**
- Purpose: AES-256-GCM at-rest encryption for PII (bank tokens, counterparty names/IBANs, Smovin credentials).
- File: `apps/api/src/lib/encryption.ts`
- Pattern: Always store three columns per secret: `encrypted` (base64), `iv` (base64), `tag` (base64).

**Payment state machine:**
- Purpose: Validates and applies GoCardless payment status transitions; prevents out-of-order webhook replays.
- File: `apps/api/src/services/paymentStateMachine.ts`
- Pattern: `canTransition(from, to)` guard before any `payments.status` DB update; `transitionPayment()` for safe updates.

**`signOAuthState()` / `verifyOAuthState()`:**
- Purpose: 10-minute HS256 JWT for CSRF-safe Ponto OAuth callback binding.
- File: `apps/api/src/lib/bankOAuthState.ts`
- Pattern: Sign on consent initiation, verify on callback; nonce prevents replay within window.

**`zValidator` middleware:**
- Purpose: Automatic 400 on schema violation; typed `c.req.valid("json")` inside handler.
- Pattern: All mutating route handlers use `zValidator("json", z.object({...}))` or `zValidator("query", ...)`.

## Entry Points

**Web app:**
- Location: `apps/web/app/layout.tsx` (NextIntl provider, root layout), `apps/web/middleware.ts` (request guard).
- Triggers: Browser navigation.
- Responsibilities: i18n context, auth redirect, onboarding gate.

**API server:**
- Location: `apps/api/src/index.ts`.
- Triggers: HTTP requests to `/api/v1/*`.
- Responsibilities: Mount 19 routers, apply global middleware, register job schedules.

**NextAuth handler:**
- Location: `apps/web/app/api/auth/[...nextauth]/route.ts`.
- Triggers: NextAuth sign-in flows (OAuth, credentials).
- Responsibilities: Issue encrypted JWE session cookie consumed by both web and API.

**Background workers (auto-started on `index.ts` import):**
- `apps/api/src/jobs/emailQueueWorker.ts` — queue: `email-queue`
- `apps/api/src/jobs/smsQueueWorker.ts` — queue: `sms-queue`
- `apps/api/src/jobs/paymentCheckWorker.ts` — cron: 00:00, 10:00, 17:00
- `apps/api/src/jobs/landlordReportWorker.ts` — cron: daily 08:00
- `apps/api/src/jobs/healthIndexWorker.ts` — cron: daily 06:00 UTC
- `apps/api/src/jobs/importDiscoveryWorker.ts` — queue: `import-discovery` (on-demand)
- `apps/api/src/jobs/importWriteWorker.ts` — queue: `import-write` (on-demand)
- `apps/api/src/services/webhookCleanup.ts` — cron: weekly Sunday 03:00

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. BullMQ workers run in-process but are async and non-blocking. Playwright (Smovin scraper) runs at `concurrency: 1` to avoid multi-browser resource exhaustion.
- **Global state:** `getDb()` module-level singleton in `packages/db`. `lastSyncCallByConnection` in-memory Map in `apps/api/src/routes/bankConnections.ts` (per-process rate limiter for `/sync`).
- **Circular imports:** None detected. `packages/db` ← `apps/api/src` ← never back-imports `apps/web`.
- **Auth contract:** API and web share `AUTH_SECRET`. API derives HKDF key matching Auth.js (`getDerivedEncryptionKey` in `authMiddleware.ts`); deviation breaks session decryption silently.
- **CSRF exemption:** Webhook routes (`/webhooks/*`, `/stripe/webhook`) skip CSRF middleware — they rely on provider signature verification instead. OAuth callback (`/bank-connections/callback`) skips `requireAuth` but is gated by the OAuth state JWT.
- **Token sanitization:** Encrypted token columns on `bank_connections` are stripped by `sanitizeConnection()` before any API response. They must never appear in logs or responses.

## Anti-Patterns

### Direct status assignment on payments

**What happens:** Calling `db.update(payments).set({ status: "..." })` directly without going through `transitionPayment()`.
**Why it's wrong:** Skips `canTransition()` guard; allows illegal state transitions that break GoCardless webhook idempotency.
**Do this instead:** Always call `transitionPayment(paymentId, newStatus)` from `apps/api/src/services/paymentStateMachine.ts`.

### In-process memory for cross-request state

**What happens:** `lastSyncCallByConnection` Map lives in-process in `apps/api/src/routes/bankConnections.ts`.
**Why it's wrong:** In a multi-process deployment the rate limit is per-process only; multiple instances bypass the 1/min guard.
**Do this instead:** Migrate rate limit tracking to Redis (documented as future work in `bankConnections.ts` line 49 comment).

### Querying all pending payments inside a per-payment loop

**What happens:** `paymentCheckWorker.ts` Phase A runs per-payment DB queries (lease, tenant, property, owner) inside a for-loop over `overduePayments`.
**Why it's wrong:** N+1 query pattern on large landlord portfolios.
**Do this instead:** Use Drizzle join to load all required data in a single query before the loop.

## Error Handling

**Strategy:**
- Routes: try-catch returning `c.json({ error: message }, statusCode)`. Zod validation auto-returns 400.
- Services: throw on failure (callers decide severity).
- Workers: inner per-item try-catch logs error and continues; job-level failures tracked by BullMQ (retry count in job options).
- Webhook dedup: `webhookEvents` table with `status` enum; cleanup service removes events older than 12 months.

**Patterns:**
- `app.onError((err, c) => c.json({ error: "Internal server error" }, 500))` in `index.ts` as last-resort catch.
- `app.notFound((c) => c.json({ error: "Not found" }, 404))`.
- MySQL `ER_DUP_ENTRY` (code 1062) swallowed in `bankStatementImporter.ts` for transaction dedup.

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` with `[Component]` prefix in square brackets (e.g., `[BankSync]`, `[PaymentCheck]`, `[TransactionMatcher]`).
**Validation:** Zod via `@hono/zod-validator` for all request bodies; `packages/shared/src/validation/index.ts` for shared schemas.
**Authentication:** NextAuth.js cookie (web) + `authMiddleware.ts` HKDF decryption (API). Property-level RBAC enforced by `propertyAccess.ts` (5 roles: owner, co_owner, manager, accountant, viewer).
**Encryption at rest:** AES-256-GCM triplet (`encrypted`, `iv`, `tag`) via `apps/api/src/lib/encryption.ts`; used for bank OAuth tokens, counterparty PII in bank_statements, and Smovin credentials in import_sessions.
**i18n:** `next-intl` on frontend; messages in `apps/web/messages/{en,nl,fr,de}/common.json`. Email templates multilingual via `DEFAULT_EMAIL_TEMPLATES` in `packages/shared/src/constants/index.ts`. API returns structured data only; translations are frontend responsibility.

---

*Architecture analysis: 2026-06-28*
