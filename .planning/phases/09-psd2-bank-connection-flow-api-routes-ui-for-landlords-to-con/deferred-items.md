# Deferred Items — Phase 09

Out-of-scope discoveries logged during execution. These are NOT fixed by the
plan that found them (SCOPE BOUNDARY rule: only issues directly caused by the
current task's changes are auto-fixed).

## Pre-existing `@rentular/api` typecheck failures (found during 09-05 Task 4)

**Discovered:** 2026-06-30 while running the Plan 05 Task 4 `pnpm lint` gate.

**Status:** Pre-existing, systemic, unrelated to Plan 05's scope (i18n / email /
legal / retention). Present on `main` since at least Phase 2 (commit c697c07,
2026-03-22) and Phase 6 (commit 82cc9e6, 2026-03-28). The earlier Phase 9 plans'
gate checks did not surface these (likely truncated output).

**Symptom:** `pnpm lint` (which runs `tsc --noEmit` per workspace) fails in the
`@rentular/api` package with ~57 errors across ~13 files. The web package
typechecks/builds clean; `pnpm build` (tsup + next build) succeeds for both apps;
the full vitest suite (67 tests) passes — because esbuild/tsup do not typecheck.

**Dominant root causes (all pre-existing):**

1. **Drizzle Date-vs-string column mismatches** — most errors. Routes/jobs pass
   `string` (e.g. "YYYY-MM-DD") or `Date` to columns whose Drizzle insert/update
   type expects the other. Affected: `routes/payments.ts`, `routes/costs.ts`,
   `routes/rentAdjustments.ts`, `routes/maintenance.ts`, `routes/indexation.ts`,
   `routes/webhooks.ts`, `jobs/landlordReportWorker.ts`, `jobs/importWriteWorker.ts`,
   `services/paymentStateMachine.ts`.
2. **`getDb()` relational query API typed as `{}`** — `db.query.<table>` access in
   `routes/webhooks.ts` / `services/paymentStateMachine.ts` resolves to `{}`
   (Property 'payments'/'webhookEvents'/'leases' does not exist on type '{}').
3. **Missing third-party type declarations** — `nordigen-node` (no .d.ts) and
   `playwright-core` (not a direct dependency, referenced as a type-only import in
   the Smovin beta scraper).
4. **BullMQ `timeout` job option** removed in current bullmq types
   (`importDiscoveryWorker.ts`, `importWriteWorker.ts`).
5. **OverduePayment / LandlordReportData structural drift** in
   `jobs/paymentCheckWorker.ts` (lines 134/287/290) and `jobs/landlordReportWorker.ts`.

**Recommendation:** Dedicated typecheck-cleanup plan (or a Phase 10 deployment
pre-task). Touches payment-critical code; should be done deliberately with its own
verification, not folded into an i18n/legal/retention plan. The application builds
and all tests pass, so this is type-hygiene debt rather than a runtime regression —
but `pnpm lint` cannot be green until it is addressed.

**Fixed in 09-05 (in-scope, NOT deferred):** `services/transactionMatcher.ts:116`
auto-mark-paid wrote a `string` to the `payments.paidDate` Date column. This sits
directly in the bank-statement → payment reconciliation path that Phase 9 delivers,
so it was fixed as a Rule 1 correctness bug (wrapped with `new Date(...)`).

## db:push idempotency unverifiable in sandbox (found during 09-05 Task 4)

`pnpm --filter @rentular/db db:push` returns ECONNREFUSED — no MySQL is reachable
in the execution sandbox. Plan 05 modified zero files under
`packages/db/src/schema`, so schema idempotency holds by construction; the
idempotency assertion ("no changes to apply") must be confirmed by a human against
the real database during the Ponto-sandbox checkpoint / deployment.
