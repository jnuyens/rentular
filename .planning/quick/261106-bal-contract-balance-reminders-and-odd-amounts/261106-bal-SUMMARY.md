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

## Fix: tracking window

Found on prod (read-only report) before deploy: three leases owed exactly one month that was not real, because their tenants pay at the end of the previous month and the June row the expected-payments generator left behind was paid in May, before the bank data was imported.

### Commits

| Commit | What |
| ------ | ---- |
| 5190719 | `trackingStart` in contractBalance.ts; reminder gate (worker, manual reminder, landlord magic link), communications schedule and dashboard overdue skip months before the window; tests with the real figures |
| 8d58408 | ContractBalanceCard shows where the counted months start and why earlier open months are not reminded (EN/NL/FR/DE) |
| not committed | prod-contract-balance-report.sql rewritten with the new window and diagnostic columns; prod-provinciestraat-arrears.sql gained a note on the window |

### The rule

The window starts at the month the first received rent payment pays for (`attributedMonth`, the same attribution `receivedForMonth` uses: a row tagged to a rent period pays its due month, an untagged bank row pays the month whose due date it lands near, 8 days early to 5 days late), or at the lease start month when that is later. Details:
- A paid row whose whole amount is marked as older arrears does not open the window (that money pays rent from before tracking).
- Without any received rent the window falls back to the old rule (due month of the first rent row, or the lease start), so a tenant who never paid is still owed and reminded.
- `beforeTrackingWindow(balance, month)` and `reminderAmountFor(balance, month, amount)` are the shared gate. Worker: `periodSettlement` reports such a month settled (no tenant reminder, no landlord late or final notice, no due-day SMS). Manual reminder: returns "nothing owed". Magic link "remind": sends nothing and shows the "nothing owed" page. Schedule: plans nothing. Dashboard: never counted or listed as overdue (not named in the fix plan, same rule; see deviations).

### Real cases (tests in contractBalance.test.ts, figures checked)

| Lease | Before | After |
| ----- | ------ | ----- |
| Tervuursestraat 97 (Akpinar, 780, 810 from 2026-11-01, day 2) | from 2026-06, expected 4710.00, received 3930.00, owed 780.00 | from 2026-07, expected 4 x 780 + 810 = 3930.00, received 3930.00, owed 0.00. June never reminded, also not in December when he would owe 810 |
| Oude Haachtsesteenweg 75A1 Diegem (Almazan, 1150) | from 2026-06, owed 1150.00 | from 2026-07, 5 x 1150 = 5750.00 expected and received, owed 0.00 |
| Smisstraat 38 studio 5 (Nascimento, 618, pays 650) | from 2026-06, owed 522.00 | from 2026-07, expected 5 x 618 = 3090.00, received 3186.00, credit 96.00 |

The test fixtures use transfer dates at the end of the previous month (29/06, 30/07 and so on) as the plan describes. The exact prod dates were not available here, but the totals fix the pattern: studio 5's 3186.00 received can only be 2 x 618 + 3 x 650 over five payments, and 3708.00 - 3186.00 = 522.00 is the old figure.

### Explanations asked for

**Smisstraat 38 studio 5, 650 against 618.** Each 650.00 transfer is 32.00 above the rent. Under the contract balance that is credit, as intended: three months at 650 give 96.00 credit after the fix. It is never reminded and it absorbs a later shortfall (a month paid 32.00 short would not trigger a reminder while the credit covers it). The old 522.00 "owed" was the phantom June 618.00 minus those 96.00. If the 650 is an agreed new amount (an informal raise or charges), the lease rent or charges should be updated instead, then nothing turns into credit.

**Arendonckstraat 27 Mechelen: 4 months, expected 3686.08 for rent 1050, credit 513.92. Why not 4200?** Received = 3686.08 + 513.92 = 4200.00 = 4 x 1050.00 exactly, so the tenant paid the full 1050 four times. The expected side is lower because each month counts the rent in force on its due date (plus charges, minus deductions), not the lease's current monthly rent. 3686.08 / 4 = 921.52 exactly, which points to an indexation record: either an applied or notified indexation that takes effect after these months with previous rent 921.52 (the rule "before the first indexation, the rent is that indexation's previous rent"), or one whose new rent is 921.52. The other possibility is rent deductions totalling 513.92 over the four months. The report now has a `month_detail` column (`YYYY-MM=expected r=<rent in force> d=<deduction>`) that shows which one it is. If the record is wrong (wrong effective date, or a proposal that never applied stored as notified), correcting the record removes the credit; if it is right, the tenant really paid 128.48 a month too much. Not verified against prod data from here.

**Smisstraat 38 studio 4, credit 685.** I had no prod rows for this lease, so this is not explained from data. What the fix does to it: the window can only start later than before, never earlier, so its expected can only drop and its credit can only stay at 685.00 or grow (by one month's rent if its first transfer was also made at the end of a month and landed in the next month's window). Usual causes of a credit this size: a month paid twice, a deposit transfer booked as rent without the deposit note, or a steady overpayment like studio 5. The report columns `first_paid_on`, `window_start`, `month_detail` and `received` show which; if the money paid rent from before tracking, mark it as older arrears on the contract page.

### Provinciestraat 199 (Ceulemans), check before deploy

Her first transfer, 1500.00 on 2026-06-28, decides her window:
- Tagged to June (booked on June's open row, due date in June): the window starts in June, the 1090.00 marks leave her even (6540.00 expected and received). Same as before the fix.
- Untagged bank row (due date = paid date = 2026-06-28): 28/06 is 3 days before July's due date, so it pays July, the window starts in July, expected is 5 x 1090 = 5450.00 and she shows 1090.00 credit even with the marks, so a missed December would not be reminded.

The owner reads the 28/06 transfer as June's rent plus 410 arrears, so in the second case the right fix is to tag that row to June (due_date 2026-06-01). The statement is in prod-provinciestraat-arrears.sql, commented out, with a 1-row guard. The report's `window_start` column shows which case applies. Both cases are covered by the Provinciestraat test.

### Report SQL (prod-contract-balance-report.sql, still read-only)

Now computes the window like the code (attribution of untagged rows with the -8/+5 day window, later month wins; fully marked rows skipped; fallback to the first rent row). New columns: `monthly_rent`, `payment_day`, `first_paid_on`, `window_start`, `open_rows_before_window` (generator leftovers that are no longer owed), `month_detail`. Run against a throwaway local MariaDB 11 container with fixtures for Akpinar, Diegem, studio 5 and Provinciestraat (CURDATE 2026-11-06): Akpinar 3930.00 / 3930.00 owed 0, Diegem 5750.00 / 5750.00 owed 0, studio 5 credit 96.00, Provinciestraat untagged window 2026-07 credit 1090.00, tagged to June window 2026-06 even. Same figures as the tests. Container removed afterwards.

### Verification (run, observed)

- `apps/api npx vitest run`: 61 files, 541 tests passed (contractBalance.test.ts now 17 tests: the three real cases, tagged start, a fully marked row not opening the window, no received rent still owed, Provinciestraat tagged and untagged).
- `apps/api npx tsc --noEmit -p .`: exit 0.
- `apps/web npx tsc --noEmit -p .`: exit 0.
- `apps/web pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: exit 0.
- Not verified: the UI in a browser, and anything against prod data.

### Deviations

**1. [Rule 2 - Missing] Dashboard overdue used the same leftover rows**
- Found during: applying the gate. The /payments/dashboard overdue total and list counted open rows before the window (capped at what the contract owes, so it only showed once a tenant owed something else).
- Fix: months before the window are skipped there too.
- Cost if wrong: an open month before the first payment no longer shows on the overview; the landlord would see it only on the payments list.
- Commit: 5190719

**2. Fully marked arrears rows do not open the window**
- Not in the fix plan. Without it, a transfer marked entirely as older arrears could pull the window back to a month that the money did not pay.
- Cost if wrong: a lease where such a row is the earliest one starts a month later than the owner expects.
- Commit: 5190719

### Assumption Drift (advisory)

- Planned: the window rule removes phantom months for the three listed leases. Actual: it also moves the window of any tenant whose first transfer was an untagged end-of-month bank row, which includes Provinciestraat in the untagged case and possibly studio 4. Why: the rule follows attribution, not the owner's reading of each transfer. Cost if wrong: such a lease shows one month more credit than the owner expects and a later missed month hides behind it; the report's `window_start` column shows every lease where this happens.
- Planned: "a pending row before the window is never owed". Actual: true whenever at least one rent payment was received; for a lease with no received rent at all the old rule stays, so a new tenant who never paid is still reminded. Cost if wrong: if the owner wanted such leases skipped too, they will get reminders for every month since the first row.
- A new lease whose first month stays unpaid while the second is paid by an untagged transfer near its due date: the first month falls before the window and is not reminded. Cost if wrong: that one missed month needs a manual reminder or a payment row tagged to it.

### Self-Check (fix): PASSED

- FOUND: commits 5190719, 8d58408
- FOUND: apps/api/src/services/contractBalance.ts (trackingStart, beforeTrackingWindow, reminderAmountFor), both SQL files updated
