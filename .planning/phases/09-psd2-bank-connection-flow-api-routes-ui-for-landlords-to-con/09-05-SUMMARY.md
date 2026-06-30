---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
plan: 05
subsystem: i18n-legal-retention
tags: [i18n, email, tos, gdpr, bullmq, cron, psd2]

# Dependency graph
requires:
  - phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con (Plan 04)
    provides: "bankConnections.* UI key tree (65 keys) across EN/NL/FR/DE + nav.bankConnections"
  - phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con (Plan 03)
    provides: "bank_statements table + paymentCheckWorker Phase C renewal-warning path"
provides:
  - "Locale-aware bank-connection renewal-warning email (bankConnections.email.renewalWarning.*) for Phase C"
  - "Terms of Service Bank Account Connections (PSD2) clause in all 4 locales"
  - "Privacy Policy Ibanity SA/NV third-party-processor disclosure in all 4 locales"
  - "bank_statements GDPR retention service + weekly BullMQ cron (Sunday 03:00) driven by BANK_STATEMENTS_RETENTION_DAYS"
  - "i18n-completeness test now enforces bankConnections parity + nav + email-template keys"
affects: [phase-10-deployment, launch-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Renewal email loads locale JSON from apps/web/messages at runtime (no tokens interpolated — T-09-05-02)"
    - "Retention cron mirrors webhookCleanup BullMQ convention (idempotent repeatable-job setup, Sunday 03:00)"

key-files:
  created:
    - apps/api/src/services/bankStatementRetention.ts
    - apps/api/src/services/__tests__/bankStatementRetention.test.ts
    - apps/api/src/jobs/bankStatementRetentionWorker.ts
    - .planning/phases/09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con/deferred-items.md
  modified:
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
    - apps/api/src/__tests__/i18n-completeness.test.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/web/app/terms/page.tsx
    - apps/web/app/privacy/page.tsx
    - apps/api/src/index.ts
    - apps/api/src/services/transactionMatcher.ts

key-decisions:
  - "Plan 04 had already seeded the bankConnections.* UI keys with full NL/FR/DE values; Task 1 therefore added only the email.renewalWarning block (11 keys) rather than re-translating the existing 65 keys, avoiding churn that could break the live UI"
  - "Renewal email keys include defaultName + defaultInstitution per locale so the worker never falls back to English 'Landlord'/'your account' in a non-English email"
  - "Privacy Ibanity disclosure rendered as a dedicated structured sub-section (purpose, lawful basis, data categories, retention, location) following the existing flat privacy.* key convention rather than the nested privacy.thirdParties.ibanity shape suggested by the plan"
  - "Rule 1 fix kept: transactionMatcher wrote a string into payments.paidDate (Date column) in the bank-reconciliation path Phase 9 feeds — fixed in scope; the remaining ~57 api typecheck errors are pre-existing and deferred"

requirements-completed: [BANK-EMAIL, BANK-I18N, BANK-TOS, BANK-RETENTION]

# Metrics
duration: ~20min
completed: 2026-06-30
---

# Phase 09 Plan 05: i18n, Legal Disclosures & GDPR Retention Summary

**Closes the Phase 9 launch checklist — localized bank-connection renewal emails, PSD2 Terms-of-Service + Ibanity Privacy-Policy disclosures across EN/NL/FR/DE, and a weekly GDPR retention cron for the bank_statements audit table — and runs the final integration gates ahead of the human Ponto-sandbox checkpoint.**

## Status

Tasks 1-4 (all `type: auto`) complete and committed. **Stopped at Task 5 (`checkpoint:human-verify`, gate="blocking")** — the manual Ponto-sandbox end-to-end verification requires a human with sandbox credentials and has NOT been performed.

## Task Commits

| Task | Name | Type | Commit |
| ---- | ---- | ---- | ------ |
| 1 | bankConnections.email.renewalWarning i18n block + extend i18n parity test | feat | `68085ae` |
| 2 | Localize renewal email + add TOS/Privacy PSD2 clauses (+ Rule 1 matcher fix) | feat | `42d969c` |
| 3 (RED) | Failing tests for bank statement retention service | test | `4edde65` |
| 3 (GREEN) | Retention service + weekly cron + startup wire | feat | `324e1d8` |
| 4 | Log pre-existing api typecheck debt + db:push sandbox limitation | docs | `48c1530` |

## Accomplishments

- **BANK-I18N:** Added the `bankConnections.email.renewalWarning` block (11 keys: subject7Day/subject1Day, greeting, body7Day/body1Day, ctaLabel, ctaUrl, consequence, signature, defaultName, defaultInstitution) to all 4 locales. `bankConnections.*` is now **76 keys per locale** with full parity. Extended `i18n-completeness.test.ts` with a `bankConnections` describe block (parity + nav + email-template assertions).
- **BANK-EMAIL:** Phase C renewal-warning email in `paymentCheckWorker.ts` now loads a locale-aware subject + body from the recipient's `users.locale` (fallback `en`) via `buildRenewalEmail()` / `loadRenewalEmailTemplate()`. The previous hardcoded English subject/body is gone. No tokens or secrets are interpolated (T-09-05-02) — only name, institution label, days, connection id (deep link), and web origin.
- **BANK-TOS:** Added a "Bank Account Connections (PSD2)" clause to `/terms` disclosing the separate Ibanity SA/NV service agreement, the €4/account/month direct billing, revocability, and 7-year statement retention. +2 keys per locale.
- **BANK-TOS (Privacy):** Added a structured Ibanity SA/NV (Isabel Group) third-party-processor disclosure to `/privacy` — purpose, lawful basis, data categories, retention, location, and a link to Ibanity's privacy policy. +15 keys per locale (incl. a one-line entry in the existing processors list).
- **BANK-RETENTION:** New `deleteExpiredBankStatements` service (hard-delete of `bank_statements` older than `BANK_STATEMENTS_RETENTION_DAYS`, default 2555 = 7 years) + `bankStatementRetentionWorker` BullMQ weekly cron (`0 3 * * 0`, Sunday 03:00, idempotent setup) wired into `index.ts` startup alongside the other schedules. 4 passing unit tests.

## Locale Key Counts (per locale, identical across EN/NL/FR/DE)

| Namespace | Before (Plan 04) | After (Plan 05) | Added |
| --------- | ---------------- | --------------- | ----- |
| `bankConnections.*` | 65 | 76 | +11 (email.renewalWarning) |
| `terms.*` | n | n+2 | bankConnectionsTitle, bankConnectionsClause |
| `privacy.*` | n | n+15 | thirdPartyIbanity + ibanity* structured block |

## TOS / Privacy Additions

- **Terms (`/terms`):** new section before "Limitation of Liability" — `terms.bankConnectionsTitle` + `terms.bankConnectionsClause`.
- **Privacy (`/privacy`):** Ibanity bullet added to the existing processors list (`privacy.thirdPartyIbanity`) plus a dedicated "Bank Account Connections (Ibanity / PSD2)" section rendering `ibanityName`, `ibanityPurpose`, `ibanityLawfulBasis`, `ibanityData`, `ibanityRetention`, `ibanityLocation`, and an external link (`ibanityLinkLabel` → https://www.ibanity.com/legal/privacy).

## Retention Worker Schedule

- Queue: `bank-statement-retention`
- Cron: `0 3 * * 0` (weekly, Sunday 03:00 — same convention as webhookCleanup)
- Threshold env: `BANK_STATEMENTS_RETENTION_DAYS` (default 2555 days; invalid/non-positive values fall back to the default — T-09-05-01)
- Setup: idempotent (removes existing repeatable jobs before re-adding); registered at process startup via `setupBankStatementRetentionSchedule()` in `index.ts`.

## Task 4 — Final Integration Gate Results (actual command outputs)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Full vitest suite | `pnpm --filter @rentular/api test` | **GREEN** — `Test Files 13 passed (13)`, `Tests 67 passed (67)` |
| Production build | `pnpm build` | **GREEN** — api `ESM Build success` + `DTS Build success`; web `✓ Compiled successfully` + `✓ Generating static pages (21/21)`; `Tasks: 2 successful, 2 total` |
| i18n parity audit | inline node script | **GREEN** — `i18n audit OK: bankConnections parity across en/nl/fr/de (76 keys)` |
| Monorepo typecheck | `pnpm lint` | **RED (pre-existing)** — `@rentular/api` `tsc --noEmit` fails with ~57 errors across ~13 files; web typechecks clean. See Deviations + deferred-items.md. |
| Schema idempotency | `pnpm --filter @rentular/db db:push` | **NOT RUN** — `ECONNREFUSED` (no MySQL in sandbox). Plan 05 changed zero schema files, so idempotency holds by construction; human must confirm against the real DB. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] transactionMatcher wrote a string to the `payments.paidDate` Date column**
- **Found during:** Task 2 (Task 4 lint gate surfaced it)
- **Issue:** `src/services/transactionMatcher.ts:116` set `paidDate: tx.bookingDate` (a `"YYYY-MM-DD"` string) on a Drizzle `date()` column whose insert/update type expects a `Date` — a correctness bug squarely in the bank-statement → payment auto-match path that Phase 9 delivers.
- **Fix:** wrapped with `new Date(tx.bookingDate)`.
- **Files modified:** `apps/api/src/services/transactionMatcher.ts`
- **Commit:** `42d969c`

### Out-of-Scope (NOT fixed — deferred)

**2. Pre-existing `@rentular/api` typecheck failures (~57 errors)**
- The `pnpm lint` gate cannot be green: the api package has been failing `tsc --noEmit` since Phase 2/6 (predates Phase 9), with systemic Drizzle Date-vs-string column mismatches, a `getDb().query` API typed as `{}`, and missing type declarations (`nordigen-node`, `playwright-core`). None are caused by Plan 05; none are in Plan 05's scope (i18n/email/legal/retention). The app builds and all 67 tests pass.
- Logged to `deferred-items.md`; recommended as a dedicated typecheck-cleanup plan before/within Phase 10 deployment. The one error directly on Phase 9's reconciliation path was fixed in scope (Deviation 1); the rest touch unrelated payment/cost/maintenance/indexation routes and were left untouched per the SCOPE BOUNDARY rule.

## Threat Surface

No new trust boundaries beyond the plan's `<threat_model>`. Renewal email interpolates no tokens (T-09-05-02 honored); retention default is the safe 7-year value with env-override-only shortening (T-09-05-01 honored); TOS/Privacy disclosures added per T-09-05-05.

## Awaiting

Task 5 human-verify checkpoint — manual Ponto-sandbox end-to-end verification (see checkpoint report returned to the orchestrator). Plan 05 is NOT complete until the human approves.

## Self-Check: PASSED

All 5 created/modified key files exist on disk; all 5 task commits (`68085ae`, `42d969c`, `4edde65`, `324e1d8`, `48c1530`) present in git history.

---
*Phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con*
*Tasks 1-4 complete 2026-06-30; checkpoint pending*
