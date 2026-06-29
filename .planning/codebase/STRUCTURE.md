# Codebase Structure

**Analysis Date:** 2026-06-28

## Directory Layout

```
source/                                  # Turborepo monorepo root
├── apps/
│   ├── api/                             # Hono HTTP API
│   │   └── src/
│   │       ├── index.ts                 # Server entry point; mounts all routers
│   │       ├── routes/                  # One Hono router file per resource domain
│   │       ├── services/                # Stateless business-logic modules
│   │       ├── jobs/                    # BullMQ workers + schedule registration
│   │       ├── lib/                     # Cross-cutting utilities (auth, crypto, SMS, email)
│   │       └── types/
│   │           └── hono.d.ts            # Hono context type augmentations (userId, etc.)
│   └── web/                             # Next.js 15 frontend
│       ├── app/
│       │   ├── layout.tsx               # Root layout; NextIntlClientProvider
│       │   ├── page.tsx                 # Root redirect
│       │   ├── (marketing)/             # Public landing page
│       │   ├── (auth)/                  # Login, invite-accept pages
│       │   │   ├── login/page.tsx
│       │   │   └── invite/accept/       # Invitation acceptance flow
│       │   ├── (dashboard)/             # Authenticated app (shared layout)
│       │   │   ├── layout.tsx           # Dashboard shell with sidebar
│       │   │   ├── properties/          # Property list + [id]/managers sub-route
│       │   │   ├── tenants/
│       │   │   ├── leases/
│       │   │   ├── payments/
│       │   │   ├── mandates/            # GoCardless SEPA mandates
│       │   │   ├── indexation/          # Belgian rent indexation tool
│       │   │   ├── communications/      # Email/SMS log
│       │   │   ├── import/              # Smovin importer UI
│       │   │   ├── maintenance/
│       │   │   └── settings/
│       │   ├── api/
│       │   │   └── auth/[...nextauth]/  # NextAuth.js handler
│       │   ├── onboarding/              # First-login onboarding wizard
│       │   ├── privacy/
│       │   └── terms/
│       ├── components/                  # Reusable React components
│       │   ├── ui/                      # Primitive UI (shadcn-style)
│       │   ├── DashboardSidebar.tsx
│       │   ├── IbanInput.tsx
│       │   ├── LanguageSwitcher.tsx
│       │   ├── MandateSetupModal.tsx
│       │   ├── BelgianCityInput.tsx
│       │   ├── RoleBadge.tsx
│       │   └── QueryProvider.tsx        # TanStack Query wrapper
│       ├── lib/
│       │   ├── auth.ts                  # NextAuth config
│       │   ├── i18n.ts                  # next-intl config
│       │   ├── routing.ts               # Locale-aware routing helpers
│       │   └── utils.ts                 # clsx/tailwind-merge cn()
│       ├── messages/                    # i18n translation files
│       │   ├── en/common.json
│       │   ├── nl/common.json
│       │   ├── fr/common.json
│       │   └── de/common.json
│       ├── types/
│       │   └── next-auth.d.ts           # NextAuth session type extensions
│       ├── data/                        # Static reference data
│       └── middleware.ts                # Auth redirect + locale guard
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── schema/                  # Drizzle table definitions (one file per domain)
│   │   │   │   ├── index.ts             # Re-exports all schema
│   │   │   │   ├── users.ts
│   │   │   │   ├── properties.ts
│   │   │   │   ├── tenants.ts
│   │   │   │   ├── leases.ts
│   │   │   │   ├── payments.ts
│   │   │   │   ├── indexation.ts        # Health index values + rent adjustment records
│   │   │   │   ├── costs.ts
│   │   │   │   ├── bankAccounts.ts      # Landlord IBAN accounts (manual, non-PSD2)
│   │   │   │   ├── bankConnections.ts   # PSD2 OAuth connections (Ponto/GC BAD)
│   │   │   │   ├── bankStatements.ts    # Raw bank transactions (PII encrypted)
│   │   │   │   ├── webhookEvents.ts     # Idempotency log for GC + Stripe webhooks
│   │   │   │   ├── propertyManagers.ts  # Multi-user RBAC
│   │   │   │   ├── communications.ts    # Email/SMS send log
│   │   │   │   ├── smtpSettings.ts      # Per-owner SMTP overrides
│   │   │   │   ├── maintenance.ts
│   │   │   │   └── imports.ts           # Smovin import sessions
│   │   │   └── index.ts                 # getDb() + re-exports schema
│   │   └── drizzle/                     # Migration SQL files (drizzle-kit)
│   └── shared/
│       └── src/
│           ├── types/index.ts           # Domain types (PropertyType, LeaseType, PaymentStatus, …)
│           ├── constants/index.ts       # Belgian law constants, cron schedules, email templates
│           └── validation/index.ts      # Shared Zod schemas
├── .planning/                           # GSD workflow planning artifacts
├── .claude/                             # Claude worktree state
├── docker-compose.yml                   # Local dev: MySQL + Redis + Mailpit
├── turbo.json                           # Turborepo task pipeline
├── pnpm-workspace.yaml
├── package.json                         # Root: volta Node/pnpm pins, shared devDeps
└── tsconfig.json                        # Root strict TS config (extended by apps/packages)
```

## Directory Purposes

**`apps/api/src/routes/`:**
- Purpose: Hono domain routers; HTTP request validation, auth enforcement, response serialization.
- Contains: One `.ts` file per resource. 19 routes total.
- Key files: `properties.ts`, `leases.ts`, `payments.ts`, `bankConnections.ts`, `webhooks.ts`, `stripe.ts`, `gocardless.ts`, `import.ts`.
- Pattern: Each file exports a named `const [domain]Router = new Hono()`.

**`apps/api/src/services/`:**
- Purpose: Domain business logic shared between routes and workers.
- Contains: Pure functions and classes — no Hono types.
- Key files: `paymentStateMachine.ts`, `bankConnectionSync.ts`, `transactionMatcher.ts`, `bankStatementImporter.ts`, `paymentFollowUp.ts`, `healthIndex.ts`, `landlordReport.ts`, `smovinScraper.ts`, `smovinMapper.ts`, `webhookCleanup.ts`.

**`apps/api/src/jobs/`:**
- Purpose: BullMQ `Worker` + `Queue` definitions; cron schedule registration.
- Contains: Worker files that import from `services/` for the actual logic.
- Key files: `paymentCheckWorker.ts` (3-phase cron), `healthIndexWorker.ts`, `importDiscoveryWorker.ts`, `importWriteWorker.ts`, `emailQueueWorker.ts`, `smsQueueWorker.ts`, `landlordReportWorker.ts`.

**`apps/api/src/lib/`:**
- Purpose: Cross-cutting utilities with no domain business logic.
- Key files:
  - `authMiddleware.ts` — JWT decrypt + user resolution.
  - `routeAuth.ts` — `requireAuth` middleware + `getRequiredUserId()`.
  - `propertyAccess.ts` — 5-role RBAC helpers.
  - `encryption.ts` — AES-256-GCM encrypt/decrypt triplet.
  - `bankAccountData.ts` — `BankAccountDataProvider` interface + `PontoConnectProvider` / `GoCardlessBadProvider`.
  - `pontoConnect.ts` — Ponto/Ibanity REST + OAuth client (no SDK).
  - `bankOAuthState.ts` — HS256 JWT for OAuth state.
  - `email.ts` — nodemailer SMTP send helper.
  - `sms.ts` — SMS provider abstraction (Twilio/MessageBird/OVH).
  - `gocardless.ts` — GoCardless SEPA mandate helpers.

**`apps/api/test/fixtures/ponto/`:**
- Purpose: JSON fixtures for unit tests of the Ponto integration.
- Contains: `accounts-list.json`, `transactions-list.json`, `institutions-be.json`, `oauth-token-success.json`.

**`apps/web/app/(dashboard)/`:**
- Purpose: All authenticated dashboard pages, each a Next.js route segment.
- Naming: Directory name = URL segment (`payments/` → `/payments`).

**`packages/db/src/schema/`:**
- Purpose: Drizzle table definitions; one file per conceptual domain.
- Generated: No. Committed: Yes. Migrations in `packages/db/drizzle/`.

**`packages/shared/src/constants/index.ts`:**
- Purpose: Belgian rental law constants, cron schedules, multilingual email/SMS templates.
- Exported constants include `BALANCE_CHECK_CRON`, `REGIONS`, `BRUSSELS_EPC_INDEXATION_FACTOR`, `FLANDERS_EPC_FREEZE_FACTOR`, `DEFAULT_EMAIL_TEMPLATES`, `DEFAULT_SMS_TEMPLATES`.

## Key File Locations

**Entry Points:**
- `apps/api/src/index.ts`: Hono server; router mounting; job schedule registration.
- `apps/web/app/layout.tsx`: Root Next.js layout; NextIntlClientProvider.
- `apps/web/middleware.ts`: Auth guard and locale routing for all web requests.
- `apps/web/app/api/auth/[...nextauth]/route.ts`: NextAuth handler.

**Configuration:**
- `turbo.json`: Build/test/lint pipeline.
- `pnpm-workspace.yaml`: Monorepo workspace definition.
- `packages/db/drizzle.config.ts`: Drizzle-kit migration config.
- `tsconfig.json`: Root TypeScript config (strict, ES2022 target).
- `docker-compose.yml`: MySQL, Redis, Mailpit for local development.
- `.env` (not committed): All environment variables; see `.env.example`.

**Core Logic:**
- `apps/api/src/services/bankConnectionSync.ts`: PSD2 sync pipeline (fetch → import → match → update).
- `apps/api/src/services/transactionMatcher.ts`: Belgian OGM-VCS structured comm matching.
- `apps/api/src/services/paymentStateMachine.ts`: Payment status transitions with GoCardless event mapping.
- `apps/api/src/services/paymentFollowUp.ts`: Overdue escalation logic (friendly/formal/final).
- `apps/api/src/lib/bankAccountData.ts`: `BankAccountDataProvider` interface + implementations.
- `apps/api/src/lib/encryption.ts`: AES-256-GCM encrypt/decrypt for PII at rest.
- `packages/shared/src/constants/index.ts`: Belgian rental law constants.
- `packages/shared/src/types/index.ts`: All shared domain types.

**Testing:**
- `apps/api/src/routes/__tests__/`: Route handler unit tests.
- `apps/api/src/services/__tests__/`: Service unit tests (`bankStatementImporter.test.ts`, `paymentFollowUp.test.ts`).
- `apps/api/src/jobs/__tests__/`: Worker unit tests (`emailQueueWorker.test.ts`, `smsQueueWorker.test.ts`).
- `apps/api/src/lib/__tests__/`: Library unit tests (`encryption.test.ts`, `pontoConnect.test.ts`, `bankOAuthState.test.ts`, `email.test.ts`).
- `apps/api/src/__tests__/`: Top-level tests including `i18n-completeness.test.ts`, `bankStatementsSchema.test.ts`.
- `apps/api/test/fixtures/ponto/`: JSON fixtures for Ponto API mock responses.

## Naming Conventions

**Files:**
- Route files: camelCase matching the resource (`bankConnections.ts`, `rentAdjustments.ts`).
- Service files: camelCase describing the concern (`bankConnectionSync.ts`, `transactionMatcher.ts`).
- Job files: camelCase with `Worker` suffix (`paymentCheckWorker.ts`, `healthIndexWorker.ts`).
- Web pages: `page.tsx` in route directories; PascalCase for client components (`IbanInput.tsx`).
- Test files: `{module}.test.ts` co-located in `__tests__/` sibling directory.

**Directories:**
- Route segment directories in `apps/web`: kebab-case (`bank-connections`, `rent-adjustments`).
- API route files: camelCase (e.g., `bankConnections.ts` not `bank-connections.ts`).
- Schema files: camelCase matching the table concept.

**Exports:**
- Routers: `export const [domain]Router = new Hono()` (named export).
- Services: named function exports (`export async function syncBankConnection(...)`).
- Workers: named export of queue and worker (`export { paymentCheckQueue, worker }`).
- Schema tables: named export matching camelCase table name (`export const bankConnections = mysqlTable(...)`).
- Types: named type exports, no `default` exports except Next.js page components.

## Where to Add New Code

**New REST resource (e.g., `invoices`):**
1. Schema: `packages/db/src/schema/invoices.ts` + add `export * from "./invoices"` to `packages/db/src/schema/index.ts`.
2. Router: `apps/api/src/routes/invoices.ts` — export `invoicesRouter`.
3. Mount: Add `app.route("/invoices", invoicesRouter)` in `apps/api/src/index.ts`; add `"/invoices"` to `protectedPrefixes` array.
4. Web page: `apps/web/app/(dashboard)/invoices/page.tsx`.

**New background job:**
1. Worker: `apps/api/src/jobs/{name}Worker.ts` — export `{name}Queue` and `worker`; export `setup{Name}Schedule()` if cron-driven.
2. Import and call `setup{Name}Schedule()` in `apps/api/src/index.ts` startup block.
3. If the worker needs business logic, put it in `apps/api/src/services/{name}.ts`.

**New service:**
- Implementation: `apps/api/src/services/{name}.ts` with named function exports.
- Tests: `apps/api/src/services/__tests__/{name}.test.ts`.

**New shared type or constant:**
- Types: `packages/shared/src/types/index.ts`.
- Domain constants: `packages/shared/src/constants/index.ts`.
- Zod schema shared between API and web: `packages/shared/src/validation/index.ts`.

**New utility (API-only):**
- Location: `apps/api/src/lib/{name}.ts`.
- Tests: `apps/api/src/lib/__tests__/{name}.test.ts`.

**New web component:**
- Generic UI primitive: `apps/web/components/ui/{ComponentName}.tsx`.
- Domain component: `apps/web/components/{ComponentName}.tsx`.

**New i18n string:**
- Add to all four files: `apps/web/messages/en/common.json`, `nl/common.json`, `fr/common.json`, `de/common.json`.
- The `i18n-completeness.test.ts` test will fail if keys are missing from any locale.

## Special Directories

**`.planning/`:**
- Purpose: GSD workflow artifacts (phases, codebase maps, debug logs, HANDOFF.json).
- Generated: Partially (by GSD commands). Committed: Yes.

**`.claude/worktrees/`:**
- Purpose: Isolated git worktrees for parallel agent execution.
- Generated: Yes. Committed: No (gitignored).

**`packages/db/drizzle/`:**
- Purpose: SQL migration files generated by `drizzle-kit`.
- Generated: Yes (by `pnpm db:generate`). Committed: Yes (versioned migrations).

**`apps/api/dist/`:**
- Purpose: tsup build output for production deployment.
- Generated: Yes. Committed: No.

**`apps/api/test/fixtures/`:**
- Purpose: Static JSON fixtures for unit tests (Ponto API mock responses).
- Generated: No (hand-authored). Committed: Yes.

---

*Structure analysis: 2026-06-28*
