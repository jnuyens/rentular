---
quick_id: 261012-wma
slug: fix-duplicate-deposit-when-deposit-notes
type: quick
autonomous: true
---

# Fix duplicate deposit when deposit notes are appended

## Problem (verified in prod 2026-10-12)

A deposit payment is recognised only by `notes === DEPOSIT_NOTE`
("auto-generated deposit"). When a bank transfer is assigned to a deposit,
`reconciliationAssign.ts` / `routes/bankTransactions.ts` append a line to the
notes ("auto-generated deposit\nAuto-assigned by ..."). From then on:

- `ensureExpectedPayments` (`services/expectedPayments.ts`) no longer finds the
  deposit and inserts a second one (prod: 30386f0c and 85023522 created
  2026-10-05 19:00).
- The reminder worker, the payments route, `coversMonthRent`, the picker and
  the IBAN matcher treat the old deposit as rent.

## Task 1: one deposit predicate, prefix based (TDD)

In `apps/api/src/services/expectedPayments.ts` export:

- `isDepositNote(notes: string | null | undefined): boolean` returning
  `notes != null && notes.startsWith(DEPOSIT_NOTE)`.
- `depositNoteLike = \`${DEPOSIT_NOTE}%\`` (for SQL `like` / `notLike`).

Tests first (`services/__tests__/expectedPayments.test.ts`): exact note,
appended note ("auto-generated deposit\nAuto-assigned by ..."), null, rent note,
"auto-generated expected payment". Also `coversMonthRent` returns false for a
paid deposit with an appended note, and a picker test in
`paymentPicker.test.ts` that a deposit with an appended note is still treated
as a deposit (not picked as rent for an overpayment).

## Task 2: use it everywhere

Replace every exact deposit check:

- `expectedPayments.ts:142` existence lookup: `like(payments.notes, depositNoteLike)`.
  Update the comment at :134 (no longer needs exact equality).
- `expectedPayments.ts:178` `coversMonthRent`: `isDepositNote(p.notes)`.
- `paymentPicker.ts:12` `isDeposit`: `isDepositNote(p.notes)`.
- `ibanMatcher.ts:38`: `!isDepositNote(p.notes)`.
- `routes/payments.ts:496`: `isDepositNote(p.notes)`.
- `routes/leases.ts:272`: `like(payments.notes, depositNoteLike)`.
- `jobs/paymentCheckWorker.ts:194, 345, 673`:
  `or(isNull(payments.notes), notLike(payments.notes, depositNoteLike))`.
- `routes/__tests__/writeGuards.test.ts` mocks `DEPOSIT_NOTE`; add mocks for
  the new exports if the module mock needs them.

Grep afterwards: no `=== DEPOSIT_NOTE`, `!== DEPOSIT_NOTE`,
`eq(payments.notes, DEPOSIT_NOTE)` or `ne(payments.notes, DEPOSIT_NOTE)` left.

## Task 3: keep the marker on manual note edits

In `routes/payments.ts` PUT (around :615-652), when the existing payment is a
deposit (`isDepositNote(existing.notes)`) and the new `notes` does not start
with `DEPOSIT_NOTE`, store `${DEPOSIT_NOTE}\n${data.notes}` so editing a
deposit's notes never turns it into rent.

## Verify

- `pnpm --filter @rentular/api test` all green.
- `pnpm --filter @rentular/api lint` and `pnpm --filter @rentular/web lint` OK.
- No em-dashes or en-dashes in any change. No Co-Authored-By lines in commits.
- No schema change, no prod data change needed (prod already cleaned).
