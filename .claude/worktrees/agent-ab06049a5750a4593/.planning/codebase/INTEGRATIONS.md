# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Payment Processing:**
- **Stripe** - Subscription billing and payment processing
  - SDK/Client: `stripe` (v20.4.1) in `apps/api/package.json`
  - Auth: `STRIPE_SECRET_KEY` environment variable
  - Plans: Configured via `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_PROFESSIONAL`
  - Implementation: `apps/api/src/routes/stripe.ts` handles checkout sessions and webhook events
  - Webhook Secret: `STRIPE_WEBHOOK_SECRET` for validating webhook signatures
  - Supported payment methods: card, Bancontact, iDEAL (for European users)

- **GoCardless** - SEPA direct debit payments for tenant rent collection
  - SDK/Client: `gocardless-nodejs` (v4.2.0) in `apps/api/package.json`
  - Auth: `GOCARDLESS_ACCESS_TOKEN` environment variable
  - Environment: `GOCARDLESS_ENVIRONMENT` (sandbox or live)
  - Webhook Secret: `GOCARDLESS_WEBHOOK_SECRET` for verifying webhook signatures
  - Implementation: `apps/api/src/lib/gocardless.ts` (client singleton and utility functions)
  - Features: Customer creation, billing request flows (mandate setup), payment creation/retry/cancel, mandate management
  - Webhook Handler: `apps/api/src/routes/webhooks.ts` processes payment, mandate, and payout events

**SMS Communications:**
- **Twilio** - SMS delivery (optional, provider-based)
  - Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` environment variables
  - API endpoint: `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`
  - Implementation: `apps/api/src/lib/sms.ts` (provider abstraction layer)

- **MessageBird** - SMS delivery (optional, provider-based)
  - Auth: `MESSAGEBIRD_API_KEY` environment variable
  - Originator: `MESSAGEBIRD_ORIGINATOR` (sender ID, defaults to "Rentular")
  - API endpoint: `https://rest.messagebird.com/messages`
  - Implementation: `apps/api/src/lib/sms.ts`

- **OVH** - SMS delivery (optional, provider-based)
  - Auth: `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY` environment variables
  - Service: `OVH_SMS_SERVICE` (service name)
  - Sender: `OVH_SMS_SENDER` (defaults to "Rentular")
  - API endpoint: `https://eu.api.ovh.com/1.0/sms/{serviceName}/jobs`
  - Implementation: `apps/api/src/lib/sms.ts`

- **Console** - SMS provider for development/testing
  - Logs SMS messages to console instead of sending
  - Implementation: `apps/api/src/lib/sms.ts`

**OAuth & Social Login:**
- **Google OAuth 2.0** - User authentication
  - Credentials: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` environment variables
  - Implementation: `apps/web/lib/auth.ts` via NextAuth.js Google provider

- **Facebook OAuth** - User authentication
  - Credentials: `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` environment variables
  - Implementation: `apps/web/lib/auth.ts` via NextAuth.js Facebook provider
  - Email linking: Enabled (`allowDangerousEmailAccountLinking: true`)

- **Twitter/X OAuth** - User authentication
  - Credentials: `AUTH_TWITTER_ID`, `AUTH_TWITTER_SECRET` environment variables
  - Implementation: `apps/web/lib/auth.ts` via NextAuth.js Twitter provider
  - Email linking: Enabled (`allowDangerousEmailAccountLinking: true`)

## Data Storage

**Databases:**
- **MySQL 5.7+** - Primary relational database
  - Connection: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` environment variables
  - Default values: localhost:3306, database: "rentular", user: "rentular"
  - Client: mysql2 (v3.11.0) in `packages/db/package.json`
  - ORM: Drizzle ORM (v0.36.0)
  - Schema location: `packages/db/src/schema/` (properties, tenants, leases, payments, users, etc.)
  - Migrations: Handled via drizzle-kit CLI commands

**File Storage:**
- Local filesystem only - No external cloud storage integration detected
- Email attachments support exists but not configured for cloud storage

**Caching:**
- **Redis** - Distributed cache and job queue backend
  - Connection: `REDIS_URL` environment variable (or `REDIS_HOST`, `REDIS_PORT`)
  - Default: localhost:6379
  - Client: ioredis (v5.4.0) in `apps/api/package.json`
  - Usage: BullMQ job queue persistence for email and SMS processing

## Authentication & Identity

**Auth Provider:**
- **NextAuth.js 5.0.0-beta.25** - Session and authentication management
  - Adapter: DrizzleAdapter for database persistence in MySQL
  - Session Strategy: JWT (JSON Web Tokens)
  - Auth Secret: `AUTH_SECRET` environment variable (generate with `openssl rand -base64 32`)
  - Callback URL: `AUTH_URL` environment variable (e.g., http://localhost:3000)
  - Pages: Custom sign-in page at `/login`, error redirect to `/login`
  - Enabled providers:
    - Google OAuth (conditional on `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`)
    - Facebook OAuth (conditional on `AUTH_FACEBOOK_ID`/`AUTH_FACEBOOK_SECRET`)
    - Twitter OAuth (conditional on `AUTH_TWITTER_ID`/`AUTH_TWITTER_SECRET`)
    - Email/Credentials (custom password-based authentication)
  - Implementation: `apps/web/lib/auth.ts` (NextAuth configuration), `apps/web/middleware.ts` (route protection)
  - User mapping: Email is canonical identifier; different OAuth providers with same email map to same user

**Password Security:**
- Bcrypt 5.1.0 - Password hashing and verification
- Used for credentials provider in NextAuth and custom password authentication

## Monitoring & Observability

**Error Tracking:**
- Not detected - No Sentry, Rollbar, or similar service configured

**Logs:**
- Console logging - All major operations log to stdout/stderr
- Timestamps and context tags: `[Webhook]`, `[EmailQueue]`, `[SmsQueue]`, `[Stripe]` prefixes
- No persistent log aggregation service detected

## CI/CD & Deployment

**Hosting:**
- Not specified in codebase - Likely self-hosted or requires documentation

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or similar configuration

## Environment Configuration

**Required env vars for full functionality:**

### Core Infrastructure
- `DB_HOST` - MySQL host
- `DB_PORT` - MySQL port (default: 3306)
- `DB_NAME` - MySQL database name
- `DB_USER` - MySQL username
- `DB_PASSWORD` - MySQL password
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` - Redis connection
- `AUTH_SECRET` - NextAuth session secret (generate with `openssl rand -base64 32`)
- `AUTH_URL` - Application URL for NextAuth callbacks

### Application URLs
- `API_PORT` - API server port (default: 4000)
- `API_URL` - API base URL (e.g., http://localhost:4000)
- `WEB_URL` - Web app URL (e.g., http://localhost:3000)
- `NEXT_PUBLIC_API_URL` - API endpoint for frontend (e.g., http://localhost:4000/api/v1)

### Authentication Providers (Optional)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` - Google OAuth
- `AUTH_FACEBOOK_ID` / `AUTH_FACEBOOK_SECRET` - Facebook OAuth
- `AUTH_TWITTER_ID` / `AUTH_TWITTER_SECRET` - Twitter OAuth

### Payment Processing
- `STRIPE_SECRET_KEY` - Stripe API secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_PRICE_STARTER` - Stripe price ID for starter plan
- `STRIPE_PRICE_STANDARD` - Stripe price ID for standard plan
- `STRIPE_PRICE_PROFESSIONAL` - Stripe price ID for professional plan
- `GOCARDLESS_ACCESS_TOKEN` - GoCardless API token
- `GOCARDLESS_ENVIRONMENT` - "sandbox" or "live"
- `GOCARDLESS_WEBHOOK_SECRET` - GoCardless webhook signing secret

### Email Configuration
- `SMTP_HOST` - SMTP server host (default: localhost)
- `SMTP_PORT` - SMTP server port (default: 1025)
- `SMTP_USER` - SMTP username (optional)
- `SMTP_PASSWORD` - SMTP password (optional)
- `SMTP_FROM` / `EMAIL_FROM` - Sender email address (default: noreply@rentular.com)
- `EMAIL_RATE_LIMIT` - Max emails per minute (default: 30)

### SMS Configuration (Optional)
- `SMS_PROVIDER` - Provider selection: "twilio", "messagebird", "ovh", or "console" (default: console)
- `SMS_RATE_LIMIT` - Max SMS per minute (default: 10)

**Provider-specific SMS credentials:**
- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- **MessageBird:** `MESSAGEBIRD_API_KEY`, `MESSAGEBIRD_ORIGINATOR`
- **OVH:** `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, `OVH_SMS_SENDER`

**Secrets location:**
- `.env` file in project root (use `.env.example` as template)
- Not committed to version control (should be in .gitignore)
- Environment-specific overrides: `.env.local`, `.env.production`, etc.

## Webhooks & Callbacks

**Incoming Webhooks:**
- **GoCardless Webhooks** - Payment and mandate status updates
  - Endpoint: `POST /api/v1/webhooks/gocardless`
  - Handler: `apps/api/src/routes/webhooks.ts`
  - Signature verification: HMAC-SHA256 using `GOCARDLESS_WEBHOOK_SECRET`
  - Resource types handled: payments, mandates, payouts
  - Events processed: payment.confirmed, payment.failed, payment.late_failure_settled, payment.charged_back, payment.paid_out, mandate.active, mandate.cancelled/failed/expired, payout.paid

- **Stripe Webhooks** - Subscription and payment events
  - Endpoint: `POST /api/v1/stripe/webhook`
  - Handler: `apps/api/src/routes/stripe.ts`
  - Signature verification: Stripe signature header validation
  - Event types handled: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
  - Webhook Secret: `STRIPE_WEBHOOK_SECRET` environment variable

**Outgoing Webhooks:**
- None detected - Application sends HTTP requests but no outbound webhook pattern observed

## Background Jobs & Async Processing

**Job Queue System:** BullMQ + Redis

**Email Queue:**
- Queue name: "email-queue"
- Rate limiting: `EMAIL_RATE_LIMIT` (default: 30 emails/minute)
- Concurrency: 1 (processes emails sequentially)
- Retry policy: 3 attempts with exponential backoff (5 second initial delay)
- Implementation: `apps/api/src/jobs/emailQueueWorker.ts`
- Enqueue functions: `queueEmail()`, `queueBatchEmails()`

**SMS Queue:**
- Queue name: "sms-queue"
- Rate limiting: `SMS_RATE_LIMIT` (default: 10 SMS/minute)
- Concurrency: 1 (processes SMS sequentially)
- Retry policy: 3 attempts with exponential backoff (10 second initial delay)
- Implementation: `apps/api/src/jobs/smsQueueWorker.ts`
- Enqueue function: `queueSms()`

**Scheduled Jobs:**
- **Payment Check Schedule** - Periodic payment status checking
  - Setup: `setupPaymentCheckSchedule()` in `apps/api/src/jobs/paymentCheckWorker.ts`
  - Started at API initialization

- **Landlord Report Schedule** - Periodic report generation
  - Setup: `setupLandlordReportSchedule()` in `apps/api/src/jobs/landlordReportWorker.ts`
  - Started at API initialization

---

*Integration audit: 2026-03-22*
