# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
rentular/
├── apps/                                # Workspace applications
│   ├── api/                             # Hono REST API server
│   │   ├── src/
│   │   │   ├── index.ts                 # Server entry, middleware chain, route mounting
│   │   │   ├── routes/                  # REST endpoint handlers (25+ routers)
│   │   │   ├── jobs/                    # Background job workers (email, SMS, payment checks)
│   │   │   ├── lib/                     # Utilities (auth, email, SMS, GoCardless)
│   │   │   ├── services/                # Business logic (landlord reports, payment follow-up)
│   │   │   ├── types/                   # API-specific type definitions
│   │   │   └── middleware/              # (empty placeholder)
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── web/                             # Next.js 15 frontend application
│       ├── app/                         # Next.js 13+ app directory
│       │   ├── (auth)/                  # Auth routes (login, register)
│       │   ├── (dashboard)/             # Protected dashboard pages
│       │   ├── (marketing)/             # Public landing pages
│       │   ├── api/                     # Next.js API routes (NextAuth handler)
│       │   ├── privacy/                 # Static pages
│       │   ├── terms/                   # Static pages
│       │   ├── layout.tsx               # Root layout with NextIntl provider
│       │   ├── page.tsx                 # Landing page (public)
│       │   └── globals.css              # Global styles
│       ├── components/                  # Reusable React components
│       │   ├── ui/                      # Base UI components (buttons, inputs, etc.)
│       │   ├── forms/                   # Form components
│       │   ├── tables/                  # Table components
│       │   ├── layout/                  # Layout components
│       │   └── [specialized].tsx        # Domain-specific (IbanInput, CountrySelect, etc.)
│       ├── lib/                         # Frontend utilities
│       │   ├── auth.ts                  # NextAuth.js config and providers
│       │   ├── i18n.ts                  # i18n configuration
│       │   └── routing.ts               # Route definitions
│       ├── messages/                    # Internationalization
│       │   ├── en/
│       │   ├── nl/
│       │   ├── fr/
│       │   └── de/
│       ├── data/                        # Static data (lookups, seed data)
│       ├── middleware.ts                # Request middleware (auth guard)
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/                            # Shared npm packages
│   ├── db/                              # Database client and schema
│   │   ├── src/
│   │   │   ├── schema/                  # Drizzle table definitions
│   │   │   │   ├── users.ts             # Auth tables (users, accounts, sessions)
│   │   │   │   ├── properties.ts        # Rental properties
│   │   │   │   ├── leases.ts            # Lease contracts and tenant links
│   │   │   │   ├── tenants.ts           # Tenant information
│   │   │   │   ├── payments.ts          # Payment records
│   │   │   │   ├── bankAccounts.ts      # Bank accounts for collections
│   │   │   │   ├── indexation.ts        # Rent indexation records
│   │   │   │   ├── costs.ts             # Property costs
│   │   │   │   ├── communications.ts    # Tenant communications log
│   │   │   │   ├── propertyManagers.ts  # Property manager assignments
│   │   │   │   └── [other schemas]      # Additional domain tables
│   │   │   ├── migrations/              # Drizzle migrations
│   │   │   └── connection.ts            # Database connection factory
│   │   ├── drizzle/                     # Generated Drizzle metadata
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   │
│   ├── shared/                          # Shared types, validation, constants
│   │   ├── src/
│   │   │   ├── types/                   # TypeScript type definitions
│   │   │   ├── validation/              # Zod validation schemas
│   │   │   └── constants/               # Business logic constants
│   │   └── package.json
│   │
│   ├── payments/                        # (empty placeholder for future extraction)
│   ├── notifications/                   # (empty placeholder for future extraction)
│   └── indexation/                      # (empty placeholder for future extraction)
│
├── .planning/codebase/                  # GSD codebase documentation
│   ├── ARCHITECTURE.md
│   ├── STRUCTURE.md
│   ├── CONVENTIONS.md (if exists)
│   └── [other docs]
│
├── pnpm-workspace.yaml                  # Workspace definition
├── turbo.json                           # Turbo build cache config
├── tsconfig.json                        # Root TypeScript config
├── package.json                         # Root workspace scripts
└── docker-compose.yml                   # Local development services (MySQL, Redis, etc.)
```

## Directory Purposes

**`apps/api/src/routes`:**
- Purpose: REST endpoint handlers organized by domain (properties, leases, payments, tenants, etc.)
- Contains: One router file per domain, each using Hono router with CRUD operations
- Key files: `properties.ts`, `leases.ts`, `payments.ts`, `tenants.ts`, `auth.ts`, `settings.ts`
- Pattern: Each route file imports database client and Zod schemas, exports `*Router` instance

**`apps/api/src/jobs`:**
- Purpose: Background job workers for async operations
- Contains: BullMQ queue setup, job processing logic, worker configuration
- Key files: `emailQueueWorker.ts` (email delivery), `smsQueueWorker.ts` (SMS delivery), `paymentCheckWorker.ts` (cron), `landlordReportWorker.ts` (cron)

**`apps/api/src/lib`:**
- Purpose: Shared utilities and integrations
- Contains: Auth token handling, external API clients, email/SMS senders
- Key files: `authMiddleware.ts` (JWT validation), `gocardless.ts` (payment provider), `email.ts` (SMTP), `sms.ts` (SMS provider)

**`apps/api/src/services`:**
- Purpose: Business logic extraction for complex operations
- Contains: Multi-step processes not fitting into single route handlers
- Key files: `paymentFollowUp.ts` (payment reminders), `landlordReport.ts` (report generation)

**`apps/web/app/(dashboard)`:**
- Purpose: Protected dashboard routes accessible only to authenticated users
- Contains: Page layouts and forms for core features
- Structure: One folder per feature (properties, leases, tenants, payments, settings, etc.)
- Pattern: Each page imports data fetching utilities and domain components

**`apps/web/components`:**
- Purpose: Reusable React components organized by responsibility
- Contains: UI primitives, form controls, table renderers, specialized inputs
- Key files: `IbanInput.tsx` (IBAN validation), `BelgianCityInput.tsx` (Belgian city selector), `PhoneInput.tsx`, domain-specific forms

**`packages/db/src/schema`:**
- Purpose: Drizzle ORM table definitions (single source of truth for database shape)
- Contains: One schema file per domain (users, properties, leases, etc.), each defining tables and relationships
- Naming: Table names in lowercase (users, properties, leases); columns in camelCase

**`apps/web/messages`:**
- Purpose: Internationalization message bundles
- Contains: JSON files per language (en, nl, fr, de) with translation keys
- Structure: Flat namespace (landing.*, auth.*, common.*) for message organization

## Key File Locations

**Entry Points:**
- `apps/web/app/layout.tsx`: Root layout initializing NextIntl and rendering child pages
- `apps/web/app/page.tsx`: Landing page (public marketing site and login modal)
- `apps/api/src/index.ts`: API server initialization, middleware chain, route mounting
- `apps/web/middleware.ts`: Request-level auth guard, locale detection, redirect logic

**Configuration:**
- `apps/api/tsconfig.json`: API-specific TypeScript settings
- `apps/web/next.config.ts`: Next.js configuration (i18n routing)
- `packages/db/drizzle.config.ts`: Database migration configuration
- `docker-compose.yml`: Local development service definitions (MySQL, Redis)

**Core Logic:**
- `apps/api/src/routes/[domain].ts`: REST endpoint implementations
- `apps/web/lib/auth.ts`: NextAuth.js setup with OAuth and credential providers
- `packages/db/src/connection.ts`: Database client factory (singleton pattern)
- `apps/api/src/lib/authMiddleware.ts`: JWT validation and user context attachment

**Testing & Validation:**
- `packages/shared/src/validation/`: Zod schema definitions used by routes
- `packages/shared/src/types/`: Shared TypeScript types across apps

## Naming Conventions

**Files:**
- Route handlers: `[domain].ts` in `apps/api/src/routes/` (e.g., `properties.ts`, `payments.ts`)
- Database schemas: `[domain].ts` in `packages/db/src/schema/` (e.g., `users.ts`, `leases.ts`)
- Components: PascalCase in `apps/web/components/` (e.g., `IbanInput.tsx`, `SupportChat.tsx`)
- Pages: `page.tsx` in route directories (Next.js convention)
- Layouts: `layout.tsx` in directories (Next.js convention)

**Directories:**
- Route groups: Parentheses notation `(auth)`, `(dashboard)`, `(marketing)` for organization without affecting URL
- Feature domains: lowercase plural (properties, tenants, leases, payments)
- UI folders: `ui/` for primitives, `forms/` for form components, `tables/` for table renderers
- Utilities: `lib/` for JavaScript utilities, `utils/` not used (prefer `lib/`)

**Identifiers:**
- Table names: lowercase underscore_case (e.g., `property_managers`, `rent_adjustments`)
- Columns: camelCase (e.g., `ownerId`, `createdAt`, `monthlyRent`)
- Variables/functions: camelCase (e.g., `getRequiredUserId`, `ensureUser`, `queueEmail`)
- Types: PascalCase (e.g., `EmailOptions`, `PropertyCreateInput`)

## Where to Add New Code

**New Feature (e.g., Maintenance Requests):**
1. Database: Add schema in `packages/db/src/schema/maintenance.ts`
2. Backend: Add route handler in `apps/api/src/routes/maintenance.ts` with GET/POST/PUT/DELETE
3. Frontend: Create page in `apps/web/app/(dashboard)/maintenance/page.tsx`
4. Forms: Add specialized form in `apps/web/components/forms/MaintenanceForm.tsx` if complex
5. Validation: Add Zod schema in route handler (or extract to `packages/shared` if shared)
6. i18n: Add message keys to `apps/web/messages/{locale}/common.json`

**New Component:**
1. Simple UI primitive: `apps/web/components/ui/[ComponentName].tsx`
2. Form component: `apps/web/components/forms/[ComponentName].tsx`
3. Table component: `apps/web/components/tables/[ComponentName].tsx`
4. Specialized component: `apps/web/components/[ComponentName].tsx` (root level if used across multiple features)

**New Utility/Service:**
1. Backend service: `apps/api/src/services/[serviceName].ts`
2. Backend utility: `apps/api/src/lib/[utilName].ts`
3. Frontend utility: `apps/web/lib/[utilName].ts`
4. Shared across apps: `packages/shared/src/` with appropriate subfolder

**New Background Job:**
1. Create worker: `apps/api/src/jobs/[featureName]Worker.ts` (follow BullMQ queue pattern in `emailQueueWorker.ts`)
2. Export queue and job functions: `queueJob()`, `processBatch()`, `getStats()`
3. Import and start in `apps/api/src/index.ts`
4. Add rate limiting and retry configuration as needed

**New Database Migration:**
1. Modify schema in `packages/db/src/schema/[domain].ts`
2. Run `pnpm db:generate` to generate migration file
3. Run `pnpm db:migrate` to apply to local database
4. Commit generated migration files to repository

## Special Directories

**`.planning/codebase`:**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by GSD tools)
- Committed: Yes
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**`apps/web/messages`:**
- Purpose: Translation catalogs for i18n
- Generated: No (manually maintained)
- Committed: Yes
- Structure: Each locale has a `common.json` with flat key/value pairs

**`packages/db/drizzle`:**
- Purpose: Drizzle ORM metadata and generated files
- Generated: Yes (by `drizzle-kit generate`)
- Committed: Yes
- Contents: Schema snapshots, type definitions

**`apps/api/src/middleware`:**
- Purpose: Reserved for future middleware plugins
- Contents: Currently empty
- Usage: Not yet established

---

*Structure analysis: 2026-03-22*
