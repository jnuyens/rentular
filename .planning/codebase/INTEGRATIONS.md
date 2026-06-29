# External Integrations

**Analysis Date:** 2026-06-28

## APIs & External Services

### Payment Collection (SEPA Direct Debit)

**GoCardless (Collect):**
- Purpose: SEPA direct debit mandate setup and rent collection for tenants
- SDK: `gocardless-nodejs` 4.2.0 (`apps/api/src/lib/gocardless.ts`)
- Client: Singleton `getGoCardlessClient()` initialized on first use; supports `Sandbox` and `Live` environments
- Operations: create customers, billing requests, billing request flows, payments (in EUR cents), retries, cancellations, mandate management
- Webhooks: receives `payments.*` and `mandates.*` events at `POST /api/v1/webhooks/gocardless` (`apps/api/src/routes/webhooks.ts`)
- Webhook verification: HMAC-SHA256, constant-time comparison (`verifyWebhookSignature()`)
- Env vars: `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_ENVIRONMENT` (`sandbox` or `live`), `GOCARDLESS_WEBHOOK_SECRET`

### Subscription Billing

**Stripe:**
- Purpose: Rentular's own SaaS subscription billing (Starter/Standard/Professional plans); NOT used for rent collection
- SDK: `stripe` 20.4.1 (`apps/api/src/routes/stripe.ts`)
- Client: Initialized at module load with `STRIPE_SECRET_KEY`
- Operations: retrieve prices (with product expand), create Checkout sessions (subscription mode), verify webhook events
- Payment methods at checkout: `card`, `bancontact`, `ideal`
- Plans: Starter (€4/mo), Standard (€10/mo), Professional (€19/mo) — amounts fetched live from Stripe; static fallback if unconfigured
- Webhook: `POST /api/v1/stripe/webhook` — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Subscription persistence is stubbed (Phase 2 placeholder)
- Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_PROFESSIONAL`

### PSD2 / Open Banking (Bank Account Data)

**Ponto Connect (Ibanity) — primary provider:**
- Purpose: Landlord connects their Belgian bank account so the system polls for incoming rent transfers
- SDK: None — hand-written REST/OAuth2 client at `apps/api/src/lib/pontoConnect.ts`
- API base: `https://api.ibanity.com/ponto-connect` (production) / `https://api.ibanity.com/sandbox/ponto-connect` (sandbox)
- Auth base: `https://authorization.myponto.com` (production) / `https://authorization.myponto.com/sandbox` (sandbox)
- OAuth2 scopes: `ai`, `pi`, `name`, `offline_access`
- OAuth flow: authorization code (PKCE not required); state token is a HS256 JWT (`apps/api/src/lib/bankOAuthState.ts`, 10-min TTL)
- Callback route: `GET /api/v1/bank-connections/callback` — bypasses `requireAuth`; identity from state JWT
- Operations: `listAccounts`, `listTransactions` (with `filter[executionDate][gte]` pagination), `listFinancialInstitutions` (per country), `revokeAccess`
- Token storage: OAuth access + refresh tokens AES-256-GCM encrypted at rest in `bank_connections` table (triplet columns per token); decrypted only in `bankConnectionSync.ts`
- Env vars: `PONTO_CLIENT_ID`, `PONTO_CLIENT_SECRET`, `PONTO_ENVIRONMENT` (`sandbox` or `production`), `PONTO_REDIRECT_URI` (optional override), `BANK_CONNECTION_REDIRECT_URL`

**GoCardless Bank Account Data (legacy/dormant):**
- Purpose: Alternative PSD2 provider; new registrations closed mid-2025; included as fallback reference
- SDK: `nordigen-node` 1.4.1 (dynamically imported to avoid startup failure)
- Implementation: `GoCardlessBadProvider` class in `apps/api/src/lib/bankAccountData.ts`
- Silent renewal: not supported (landlord must re-authorize)
- Env vars: `GOCARDLESS_BAD_SECRET_ID`, `GOCARDLESS_BAD_SECRET_KEY`

**Provider selection:**
- Controlled via `BANK_DATA_PROVIDER` env var (`ponto` is default; `gocardless_bad` also recognized)
- Factory: `getBankAccountDataProvider()` in `apps/api/src/lib/bankAccountData.ts`
- Abstract interface: `BankAccountDataProvider` with `createConsent`, `listAccounts`, `getTransactions`, `renewConsent`, `revokeConsent`

### Belgian Health Index (Rent Indexation)

**Statbel beSTAT API:**
- Purpose: Fetch Belgian health index values for automatic rent indexation calculations
- Endpoint: `https://bestat.statbel.fgov.be/bestat/api/views/208b69bd-05c5-4947-b7f9-2d2300f517b8/result/JSON`
- Client: native `fetch()` in `apps/api/src/services/healthIndex.ts`
- Schedule: daily at 06:00 UTC via BullMQ cron (`health-index-refresh` queue, `apps/api/src/jobs/healthIndexWorker.ts`)
- Upserts cached values to `health_index_values` DB table; tolerates API failure silently (retries next day)
- No auth required; no env vars

### Competitor Data Import (Smovin)

**Smovin (scraping):**
- Purpose: Allow landlords to migrate from Smovin by importing their properties, tenants, leases, and payments
- Approach: Playwright-based stealth headless Chromium scraper (`apps/api/src/services/smovinScraper.ts`)
- Stealth: `playwright-extra` + `puppeteer-extra-plugin-stealth`; headless Chromium with `--disable-blink-features=AutomationControlled`, Belgian locale (`fr-BE`, `Europe/Brussels`)
- Target URL: `https://app.smovin.be/login`
- Execution: BullMQ workers — `import-discovery` queue (30-min timeout, 2 attempts) and `import-write` queue
- Credentials: AES-256-GCM encrypted at rest in `import_sessions` table; never returned to client
- Data mapping: `apps/api/src/services/smovinMapper.ts`

### Support Chat

**Signal Bot (optional):**
- Purpose: Forward in-app support chat messages to a Signal number for the support team
- Client: native `fetch()` to `signal-cli` REST API at `SIGNAL_BOT_URL` (e.g., `http://localhost:8080/v2/send`)
- Implementation: `apps/api/src/routes/support.ts`
- Fallback: replies with static FAQ text if bot URL is unconfigured
- Env vars: `SIGNAL_BOT_URL`, `SIGNAL_BOT_NUMBER`, `SIGNAL_SUPPORT_NUMBER`, `SUPPORT_EMAIL`

---

## Data Storage

### Databases

**Primary: MariaDB 11 / MySQL 5.7+**
- Connection: `DB_HOST`, `DB_PORT` (default 3306), `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Client: Drizzle ORM 0.36.0 with `mysql2/promise` connection pool
- Singleton: `getDb()` in `packages/db/src/connection.ts` — lazy-initialized, connection pool reused for process lifetime
- Schema: `packages/db/src/schema/` — 18 schema files covering: `users`, `bankAccounts`, `bankConnections`, `bankStatements`, `communications`, `costs`, `imports`, `indexation`, `leases`, `maintenance`, `payments`, `properties`, `propertyManagers`, `smtpSettings`, `tenants`, `webhookEvents`
- Migrations: `drizzle-kit generate` / `drizzle-kit migrate`; output to `packages/db/drizzle/`

### File Storage

- Local filesystem only — no S3, GCS, or other object storage detected

### Caching

**Redis 7:**
- Connection: `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`, defaulting to `localhost:6379`)
- Client: `ioredis` 5.4.0 for BullMQ connections; direct `ioredis` for health check
- Used exclusively by BullMQ job queues — not used as a general application cache

---

## Authentication & Identity

### NextAuth.js (Web)

**Provider: next-auth 5.0.0-beta.25**
- Implementation: `apps/web/lib/auth.ts`
- Strategy: JWT sessions (A256CBC-HS512 encrypted JWE cookie)
- Adapter: `@auth/drizzle-adapter` — persists sessions/accounts to MySQL `users` table
- Providers enabled (conditional on env vars):
  - Google OAuth (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`)
  - Facebook OAuth (`AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET`)
  - Twitter/X OAuth (`AUTH_TWITTER_ID`, `AUTH_TWITTER_SECRET`)
  - Credentials (email + bcrypt password; minimum 12-char password enforced)
- Cookie names: `__Secure-authjs.session-token` (production) / `authjs.session-token` (dev)
- Custom pages: `/login` for `signIn` and `error`
- JWT callback: stores `id`, `email`, `provider`, `onboardingComplete` in the token

### API Auth Middleware

**Implementation: `apps/api/src/lib/authMiddleware.ts`**
- Decrypts the NextAuth JWT cookie using `jose.jwtDecrypt` + `@panva/hkdf` key derivation (matches Auth.js internal algorithm)
- Attaches `userId`, `userEmail`, `userName` to Hono context
- `getRequiredUserId()` (`apps/api/src/lib/routeAuth.ts`) throws if `userId` is null on protected routes
- New users auto-provisioned to DB on first API hit; admin notification sent via `adminNotify.ts`

### AES-256-GCM At-Rest Encryption

**Implementation: `apps/api/src/lib/encryption.ts`**
- Key derived from `AUTH_SECRET` via SHA-256 (32-byte key)
- Cipher: AES-256-GCM; 96-bit random IV; 16-byte auth tag
- Used for: Ponto OAuth tokens in `bank_connections`, per-landlord SMTP passwords in `smtp_settings`, Smovin credentials in `import_sessions`
- Storage pattern: three columns per secret (`{encrypted}`, `{iv}`, `{tag}`) as base64 strings

### OAuth State (PSD2 Flow)

**Implementation: `apps/api/src/lib/bankOAuthState.ts`**
- Signs HS256 JWTs with `AUTH_SECRET` for CSRF/replay protection on Ponto callback
- 10-minute TTL; unique nonce per consent request
- Verified by `GET /api/v1/bank-connections/callback` (bypasses session auth)

---

## Email

**SMTP (nodemailer):**
- Platform default SMTP: `SMTP_HOST`, `SMTP_PORT` (default 1025 for Mailpit in dev)
- Per-landlord custom SMTP: optional override stored encrypted in `smtp_settings` DB table
- Transport cache: 30-minute TTL per `ownerId` (`apps/api/src/lib/email.ts`)
- Queue: `email-queue` BullMQ worker; rate limited to `EMAIL_RATE_LIMIT` msgs/min (default 30); retry 3× exponential backoff
- Worker: `apps/api/src/jobs/emailQueueWorker.ts`
- Template rendering: `{{variable}}` double-brace substitution via `renderTemplate()`
- Communication logging: all sent emails tracked in `communications` table
- Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `EMAIL_RATE_LIMIT`, `EMAIL_FROM`, `ADMIN_EMAIL`

---

## SMS

**Provider abstraction (`apps/api/src/lib/sms.ts`):**
- Selected via `SMS_PROVIDER` env var
- Queue: `sms-queue` BullMQ worker; rate limited to `SMS_RATE_LIMIT` msgs/min (default 10)

**Twilio:**
- REST API: `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`
- Auth: Basic (AccountSid:AuthToken)
- Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

**MessageBird (Bird):**
- REST API: `https://rest.messagebird.com/messages`
- Auth: `AccessKey` header
- Env vars: `MESSAGEBIRD_API_KEY`, `MESSAGEBIRD_ORIGINATOR`

**OVH SMS:**
- REST API: `https://eu.api.ovh.com/1.0/sms/{serviceName}/jobs`
- Auth: OVH HMAC-SHA1 signature (timestamp-based)
- Env vars: `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, `OVH_SMS_SENDER`

**Console (dev/testing):**
- Default provider if `SMS_PROVIDER` is unset; logs to stdout only

---

## Monitoring & Observability

**Error Tracking:** Not detected — no Sentry, Datadog, or similar SDK

**Logs:**
- `console.log` / `console.error` with bracketed context prefix (`[Auth]`, `[EmailQueue]`, etc.)
- Hono `logger()` middleware logs all HTTP requests
- Health check endpoint: `GET /api/v1/health` — verifies DB (`SELECT 1`) and Redis (`PING`); returns `{ status, checks, version }`

---

## CI/CD & Deployment

**Hosting:**
- Proxmox/Hetzner VPS with Docker (`docker-compose.yml` at project root)
- Services: `mariadb` (MariaDB 11), `redis` (Redis 7 Alpine), `mailpit` (dev email)

**CI Pipeline:** Not detected — no `.github/workflows`, `.gitlab-ci.yml`, or similar

---

## Webhooks & Callbacks

**Incoming webhooks:**
- `POST /api/v1/webhooks/gocardless` — GoCardless payment/mandate/payout events; HMAC-SHA256 signature verification; idempotency via `webhook_events` table dedup
- `POST /api/v1/stripe/webhook` — Stripe subscription lifecycle events; signature via `stripe.webhooks.constructEvent()`

**OAuth callbacks:**
- `GET /api/v1/bank-connections/callback` — Ponto Connect OAuth2 authorization code exchange; state JWT replaces session auth on this single route

**Outgoing webhooks:** None detected

---

## Environment Configuration Summary

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MariaDB connection |
| `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`) | Redis / BullMQ |
| `AUTH_SECRET` | NextAuth JWT encryption + AES-256-GCM data encryption key |
| `AUTH_URL` | NextAuth base URL |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth (optional) |
| `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` | Facebook OAuth (optional) |
| `AUTH_TWITTER_ID`, `AUTH_TWITTER_SECRET` | Twitter/X OAuth (optional) |
| `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_ENVIRONMENT`, `GOCARDLESS_WEBHOOK_SECRET` | GoCardless SEPA direct debit |
| `GOCARDLESS_BAD_SECRET_ID`, `GOCARDLESS_BAD_SECRET_KEY` | GoCardless Bank Account Data (dormant) |
| `BANK_DATA_PROVIDER`, `BANK_CONNECTION_REDIRECT_URL` | PSD2 provider selection |
| `PONTO_CLIENT_ID`, `PONTO_CLIENT_SECRET`, `PONTO_ENVIRONMENT`, `PONTO_REDIRECT_URI` | Ponto Connect OAuth |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_PROFESSIONAL` | Stripe subscription billing |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `EMAIL_RATE_LIMIT`, `EMAIL_FROM` | Platform SMTP |
| `ADMIN_EMAIL` | Admin signup notification recipient |
| `SMS_PROVIDER`, `SMS_RATE_LIMIT` | SMS provider selection + rate limit |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio SMS (if selected) |
| `MESSAGEBIRD_API_KEY`, `MESSAGEBIRD_ORIGINATOR` | MessageBird SMS (if selected) |
| `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, `OVH_SMS_SENDER` | OVH SMS (if selected) |
| `API_PORT`, `API_URL`, `WEB_URL`, `NEXT_PUBLIC_API_URL`, `ALLOWED_ORIGINS` | Server URLs and CORS |
| `SIGNAL_BOT_URL`, `SIGNAL_BOT_NUMBER`, `SIGNAL_SUPPORT_NUMBER`, `SUPPORT_EMAIL` | Support chat forwarding (optional) |
| `BANK_STATEMENTS_RETENTION_DAYS` | Belgian tax-law data retention (default 2555 = 7 years) |

---

*Integration audit: 2026-06-28*
