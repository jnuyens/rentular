<!-- GSD:project-start source:PROJECT.md -->
## Project

**Rentular**

A Belgian rental property management platform for landlords and property managers. Rentular handles property listings, tenant management, lease tracking (residential and commercial), automated rent collection via SEPA direct debit (GoCardless), payment follow-up with email and SMS reminders, Belgian rent indexation, and payment reporting. It competes on price against existing Belgian tools like Smovin and Rentila.

**Core Value:** Landlords can automatically collect rent via SEPA direct debit and track all their properties in one affordable, multilingual platform.

### Constraints

- **Tech stack**: Existing stack must be preserved — Next.js 15, Hono, Drizzle ORM, MySQL, GoCardless, Stripe
- **Language**: All UI must be available in EN, NL, FR, DE
- **Market**: Belgian rental law context (health index, SEPA, residential + commercial leases)
- **Timeline**: ASAP — launch as soon as everything works
- **Payments**: GoCardless for rent collection (SEPA direct debit), Stripe for Rentular subscription billing only
- **Hosting**: Must run on Proxmox/Hetzner VPS with Docker
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.5.0 - All application code (API, web app, shared utilities, database)
- JavaScript (Node.js) - Runtime execution for TypeScript-compiled code
## Runtime
- Node.js 20.19.0 (as specified in `volta` config in `/Users/jnuyens/rentular/source/package.json`)
- Minimum version requirement: Node.js >= 20.0.0
- pnpm 9.15.0 - Monorepo package manager
- Lockfile: pnpm-lock.yaml (present at `/Users/jnuyens/rentular/source/pnpm-lock.yaml`)
## Frameworks
- Next.js 15.1.0 - Web frontend framework (`apps/web/package.json`)
- Hono 4.6.0 - Lightweight HTTP server framework for API (`apps/api/package.json`)
- NextAuth.js 5.0.0-beta.25 - User authentication and session management in web app (`apps/web/package.json`)
- DrizzleAdapter 1.11.1 - NextAuth adapter for database-backed session/user storage
- @hono/node-server 1.13.0 - Node.js server adapter for Hono
- @hono/zod-validator 0.4.0 - Zod-based request/response validation middleware for Hono
- Drizzle ORM 0.36.0 - Type-safe SQL ORM (api, web, and db packages)
- Drizzle-kit 0.31.9 - CLI tool for schema generation and migrations (`packages/db/package.json`)
- mysql2 3.11.0 - MySQL database driver (`packages/db/package.json`)
- BullMQ 5.25.0 - Redis-backed job queue for async task processing (`apps/api/package.json`)
- ioredis 5.4.0 - Redis client for queue connections and caching
- React 19.0.0 - UI component library
- React DOM 19.0.0 - DOM rendering
- Tailwind CSS 3.4.16 - Utility-first CSS framework (`apps/web/package.json`)
- PostCSS 8.4.49 - CSS transformation tool
- Autoprefixer 10.4.20 - CSS vendor prefix generation
- Lucide React 0.468.0 - Icon library
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 2.6.0 - Tailwind CSS class conflict resolver
- @tanstack/react-query 5.62.0 - Client-side data fetching and caching
- next-intl 3.24.0 - Multi-language support for Next.js (support for en, nl, fr, de)
- Zod 3.24.0 - Schema validation library (shared, api, web packages)
- tsup 8.3.0 - TypeScript bundler for API builds (`apps/api/package.json`)
- tsx 4.19.0 - TypeScript executor for development server (`apps/api/package.json`)
- Turbo 2.3.0 - Monorepo build system and task orchestrator
- Prettier 3.2.0 - Code formatter
- TypeScript 5.5.0 - Language and type checking
- bcrypt 5.1.0 - Password hashing (both api and web)
- jose 6.2.1 - JWT handling and cryptographic operations (`apps/api/package.json`)
- @panva/hkdf 1.2.1 - Key derivation function (`apps/api/package.json`)
## Key Dependencies
- stripe 20.4.1 - Stripe payment processing SDK (`apps/api/package.json`)
- gocardless-nodejs 4.2.0 - GoCardless SEPA direct debit SDK (`apps/api/package.json`)
- nodemailer 6.9.0 - Email sending library (`apps/api/package.json`)
- @types/node 22.0.0 - Type definitions for Node.js
- @types/react 19.0.0 - React type definitions (web)
- @types/react-dom 19.0.0 - React DOM type definitions (web)
- @types/bcrypt 5.0.0+ - Bcrypt type definitions
- @types/nodemailer 6.4.0 - Nodemailer type definitions
## Configuration
- Configured via `.env` file (example template at `.env.example`)
- Environment variables for database, Redis, authentication, payment providers, and email
- **Database:** DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
- **Redis:** REDIS_URL (or REDIS_HOST/REDIS_PORT)
- **Authentication:** AUTH_SECRET, AUTH_URL, AUTH_GOOGLE_*, AUTH_FACEBOOK_*, AUTH_TWITTER_*
- **Payment:** STRIPE_SECRET_KEY, STRIPE_PRICE_*, STRIPE_WEBHOOK_SECRET, GOCARDLESS_ACCESS_TOKEN, GOCARDLESS_ENVIRONMENT, GOCARDLESS_WEBHOOK_SECRET
- **Email:** SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, EMAIL_RATE_LIMIT
- **SMS:** SMS_PROVIDER, SMS_RATE_LIMIT, provider-specific credentials (TWILIO_*, MESSAGEBIRD_*, OVH_*)
- **API & Web URLs:** API_PORT, API_URL, WEB_URL, NEXT_PUBLIC_API_URL
- `tsconfig.json` at project root with strict TypeScript settings (target: ES2022, strict mode enabled)
- Turbo task configuration in `turbo.json` for monorepo orchestration
- Drizzle ORM configuration in `packages/db/drizzle.config.ts` for MySQL dialect
- Next.js configuration (if exists, not explicitly read)
## Platform Requirements
- Node.js 20.0.0 or higher
- pnpm 9.15.0
- MySQL 5.7+ (or compatible)
- Redis (for BullMQ queue processing)
- Node.js 20.0.0 or higher
- MySQL database instance
- Redis instance for job queues
- SMTP server or Mailpit for email
- Optional: Stripe account for subscription payments
- Optional: GoCardless account for SEPA direct debits
- Optional: SMS provider (Twilio, MessageBird, OVH) for SMS communications
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- PascalCase for React components: `LoginPage.tsx`, `IbanInput.tsx`, `LanguageSwitcher.tsx`
- camelCase for utility and service files: `emailQueueWorker.ts`, `paymentFollowUp.ts`, `authMiddleware.ts`
- kebab-case for route files: `bank-accounts`, `property-managers`, `rent-adjustments` (as directory names)
- Types and schema files: `hono.d.ts`, `communications.ts`, `tenants.ts`
- camelCase for all function definitions: `getRequiredUserId()`, `sendEmail()`, `renderTemplate()`, `queueEmail()`
- Exported constants use camelCase: `emailQueue`, `propertiesRouter`, `tenantsRouter`
- Middleware and router objects use camelCase: `requireAuth`, `authMiddleware`, `propertiesRouter`
- camelCase for local variables: `ownerId`, `email`, `password`, `error`, `resetToken`
- Uppercase for environment-derived constants: `MAX_EMAILS_PER_MINUTE`, `AUTH_SECRET`, `QUEUE_NAME`, `COOKIE_NAME`, `DELAY_BETWEEN_MS`
- Descriptive names: `dbSchema`, `usersTable`, `byEmail`, `byId` (indicates database query result)
- PascalCase for interfaces and type aliases: `PaymentStatus`, `EmailOptions`, `PaymentFollowUpSettings`, `IndexationResult`, `PropertyManagerRole`
- Literal union types for enums: `type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded"`
- Generic type prefixes: `TemplatePlaceholder`, `EpcScore`
- `...Settings` suffix for configuration objects: `PaymentFollowUpSettings`
- `...Result` suffix for computed/processed data: `IndexationResult`
- `...Options` suffix for function parameters: `EmailOptions`
- `...Schema` suffix for Zod schemas or database schemas
## Code Style
- Tool: Prettier 3.2.0 (configured at workspace root)
- Command: `pnpm format` runs `prettier --write "**/*.{ts,tsx,md,json}"`
- Applied to all TypeScript, TSX, Markdown, and JSON files
- No ESLint config detected in project root or app directories
- TypeScript strict mode enabled: All strict checks active
- Implicit `any` forbidden
- Used in Next.js frontend: `@/components/LanguageSwitcher`, `@/lib/auth`
- No aliases in API (uses relative imports)
## Error Handling
- Graceful fallback to in-memory store when database is unavailable
- Routes contain try-catch blocks that fall back to `memoryStore` if database fails
- Logging to console with context prefix: `console.error("DB read failed, falling back to memory:", err)`
- Errors from operations result in HTTP status codes: `c.json({ error: "Property not found" }, 404)`
- Middleware throws errors for validation: `throw new Error("Authenticated user is required")`
## Logging
- Context prefix in square brackets: `[Properties]`, `[Auth]`, `[EmailQueue]`, `[SmsQueue]`
- Info-level logs: `console.log("[Properties] Database unavailable, using in-memory store")`
- Error-level logs: `console.error("DB insert failed, using memory store:", err)`
- Describes operation and status: `console.log(\`[EmailQueue] Sending email to ${to}: "${subject}"\`)`
## Comments
- Explaining algorithm or complex business logic (e.g., Belgian rent indexation)
- Clarifying non-obvious decisions (e.g., why database fallback is needed)
- Linking to external references: `// See: @auth/core/jwt.js getDerivedEncryptionKey()`
- TODO comments indicating incomplete implementation
- Used for exported functions and queue operations
- Documents parameters and return types
## Function Design
- Use object parameters for multiple related values
- Keep async functions with explicit parameter passing (avoid relying on closure state when possible)
- Route handlers use Hono context object: `async (c: Context) => {...}`
- Route handlers return Hono response: `c.json(data)`, `c.json({ error: "..." }, 404)`
- Service functions return typed data: `Promise<string>` for job IDs, `Promise<void>` for side effects
- Validation functions return boolean: `validateStructuredCommunication(): boolean`
- Universally used for async operations
- Error handling via try-catch for database operations
- Queue operations: `await emailQueue.add("send-email", options, {...})`
## Module Design
- Named exports for routers: `export const propertiesRouter = new Hono()`
- Named exports for types: `export type PropertyType = "apartment" | "house" | ...`
- Named exports for functions: `export async function queueEmail(...)`
- Single default export for page components in Next.js: `export default function LoginPage() {...}`
- Used in shared package: `packages/shared/src/index.ts` re-exports types and utilities
- Allows cleaner imports: `import { PropertyType, Language } from "@rentular/shared"`
## TypeScript Usage
- `strict: true` enforced globally in `tsconfig.json`
- All implicit `any` forbidden
- Unused variables flagged
- Null/undefined checks required
- Function parameters explicitly typed
- Return types specified for exported functions
- Route handlers: `async (c: Context)`, response: `c.json<T>(data)`
- Optional fields use `z.string().optional().default("")`
- Nullable in database: `.or(null)` in Zod or explicit `null` in database inserts
- Environment variables checked before use: `process.env.AUTH_SECRET || ""`
## Validation
## Internationalization
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Turborepo monorepo structure enabling optimized builds across apps and packages
- API-driven architecture: REST endpoints served by Hono.js backend
- Session-based authentication: NextAuth.js on frontend with JWT validation on backend
- Queue-based background job processing: BullMQ for email and SMS delivery
- Database-first approach: Drizzle ORM with MySQL connection pooling
- Multi-language support: next-intl for i18n on frontend
## Layers
- Purpose: Server-side rendered Next.js app providing user interface for property and lease management
- Location: `apps/web/`
- Contains: React components, page layouts (marketing, auth, dashboard), i18n messages, forms
- Depends on: NextAuth.js for authentication, API client calls to backend
- Used by: End-user browsers
- Purpose: RESTful HTTP API handling business logic, data persistence, and job scheduling
- Location: `apps/api/src/`
- Contains: Route handlers, middleware, background job workers, utility services
- Depends on: Drizzle ORM database client, BullMQ for queuing, external integrations (GoCardless, Stripe, email/SMS)
- Used by: Frontend application via HTTP calls
- Purpose: Shared database schema, connection pooling, and migrations
- Location: `packages/db/src/`
- Contains: Drizzle schema definitions, connection factory, migration files
- Depends on: MySQL driver, Drizzle ORM
- Used by: Both API and web app for data access
- Purpose: Reusable types, validation schemas, and constants across applications
- Location: `packages/shared/src/`
- Contains: TypeScript types, Zod validation schemas, business logic constants
- Depends on: Zod for validation
- Used by: Both apps for consistent data definitions
## Data Flow
- Frontend state: React hooks (useState) for form state, client-side caching via fetch
- Backend state: Database as source of truth; in-memory fallback (memoryStore) for testing/development
- Background jobs: Redis queue for reliability; BullMQ handles retries and scheduling
## Key Abstractions
- Singleton pattern: returns cached Drizzle instance
- Lazy initialization on first call
- Connection pooling via mysql2/promise
- Automatic 400 response on validation failure
- Type-safe access to validated data via `c.req.valid("json")`
## Entry Points
- Location: `apps/web/app/layout.tsx` (root) and `apps/web/middleware.ts` (request guard)
- Triggers: Browser navigation, HTTP requests to `/` and sub-paths
- Responsibilities: Initialize NextIntl provider, enforce authentication redirects, render layout
- Location: `apps/api/src/index.ts`
- Triggers: HTTP requests to `/api/v1/*`
- Responsibilities: Mount all routers, apply middleware, start Hono server on port 4000
- Email: `apps/api/src/jobs/emailQueueWorker.ts` (auto-started on import)
- SMS: `apps/api/src/jobs/smsQueueWorker.ts` (auto-started on import)
- Payment check: `apps/api/src/jobs/paymentCheckWorker.ts` (cron-scheduled)
- Landlord report: `apps/api/src/jobs/landlordReportWorker.ts` (cron-scheduled)
## Error Handling
- Try-catch wraps database operations
- On error: logs error, falls back to in-memory store if available
- Returns 404 or 500 as appropriate
- Missing/invalid JWT: authMiddleware sets userId to null
- Protected routes check for userId, return 401 if missing
- Throws error in `getRequiredUserId()` for convenience routes
- Input validation: Zod validator returns 400 automatically
- Not found: `app.notFound()` returns 404
- Unhandled: `app.onError()` catches and logs, returns 500
- BullMQ retries failed jobs up to 3 times with exponential backoff
- Failed jobs tracked in failed queue
- Worker logs errors with job ID and attempt count
## Cross-Cutting Concerns
- Web: NextAuth.js with session strategy, supports OAuth and credentials
- API: JWT decryption and user lookup on each request
- Context attachment: userId attached to Hono context via middleware
- Frontend: next-intl loads messages per locale from `apps/web/messages/{locale}/common.json`
- Backend: No i18n; API returns structured data, frontend responsible for translation
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
