---
quick_id: 261106-bal
type: quick
autonomous: true
---

# Quick Task 261106-bal: Reminders follow the contract balance; every tenant transfer is attached to its contract

## Owner decisions (2026-11-06, locked)

1. Contract balance, arrears marked. The amount a tenant can be reminded about is what is owed on the whole contract: rent due so far (exact settlement per month: rent in force on each due date + charges - deductions, only months whose due date has passed, from the start of tracking) minus everything received as rent (non-deposit, non-ignored paid rows, allocations as today). The reminder for a month asks min(month shortfall, contract amount owed). If the contract is even or in credit (owed <= 0.00), NO tenant reminder at all and no landlord late/final notices for rent. Extra money counts as credit for later months, UNLESS the landlord marks it as paying off older arrears (from before tracking or otherwise not represented in Rentular); such marked money does not count as credit.
   - Real case: Provinciestraat 199 Antwerpen (I. Ceulemans, rent 1090): paid 1500 (28/06), 1500 (29/07), 1300 (04/08), 60 (11/08), 1090 (30/08), then 1090 monthly. The extra 1090 repaid a month missed before Rentular tracked her. Without marking it would wrongly count as credit. Provide the marking (see Task 2) and a one-off prod SQL (Task 3) to mark those extras for her, owner already confirmed this.
2. Odd amounts from a known tenant: a transfer from a tenant's known IBAN (tenantBankAccounts) or with the lease's structured communication, whose amount fits no open payment exactly, is ALWAYS attached to that contract: booked on the oldest open month as a partial (that month's open row marked partly paid with the transfer amount, the rest stays open, remainder rows as today), flagged "afwijkend bedrag" so the landlord can check. Never left unmatched just because the amount is odd. A transfer larger than the oldest open month's shortfall fills that month and the excess fills the next open months in order (oldest first); any excess after all open months is credit on the contract (shown as "tegoed"). Deposits keep their own rule (only exact deposit amounts match a deposit row).

## Task 1: Balance and booking logic (API)

- New helper (services/contractBalance.ts, pure + tests): contractBalance({ leaseRows, indexRecords, deductions, allocations, arrearsMarks, today, timezone }) -> { owed, credit, perMonth[] } using the existing exact settlement helpers (monthReceived.ts / monthTotals.ts), months from the first tracked month (first payment row or lease start, whichever is later) to the last due month <= today.
- Reminders (paymentCheckWorker, manualReminder, landlord magic link "remind", due-date SMS): compute the contract balance before sending; skip when owed <= 0; cap the amount at owed. Keep the existing waiting-transfer hold (transferReview.ts) and rematch-before-reminders. Projections in the communications history schedule (GET /leases/:id/communications) must use the same rule (no scheduled reminder when owed <= 0).
- Booking (reconciliationAssign.ts assignStatementToLease + ibanMatcher/amountMatcher callers): implement decision 2 (oldest open month first, spill excess forward, excess beyond all open months recorded as a paid row flagged credit, never unmatched for a known tenant). Keep the exact-amount fast paths and the pre-indexation and shortfall rules from earlier tasks. Mark odd bookings with a note marker and a flag the UI can show ("afwijkend bedrag").
- Overview (/payments/dashboard): show the contract credit where relevant (e.g. "Tegoed €X" on a lease row) and never list a lease as overdue when its contract balance is even or in credit; keep month figures exact as now.
- Tests: Akpinar Nov case; Carnot 25 remainder; overpayment carry-forward (tenant pays 2x rent, next month not reminded); odd 500 against 810 -> partial, remainder 310 reminded; credit after all months; Provinciestraat with and without arrears mark.

## Task 2: Marking money as payment of older arrears (API + UI)

- Data: avoid schema changes if possible by storing the mark on the payment row (notes marker like the deposit marker, e.g. "arrears repayment" prefix, plus optional amount in a JSON-ish note line) or, if a cleaner design needs a column/table, write the DDL to the plan folder as prod-ddl.sql (never db:generate; orchestrator applies after backup).
- API endpoint to mark/unmark a paid row (or a part of it, amount) as arrears repayment, role manager+ on the property, logged.
- UI: on the contract page /leases/[id] (or the payments list for the lease) a "Markeer als afbetaling van achterstal" action per paid row with an amount field, and a visible line "Tegoed: €X" / "Openstaand: €Y" for the contract. All four languages, proper accents, human tone.

## Task 3: Prod data script (do not run)

- `.planning/quick/261106-bal-contract-balance-reminders-and-odd-amounts/prod-provinciestraat-arrears.sql`: marks Provinciestraat 199 Antwerpen's extra 1090.00 above rent in the June to August 2026 payments as arrears repayment (total 1090.00, spread as 410 + 410 + 210 + 60 from the rows 1500 (2026-06-28), 1500 (2026-07-29), 1300 (2026-08-04), 60 (2026-08-11), whichever representation Task 2 chose), with SELECT checks before and after, and the expected contract balance for her afterwards (even, assuming current months are paid).
- Also a read-only report query listing, for every active lease of owner a1e2c837-8130-438a-9a12-c285dda5cf27, the contract balance (owed / credit) as the new logic computes it, so the owner can review before reminders start using it.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder env if needed).
- A parallel quick task (261106-tzs) changes packages/db/src/connection.ts (UTC sessions) and date/time display and "today" computations across the app. Do not edit connection.ts; for "today" use the existing helpers and keep time-related edits minimal so the merge stays easy.
- Exact to the cent everywhere, no tolerances. No em-dashes or en-dashes; no Co-Authored-By. Never deploy, never touch prod, never send messages, never run db:generate.
