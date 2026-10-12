---
quick_id: 261012-wma
slug: fix-duplicate-deposit-when-deposit-notes
status: complete
completed: 2026-10-12
---

# Quick 261012-wma: Fix duplicate deposit when deposit notes are appended

Deposits are now recognised by the `DEPOSIT_NOTE` prefix instead of exact
equality, so a reconciliation line appended to a deposit's notes no longer
makes `ensureExpectedPayments` create a second deposit, and no longer makes
the reminder worker, payments route, `coversMonthRent`, picker or IBAN matcher
treat the deposit as rent. Replacing a deposit's notes keeps the marker.

## Commits

| Commit  | Message |
| ------- | ------- |
| 9cde6cf | test(261012-wma): add failing tests for prefix-based deposit detection |
| 21ab807 | fix(261012-wma): detect deposits by note prefix instead of equality |
| b516b6e | fix(261012-wma): use prefix-based deposit checks everywhere |
| eb09881 | test(261012-wma): add failing tests for keeping the deposit marker on note edits |
| e252718 | fix(261012-wma): keep the deposit marker when a deposit's notes are edited |

## Changed files

- `apps/api/src/services/expectedPayments.ts`: new `isDepositNote`, `depositNoteLike`, `keepDepositMarker`; existing-deposit lookup uses `like(payments.notes, depositNoteLike)`; `coversMonthRent` uses `isDepositNote`; comment updated
- `apps/api/src/services/paymentPicker.ts`: `isDeposit` uses `isDepositNote`
- `apps/api/src/services/ibanMatcher.ts`: oldest rent row uses `!isDepositNote`
- `apps/api/src/routes/payments.ts`: overdue loop uses `isDepositNote`; mark-paid uses `keepDepositMarker`
- `apps/api/src/routes/leases.ts`: settle-prior-payments update uses `like(payments.notes, depositNoteLike)`
- `apps/api/src/jobs/paymentCheckWorker.ts`: three reminder queries use `or(isNull(notes), notLike(notes, depositNoteLike))`
- `apps/api/src/routes/__tests__/writeGuards.test.ts`: module mock exposes the new exports
- `apps/api/src/services/__tests__/expectedPayments.test.ts`: tests for `isDepositNote`, `depositNoteLike`, `keepDepositMarker`, appended-note deposit in `coversMonthRent`
- `apps/api/src/services/__tests__/paymentPicker.test.ts`: deposit with appended note is not picked as rent for an overpayment

## Verification (observed)

- RED: 7 new tests failed before Task 1 implementation (isDepositNote not a function, coversMonthRent true, picker returned the deposit); 4 new tests failed before Task 3 implementation.
- `pnpm --filter @rentular/api test`: 34 files, 227 tests passed (was 216 before; 11 new). One earlier full run had 1 to 3 timeouts at 10s in unrelated files (bootstrap, reminderChannel, apiTokens), a different set each run under machine load; those files pass in isolation and the subsequent full run passed 227/227.
- `pnpm --filter @rentular/api lint` (tsc --noEmit): exit 0.
- `pnpm --filter @rentular/web lint` (tsc --noEmit): exit 0.
- Grep for `=== DEPOSIT_NOTE`, `!== DEPOSIT_NOTE`, `eq(payments.notes, DEPOSIT_NOTE)`, `ne(payments.notes, DEPOSIT_NOTE)` across `apps` and `packages`: no matches.
- No em-dashes or en-dashes in added lines. No schema change, no prod touched.

## Deviations

1. **Task 3 target route.** The plan pointed at a payments `PUT` around lines 615-652; there is no PUT in `routes/payments.ts`. That range is `POST /payments/:id/mark-paid`, the only route that replaces an existing payment's notes, so the fix went there.
2. **Task 3 as a pure helper.** Instead of inlining the prefix logic in the route, it lives in `keepDepositMarker` in `expectedPayments.ts` so it could be unit-tested TDD-style without a route-level DB mock. Behaviour matches the plan: a deposit whose new notes do not start with `DEPOSIT_NOTE` stores `${DEPOSIT_NOTE}\n${notes}`.
3. **Picker change landed with Task 1.** `paymentPicker.ts` was listed under Task 2, but the Task 1 picker test needs it to go green, so it was committed with Task 1.
4. **Worktree fast-forward.** The worktree branch started at b37c6dd, one commit behind main; fast-forwarded to 9b64828 (the plan commit) before starting.
5. **Formatting.** Prettier reports the touched files as unformatted, but they already were at baseline; whole-file reformatting was not applied to keep the diff focused.

## Self-Check: PASSED
