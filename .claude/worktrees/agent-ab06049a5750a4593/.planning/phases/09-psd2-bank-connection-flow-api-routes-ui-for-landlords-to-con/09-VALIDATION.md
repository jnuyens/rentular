---
phase: 09
slug: psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
status: planner-approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-12
updated: 2026-05-12
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (already configured at apps/api/vitest.config.ts; Phase 9 only adds MSW + fixtures) |
| **Config file** | apps/api/vitest.config.ts (no edits required) |
| **Quick run command** | `pnpm --filter @rentular/api test --run` |
| **Targeted run command** | `pnpm --filter @rentular/api test -- src/path/to/file.test.ts --run` |
| **Full suite command** | `pnpm lint && pnpm build && pnpm --filter @rentular/api test --run && pnpm --filter @rentular/db db:push` |
| **Estimated runtime** | ~30s for unit; ~3 min for full suite incl. typecheck + build |

**Update vs draft:** The draft VALIDATION.md (2026-05-12) assumed vitest needed to be installed in Wave 0. Inspection of the repo shows vitest is already configured (apps/api/vitest.config.ts with `include: ["src/**/__tests__/**/*.test.ts"]`) and the codebase has 6 existing test files. Phase 9 Wave 1 therefore only needs to add MSW + fixture JSON, not bootstrap the entire harness.

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command from `<verify>` (typically under 30s)
- **After every plan wave:** Run `pnpm --filter @rentular/api test --run`
- **Before final checkpoint:** Run the full suite via Plan 05 Task 4
- **Max feedback latency:** 30 seconds for unit; 180 seconds for full suite

---

## Per-Task Verification Map

> Each task in PLAN.md frontmatter must reference an entry here. Tasks marked W0 are Wave 0 (test infrastructure) and have install/scaffold commands rather than runnable tests.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | BANK-SCHEMA | T-09-01-01 | Encrypted-token columns added additively | grep + lint | `grep -c "encryptedAccessToken\|tokenIv\|tokenAuthTag\|encryptedRefreshToken\|refreshTokenIv\|refreshTokenAuthTag\|providerMetadata\|country: varchar" packages/db/src/schema/bankConnections.ts \| grep -qE "^[89]$"` | n/a | ⬜ pending |
| 09-01-02 | 01 | 1 | BANK-SCHEMA | T-09-01-02 | bank_statements columns enforce encryption-only PII storage | vitest | `pnpm --filter @rentular/api test -- src/__tests__/bankStatementsSchema.test.ts --run` | apps/api/src/__tests__/bankStatementsSchema.test.ts | ⬜ pending |
| 09-01-03 | 01 | 1 | BANK-INFRA | T-09-01-04, T-09-01-05 | MSW installed, fixtures valid JSON, db:push additive | install + parse + db:push | `test -f apps/api/test/fixtures/ponto/oauth-token-success.json && grep -c '"msw"' apps/api/package.json && pnpm --filter @rentular/db db:push` | apps/api/test/fixtures/ponto/*.json | ⬜ pending |
| 09-02-01 | 02 | 2 | BANK-OAUTH | T-09-02-01, T-09-02-06 | State JWT signs and verifies; rejects tampered + expired | vitest | `pnpm --filter @rentular/api test -- src/lib/__tests__/bankOAuthState.test.ts --run` | apps/api/src/lib/__tests__/bankOAuthState.test.ts | ⬜ pending |
| 09-02-02 | 02 | 2 | BANK-PROVIDER | T-09-02-03, T-09-02-07 | Ponto REST client never logs tokens; rejects misconfigured | vitest + MSW | `pnpm --filter @rentular/api test -- src/lib/__tests__/pontoConnect.test.ts --run` | apps/api/src/lib/__tests__/pontoConnect.test.ts | ⬜ pending |
| 09-02-03 | 02 | 2 | BANK-PROVIDER | T-09-02-07 | Factory dispatches via BANK_DATA_PROVIDER; consent expiry sourced from provider | grep + lint | `grep -q "class PontoConnectProvider" apps/api/src/lib/bankAccountData.ts && grep -q "BANK_DATA_PROVIDER" .env.example && pnpm --filter @rentular/api lint` | apps/api/src/lib/bankAccountData.ts | ⬜ pending |
| 09-03-01 | 03 | 3 | BANK-MATCHER | T-09-03-04 | Importer encrypts PII + dedups on UNIQUE constraint | vitest | `pnpm --filter @rentular/api test -- src/services/__tests__/bankStatementImporter.test.ts --run` | apps/api/src/services/__tests__/bankStatementImporter.test.ts | ⬜ pending |
| 09-03-02 | 03 | 3 | BANK-ROUTES | T-09-03-01, T-09-03-02, T-09-03-03, T-09-03-08 | 8 endpoints with auth + CSRF + ownership scoping + token sanitization | grep + lint | `grep -c 'bankConnectionsRouter\.(get\|post\|delete)' apps/api/src/routes/bankConnections.ts \| awk '{ exit ($1 >= 8 ? 0 : 1) }' && pnpm --filter @rentular/api lint` | apps/api/src/routes/bankConnections.ts | ⬜ pending |
| 09-03-03 | 03 | 3 | BANK-WORKER, BANK-ROUTES | T-09-03-09 | Worker delegates to syncBankConnection; route tests cover 503/insert/callback-tamper | vitest + build | `pnpm --filter @rentular/api test -- src/routes/__tests__/bankConnections.test.ts --run && pnpm --filter @rentular/api build` | apps/api/src/routes/__tests__/bankConnections.test.ts | ⬜ pending |
| 09-04-01 | 04 | 4 | BANK-UI-NAV | T-09-04-01 | Sidebar entry owner-only; Banknote icon mapped | grep + build | `grep -q '"bankConnections"' apps/web/app/\(dashboard\)/layout.tsx && grep -q "Banknote" apps/web/components/DashboardSidebar.tsx && pnpm --filter @rentular/web build` | apps/web/app/(dashboard)/layout.tsx | ⬜ pending |
| 09-04-02 | 04 | 4 | BANK-UI-LIST, BANK-UI-CALLBACK | T-09-04-03, T-09-04-04 | List + connect + callback pages render; pricing + ToS disclosed; no dangerouslySetInnerHTML | build + grep | `pnpm --filter @rentular/web build && grep -q "€4\|4 per account" apps/web/app/\(dashboard\)/bank-connections/page.tsx` | apps/web/app/(dashboard)/bank-connections/{page,connect/page,callback/page}.tsx | ⬜ pending |
| 09-04-03 | 04 | 4 | BANK-UI-DETAIL | T-09-04-05 | Detail page surfaces sync/renew/revoke; revoke confirmed via AlertDialog | build + grep | `grep -q "AlertDialog" apps/web/app/\(dashboard\)/bank-connections/\[id\]/page.tsx && pnpm --filter @rentular/web build` | apps/web/app/(dashboard)/bank-connections/[id]/page.tsx | ⬜ pending |
| 09-04-04 | 04 | 4 | BANK-UI-LIST, BANK-UI-DETAIL | T-09-04-02 | Manual visual checkpoint (sidebar, empty state, connect, callback, detail, sidebar role-gate, cross-link) | human-verify | (checkpoint) | n/a | ⬜ pending |
| 09-05-01 | 05 | 5 | BANK-I18N | T-09-05-03 | bankConnections.* parity across en/nl/fr/de | vitest | `pnpm --filter @rentular/api test -- src/__tests__/i18n-completeness.test.ts --run` | apps/web/messages/{en,nl,fr,de}/common.json | ⬜ pending |
| 09-05-02 | 05 | 5 | BANK-EMAIL, BANK-TOS | T-09-05-02, T-09-05-05 | Renewal email locale-aware; TOS Bank Connections clause; Privacy lists Ibanity | grep + build | `grep -q "bankConnections.email.renewalWarning\|loadEmailTemplate" apps/api/src/jobs/paymentCheckWorker.ts && pnpm --filter @rentular/web build` | apps/web/app/{terms,privacy}/page.tsx | ⬜ pending |
| 09-05-03 | 05 | 5 | BANK-RETENTION | T-09-05-01 | Retention service deletes by env-driven threshold; weekly Sunday 03:00 cron | vitest + build | `pnpm --filter @rentular/api test -- src/services/__tests__/bankStatementRetention.test.ts --run && pnpm --filter @rentular/api build` | apps/api/src/services/bankStatementRetention.ts | ⬜ pending |
| 09-05-04 | 05 | 5 | (final gates) | (all phase threats) | Full pipeline: lint + build + db:push idempotent + full vitest + i18n audit | composite | `pnpm lint && pnpm build && pnpm --filter @rentular/api test --run && pnpm --filter @rentular/db db:push` | n/a | ⬜ pending |
| 09-05-05 | 05 | 5 | (end-to-end) | (all phase threats) | Manual end-to-end against Ponto sandbox + Mailpit + locale switch + role gate | human-verify | (checkpoint) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**Status:** vitest harness already exists in repo (apps/api/vitest.config.ts present). Wave 0 work folded into Plan 01 Task 3 (install MSW + write Ponto fixtures + db:push).

- [x] vitest framework installed (already present from earlier work)
- [ ] MSW v2 installed in apps/api devDependencies (Plan 01 Task 3)
- [ ] apps/api/test/fixtures/ponto/{oauth-token-success,accounts-list,transactions-list,institutions-be}.json (Plan 01 Task 3)
- [ ] drizzle-kit push applies bank_connections additive columns + bank_statements table (Plan 01 Task 3 [BLOCKING])

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ponto sandbox OAuth flow end-to-end | BANK-OAUTH, BANK-ROUTES | Real browser redirect to authorization.myponto.com cannot be mocked at protocol fidelity | (1) Set PONTO_ENVIRONMENT=sandbox, PONTO_CLIENT_ID, PONTO_CLIENT_SECRET in .env.local from Ibanity developer portal. (2) pnpm dev. (3) Log in as test landlord. (4) Navigate /dashboard/bank-connections. (5) Click Connect bank account → confirm pricing disclosure + ToS. (6) Continue → select Belfius sandbox → Connect. (7) Complete Ponto sandbox authorization. (8) Confirm callback redirects to /dashboard/bank-connections/[id]?connected=1 with status=Active and consentExpiresAt populated from provider response. |
| Consent renewal email arrives at 7-day threshold | BANK-EMAIL | Email + cron timing; verifiable only with seeded DB row and BullMQ admin trigger | (1) INSERT a bank_connections row with consentExpiresAt = now() + 7 days, status='active'. (2) Manually trigger paymentCheckWorker Phase C (BullMQ admin or temporary test endpoint). (3) Inspect Mailpit for renewal warning email; verify subject + body match recipient locale (EN/NL/FR/DE). |
| Belgian bank coverage matches expectations | BANK-PROVIDER | Real institution coverage cannot be unit-tested; sandbox flow against each bank | Run sandbox connect flow against each of Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan in Ponto sandbox. Confirm each renders in the picker and successfully links a test account. |
| TOS + pricing disclosure visible before connect | BANK-TOS, BANK-UI-LIST | Visual acceptance criterion | Navigate to /dashboard/bank-connections empty state and to /dashboard/bank-connections/connect info step; confirm €4/account/month copy and ToS link visible above any Connect CTA; visit /terms and /privacy to verify clauses + Ibanity processor row. |
| i18n coverage 4 locales | BANK-I18N | Per-locale visual check (test enforces key parity but not localization quality) | For each of EN/NL/FR/DE, set locale and navigate to all 4 bank-connections pages plus trigger renewal email — confirm zero raw keys (e.g., literal "bankConnections.title") visible. |
| Role gate (non-owner cannot see sidebar entry) | BANK-UI-NAV | Visual + role-switching check | Log in as a non-owner user (manager role on at least one property). Confirm Bank Connections entry is absent from sidebar. Switch to owner — entry appears. |
| Soft-delete preserves bank_statements on revoke | BANK-RETENTION, BANK-ROUTES | DB-level verification | After successful sandbox connect + at least one sync, click Revoke. Query MySQL: SELECT status FROM bank_connections WHERE id=...; → "revoked". SELECT count(*) FROM bank_statements WHERE connectionId=...; → unchanged (rows retained for 7-year tax retention). |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (vitest already exists; MSW + fixtures + db:push in Plan 01 Task 3)
- [x] No watch-mode flags
- [x] Feedback latency &lt; 180s for full suite (Plan 05 Task 4 gate)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-05-12
