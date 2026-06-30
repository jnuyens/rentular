---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
verified: 2026-06-30T12:08:00Z
status: human_needed
score: 15/15 must-haves verified
has_blocking_gaps: false
human_verification:
  - test: "Empty state + disclosures (live)"
    expected: "/dashboard/bank-connections empty state shows the €4/account/month Ibanity disclosure, ToS link, and Connect bank account CTA in the deployed app."
    why_human: "Requires browser + deployed app; Next.js server-side rendering, auth session, and locale resolution cannot be verified by grep."
  - test: "Connect wizard end-to-end (Ponto sandbox)"
    expected: "Connect flow shows pricing + ToS notice; institution picker lists all 6 BE banks (Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan); selecting one redirects to authorization.myponto.com."
    why_human: "Requires live Ponto sandbox credentials and browser. API route calls Ponto's public institutions endpoint at runtime."
  - test: "Authorization redirect + callback (Ponto sandbox)"
    expected: "Completing sandbox auth at authorization.myponto.com redirects back to /dashboard/bank-connections/[id]?connected=1 with success message; connection is stored as active."
    why_human: "Requires live OAuth round-trip with Ponto credentials. Cannot be verified without a running production/sandbox instance."
  - test: "Detail page accuracy — provider-sourced consentExpiresAt"
    expected: "Detail page shows institutionName, status='Active', and consentExpiresAt value that came from the Ponto provider (NOT a hardcoded +90 days)."
    why_human: "Requires a real connected account row in the DB with actual Ponto token data."
  - test: "Sync + rate-limit behavior"
    expected: "'Sync now' triggers sync and shows success toast; repeating within 60 s returns 429 with 'Sync rate-limited' toast."
    why_human: "Rate limiter is in-process Map; behavior only observable in a running API instance."
  - test: "Encrypted statements in DB"
    expected: "bank_statements rows exist for the connection; counterparty_name_encrypted column contains ciphertext (not plaintext name)."
    why_human: "Requires DB access after a real sync has run."
  - test: "Renew consent"
    expected: "'Renew consent' button redirects to a Ponto authorization URL with a fresh signed state JWT in the state param."
    why_human: "Requires browser + running API; state JWT is generated server-side at request time."
  - test: "Revoke — bank_statements retained"
    expected: "Revoke AlertDialog → confirm → status becomes 'Revoked'; connection hidden from active list; bank_statements rows for the connection still exist in DB."
    why_human: "Requires live API + DB; tests retention behavior after soft-delete."
  - test: "Locale parity at runtime (NL/FR/DE)"
    expected: "Every /dashboard/bank-connections/* page renders translated strings in NL, FR, DE — no raw translation keys visible in the browser."
    why_human: "next-intl locale resolution at runtime depends on browser locale headers or locale cookie; cannot be confirmed by static file inspection alone."
  - test: "Role gating — manager cannot see Bank Connections nav entry"
    expected: "A user with role 'manager' (non-owner) does NOT see the Bank Connections sidebar entry."
    why_human: "NAV_VISIBILITY is applied at render time in DashboardSidebar based on the session role; requires a logged-in non-owner session."
  - test: "Localized renewal email delivery"
    expected: "A bank_connection row with consentExpiresAt = now()+7d triggers Phase C in the worker → renewal-warning email delivered in the landlord's locale with the correct localized subject."
    why_human: "Requires a running worker, Redis, SMTP, and a DB row with a near-expiry consent — integration only verifiable end-to-end."
  - test: "Legal copy — /terms and /privacy"
    expected: "/terms shows the 'Bank Account Connections (PSD2)' clause; /privacy lists the Ibanity SA/NV processor row with purpose, lawful basis, data categories, retention, and location."
    why_human: "Page rendering requires a running Next.js app with locale; static file evidence (verified below) is sufficient for code-level check, but human should confirm the rendered output."
  - test: "Schema idempotency on production DB"
    expected: "'pnpm --filter @rentular/db db:push' against the real DB reports 'no changes to apply' (Plan 05 changed zero schema files)."
    why_human: "No MySQL reachable in the execution sandbox; idempotency holds by construction (Plan 05 touched zero schema files) but must be confirmed against the real DB during Phase 10 deploy."
deferred:
  - truth: "pnpm lint (api tsc --noEmit) exits 0"
    addressed_in: "Phase 10 (pre-deploy typecheck-cleanup task)"
    evidence: "~57 pre-existing Drizzle Date/string mismatches + untyped getDb().query + missing nordigen-node/playwright-core type decls, present since Phase 2/6. One Phase 9 in-scope error (transactionMatcher.ts paidDate string→Date) was fixed in Plan 05. Remaining errors are unrelated payment/cost/maintenance/indexation routes. Build (tsup + next build) and all 67 api vitest tests pass — type-hygiene debt only."
  - truth: "drizzle-kit push completes without error against running MySQL (Plan 01 gate)"
    addressed_in: "Phase 10 (deploy step)"
    evidence: "Plan 01 ran db:push and got ECONNREFUSED (no MySQL in sandbox). Plan 05 changed zero schema files, so idempotency holds by construction. Human must confirm 'no changes to apply' against the real DB."
---

# Phase 09: PSD2 Bank Connection Flow Verification Report

**Phase Goal:** Landlords can link their Belgian bank account via Ponto Connect (Ibanity) under the Customer-Paying model so the existing polling worker auto-imports statements and matches incoming rent transfers, with PSD2-compliant 180-day consent renewal, encrypted token storage, locale-aware renewal emails, GDPR disclosures, and a 7-year retention policy aligned to Belgian tax law.

**Verified:** 2026-06-30T12:08:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | bank_connections has 8 additive encrypted-token + metadata + country columns | VERIFIED | `packages/db/src/schema/bankConnections.ts` lines 32–41: encryptedAccessToken, tokenIv, tokenAuthTag, encryptedRefreshToken, refreshTokenIv, refreshTokenAuthTag, providerMetadata, country — all present, existing columns and index block unchanged |
| 2 | bank_statements audit table exists with UNIQUE(connectionId, externalTransactionId), match_status enum, and PII-encryption triplets | VERIFIED | `packages/db/src/schema/bankStatements.ts` — 22 columns, uniqueIndex bank_statements_conn_tx_uniq, mysqlEnum match_status ["unmatched","matched","mismatched_amount","ignored"], counterpartyName/IBAN/rawPayload each stored as encrypted+iv+authTag triplet |
| 3 | Drizzle schema barrel re-exports bankStatements | VERIFIED | `packages/db/src/schema/index.ts` line 15: `export * from "./bankStatements"` |
| 4 | MSW dev-dependency installed and importable from api tests | VERIFIED | `apps/api/package.json` devDependencies line 38: `"msw": "^2.6.0"` |
| 5 | Ponto sandbox fixture JSON files exist and are valid JSON | VERIFIED | 4 files in `apps/api/test/fixtures/ponto/` (oauth-token-success, accounts-list, transactions-list, institutions-be) — all parse valid (node verified) |
| 6 | PontoConnectProvider class implements BankAccountDataProvider; factory dispatches on BANK_DATA_PROVIDER; GoCardlessBadProvider dormant | VERIFIED | `apps/api/src/lib/bankAccountData.ts` — class PontoConnectProvider (line 210) implements all 5 interface methods; getBankAccountDataProvider factory (line 335) dispatches to ponto (default) or gocardless_bad; GoCardlessBadProvider unchanged |
| 7 | pontoConnect.ts exposes 9 named exports including isPontoConfigured, createPontoAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken, revokeAccess, listAccounts, listTransactions, listFinancialInstitutions | VERIFIED | `apps/api/src/lib/pontoConnect.ts` — all 9 exports present; base URLs hardcoded (T-09-02-07); no token interpolation in logs (T-09-02-03) |
| 8 | bankOAuthState.ts exposes signOAuthState and verifyOAuthState using jose HS256 + AUTH_SECRET + 10-minute TTL | VERIFIED | `apps/api/src/lib/bankOAuthState.ts` — ALG="HS256", TTL="10m", getSecret() reads AUTH_SECRET; both exports present |
| 9 | bankConnections Hono router has 8 endpoints with auth + CSRF + ownership scoping + token-column sanitization | VERIFIED | `apps/api/src/routes/bankConnections.ts` — 8 route registrations (GET /institutions, POST /, GET /callback, GET /, GET /:id, POST /:id/renew, DELETE /:id, POST /:id/sync); sanitizeConnection() strips 7 token columns; mounted in index.ts protectedPrefixes; /callback exempted |
| 10 | bankStatementImporter encrypts counterpartyName/IBAN/rawPayload and deduplicates via UNIQUE constraint | VERIFIED | `apps/api/src/services/bankStatementImporter.ts` lines 80–103: encrypt() called for debtorName, debtorIban, rawPayload; ER_DUP_ENTRY caught per-row; test passes (3 tests: encrypt, dedup, normalize) |
| 11 | syncBankConnection is shared by route and worker; first-sync 90-day backfill | VERIFIED | `apps/api/src/services/bankConnectionSync.ts` line 48: FIRST_SYNC_BACKFILL_MS = 90*24*60*60*1000; importBankStatements called (line 155) before processIncomingTransactions (line 168); paymentCheckWorker line 339 calls syncBankConnection |
| 12 | Bank Connections sidebar entry between Payments and Mandates with Banknote icon, owner-only | VERIFIED | `apps/web/app/(dashboard)/layout.tsx` line 15: bankConnections with iconName="Banknote"; NAV_VISIBILITY line 29 hides from co_owner/manager/accountant/viewer (owner-only visible); Banknote icon in DashboardSidebar.tsx and MobileNav.tsx |
| 13 | /dashboard/bank-connections list page: €4/month disclosure, ToS link, Connect CTA, status badges | VERIFIED | `apps/web/app/(dashboard)/bank-connections/page.tsx`: fetches /api/v1/bank-connections (line 68); renders t("pricingDisclosure") (EN: "up to €4 per account per month, billed directly to you by Ibanity") and t("tosNotice") with href="/terms" (lines 144–150); BankConnectionStatusBadge used |
| 14 | /dashboard/bank-connections/connect: institution picker, pricing + ToS notice, POST then redirect to consentLink | VERIFIED | `apps/web/app/(dashboard)/bank-connections/connect/page.tsx`: 4-step state machine (info→select→redirecting→error); InstitutionPicker fed by /api/v1/bank-connections/institutions (InstitutionPicker.tsx line 50); POST to /api/v1/bank-connections with institutionId (lines 34–38); window.location.href = consentLink (line 45) |
| 15 | /dashboard/bank-connections/[id] detail: status badge, lastSyncAt, consentExpiresAt countdown, Sync/Renew/Revoke with AlertDialog | VERIFIED | `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx`: fetches /:id (line 78); handleSync→POST /:id/sync (line 105); handleRenew→POST /:id/renew (line 128); handleRevoke→DELETE /:id (line 151–152); AlertDialogTrigger wraps revoke; BankConnectionStatusBadge rendered |
| 16 | /dashboard/bank-connections/callback handles access_denied, expired_state, missing_params, no_accounts, unknown, and ?connected=1 | VERIFIED | `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` lines 11–15: ERROR_KEYS map for all 4 named codes; line 59: fallback "errorUnknown" for other codes; line 33: connected=1 success path |
| 17 | Phase C renewal warning emails use locale-aware templates from bankConnections.email.renewalWarning namespace | VERIFIED | `apps/api/src/jobs/paymentCheckWorker.ts`: loadRenewalEmailTemplate() reads web/messages/{locale}/common.json at runtime (lines 55–76); buildRenewalEmail() composes locale subject+body (line 87); 7-day and 1-day thresholds enforced (line 395); called at line 430 |
| 18 | bankConnections.* namespace has 76 keys per locale, zero missing keys across EN/NL/FR/DE | VERIFIED | Python count: EN=76, NL=76, FR=76, DE=76; i18n-completeness.test.ts bankConnections describe block passes (7 tests total file); email.renewalWarning keys present in all 4 locales |
| 19 | Terms of Service has Bank Account Connections clause; Privacy Policy lists Ibanity SA/NV as third-party processor | VERIFIED | `apps/web/app/terms/page.tsx` line 94–95: renders bankConnectionsTitle + bankConnectionsClause; `apps/web/app/privacy/page.tsx` lines 128–166: Ibanity bullet in processors list + dedicated structured disclosure section (purpose, lawful basis, data categories, retention, location, external link) |
| 20 | BullMQ weekly cron (Sunday 03:00) hard-deletes bank_statements older than BANK_STATEMENTS_RETENTION_DAYS; wired at startup | VERIFIED | `apps/api/src/services/bankStatementRetention.ts`: deleteExpiredBankStatements() deletes rows WHERE importedAt < cutoff; default 2555 days; `apps/api/src/jobs/bankStatementRetentionWorker.ts`: CRON_PATTERN="0 3 * * 0"; `apps/api/src/index.ts` line 168: setupBankStatementRetentionSchedule() called at startup; 4 retention unit tests pass |

**Score:** 15/15 BANK-* requirements verified (20 observable truths checked — some requirements map to multiple truths)

---

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | pnpm lint (api tsc --noEmit) exits 0 | Phase 10 (pre-deploy typecheck-cleanup task) | ~57 pre-existing errors from Phase 2/6 era (Drizzle Date/string mismatches, untyped db.query, missing nordigen-node/playwright-core decls, BullMQ timeout type). One Phase 9 in-scope error fixed (transactionMatcher.ts paidDate string→Date). Build and all 67 vitest tests pass. Documented in deferred-items.md. |
| 2 | drizzle-kit push confirms additive-only migration on real MySQL | Phase 10 (deploy step) | No MySQL in sandbox (ECONNREFUSED). Plan 05 touched zero schema files; idempotency holds by construction. Human confirms in Phase 10. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `packages/db/src/schema/bankConnections.ts` | 8 additive token + metadata + country columns | VERIFIED | All 8 columns present; existing index block (ownerIdx, statusIdx) unchanged |
| `packages/db/src/schema/bankStatements.ts` | 22-column audit table, 3 indexes | VERIFIED | uniqueIndex conn_tx_uniq + conn_date_idx + match_status_idx; match_status enum; PII triplets |
| `packages/db/src/schema/index.ts` | barrel re-exports bankStatements | VERIFIED | Line 15: `export * from "./bankStatements"` |
| `apps/api/test/fixtures/ponto/oauth-token-success.json` | Valid JSON with access_token, refresh_token | VERIFIED | All 4 fixture files valid JSON |
| `apps/api/test/fixtures/ponto/accounts-list.json` | Single fixture account BE71… IBAN | VERIFIED | |
| `apps/api/test/fixtures/ponto/transactions-list.json` | 2 transactions (structured + unstructured) | VERIFIED | |
| `apps/api/test/fixtures/ponto/institutions-be.json` | 6 BE banks | VERIFIED | |
| `apps/api/src/__tests__/bankStatementsSchema.test.ts` | Vitest schema-shape sanity test | VERIFIED | 2 tests pass (bank_statements columns, bank_connections additive columns) |
| `apps/api/src/lib/bankOAuthState.ts` | signOAuthState / verifyOAuthState HS256 JWT | VERIFIED | HS256, 10m TTL, AUTH_SECRET; 4 tests pass |
| `apps/api/src/lib/pontoConnect.ts` | 9 named exports, no token logging | VERIFIED | isPontoConfigured, createPontoAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken, revokeAccess, listAccounts, listTransactions, listFinancialInstitutions, getPontoBaseUrls; 6 MSW-mocked tests pass |
| `apps/api/src/lib/bankAccountData.ts` | PontoConnectProvider + factory dispatch | VERIFIED | class PontoConnectProvider (line 210), getBankAccountDataProvider dispatches on BANK_DATA_PROVIDER |
| `apps/api/src/routes/bankConnections.ts` | 8-endpoint Hono router | VERIFIED | 8 route registrations, sanitizeConnection, signOAuthState/verifyOAuthState imported |
| `apps/api/src/index.ts` | bankConnectionsRouter mounted; in protectedPrefixes; /callback exempted | VERIFIED | Line 149: app.route; line 59: in protectedPrefixes; line 94: callback exemption |
| `apps/api/src/services/bankStatementImporter.ts` | Encrypts PII, deduplicates via UNIQUE | VERIFIED | encrypt() called for 3 PII fields; ER_DUP_ENTRY handled; 3 tests pass |
| `apps/api/src/services/bankConnectionSync.ts` | Shared sync service, 90-day backfill | VERIFIED | FIRST_SYNC_BACKFILL_MS=90*24*60*60*1000; importBankStatements called before processIncomingTransactions |
| `apps/api/src/jobs/paymentCheckWorker.ts` | Phase B delegates to syncBankConnection | VERIFIED | Line 339: syncBankConnection(conn.id); loadRenewalEmailTemplate() reads locale JSON |
| `apps/api/src/services/bankStatementRetention.ts` | deleteExpiredBankStatements, BANK_STATEMENTS_RETENTION_DAYS=2555 | VERIFIED | Hard-delete via Drizzle; 4 tests pass |
| `apps/api/src/jobs/bankStatementRetentionWorker.ts` | Weekly cron "0 3 * * 0", setupBankStatementRetentionSchedule | VERIFIED | CRON_PATTERN="0 3 * * 0"; exported setupBankStatementRetentionSchedule |
| `apps/web/app/(dashboard)/bank-connections/page.tsx` | List page with €4 disclosure, ToS link | VERIFIED | fetches /api/v1/bank-connections; pricingDisclosure + tosNotice rendered; BankConnectionStatusBadge used |
| `apps/web/app/(dashboard)/bank-connections/connect/page.tsx` | 4-step wizard, InstitutionPicker, POST + redirect | VERIFIED | Step state machine info→select→redirecting→error; InstitutionPicker; POST + window.location.href consentLink |
| `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` | Error code mapping + connected=1 | VERIFIED | ERROR_KEYS for 4 codes + fallback errorUnknown; connected=1 success |
| `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` | Detail page with actions | VERIFIED | Sync/Renew/Revoke wired to API; AlertDialog for revoke; status badge + countdown |
| `apps/web/components/BankConnectionStatusBadge.tsx` | Status badge for 5 status values | VERIFIED | pending/active/expired/revoked/error with color tokens; uses t("status.*") i18n |
| `apps/web/components/InstitutionPicker.tsx` | Institution picker fed by GET /institutions | VERIFIED | Fetches /api/v1/bank-connections/institutions; searchable |
| `apps/web/app/(dashboard)/layout.tsx` | Sidebar Bank Connections entry, Banknote icon, owner-only | VERIFIED | Line 15: bankConnections entry with Banknote; NAV_VISIBILITY excludes non-owners |
| `apps/web/app/(dashboard)/settings/page.tsx` | GoCardless tab cross-link to /dashboard/bank-connections | VERIFIED | Lines 338–346: bankConnectionsCrossLink card + Link to /dashboard/bank-connections |
| `apps/web/messages/en/common.json` | bankConnections namespace 76 keys | VERIFIED | 76 keys confirmed via Python count |
| `apps/web/messages/nl/common.json` | 76 bankConnections keys (NL) | VERIFIED | |
| `apps/web/messages/fr/common.json` | 76 bankConnections keys (FR) | VERIFIED | |
| `apps/web/messages/de/common.json` | 76 bankConnections keys (DE) | VERIFIED | |
| `apps/api/src/__tests__/i18n-completeness.test.ts` | bankConnections describe block, parity assertions | VERIFIED | 7 tests pass including parity, nav, email-template key assertions |
| `apps/web/app/terms/page.tsx` | Bank Account Connections (PSD2) clause | VERIFIED | bankConnectionsTitle + bankConnectionsClause rendered |
| `apps/web/app/privacy/page.tsx` | Ibanity SA/NV processor disclosure | VERIFIED | thirdPartyIbanity + full structured disclosure section |
| `.env.example` | PONTO_CLIENT_ID, BANK_DATA_PROVIDER, BANK_STATEMENTS_RETENTION_DAYS | VERIFIED | All 6 new env vars present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/db/src/schema/index.ts` | `bankStatements.ts` | barrel re-export | WIRED | `export * from "./bankStatements"` at line 15 |
| `bankStatements.ts` | `bankConnections.id` | FK reference | WIRED | `.references(() => bankConnections.id)` at line 25 |
| `apps/api/src/index.ts` | `bankConnectionsRouter` | app.route mount | WIRED | Line 149: `app.route("/bank-connections", bankConnectionsRouter)` |
| `apps/api/src/index.ts` | `bankStatementRetentionWorker` | startup call | WIRED | Line 168: `setupBankStatementRetentionSchedule().catch(...)` |
| `bankConnections.ts route` | `bankOAuthState.ts` | signOAuthState/verifyOAuthState | WIRED | Lines 33–34: imported and called in POST / and GET /callback handlers |
| `bankConnections.ts route` | `bankConnectionSync.ts` | syncBankConnection | WIRED | `syncBankConnection` imported and called in POST /:id/sync handler |
| `bankConnectionSync.ts` | `bankStatementImporter.ts` | importBankStatements before matcher | WIRED | Line 155: `importBankStatements(connectionId, transactions)` called before processIncomingTransactions (line 168) |
| `bankStatementImporter.ts` | `encryption.ts` | encrypt PII triplets | WIRED | Lines 80–82: `encrypt(tx.debtorName)`, `encrypt(tx.debtorIban)`, `encrypt(JSON.stringify(tx))` |
| `paymentCheckWorker.ts` | `bankConnectionSync.ts` | Phase B delegation | WIRED | Line 24: import; line 339: `syncBankConnection(conn.id)` |
| `paymentCheckWorker.ts` | `apps/web/messages/{locale}/common.json` | locale-aware email template | WIRED | Lines 55–68: `loadRenewalEmailTemplate` reads web/messages/{locale}/common.json at runtime |
| `bank-connections/page.tsx` | `/api/v1/bank-connections` | fetch with credentials | WIRED | Line 68: fetch `/api/v1/bank-connections` with credentials include |
| `bank-connections/connect/page.tsx` | `/api/v1/bank-connections` (POST) | POST + consentLink redirect | WIRED | Lines 34–45: POST with institutionId body; window.location.href = consentLink |
| `bank-connections/[id]/page.tsx` | `/api/v1/bank-connections/:id/sync`, `:id/renew`, DELETE `:id` | fetch action handlers | WIRED | Lines 105, 128, 151–152 |
| `apps/web/app/(dashboard)/layout.tsx` | DashboardSidebar | bankConnections nav entry | WIRED | Line 15: bankConnections entry; DashboardSidebar + MobileNav both register Banknote icon |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|---------------|--------|-------------------|--------|
| `bank-connections/page.tsx` | connections state | GET /api/v1/bank-connections | Yes — Drizzle SELECT from bank_connections WHERE ownerId; sanitizeConnection strips token columns | FLOWING |
| `bank-connections/[id]/page.tsx` | connection state | GET /api/v1/bank-connections/:id | Yes — Drizzle SELECT by id+ownerId; 404 on ownership mismatch | FLOWING |
| `InstitutionPicker.tsx` | institutions state | GET /api/v1/bank-connections/institutions | Yes — listFinancialInstitutions() → Ponto public catalogue endpoint | FLOWING |
| `bankStatementImporter.ts` | insert into bank_statements | IncomingTransaction[] from provider | Yes — encrypted PII columns written via Drizzle insert | FLOWING |
| `bankStatementRetention.ts` | deleted count | Drizzle DELETE WHERE importedAt < cutoff | Yes — returns affectedRows from mysql2 ResultSetHeader | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| bankStatementsSchema test — schema column assertions | `pnpm --filter @rentular/api test -- src/__tests__/bankStatementsSchema.test.ts --run` | 2 passed | PASS |
| i18n completeness — bankConnections parity across 4 locales | `pnpm --filter @rentular/api test -- src/__tests__/i18n-completeness.test.ts --run` | 7 passed | PASS |
| bankOAuthState — round-trip + wrong-secret + expiry rejection | `pnpm --filter @rentular/api test -- src/lib/__tests__/bankOAuthState.test.ts src/lib/__tests__/pontoConnect.test.ts --run` | 10 passed (4+6) | PASS |
| bankStatementImporter — encrypt + dedup + normalize | `pnpm --filter @rentular/api test -- src/services/__tests__/bankStatementImporter.test.ts --run` | 3 passed | PASS |
| bankStatementRetention — cutoff calculation + delete | `pnpm --filter @rentular/api test -- src/services/__tests__/bankStatementRetention.test.ts --run` | 4 passed | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for Phase 09. The Plan 05 Task 4 integration gate ran the full vitest suite (67 tests / 13 files — all green) and `pnpm build` (api ESM + DTS success; web 21/21 static pages). Those gates were run by the executor; individual named tests above confirm the Phase 9 additions specifically.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|------------|-------------|--------|---------|
| BANK-INFRA | 09-01 | Vitest fixtures + MSW dev-dep | SATISFIED | MSW ^2.6.0 in package.json; 4 fixture files valid JSON; bankStatementsSchema test passes |
| BANK-SCHEMA | 09-01 | Encrypted-token columns + bank_statements + barrel | SATISFIED | bankConnections.ts 8 additive columns; bankStatements.ts 22 cols + 3 indexes; index.ts re-export |
| BANK-PROVIDER | 09-02 | PontoConnectProvider + factory + GoCardlessBadProvider dormant | SATISFIED | class PontoConnectProvider in bankAccountData.ts; factory dispatches on BANK_DATA_PROVIDER |
| BANK-OAUTH | 09-02 | signOAuthState/verifyOAuthState HS256 AUTH_SECRET 10-min | SATISFIED | bankOAuthState.ts; 4 vitest cases pass |
| BANK-ROUTES | 09-03 | 8 Hono endpoints, CSRF, ownership scoping, token sanitization | SATISFIED | bankConnections.ts router 8 endpoints; protectedPrefixes + /callback exemption in index.ts |
| BANK-UI-LIST | 09-04 | List page with €4 disclosure, ToS link, Connect CTA | SATISFIED | page.tsx fetches API, renders pricingDisclosure + tosNotice + BankConnectionStatusBadge |
| BANK-UI-DETAIL | 09-04 | Detail page: status, lastSyncAt, consentExpiresAt countdown, actions | SATISFIED | [id]/page.tsx wires Sync/Renew/Revoke to API; AlertDialog for revoke |
| BANK-UI-CALLBACK | 09-04 | Callback maps error codes + connected=1 | SATISFIED | callback/page.tsx maps 4 named codes + fallback errorUnknown; connected=1 success |
| BANK-UI-NAV | 09-04 | Sidebar entry Banknote icon between Payments/Mandates, owner-only | SATISFIED | layout.tsx line 15; NAV_VISIBILITY excludes non-owners; Banknote in DashboardSidebar + MobileNav |
| BANK-WORKER | 09-03 | paymentCheckWorker Phase B → syncBankConnection; 90-day backfill | SATISFIED | paymentCheckWorker line 339; bankConnectionSync FIRST_SYNC_BACKFILL_MS=90*24*60*60*1000 |
| BANK-MATCHER | 09-03 | bankStatementImporter encrypts PII BEFORE matcher; dedup via UNIQUE | SATISFIED | bankStatementImporter.ts encrypt calls; ER_DUP_ENTRY handling; importBankStatements before processIncomingTransactions in sync pipeline |
| BANK-EMAIL | 09-05 | Renewal warning emails locale-aware from bankConnections.email.renewalWarning | SATISFIED | paymentCheckWorker loadRenewalEmailTemplate reads locale JSON at runtime; 7-day + 1-day thresholds |
| BANK-I18N | 09-05 | bankConnections.* 76 keys × 4 locales, zero missing, i18n test | SATISFIED | 76 keys per locale confirmed; i18n-completeness.test.ts bankConnections block passes |
| BANK-TOS | 09-05 | TOS Bank Account Connections clause; Privacy Ibanity SA/NV processor | SATISFIED | terms/page.tsx renders PSD2 clause; privacy/page.tsx renders structured Ibanity disclosure |
| BANK-RETENTION | 09-05 | BullMQ weekly cron Sunday 03:00, BANK_STATEMENTS_RETENTION_DAYS=2555, startup wire | SATISFIED | bankStatementRetentionWorker.ts "0 3 * * 0"; index.ts setupBankStatementRetentionSchedule; 4 unit tests pass |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api/src/services/bankStatementImporter.ts` | 59 | `return null` (normalizeStructuredCommunication) | INFO | Not a stub — intentional: function returns null when remittance has no digits. Correct behavior for unstructured transactions. |
| `apps/api/src/lib/bankAccountData.ts` | 272 | `institutionId: ""` in PontoConnectProvider.listAccounts | INFO | Intentional documented stub — plan design decision. Route layer resolves institutionId from providerMetadata. Inline comment references Plan 03 consumer. |
| Pre-existing `tsc --noEmit` failures (~57 errors across ~13 files) | Various | Type-hygiene debt in unrelated routes/workers | INFO (carried debt, pre-existing) | Does not block runtime; build and all 67 tests pass. Dates to Phase 2/6. Documented in deferred-items.md. Recommended for dedicated cleanup before Phase 10 deploy. |

No TBD, FIXME, or XXX markers found in any Phase 9 files.

---

### Human Verification Required

See frontmatter `human_verification` for the full list. All 13 items require a deployed production instance (Phase 10 / m1 Hetzner). They are documented in `09-HUMAN-UAT.md` with status: partial, environment: production.

The key items requiring live Ponto credentials are:
1. **Authorization redirect + callback** — complete Ponto sandbox/prod OAuth round-trip
2. **Detail page consentExpiresAt** — verify provider-sourced value (not hardcoded +90d)
3. **Encrypted statements in DB** — confirm counterparty_name_encrypted is ciphertext
4. **Localized renewal email delivery** — integration test of Phase C worker

The items requiring only a running app (no Ponto credentials) are:
- Role gating (non-owner session), locale switching, revoke retention check, schema idempotency confirm.

---

### Gaps Summary

No gaps found. All 15 BANK-* requirement implementations are code-verified. The only outstanding items are:

1. **Intentionally deferred prod UAT** (13 items in 09-HUMAN-UAT.md) — require Phase 10 deployment to m1.linuxbe.com. This is the documented plan: Phase 9 produces a working production-ready codebase; Phase 10 deploys it; the human Ponto-sandbox checkpoint runs post-deploy.

2. **Carried pre-existing typecheck debt** (~57 api tsc errors, Phase 2/6 era) — zero Phase 9 errors except the one transactionMatcher.ts string→Date fix that was corrected in scope.

3. **db:push deferred** — Plan 05 changed zero schema files; idempotency holds by construction; human confirms against real DB in Phase 10.

---

_Verified: 2026-06-30T12:08:00Z_
_Verifier: Claude (gsd-verifier)_
