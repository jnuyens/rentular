---
phase: quick-261012-mko-fix-bank-matcher-assigning-rent-to-depos
plan: 01
subsystem: payments, bank reconciliation, ledger
tags: [bank-matching, deposits, rent-deductions, ledger, i18n, data-correction]
requires: [quick-261012-kpc]
provides:
  - pickPaymentForTransfer (pure matcher priority)
  - shared rent deduction helpers (deductionsForDueDate, deductedAmount, periodRentDue, periodEndFor, loaders)
  - leases.prior_payments_settled
  - ledger reduction UI
  - prod-data-correction.sql (not executed)
affects: [ibanMatcher, reconciliationAssign, bank assign route, expectedPayments, leases routes, ledger, paymentCheckWorker]
tech-stack:
  added: []
  patterns: [pure selection logic with thin db wrapper, lazy deposit generation driven by a persisted lease flag]
key-files:
  created:
    - apps/api/src/services/paymentPicker.ts
    - apps/api/src/services/rentDeductions.ts
    - apps/api/src/services/__tests__/paymentPicker.test.ts
    - apps/api/src/services/__tests__/rentDeductions.test.ts
    - .planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/leases-prior-payments-settled.sql
    - .planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/prod-data-correction.sql
  modified:
    - apps/api/src/services/reconciliationAssign.ts
    - apps/api/src/services/ibanMatcher.ts
    - apps/api/src/routes/bankTransactions.ts
    - apps/api/src/services/__tests__/ibanMatcher.test.ts
    - apps/api/src/routes/__tests__/bankTransactions.test.ts
    - packages/db/src/schema/leases.ts
    - apps/api/src/services/expectedPayments.ts
    - apps/api/src/routes/leases.ts
    - apps/api/src/services/smovinMapper.ts
    - apps/api/src/services/ledger.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/web/app/(dashboard)/leases/page.tsx
    - apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - Persist the "earlier payments settled" answer as leases.prior_payments_settled (default yes) instead of creating the deposit eagerly, because the deposit row is generated lazily on several paths
  - Manual assign uses createWhenUnmatched, recording a non-fitting transfer as its own paid payment so the larger pending rent stays open; the automatic IBAN pass leaves it unmatched
  - Smovin imports default priorPaymentsSettled to true with no import checkbox
  - A ledger period reduced to zero (rent-free or fully deducted) with nothing allocated reads as paid
metrics:
  duration: ~25 min
  completed: 2026-10-12
  tasks: 4
  files: 25
---

# Quick 261012-mko: bank matcher, older-contract deposits, ledger reductions Summary

The bank matcher now settles the pending rent row (or rent net of an applicable rent deduction) and only closes a deposit on an exact amount. Older contracts get their deposit presumed paid through a new `prior_payments_settled` lease flag. The ledger shows per-period reductions with an "Add reduction" action, and the reminder worker treats rent net of deductions as what is due. A prod data-correction SQL is prepared for the three affected leases and has not been run.

## What was built

**Task 1: deduction-aware matcher** (`35b415d` test, `5e5a640` feat, `fe8acb6` test)
- `paymentPicker.ts`: `pickPaymentForTransfer(pending, amount, deductions, tolerance)`. Priority: the oldest rent row whose raw or deduction-adjusted amount equals the transfer, then a deposit of exactly that amount, then the oldest rent row on an overpayment, else null.
- `rentDeductions.ts`: `deductionsForDueDate`, `deductedAmount`, `periodRentDue`, `loadLeaseDeductions`, `loadLeaseFreePeriods` (plus `periodEndFor` from Task 3).
- `assignStatementToLease` now loads all pending rows and the lease deductions, then uses the picker. If nothing fits, it returns null in auto mode. With `createWhenUnmatched` (manual route) it records a separate paid payment whose note says the pending rent stays open.
- `ibanMatcher.ts`: disambiguation uses the oldest non-deposit pending row's raw and net amounts, or the rent if there is none. A null assignment is logged, skipped and not counted.

**Task 2: older contracts** (`76b7475`)
- Column `leases.prior_payments_settled` (default true), with hand DDL `leases-prior-payments-settled.sql`.
- `ensureExpectedPayments` creates the deposit as `paid` (paid_date = start date, notes exactly `auto-generated deposit`) when the start date is before the lease's created day and the flag is not false. Leases starting today or later still get a pending deposit.
- Create and PUT accept `priorPaymentsSettled`. If PUT flips it from false to true on an older contract, it closes the lease's pending auto-generated deposit. A flip from true to false leaves payments alone.
- Lease form: a controlled toggle (default on) appears below the deposit field only when the start date is before today (local date). It is translated in EN/NL/FR/DE.

**Task 3: ledger and reminders** (`6fbbbfb` test, `404a168` feat)
- `computeLedger` uses `periodRentDue` per period. `LedgerPeriod` gains `periodEnd`, `grossRentDue`, `deductions` and `rentFree`, and `totalCharged` sums the reduced amounts.
- `isPeriodSettled` in paymentCheckWorker compares against rent minus applicable deductions (and returns settled when that is 0). Nothing else in the worker was touched, so the 261012-kpc third-reminder landlord gate is unchanged.
- Ledger page:
  - Lists each reduction with a remove button and shows a rent-free line.
  - The gross rent is struck through when it differs from the net rent.
  - "Add reduction" on every period opens `ReductionPanel` with amount, reason and the property-tax preset. Saving POSTs a temporary deduction from the period due date to the period end.

**Task 4: prod SQL** (`e46b8d8`)
- `prod-data-correction.sql` runs BEFORE selects, then START TRANSACTION, blocks 1 to 4, AFTER selects and COMMIT. Every write is guarded, so a rerun changes nothing. Bouchaouni's payment stays paid and matched, and the deduction row has the fixed id `7b1c9e2a-5d3f-4c8e-9a1b-262301326685`.

## Security check (T-mko-02)

- `POST /rent-adjustments/deductions` calls `checkLeasePropertyRole(userId, leaseId, "manager")` before inserting. A missing or foreign lease returns `ok: false`, which becomes a 403.
- `DELETE /rent-adjustments/deductions/:id` loads the row, then calls `checkLeasePropertyRole(userId, row.leaseId, "co_owner")` before deleting.
- `GET /ledger/:leaseId` and the other ledger routes go through `authorizeLease`, which checks accessible property ids.

No gap was found, so nothing was changed.

## Verification (observed)

- `pnpm --filter @rentular/api test`: 34 files, 216 tests passed. This includes paymentPicker (11), rentDeductions (12), ibanMatcher (5, one new) and bankTransactions (one new manual-assign case).
- `pnpm --filter @rentular/api lint` (tsc --noEmit): exit 0.
- `pnpm --filter @rentular/web lint` (tsc --noEmit): exit 0.
- All four message files parse, and every new key is present.
- No U+2014 or U+2013 characters appear in any added line or in either SQL file.
- RED was observed for both test commits: missing modules, then `periodEndFor is not a function`.
- Not verified: the ledger and lease-form UI in a browser, and either SQL file against a real MariaDB. Neither SQL file was executed, and nothing was deployed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] bankTransactions router test mock lacked the deduction tables**
- **Found during:** full API test run after Task 1
- **Issue:** `assignStatementToLease` now calls `loadLeaseDeductions`, and the `@rentular/db` vi.mock in `routes/__tests__/bankTransactions.test.ts` did not export `rentDeductions`, so the assign test got a 500.
- **Fix:** added `rentDeductions` and `rentFreePeriods` sentinels to the mock. Also added a case showing that manual assign of a non-fitting amount records a separate paid payment and keeps the rent open.
- **Commit:** fe8acb6

**2. [Rule 1 - Bug] zero-due ledger period would show as "open"**
- **Found during:** Task 3
- **Issue:** a period whose rent is fully waived or deducted had `allocated = 0`, so the existing status logic marked it "open".
- **Fix:** a period with nothing allocated is now "paid" when its net due is 0.
- **Commit:** 404a168

**3. Extra test** in ibanMatcher.test.ts: a null assignment is not counted.

## Notes for the operator

- Smovin import: `mapSmovinLease` returns `priorPaymentsSettled: true`. There is no checkbox in the import UI, because `import_sessions` has no options column to carry the answer to the write worker, and the import never sets a deposit amount anyway.
- Existing pending deposits are not touched by `ensureExpectedPayments`. The prod backfill is Block 4 of the SQL file.
- **Both SQL files in the quick dir are pending manual application on prod.** Apply them in this order:
  1. `leases-prior-payments-settled.sql`, BEFORE deploying the API. Without the column, every lease select fails.
  2. Deploy (web build and API restart).
  3. `prod-data-correction.sql`, AFTER the deploy. This way the deduction row and the restored deposits are read by the new ledger and settle logic straight away, and the old matcher cannot reassign anything in between. The file does not depend on the new column, so running it just before the deploy also works technically.

## Known Stubs

None.

## Self-Check: PASSED

- Files: paymentPicker.ts, rentDeductions.ts, both new test files and both SQL files exist.
- Commits: 35b415d, 5e5a640, fe8acb6, 76b7475, 6fbbbfb, 404a168 and e46b8d8 are all present in `git log`.
