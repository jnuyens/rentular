# Coding Conventions

**Analysis Date:** 2026-06-28

## Naming Patterns

**Files:**
- PascalCase for React component files: `IbanInput.tsx`, `MandateSetupModal.tsx`, `LanguageSwitcher.tsx`, `CancelMandateDialog.tsx`
- camelCase for API service, lib, and job files: `emailQueueWorker.ts`, `bankStatementImporter.ts`, `pontoConnect.ts`, `bankOAuthState.ts`
- camelCase for route files: `bankConnections.ts`, `payments.ts`, `rentAdjustments.ts`
- kebab-case for Next.js route directories: `bank-connections/`, `rent-adjustments/`, `property-managers/`
- Schema files named after their domain concept in camelCase: `bankConnections.ts`, `bankStatements.ts`, `smtpSettings.ts`

**Functions:**
- camelCase for all exported functions: `getRequiredUserId()`, `signOAuthState()`, `verifyOAuthState()`, `importBankStatements()`, `sanitizeConnection()`, `isPontoConfigured()`
- Async functions always explicitly `async`: no implicit promise wrappers
- Private/module-local helpers are camelCase and unexported: `notConfigured()`, `webUrl()`, `getEncryptionKey()`, `getDefaultSettings()`

**Variables:**
- camelCase for all local variables and parameters: `ownerId`, `consentLink`, `institutionId`, `insertCalls`
- Uppercase for module-level constants derived from env or business rules: `MAX_EMAILS_PER_MINUTE`, `DELAY_BETWEEN_MS`, `QUEUE_NAME`, `COOKIE_NAME`, `SYNC_RATE_LIMIT_MS`
- Prefix database result variables descriptively: `rows`, `result`, `row` (singular for indexed access)

**Types and Interfaces:**
- PascalCase for interfaces and type aliases: `OAuthStatePayload`, `CommunicationMeta`, `FollowUpSettings`, `OverduePayment`
- Literal union types instead of enums: `type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded"` (`packages/shared/src/types/index.ts`)
- `...Settings` suffix for configuration object types: `PaymentFollowUpSettings`, `FollowUpSettings`
- `...Options` suffix for function parameter bags: `EmailOptions`
- `...Payload` suffix for JWT/message payloads: `OAuthStatePayload`
- `...Meta` suffix for supplementary logging/audit objects: `CommunicationMeta`

**Constants (shared package):**
- SCREAMING_SNAKE_CASE for all exported constants: `REMINDER_DEFAULTS`, `DEFAULT_EMAIL_TEMPLATES`, `DEFAULT_SMS_TEMPLATES`, `DEFAULT_INTEREST_RATE`, `REGIONS`, `PROPERTY_TYPES`

**Exported module objects:**
- camelCase for named router exports: `bankConnectionsRouter`, `paymentsRouter`, `settingsRouter`
- camelCase for queue exports: `emailQueue`, `smsQueue`, `importDiscoveryQueue`

## Code Style

**Formatting:**
- Tool: Prettier 3.2.0, run via `pnpm format` at repo root
- Command: `prettier --write "**/*.{ts,tsx,md,json}"` (configured in root `package.json`)
- No dedicated `.prettierrc` file detected; Prettier runs with defaults (single quotes not enforced, trailing commas on by default in Prettier 3)
- No ESLint config detected in the repo; lint script runs `tsc --noEmit` only

**TypeScript:**
- `strict: true` in all `tsconfig.json` files; applies to root, `apps/web/`, and `apps/api/`
- Target: `ES2022` for both web and API
- `noEmit: true` for type-checking builds; tsup builds the API for production
- `isolatedModules: true` everywhere
- Implicit `any` forbidden; use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with explanation when casting is unavoidable (appears in `bankConnections.ts:125`, `bankAccountData.ts:67`)

## Import Organization

**Order (API):**
1. Node built-ins and third-party packages: `import { Hono } from "hono"`, `import { zValidator } from "@hono/zod-validator"`, `import { eq, and, desc } from "drizzle-orm"`
2. Internal workspace packages: `import { getDb, bankConnections } from "@rentular/db"`, `import { ... } from "@rentular/shared"`
3. Local relative imports: `import { getRequiredUserId } from "../lib/routeAuth"`, `import { encrypt } from "../lib/encryption"`

**Order (Web):**
1. React and third-party: `import { useState, useEffect } from "react"`, `import { useTranslations } from "next-intl"`
2. UI library components via `@/` alias: `import { Button } from "@/components/ui/button"`, `import { Badge } from "@/components/ui/badge"`
3. Domain-specific components via `@/`: `import { MandateStatusBadge } from "@/components/MandateStatusBadge"`

**Path Aliases:**
- `@/*` resolves to `apps/web/*` (configured in `apps/web/tsconfig.json`)
- No `@/` alias in `apps/api/`; API uses only relative imports and `@rentular/*` workspace packages
- Workspace packages: `@rentular/db`, `@rentular/shared`

## Error Handling

**Route handlers (Hono):**
- Wrap entire handler body in `try { ... } catch (err)` — extract `.message` with `err instanceof Error ? err.message : "Unknown error"` pattern
- Return typed HTTP status: `c.json({ error: message }, 500)` for server errors, `c.json({ error: "..." }, 404)` for not-found, `c.json({ error: "..." }, 503)` for unconfigured integrations
- Log before returning error: `console.error("[BankConnections] /institutions error:", err)`
- Throw from `getRequiredUserId()` to signal missing auth — outer try-catch converts to 500

**Services and lib:**
- Functions throw on failure; callers catch and decide HTTP response
- BullMQ workers re-throw after logging to trigger BullMQ retry: `throw err; // Re-throw for BullMQ retry` (`apps/api/src/jobs/emailQueueWorker.ts:75`)
- Database errors swallowed only when explicitly safe (e.g., `ER_DUP_ENTRY` in `bankStatementImporter.ts`)

**Auth middleware:**
- `requireAuth` middleware (`apps/api/src/lib/routeAuth.ts`) returns `c.json({ error: "Authentication required" }, 401)` and short-circuits
- Inside protected handlers, call `getRequiredUserId(c)` which throws `Error("Authenticated user is required")` if userId is absent

## Logging

**Format:** Context prefix in square brackets followed by description
- `[EmailQueue] Sending email to ${to}: "${subject}"`
- `[BankConnections] /institutions error:`
- `[Encryption] WARNING: AUTH_SECRET is empty, encryption key derived from empty string`
- `[BankOAuthState] WARNING: AUTH_SECRET is empty; OAuth state tokens are not secure`

**Levels:**
- `console.log(...)` for normal operational events (sending, starting, scheduled)
- `console.error(...)` for failures and exceptions

## Comments

**When to use:**
- File-level JSDoc blocks explain trust boundaries, endpoint inventory, and security rationale (e.g., `apps/api/src/routes/bankConnections.ts` header block)
- JSDoc on exported async functions that implement security-critical logic: `signOAuthState()`, `verifyOAuthState()` in `apps/api/src/lib/bankOAuthState.ts`
- Inline comments explain non-obvious decisions: `// Re-throw for BullMQ retry`, `// Static path MUST come before /:id so Hono matches it first`
- Schema files use inline comments for encrypted column groups and PII annotations
- `// eslint-disable-next-line @typescript-eslint/no-explicit-any` always includes explanation on the preceding line
- Phase/task references in comments link code to planning artifacts: `// Phase 9: AES-256-GCM encrypted OAuth tokens (Ponto)`, `// T-09-03-03`
- TODO comments are specific: `// TODO: Replace with proper PDF generation (pdfkit, puppeteer, etc.)` (`apps/api/src/services/paymentFollowUp.ts:307`)

## Validation

**API input validation:**
- All route handlers that accept query params or JSON body use `zValidator` from `@hono/zod-validator` as middleware before the handler function
- Pattern: `zValidator("json", z.object({ field: z.string().min(1) }))` for body; `zValidator("query", z.object({ country: z.string().length(2).default("BE") }))` for query
- Accessed via `c.req.valid("json")` or `c.req.valid("query")` inside the handler — never `c.req.json()` directly
- Zod returns 400 automatically on validation failure; no additional try-catch needed for validation errors

**Shared validation:**
- Zod schemas exported from `packages/shared/src/validation/index.ts` for cross-app use

## Function Design

**Route handlers:**
- Signature: `async (c) => { ... }` — context object is always named `c`
- Return: `c.json(data)`, `c.json(data, statusCode)`, or `c.redirect(url)`
- Destructure validated input at top of handler: `const { institutionId } = c.req.valid("json")`
- Call `getRequiredUserId(c)` at the top of protected handlers

**Service functions:**
- Named exports, explicit parameter types and return types
- Use object parameters for multiple related values: `importBankStatements("conn-1", [tx])`
- Return structured result objects for batch operations: `{ inserted, skippedDuplicates }`

**Queue functions:**
- `queueEmail(options, delay?, meta?)` — optional parameters for backward compatibility
- Return job ID string: `Promise<string>`

## Module Design

**API routes:**
- Named export of Hono router: `export const bankConnectionsRouter = new Hono()`
- One router per domain file; mounted in `apps/api/src/index.ts`

**Shared package:**
- Named exports only from `packages/shared/src/index.ts`; re-exports from `types/`, `constants/`, `validation/` subdirectories
- Allows `import { PaymentStatus, REMINDER_DEFAULTS } from "@rentular/shared"`

**DB package:**
- Named table exports from individual schema files: `export const bankConnections = mysqlTable(...)`
- All re-exported via `packages/db/src/schema/index.ts` then `packages/db/src/index.ts`
- `getDb()` is singleton lazy-initialized and exported from `packages/db/src/index.ts`

**Web components:**
- Default export for the primary component: `export default function IbanInput(...) {...}`
- Named exports for secondary components in same file: `export function BankNameSelect(...) {...}`, `export function BicSelect(...) {...}`
- `"use client"` directive required at top of all interactive components

## React / Next.js Patterns

**Server vs. client components:**
- 18 client components (marked `"use client"`) in `apps/web/app/`; only 1 server component in app routes
- Interactive pages are client components using `useState` + `useEffect` + `useCallback`

**i18n:**
- `const t = useTranslations("namespace")` at the top of every client component that renders text
- Namespace matches the message file key: `"auth"`, `"marketing"`, `"communications"`, `"managers"`
- Messages live in `apps/web/messages/{locale}/common.json` for all four locales (en, nl, fr, de)

**Data fetching (web):**
- Client-side via `fetch()` with `async/await` inside `useEffect` or event handlers
- No server actions or `getServerSideProps` pattern observed in dashboard pages

---

*Convention analysis: 2026-06-28*
