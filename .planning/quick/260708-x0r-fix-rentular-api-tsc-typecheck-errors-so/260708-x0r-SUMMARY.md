---
quick_id: 260708-x0r
description: Fix @rentular/api tsc typecheck errors so pnpm lint passes
status: complete
completed: 2026-07-09
---

# Quick Task 260708-x0r — Summary

## Result

`pnpm lint` is **green**. `@rentular/api` `tsc --noEmit` went from **59 errors → 0**.
`@rentular/web` typecheck stays clean, API tests **77 pass**, API build (tsup) and
web build (Next) both succeed. No runtime behavior change.

## What was wrong

59 pre-existing, type-only errors that build/tests tolerated but blocked the lint gate.
Three root causes plus a few one-offs.

## Fixes

**1. Date/string mismatch (~53 errors) — schema `mode: "string"`.**
Drizzle `date(...)` columns defaulted to `mode: "date"` (typed `Date`), but mysql2 returns
DATE columns as `"YYYY-MM-DD"` strings and all code reads/writes them as strings. Flipped all
17 `date()` columns across 6 schema files (`payments`, `leases`, `maintenance`, `costs`,
`indexation`, `bankStatements`) to `{ mode: "string" }`. Type-only: emitted SQL and stored
data unchanged, so **no migration and no DB change**. This is the source-level fix the
user approved over scattering `new Date()` conversions across call sites.

Two call-site follow-ups after the flip:
- `transactionMatcher.ts` auto-match wrote `new Date(tx.bookingDate)` to `paidDate`; now writes
  the string `tx.bookingDate` directly (already `YYYY-MM-DD`). Same stored value.
- `payments.ts` overdue query compared `dueDate` against `new Date(today)`; now compares against
  the `today` string.
- Left `bankTransactions.ts` markPaymentPaid untouched — it uses an `as any` cast (no tsc error)
  and its test asserts `paidDate instanceof Date`; runtime is unaffected by the type flip.

**2. `getDb().query` typed `{}` (4 errors).**
`connection.ts` annotated `_db` with the raw drizzle type, erasing the `<typeof schema>` generic.
Annotating the full generic directly triggered TS2719 (duplicate type identity), so refactored to
infer the type from a `createDb()` factory (`let _db: ReturnType<typeof createDb>`). Restores the
relational `.query.*` API types used by `webhooks.ts` and `paymentStateMachine.ts`.

**3. Missing module declarations (2 errors).**
- Added `apps/api/src/types/shims.d.ts` with `declare module "nordigen-node"` (ships no types).
- `smovinScraper.ts` imported the `BrowserContext` type from `playwright-core` (transitive-only,
  unresolvable); retargeted to `playwright` (a direct dep that re-exports it) — no new dependency.

**4. Misc.**
- BullMQ v5 removed per-job `timeout` from `DefaultJobOptions`; removed it from the import
  discovery + write queues with an explanatory comment (it was never enforced).
- `bootstrap.test.ts` cast through `unknown[]` to index the mock call tuple safely.

## Files changed (13 + 1 new)

Schema: `packages/db/src/schema/{payments,leases,maintenance,costs,indexation,bankStatements}.ts`,
`packages/db/src/connection.ts`. API: `routes/payments.ts`, `services/transactionMatcher.ts`,
`services/smovinScraper.ts`, `jobs/importDiscoveryWorker.ts`, `jobs/importWriteWorker.ts`,
`scripts/__tests__/bootstrap.test.ts`, new `types/shims.d.ts`.

## Verification

- `pnpm lint` → 2 successful (api + web), 0 errors
- `pnpm --filter=@rentular/api test` → 77 passed (16 files)
- `pnpm --filter=@rentular/api build` → tsup success
- `pnpm --filter=@rentular/web build` → Next build success

## Follow-up unblocked

Resolves the STATE.md Phase-09 blocker: "`pnpm lint` is RED — ~57 pre-existing @rentular/api
errors." Lint can now be a real CI/pre-commit gate.
