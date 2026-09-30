# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Monorepo with separation of concerns: a Next.js web frontend, Hono API backend, and shared packages for database, validation, and business logic.

**Key Characteristics:**
- Turborepo monorepo structure enabling optimized builds across apps and packages
- API-driven architecture: REST endpoints served by Hono.js backend
- Session-based authentication: NextAuth.js on frontend with JWT validation on backend
- Queue-based background job processing: BullMQ for email and SMS delivery
- Database-first approach: Drizzle ORM with MySQL connection pooling
- Multi-language support: next-intl for i18n on frontend

## Layers

**Frontend Application (`apps/web`):**
- Purpose: Server-side rendered Next.js app providing user interface for property and lease management
- Location: `apps/web/`
- Contains: React components, page layouts (marketing, auth, dashboard), i18n messages, forms
- Depends on: NextAuth.js for authentication, API client calls to backend
- Used by: End-user browsers

**Backend API (`apps/api`):**
- Purpose: RESTful HTTP API handling business logic, data persistence, and job scheduling
- Location: `apps/api/src/`
- Contains: Route handlers, middleware, background job workers, utility services
- Depends on: Drizzle ORM database client, BullMQ for queuing, external integrations (GoCardless, Stripe, email/SMS)
- Used by: Frontend application via HTTP calls

**Database Package (`packages/db`):**
- Purpose: Shared database schema, connection pooling, and migrations
- Location: `packages/db/src/`
- Contains: Drizzle schema definitions, connection factory, migration files
- Depends on: MySQL driver, Drizzle ORM
- Used by: Both API and web app for data access

**Shared Package (`packages/shared`):**
- Purpose: Reusable types, validation schemas, and constants across applications
- Location: `packages/shared/src/`
- Contains: TypeScript types, Zod validation schemas, business logic constants
- Depends on: Zod for validation
- Used by: Both apps for consistent data definitions

**Reserved Packages:** `packages/payments`, `packages/notifications`, `packages/indexation` exist but are currently empty placeholders for future business logic extraction.

## Data Flow

**User Authentication Flow:**

1. User submits credentials on `apps/web/app/(auth)/login/page.tsx`
2. NextAuth.js routes to Credentials provider or OAuth (Google/Facebook/Twitter)
3. Credentials provider queries `@rentular/db` users table and validates password via bcrypt
4. NextAuth creates JWT session token stored in `__Secure-authjs.session-token` cookie
5. Frontend middleware (`apps/web/middleware.ts`) checks token on each request
6. API calls include cookie; backend `authMiddleware.ts` decrypts JWT and extracts userId
7. Backend ensures user exists in database via `ensureUser()` function
8. Context variable `userId` is available to all API routes

**Property Management Flow:**

1. User accesses dashboard (e.g., `/dashboard/properties`)
2. Frontend middleware redirects to login if not authenticated
3. Dashboard layout loads and renders property list page
4. Page makes GET request to `POST /api/v1/properties` with auth cookie
5. API middleware decrypts JWT, extracts userId, attaches to context
6. Route handler queries `properties` table filtered by `ownerId`
7. Results returned as JSON with metadata
8. Frontend renders property list with edit/delete actions
9. Edit triggers POST to `/api/v1/properties/:id` with updated fields
10. API validates input via Zod schema, updates database, returns updated record

**Background Job Flow (Email Example):**

1. Backend service (e.g., payment reminder) calls `queueEmail()` from `emailQueueWorker.ts`
2. Job added to BullMQ Redis queue with configurable priority and delay
3. Worker process picks up job from queue
4. Email sent via `sendEmail()` utility in `lib/email.ts`
5. On success: job removed from queue
6. On failure: job retried up to 3 times with exponential backoff
7. Failed jobs tracked in failed queue for admin review

**State Management:**

- Frontend state: React hooks (useState) for form state, client-side caching via fetch
- Backend state: Database as source of truth; in-memory fallback (memoryStore) for testing/development
- Background jobs: Redis queue for reliability; BullMQ handles retries and scheduling

## Key Abstractions

**Route Handler Pattern:**

All API routes follow this pattern (e.g., `apps/api/src/routes/properties.ts`):
1. Import database client and schema lazily with try-catch fallback to in-memory store
2. Define Zod validation schema for request body
3. Create Hono router instance
4. Implement GET, POST, PUT, DELETE handlers
5. Each handler extracts userId from context and filters/authorizes data
6. Database queries use Drizzle ORM with where clauses

**Middleware Chain:**

Request flow in `apps/api/src/index.ts`:
1. Global middleware: `logger()`, `prettyJSON()`, `cors()`
2. Auth middleware: `authMiddleware` extracts user from NextAuth JWT
3. Route-specific auth: `requireAuth` middleware on protected prefixes
4. Route handlers process request

**Job Queue Abstraction:**

BullMQ queue pattern in `emailQueueWorker.ts` and `smsQueueWorker.ts`:
1. Queue defined with connection config and default retry strategy
2. Worker processes jobs concurrently (email: 1, SMS: varies)
3. Rate limiting enforced via queue limiter config
4. Public functions (`queueEmail`, `queueBatchEmails`) abstract job creation
5. Stats function provides observability

**Database Connection Factory:**

`packages/db/src/connection.ts` exports `getDb()` function:
- Singleton pattern: returns cached Drizzle instance
- Lazy initialization on first call
- Connection pooling via mysql2/promise

**Validation Layer:**

Hono `zValidator` middleware applies Zod schemas:
- Automatic 400 response on validation failure
- Type-safe access to validated data via `c.req.valid("json")`

## Entry Points

**Web App:**
- Location: `apps/web/app/layout.tsx` (root) and `apps/web/middleware.ts` (request guard)
- Triggers: Browser navigation, HTTP requests to `/` and sub-paths
- Responsibilities: Initialize NextIntl provider, enforce authentication redirects, render layout

**API Server:**
- Location: `apps/api/src/index.ts`
- Triggers: HTTP requests to `/api/v1/*`
- Responsibilities: Mount all routers, apply middleware, start Hono server on port 4000

**Background Jobs:**
- Email: `apps/api/src/jobs/emailQueueWorker.ts` (auto-started on import)
- SMS: `apps/api/src/jobs/smsQueueWorker.ts` (auto-started on import)
- Payment check: `apps/api/src/jobs/paymentCheckWorker.ts` (cron-scheduled)
- Landlord report: `apps/api/src/jobs/landlordReportWorker.ts` (cron-scheduled)

## Error Handling

**Strategy:** Layered error handling with fallbacks and logging.

**Patterns:**

Database errors in route handlers:
- Try-catch wraps database operations
- On error: logs error, falls back to in-memory store if available
- Returns 404 or 500 as appropriate

Authentication errors:
- Missing/invalid JWT: authMiddleware sets userId to null
- Protected routes check for userId, return 401 if missing
- Throws error in `getRequiredUserId()` for convenience routes

Route errors:
- Input validation: Zod validator returns 400 automatically
- Not found: `app.notFound()` returns 404
- Unhandled: `app.onError()` catches and logs, returns 500

Job errors:
- BullMQ retries failed jobs up to 3 times with exponential backoff
- Failed jobs tracked in failed queue
- Worker logs errors with job ID and attempt count

## Cross-Cutting Concerns

**Logging:** Console-based logging using `console.log()` and `console.error()` with prefixes (e.g., `[Auth]`, `[EmailQueue]`, `[Properties]`).

**Validation:** Zod schemas validate all user input at route entry point. No validation-at-persistence pattern; business logic assumes valid data.

**Authentication:**
- Web: NextAuth.js with session strategy, supports OAuth and credentials
- API: JWT decryption and user lookup on each request
- Context attachment: userId attached to Hono context via middleware

**Authorization:** Row-level security implemented in route handlers via `ownerId` field checks (e.g., `eq(dbSchema.ownerId, ownerId)` in queries).

**Internationalization:**
- Frontend: next-intl loads messages per locale from `apps/web/messages/{locale}/common.json`
- Backend: No i18n; API returns structured data, frontend responsible for translation

---

*Architecture analysis: 2026-03-22*
