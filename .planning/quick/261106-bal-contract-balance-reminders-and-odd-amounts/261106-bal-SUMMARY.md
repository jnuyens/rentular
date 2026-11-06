---
quick_id: 261106-bal
status: complete
subsystem: payments, reminders, reconciliation
tags: [contract-balance, reminders, arrears, odd-amounts, credit]
key-files:
  created:
    - apps/api/src/services/contractBalance.ts
    - apps/api/src/services/__tests__/contractBalance.test.ts
    - apps/api/src/services/__tests__/reconciliationAssignSpill.test.ts
    - apps/web/components/leases/ContractBalanceCard.tsx
    - .planning/quick/261106-bal-contract-balance-reminders-and-odd-amounts/prod-provinciestraat-arrears.sql (not committed)
    - .planning/quick/261106-bal-contract-balance-reminders-and-odd-amounts/prod-contract-balance-report.sql (not committed)
  modified:
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/services/manualReminder.ts
    - apps/api/src/routes/landlordActions.ts
    - apps/api/src/services/leaseCommunications.ts
    - apps/api/src/services/reconciliationAssign.ts
    - apps/api/src/services/shortfallMatch.ts
    - apps/api/src/services/ibanMatcher.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/routes/leases.ts
    - apps/web/app/(dashboard)/leases/[id]/page.tsx
    - apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - Arrears marks live in payments.notes as "[arrears repayment: 410.00]"; no schema change, no DDL
  - Odd and credit bookings are flagged with "[odd amount]" and "[credit]" note markers
  - Contract balance counts months with due date <= today (so the due-day SMS for today's rent still goes out when owed)
  - Received is counted per paid row (allocations only added when they come from a non-rent payment), so money is never counted twice
  - A month whose open row is ignored counts min(expected, received): neither debt nor hidden credit
  - Overpayments (transfer above the picked rent row) now spill onto the next open months in every mode, instead of silently dropping the excess
metrics:
  completed: 2026-11-06
  commits: 2
---

# Quick 261106-bal: Reminders follow the contract balance; every tenant transfer is attached to its contract

Reminders, landlord late/final notices and the communication schedule now look at the whole contract (rent due so far minus everything received, exact to the cent), skip contracts that are even or in credit, and never ask more than the contract owes. Transfers from a known tenant (known IBAN or the lease's structured communication) are always booked: oldest open month first, excess onto the next months, rest as credit, all flagged "afwijkend bedrag". Landlords can mark money as paying off older arrears on the contract page.

## Commits

| Task | Commit | What |
| ---- | ------ | ---- |
| 1 | b644399 | contractBalance service, reminders/schedule/dashboard follow it, spill booking for known tenants and overpayments, tests |
| 2 | f7713e3 | GET /leases/:id/balance, POST /leases/:id/payments/:paymentId/arrears (manager+, logged), ContractBalanceCard on /leases/[id], credit badge on the overview, translated "nothing owed" reminder error |
| 3 | not committed | prod-provinciestraat-arrears.sql and prod-contract-balance-report.sql in this folder |

## What changed

**contractBalance.ts (pure + loader).** `contractBalance({ lease, rows, allocations, records, deductions, today })` returns `{ expected, received, arrearsRepaid, owed, credit, fromMonth, perMonth[] }`. Months run from the first rent row's month (or the lease start, whichever is later) to the last month due on or before today, each with the existing `monthSettlement` rule. `cappedReminderAmount(month, owed)` gives null when owed <= 0, else min(month, owed).

**Reminders.**
- paymentCheckWorker: `periodSettlement` now takes `today`, loads the contract balance and reports the month settled when owed <= 0 (so no tenant reminder, no landlord late notice, no final_pending notice, no due-today heads-up, no due-date SMS). `amountDueFor` caps at owed. Remainder context is dropped when the cap makes it wrong. Rematch-before-reminders and the waiting-transfer hold are unchanged.
- manualReminder: returns `{ ok: false, error: NOTHING_OWED_ERROR }` when the contract owes nothing (judged on the month's due date for rent not due yet); caps the amount. The route adds `code: "nothing_owed"`, the overview shows it translated.
- Landlord magic link "remind": asks the month shortfall capped at owed; when nothing is owed it sends nothing and shows a translated page.
- GET /leases/:id/communications: schedule entries for a month are dropped when the contract balance on max(today, due date) owes nothing; amounts are capped.

**Booking.** `assignStatementToLease` gains `knownTenant`. Order: exact fast paths, pre-indexation, shortfall/partial (partials flagged `[odd amount]`), then for known tenants `planSpill` (oldest open month first, each month gets what it misses, the rest to the next open month, leftover recorded as a paid row flagged `[credit]` and `[odd amount]`). The statement links to the first booked row. Overpayments (transfer above the picked rent row) spill in all modes. Deposits keep their exact-amount rule. ibanMatcher passes `knownTenant`, also finds the lease by structured communication when the IBAN is unknown, and now also looks at statements the OGM pass flagged `mismatched_amount` that are not linked to a payment.

**Dashboard.** Every lease item carries `contractOwed` and, when positive, `contractCredit` ("Tegoed €X" badge). A lease whose contract owes nothing is left out of the overdue list; total overdue is capped per contract at what it owes. Month figures (paid, to come, overdue this month, expected, history) are unchanged.

**Contract page.** New card: "Openstaand: €Y" / "Tegoed: €X" / "Alles in orde", the summary since the first tracked month, the paid rows with "Afwijkend bedrag", "Tegoed" and "Oudere achterstal" badges, and per row "Markeer als afbetaling van achterstal" with an amount field (manager+). EN/NL/FR/DE.

## Verification (run, observed)

- `apps/api npx vitest run`: 59 files, 524 tests passed (new: contractBalance.test.ts 11 tests, reconciliationAssignSpill.test.ts 5 tests, covering Akpinar November, Carnot 25, double rent carry-forward, odd 500 against 810 with 310 reminded, spill and credit, Provinciestraat with and without marks).
- `apps/api npx tsc --noEmit -p .`: clean.
- `apps/web npx tsc --noEmit -p .`: clean.
- `apps/web pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: exit 0.
- Both SQL files were run against a throwaway local MariaDB 11 container with fixture rows for Provinciestraat (rent 1090, day 1) and Carnot (900 to 925): report before showed Provinciestraat credit 1090.00 and Carnot owed 25.00; the arrears script marked 4 rows totalling 1090.00, is idempotent on a second run, and the report afterwards showed Provinciestraat even (expected 6540.00, received 6540.00, arrears 1090.00). The undo statement removed only the mark lines. Container removed afterwards.
- Not verified: the UI in a browser, and anything against prod data.

## DDL and deploy order

No DDL needed: marks are note lines on existing payment rows.

Deploy order:
1. Merge and deploy (build web, restart api and web). From the next 19:15 run, reminders follow the contract balance.
2. Before or right after that run: back up, then run `prod-contract-balance-report.sql` (read-only) so the owner can review owed/credit per lease. Leases with an unexpected credit are candidates for an arrears mark.
3. Run `prod-provinciestraat-arrears.sql` (check the 4-row / 1090.00 SELECT, then COMMIT). Without it Ceulemans shows 1090.00 credit and her next missed month would not be reminded. Check the contract page shows "Alles in orde".

Order between this task and 261106-tzs: independent; this task did not touch packages/db/src/connection.ts. `today` in the worker still comes from the existing `new Date().toISOString()` line that tzs may change; manual, magic-link and schedule use `wallClock(..., getScheduleTimezone())`.

## Deviations from Plan

**1. [Rule 1 - Bug] Overpayments dropped the excess**
- Found during: Task 1
- Issue: pickPaymentForTransfer picks the oldest rent row on an overpayment and the row kept its own amount, so the extra money vanished and the next month was reminded.
- Fix: overpayments now spill onto the next open months (or credit) in every mode.
- Cost if wrong: a manually assigned overpayment now also closes the next month; the landlord would have to reopen it.
- Commit: b644399

**2. [Rule 2 - Missing] Structured-communication transfers flagged mismatched were never matched again**
- Found during: Task 1
- Issue: the OGM pass marks unlinked statements `mismatched_amount`, and the IBAN pass only read `unmatched`, so decision 2 could not apply to them.
- Fix: the known-tenant pass also reads `mismatched_amount` statements without a matched payment, and finds the lease by structured communication.
- Cost if wrong: a statement the landlord meant to review by hand gets booked automatically (flagged as odd amount).
- Commit: b644399

**3. Report query is SQL, not the app itself**
- The report replicates the rules in SQL; one simplification (ignored months count fully) is documented in the file with a column showing where it matters. The exact per-lease figure is GET /api/v1/leases/<id>/balance.

## Assumption Drift (advisory)

- Found during: Task 1. Planned: months "whose due date has passed". Actual: due date on or before today. Why: otherwise the due-date SMS on the due day would always be skipped for a tenant who is even up to then. Cost if wrong: a reminder on the due day itself could be capped differently; overdue reminders (due < today) are unaffected.
- Found during: Task 3. Planned: tracking starts at "first payment row". Actual: the month of the first rent row's due date (not its attributed month), so Provinciestraat starts in June as the owner expects. Cost if wrong: if her real first row is older or her payment day is not 1, the expected even balance differs; the script's context SELECT shows all her rows.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-endpoint | apps/api/src/routes/leases.ts | GET /leases/:id/balance (any role on the property) and POST /leases/:id/payments/:paymentId/arrears (manager+, row must belong to the lease, amount <= row amount, logged with user id) |

## Self-Check: PASSED

- FOUND: apps/api/src/services/contractBalance.ts, apps/web/components/leases/ContractBalanceCard.tsx, both SQL files
- FOUND: commits b644399, f7713e3
