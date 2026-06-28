# Codebase Structure

**Analysis Date:** 2026-06-24

## Directory Layout

```
rentular/source/
├── apps/                                   # Workspace applications
│   ├── api/                                # Hono REST API server
│   │   ├── src/
│   │   │   ├── index.ts                    # Server entry, middleware chain, route mounting
│   │   │   ├── routes/                     # REST endpoint handlers (20 routers)
│   │   │   │   ├── auth.ts                 # Authentication (login, register, reset)
│   │   │   │   ├── bankAccounts.ts         # Bank account CRUD
│   │   │   │   ├── bankConnections.ts      # PSD2 bank connection + OAuth flow (Phase 09)
│   │   │   │   ├── communications.ts       # Tenant communications log
│   │   │   │   ├── costs.ts                # Property costs
│   │   │   │   ├── gocardless.ts           # GoCardless mandate + payment actions
│   │   │   │   ├── import.ts               # Smovin data import
│   │   │   │   ├── indexation.ts           # Belgian rent indexation
│   │   │   │   ├── leases.ts               # Lease CRUD and management
│   │   │   │   ├── maintenance.ts          # Maintenance requests
│   │   │   │   ├── payments.ts             # Payment records
│   │   │   │   ├── properties.ts           # Property CRUD
│   │   │   │   ├── propertyManagers.ts     # Property manager assignments
│   │   │   │   ├── rentAdjustments.ts      # Rent adjustment records
│   │   │   │   ├── settings.ts             # User and SMTP settings
│   │   │   │   ├── stripe.ts               # Stripe subscription billing
│   │   │   │   ├── support.ts              # Support / admin notifications
│   │   │   │   ├── tenants.ts              # Tenant CRUD
│   │   │   │   ├── webhooks.ts             # GoCardless + Stripe webhooks
│   │   │   │   └── __tests__/              # Route integration tests
│   │   │   │       ├── bankConnections.test.ts
│   │   │   │       └── settings.test.ts
│   │   │   ├── jobs/                       # Background job workers
│   │   │   │   ├── emailQueueWorker.ts     # BullMQ worker for email delivery
│   │   │   │   ├── smsQueueWorker.ts       # BullMQ worker for SMS delivery
│   │   │   │   ├── paymentCheckWorker.ts   # Cron: SEPA payment reconciliation
│   │   │   │   ├── landlordReportWorker.ts # Cron: monthly landlord reports
│   │   │   │   ├── healthIndexWorker.ts    # Cron: Belgian health index update
│   │   │   │   ├── importDiscoveryWorker.ts# Smovin import discovery step
│   │   │   │   ├── importWriteWorker.ts    # Smovin import write step
│   │   │   │   └── __tests__/
│   │   │   │       ├── emailQueueWorker.test.ts
│   │   │   │       └── smsQueueWorker.test.ts
│   │   │   ├── lib/                        # Utilities and integrations
│   │   │   │   ├── authMiddleware.ts       # JWT validation, userId context
│   │   │   │   ├── routeAuth.ts            # Route-level auth helpers
│   │   │   │   ├── propertyAccess.ts       # Property ownership/manager access check
│   │   │   │   ├── email.ts                # SMTP email sender (Nodemailer)
│   │   │   │   ├── sms.ts                  # SMS provider client
│   │   │   │   ├── gocardless.ts           # GoCardless API client wrapper
│   │   │   │   ├── pontoConnect.ts         # Ponto Connect PSD2 OAuth client
│   │   │   │   ├── bankOAuthState.ts       # JWT-signed OAuth state for bank flows
│   │   │   │   ├── bankAccountData.ts      # Bank account data helpers
│   │   │   │   ├── encryption.ts           # AES-GCM token encryption at rest
│   │   │   │   ├── adminNotify.ts          # Internal admin alert helper
│   │   │   │   └── __tests__/
│   │   │   │       ├── bankOAuthState.test.ts
│   │   │   │       ├── email.test.ts
│   │   │   │       ├── encryption.test.ts
│   │   │   │       └── pontoConnect.test.ts
│   │   │   ├── services/                   # Business logic (multi-step operations)
│   │   │   │   ├── bankConnectionSync.ts   # Sync bank transactions via Ponto
│   │   │   │   ├── bankStatementImporter.ts# Parse + store PSD2 bank statement entries
│   │   │   │   ├── paymentFollowUp.ts      # Payment reminder scheduling and dispatch
│   │   │   │   ├── paymentStateMachine.ts  # Payment lifecycle state transitions
│   │   │   │   ├── transactionMatcher.ts   # Match bank transactions to payments
│   │   │   │   ├── landlordReport.ts       # Monthly report data assembly
│   │   │   │   ├── healthIndex.ts          # Belgian health index calculation
│   │   │   │   ├── indexationEmail.ts      # Indexation email generation
│   │   │   │   ├── smovinMapper.ts         # Smovin → Rentular data mapping
│   │   │   │   ├── smovinScraper.ts        # Smovin data extraction
│   │   │   │   ├── webhookCleanup.ts       # Stale webhook event pruning
│   │   │   │   ├── spikeTest.ts            # (Development/spike scratch file)
│   │   │   │   └── __tests__/
│   │   │   │       ├── bankStatementImporter.test.ts
│   │   │   │       └── paymentFollowUp.test.ts
│   │   │   └── types/
│   │   │       └── hono.d.ts               # Hono context augmentation (userId, etc.)
│   │   ├── test/                           # Top-level test utilities
│   │   │   └── fixtures/
│   │   │       └── ponto/                  # Ponto Connect API response fixtures
│   │   │           ├── accounts-list.json
│   │   │           ├── institutions-be.json
│   │   │           ├── oauth-token-success.json
│   │   │           └── transactions-list.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── web/                                # Next.js 15 frontend application
│       ├── app/                            # Next.js App Router pages
│       │   ├── layout.tsx                  # Root layout (NextIntl provider, fonts)
│       │   ├── page.tsx                    # Root redirect
│       │   ├── globals.css                 # Global Tailwind CSS
│       │   ├── (auth)/                     # Auth route group (no sidebar)
│       │   │   ├── login/page.tsx          # Login form
│       │   │   └── invite/accept/          # Invitation acceptance flow
│       │   │       ├── page.tsx
│       │   │       └── InvitationAcceptClient.tsx
│       │   ├── (dashboard)/                # Protected dashboard route group
│       │   │   ├── layout.tsx              # Dashboard layout (sidebar, nav)
│       │   │   ├── properties/page.tsx     # Property list
│       │   │   ├── properties/[id]/managers/page.tsx  # Property manager management
│       │   │   ├── leases/page.tsx         # Lease list
│       │   │   ├── tenants/page.tsx        # Tenant list
│       │   │   ├── payments/page.tsx       # Payment list
│       │   │   ├── mandates/page.tsx       # SEPA mandate management
│       │   │   ├── indexation/page.tsx     # Rent indexation
│       │   │   ├── communications/page.tsx # Communication log
│       │   │   ├── import/page.tsx         # Smovin import wizard
│       │   │   ├── import/error.tsx        # Import error boundary
│       │   │   ├── maintenance/page.tsx    # Maintenance requests
│       │   │   └── settings/page.tsx       # User settings
│       │   ├── (marketing)/                # Public marketing route group
│       │   │   └── page.tsx                # Marketing landing page
│       │   ├── api/auth/[...nextauth]/     # NextAuth.js handler
│       │   │   └── route.ts
│       │   ├── onboarding/page.tsx         # New-user onboarding flow
│       │   ├── privacy/page.tsx            # Privacy policy (static)
│       │   └── terms/page.tsx              # Terms of service (static)
│       ├── components/                     # Reusable React components
│       │   ├── ui/                         # shadcn/ui primitives
│       │   │   ├── alert.tsx, alert-dialog.tsx, badge.tsx
│       │   │   ├── button.tsx, card.tsx, dialog.tsx
│       │   │   ├── dropdown-menu.tsx, input.tsx, label.tsx
│       │   │   ├── radio-group.tsx, select.tsx, separator.tsx
│       │   │   ├── sheet.tsx, skeleton.tsx, sonner.tsx
│       │   │   ├── table.tsx, tabs.tsx, textarea.tsx, tooltip.tsx
│       │   ├── BelgianCityInput.tsx        # Belgian city autocomplete
│       │   ├── CancelMandateDialog.tsx     # GoCardless mandate cancellation dialog
│       │   ├── CountrySelect.tsx           # Country dropdown
│       │   ├── DashboardSidebar.tsx        # Navigation sidebar
│       │   ├── IbanInput.tsx               # IBAN validation input
│       │   ├── LanguageSwitcher.tsx        # EN/NL/FR/DE switcher
│       │   ├── MandateSetupModal.tsx       # SEPA mandate creation modal
│       │   ├── MandateStatusBadge.tsx      # Mandate state badge
│       │   ├── MobileNav.tsx               # Mobile navigation overlay
│       │   ├── PaymentMethodRadioGroup.tsx # SEPA vs manual payment selector
│       │   ├── PhoneInput.tsx              # Phone number input
│       │   ├── QueryProvider.tsx           # TanStack Query provider wrapper
│       │   ├── RoleBadge.tsx               # Property manager role badge
│       │   └── SupportChat.tsx             # Support chat widget
│       ├── lib/                            # Frontend utilities
│       │   ├── auth.ts                     # NextAuth.js config (providers, callbacks)
│       │   ├── i18n.ts                     # next-intl configuration
│       │   ├── routing.ts                  # Route path definitions
│       │   └── utils.ts                    # clsx/tailwind-merge helper
│       ├── types/
│       │   └── next-auth.d.ts              # NextAuth session type augmentation
│       ├── messages/                       # i18n translation bundles
│       │   ├── en/common.json              # English
│       │   ├── nl/common.json              # Dutch
│       │   ├── fr/common.json              # French
│       │   └── de/common.json              # German
│       ├── data/
│       │   └── belgian-postcodes.ts        # Belgian postcode → city lookup table
│       ├── public/
│       │   └── rentular.png                # App logo
│       ├── middleware.ts                   # Auth guard + locale detection
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/                               # Shared npm packages
│   ├── db/                                 # Database schema, client, migrations
│   │   ├── src/
│   │   │   ├── schema/                     # Drizzle table definitions (one file per domain)
│   │   │   │   ├── index.ts                # Re-exports all schema objects
│   │   │   │   ├── users.ts                # Auth tables (users, accounts, sessions)
│   │   │   │   ├── properties.ts           # Rental properties
│   │   │   │   ├── leases.ts               # Lease contracts and tenant links
│   │   │   │   ├── tenants.ts              # Tenant information
│   │   │   │   ├── payments.ts             # Payment records
│   │   │   │   ├── bankAccounts.ts         # Bank accounts for SEPA collections
│   │   │   │   ├── bankConnections.ts      # PSD2 bank connections (Ponto)
│   │   │   │   ├── bankStatements.ts       # PSD2 bank statement transactions
│   │   │   │   ├── communications.ts       # Tenant communications log
│   │   │   │   ├── costs.ts                # Property costs
│   │   │   │   ├── imports.ts              # Smovin import job records
│   │   │   │   ├── indexation.ts           # Rent indexation records
│   │   │   │   ├── maintenance.ts          # Maintenance request records
│   │   │   │   ├── propertyManagers.ts     # Property manager assignments
│   │   │   │   ├── rentAdjustments.ts      # Rent adjustment history
│   │   │   │   ├── smtpSettings.ts         # Per-user SMTP configuration
│   │   │   │   └── webhookEvents.ts        # Idempotent webhook event log
│   │   │   └── connection.ts               # Drizzle connection factory (singleton)
│   │   ├── drizzle/                        # Generated Drizzle metadata + snapshots
│   │   │   └── meta/
│   │   ├── drizzle.config.ts               # Migration configuration
│   │   └── package.json
│   │
│   └── shared/                             # Shared types, validation, constants
│       ├── src/
│       │   ├── index.ts                    # Public re-export barrel
│       │   ├── types/
│       │   │   └── index.ts                # TypeScript type definitions (domain types)
│       │   ├── validation/
│       │   │   └── index.ts                # Zod validation schemas
│       │   └── constants/
│       │       └── index.ts                # Business logic constants
│       └── package.json
│
├── .planning/                              # GSD workflow artifacts (committed)
│   ├── codebase/                           # Auto-generated codebase analysis docs
│   ├── phases/                             # Phase planning docs (01–09)
│   ├── debug/                              # Debug session docs
│   └── research/                           # Research notes
│
├── .claude/                                # Claude agent runtime state
│   └── worktrees/                          # Executor worktree checkouts
│
├── .env.example                            # Environment variable template
├── docker-compose.yml                      # Local dev services (MySQL, Redis, Mailpit)
├── package.json                            # Root workspace scripts
├── pnpm-workspace.yaml                     # Workspace definition
├── turbo.json                              # Turbo build task graph
├── tsconfig.json                           # Root TypeScript config (strict)
└── CLAUDE.md                               # Project instructions for Claude
```

## Directory Purposes

**`apps/api/src/routes/`:**
- Purpose: REST endpoint handlers organized by domain (20 routers)
- Contains: One router file per domain, each using Hono with CRUD operations
- Key files: `bankConnections.ts` (PSD2 bank connections, 8 endpoints added Phase 09), `webhooks.ts` (GoCardless + Stripe event handling), `gocardless.ts` (mandate management)
- Pattern: Each file exports a `*Router` Hono instance; mounted in `apps/api/src/index.ts`

**`apps/api/src/jobs/`:**
- Purpose: Background job workers for async operations
- Contains: BullMQ queue setup, job processing logic, cron-scheduled workers
- Key files: `emailQueueWorker.ts`, `smsQueueWorker.ts` (queue-driven delivery), `paymentCheckWorker.ts` (daily SEPA reconciliation via `bankConnectionSync`), `healthIndexWorker.ts` (Belgian CPI updates), `importDiscoveryWorker.ts` + `importWriteWorker.ts` (Smovin import pipeline)

**`apps/api/src/lib/`:**
- Purpose: Utilities and thin integration wrappers
- Contains: Auth helpers, external API clients, encryption, access control
- Key files: `authMiddleware.ts` (JWT decrypt + userId context), `pontoConnect.ts` (PSD2 OAuth client for Ponto), `bankOAuthState.ts` (JWT-signed state for OAuth callback security), `encryption.ts` (AES-GCM for storing bank OAuth tokens at rest), `propertyAccess.ts` (ownership + manager role check)

**`apps/api/src/services/`:**
- Purpose: Business logic for multi-step operations not fitting single route handlers
- Contains: Complex domain operations, external data sync, data assembly
- Key files: `bankConnectionSync.ts` (PSD2 transaction pull + match), `bankStatementImporter.ts` (normalize + deduplicate transactions), `transactionMatcher.ts` (match bank entries to rent payments), `paymentStateMachine.ts` (payment lifecycle), `smovinMapper.ts` + `smovinScraper.ts` (Smovin import)

**`apps/web/app/(dashboard)/`:**
- Purpose: Protected dashboard pages (require authentication)
- Contains: All landlord-facing feature pages
- Structure: Each feature has its own subdirectory with a `page.tsx`; no nested routing beyond `properties/[id]/managers`
- Pattern: Server components fetch via API calls; client interactivity via TanStack Query

**`apps/web/components/`:**
- Purpose: Reusable React components organized by level of abstraction
- `ui/`: shadcn/ui primitives (no business logic)
- Root level: Domain-specific components used across multiple pages (e.g., `MandateSetupModal.tsx`, `IbanInput.tsx`)
- No `forms/` or `tables/` subdirectories — form and table components live inline in page files or at root `components/`

**`packages/db/src/schema/`:**
- Purpose: Drizzle ORM table definitions (single source of truth for database shape)
- Contains: 17 schema files + `index.ts` barrel export
- Naming: File name matches domain (e.g., `bankConnections.ts`, `webhookEvents.ts`)
- New tables added since March 2026: `bankConnections.ts`, `bankStatements.ts`, `smtpSettings.ts`, `webhookEvents.ts`, `maintenance.ts`, `imports.ts`, `rentAdjustments.ts`

**`apps/api/test/fixtures/ponto/`:**
- Purpose: Static JSON fixtures for Ponto Connect API integration tests
- Contains: Mocked API responses for accounts, institutions, OAuth tokens, transactions

**`apps/web/messages/`:**
- Purpose: Translation bundles for next-intl
- Contains: One `common.json` per locale (en, nl, fr, de)
- All four locales maintained in parallel; keys are flat namespaced strings

## Key File Locations

**Entry Points:**
- `apps/web/app/layout.tsx`: Root layout — NextIntl provider, font loading
- `apps/web/app/page.tsx`: Root redirect (to marketing or dashboard)
- `apps/web/middleware.ts`: Auth guard + locale detection
- `apps/api/src/index.ts`: API server entry — middleware chain, all router mounts
- `apps/web/app/api/auth/[...nextauth]/route.ts`: NextAuth.js handler

**Configuration:**
- `tsconfig.json`: Root TypeScript strict config
- `apps/api/tsconfig.json`: API TypeScript config (tsup build)
- `apps/web/next.config.ts`: Next.js config (i18n routing)
- `apps/web/tailwind.config.ts`: Tailwind config
- `packages/db/drizzle.config.ts`: Drizzle migration config (MySQL dialect)
- `docker-compose.yml`: Local dev services (MySQL, Redis, Mailpit)
- `turbo.json`: Turbo task graph

**Core Logic:**
- `apps/api/src/lib/authMiddleware.ts`: JWT validation + userId context attachment
- `apps/api/src/lib/pontoConnect.ts`: Ponto Connect PSD2 OAuth client
- `apps/api/src/lib/encryption.ts`: AES-GCM token encryption for stored OAuth credentials
- `apps/api/src/services/bankConnectionSync.ts`: PSD2 transaction sync
- `apps/api/src/services/paymentStateMachine.ts`: Payment lifecycle transitions
- `apps/api/src/services/transactionMatcher.ts`: Bank transaction → payment matching
- `apps/web/lib/auth.ts`: NextAuth.js providers and session callbacks
- `packages/db/src/connection.ts`: Drizzle singleton factory

**Database Schema:**
- `packages/db/src/schema/index.ts`: Barrel re-export of all tables
- `packages/db/src/schema/bankConnections.ts`: PSD2 connection records with encrypted tokens
- `packages/db/src/schema/bankStatements.ts`: Normalized transaction entries
- `packages/db/src/schema/webhookEvents.ts`: Idempotent webhook deduplication log
- `packages/db/src/schema/smtpSettings.ts`: Per-user SMTP config (encrypted credentials)

**Shared Package:**
- `packages/shared/src/index.ts`: Public API barrel for types, validation, constants

## Naming Conventions

**Files:**
- Route handlers: `[domain].ts` in `apps/api/src/routes/` — camelCase, singular domain noun (e.g., `bankConnections.ts`, `properties.ts`)
- Job workers: `[feature]Worker.ts` in `apps/api/src/jobs/` (e.g., `paymentCheckWorker.ts`, `healthIndexWorker.ts`)
- Services: `[featureName].ts` in `apps/api/src/services/` — camelCase noun (e.g., `bankConnectionSync.ts`, `transactionMatcher.ts`)
- DB schemas: `[domain].ts` in `packages/db/src/schema/` — camelCase plural noun matching table concept
- React components: PascalCase `.tsx` (e.g., `MandateSetupModal.tsx`, `IbanInput.tsx`)
- Next.js pages: `page.tsx` (convention), layouts: `layout.tsx`
- Test files: `[subject].test.ts` co-located in `__tests__/` sibling directories or `test/` at app root

**Directories:**
- Next.js route groups: parentheses notation `(auth)`, `(dashboard)`, `(marketing)` — no URL impact
- Dynamic segments: bracket notation `[id]`, `[...nextauth]`
- Feature domains: lowercase camelCase plural (e.g., `bankConnections`, `properties`)
- Primitive UI: `ui/` inside `components/`
- Utilities: `lib/` (never `utils/`)

**Identifiers:**
- DB table names: camelCase (Drizzle convention), e.g., `bankConnections`, `webhookEvents`
- DB columns: camelCase, e.g., `ownerId`, `createdAt`, `encryptedToken`
- Functions/variables: camelCase, e.g., `syncBankConnection`, `getRequiredUserId`
- Types/interfaces: PascalCase, e.g., `PaymentStatus`, `BankConnectionRow`
- Exported router instances: `[domain]Router`, e.g., `bankConnectionsRouter`, `paymentsRouter`
- Environment constants: SCREAMING_SNAKE_CASE, e.g., `REDIS_URL`, `GOCARDLESS_ACCESS_TOKEN`

## Where to Add New Code

**New Feature (e.g., Document Storage):**
1. DB schema: `packages/db/src/schema/documents.ts`; re-export from `packages/db/src/schema/index.ts`
2. Migration: Run `pnpm db:generate` then `pnpm db:migrate`
3. API route: `apps/api/src/routes/documents.ts` (export `documentsRouter`); mount in `apps/api/src/index.ts`
4. Business logic (if complex): `apps/api/src/services/documentService.ts`
5. Dashboard page: `apps/web/app/(dashboard)/documents/page.tsx`
6. Specialized components: `apps/web/components/DocumentUpload.tsx` (root level, shared across pages)
7. i18n: Add keys to all four `apps/web/messages/{locale}/common.json` files

**New Background Job:**
1. Create worker: `apps/api/src/jobs/[featureName]Worker.ts` — follow BullMQ pattern from `emailQueueWorker.ts`
2. Import and start worker in `apps/api/src/index.ts`
3. For cron: configure schedule in worker initialization (BullMQ `repeat` option)

**New API Utility / Integration:**
1. Thin client or helper: `apps/api/src/lib/[clientName].ts`
2. Multi-step orchestration: `apps/api/src/services/[serviceName].ts`
3. If access-control related: extend `apps/api/src/lib/propertyAccess.ts` or `routeAuth.ts`

**New Component:**
1. shadcn/ui primitive: `apps/web/components/ui/[component].tsx`
2. Domain-specific, used across pages: `apps/web/components/[ComponentName].tsx`
3. Inline in a single page: define within the page file itself

**New DB Schema:**
1. Add file: `packages/db/src/schema/[domain].ts`
2. Export from `packages/db/src/schema/index.ts`
3. Generate + apply migration: `pnpm db:generate && pnpm db:migrate`
4. Commit generated files in `packages/db/drizzle/`

**New Shared Type or Validation:**
1. Types: `packages/shared/src/types/index.ts`
2. Zod schemas: `packages/shared/src/validation/index.ts`
3. Constants: `packages/shared/src/constants/index.ts`
4. Re-export via `packages/shared/src/index.ts`

## Special Directories

**`.planning/`:**
- Purpose: GSD workflow artifacts — phase plans, codebase analysis, debug sessions
- Generated: Partially (codebase docs by GSD map-codebase, phase docs by gsd:plan-phase)
- Committed: Yes
- Contents: `codebase/` (ARCHITECTURE, STRUCTURE, etc.), `phases/01–09/` (planning docs), `research/`

**`.claude/worktrees/`:**
- Purpose: Isolated git worktree checkouts used by executor agents during phase work
- Generated: Yes (by gsd:execute-phase infrastructure)
- Committed: No (.gitignore'd)

**`apps/api/test/fixtures/ponto/`:**
- Purpose: Static JSON fixtures for Ponto Connect MSW-based integration tests
- Generated: No (manually curated from real API responses)
- Committed: Yes

**`packages/db/drizzle/`:**
- Purpose: Drizzle ORM migration SQL files and schema snapshots
- Generated: Yes (by `drizzle-kit generate`)
- Committed: Yes
- Contents: Migration files + `meta/` snapshot directory

**`apps/web/messages/`:**
- Purpose: Translation catalogs for next-intl (en, nl, fr, de)
- Generated: No (manually maintained)
- Committed: Yes
- Structure: Each locale directory contains a single `common.json`

---

*Structure analysis: 2026-06-24*
