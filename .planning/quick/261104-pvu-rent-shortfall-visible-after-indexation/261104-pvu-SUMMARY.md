---
phase: quick-261104-pvu
plan: 01
status: complete
subsystem: payments
tags: [rent, indexation, overview, reminders, reconciliation]
requires: []
provides:
  - "monthReceived: exact per lease+month settlement (rentForDate, attributedMonth, receivedForMonth, monthSettlement, preIndexationMatch, loadIndexRecords, loadMonthStatus)"
affects: [dashboard overview, payment check worker, mark-month-paid, manual reminder, indexation apply, bank reconciliation, IBAN matcher]
tech-stack:
  added: []
  patterns: ["one settlement function shared by dashboard, worker, mark-paid and reminders"]
key-files:
  created:
    - apps/api/src/services/monthReceived.ts
    - apps/api/src/services/__tests__/monthReceived.test.ts
  modified:
    - apps/api/src/services/expectedPayments.ts
    - apps/api/src/services/__tests__/expectedPayments.test.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/routes/__tests__/writeGuards.test.ts
    - apps/api/src/routes/__tests__/indexation.test.ts
    - apps/api/src/routes/__tests__/bankTransactions.test.ts
    - apps/api/src/services/manualReminder.ts
    - apps/api/src/services/__tests__/manualReminder.test.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/services/reconciliationAssign.ts
    - apps/api/src/services/ibanMatcher.ts
    - apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - "A month counts as settled only when what was received is less than one full cent short of the expected amount (checked in tenths of a cent to absorb float noise). A 1 cent shortfall is NOT settled."
  - "Each paid row counts for one month; allocations and rows combine via max; deposits never count"
  - "Partly paid leases appear in the paid list with their received amount (amber, Partly paid badge) and in overdue/to-come with the shortfall"
metrics:
  duration: "about 40 min"
  completed: 2026-11-04
---

# Quick 261104-pvu: Rent shortfall visible after indexation Summary

Rent coverage is now exact to the cent everywhere. A month only counts as paid when the full expected amount for that month (rent in force on the due date, plus charges, minus deductions) has come in. The old 0.9x / 3.5x rule in coversMonthRent is gone. Partly paid months, especially tenants still paying the rent from before the indexation, show up on the overview, in the prior-month overdue total, in automatic and manual reminders, in mark-paid and in bank matching.

## Commits (worktree branch worktree-agent-a416ac68dabe7bf6a)

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 66decaf | monthReceived helper and tests; ensureCurrentMonthPayment and the payment check worker switched to it |
| 2 | 4eb3a16 | Dashboard, mark-month-paid, manual reminder, indexation apply, pre-indexation matcher; coversMonthRent deleted |
| 3 | a535112 | Overview badge, shortfall lines and i18n in four languages; paid list carries partial items (owner addition) |

## Verification (observed)

- `cd apps/api && npx vitest run`: 47 files, 434 tests passed (410 before; 10 old coversMonthRent cases moved into monthReceived.test.ts, which has 32 cases; 2 new manualReminder cases).
- `npx tsc --noEmit -p .`: clean in apps/api and in apps/web (exit 0).
- `grep -rn "coversMonthRent\|rent \* 0\.9\|rent \* 3\.5" apps/api/src`: no matches.
- i18n: all four locales have overview.partlyPaid, shortfallPaidOf, shortfallRemaining and shortfallOldRent (checked with node).
- No em-dashes or en-dashes in any added line of the diff (count 0). No schema or migration files changed. db:generate not run. Nothing deployed and prod not touched.
- Prod fixtures pass as unit tests: Carnotstraat 65 b102 Nov is 900 of 925, shortfall 25, oldRent 900. Tervuursestraat 97 Oct is settled at 780 (the 740 row does not count for Oct), and Nov is 740 of 810 with a shortfall of 70, counted once.
- Not verified: the live overview figures (Betaald -95, Achterstallig +95). That needs prod data and is left for the post-deploy UAT.

## Final grep for fuzzy amount comparisons

`grep -rnE '\* ?0\.[5-9]|\* ?1\.[1-9]|tolerance' apps/api/src apps/web/app apps/web/lib apps/web/components --include='*.ts' --include='*.tsx' | grep -v __tests__`:

```
apps/api/src/services/transactionMatcher.ts:44:      const tolerance = 0.01; // Per Pitfall 4: decimal precision tolerance
apps/api/src/services/transactionMatcher.ts:46:      if (Math.abs(tx.amount - expectedAmount) < tolerance) {
apps/api/src/services/paymentPicker.ts:34:  tolerance = 0.01,
apps/api/src/services/paymentPicker.ts:39:  const fits = (expected: number) => Math.abs(amount - expected) < tolerance;
apps/api/src/services/paymentPicker.ts:61:  if (oldestRent && amount >= oldestRent.effective - tolerance) {
```

All of these are 0.01 float-precision comparisons, not percentage tolerances. amountMatcher.ts and ibanMatcher.ts use `AMOUNT_TOLERANCE = 0.01` (not matched by this lowercase grep), which is also exact-cent. No multiplier comparison against rent remains.

## Paid contribution changes caused by deductions

Settled leases now add `expected` (rent in force + charges - deductions) to Betaald instead of monthlyRent + charges. These differ only for an active lease with a rent deduction that applies on this month's due date. I could not check prod for such leases, because the constraints forbid touching prod. To find them after deploy, run `SELECT DISTINCT lease_id FROM rent_deductions WHERE start_date <= CURDATE() AND (type='permanent' OR end_date >= CURDATE())` and join it to active leases. For each one, Betaald and Verwacht go down by the deducted amount. If there are none, Verwacht stays at 10189 as the plan expects. The new rule does not change any lease in the unit fixtures.

## Deviations from Plan

**1. [Rule 1 - Bug] Settlement threshold is "less than one full cent short", not `received >= expected - 0.01`**
- Found during: Task 1
- Issue: with float math, `received >= expected - 0.01` settles a payment that is exactly 1 cent short (1049.99 against 1050), which goes against the owner's "exact to the cent" rule. Rounding received to cents first also breaks the planned case "1050 - 0.005 is settled".
- Fix: settled when `Math.round((expected - unroundedReceived) * 1000) < 10`. 1049.995 settles, 1049.99 does not (both are covered by tests). The reported `received` is still rounded to cents.
- Cost if wrong: a tenant 1 cent short is shown as owing 0.01. That is easy to relax later in one function (isShort).

**2. [Rule 1 - Bug] mark-month-paid no longer returns "already paid" for a paid row that belongs to another month**
- Found during: Task 2
- Issue: the old shortcut returned `already: true` whenever any paid row had a due date in the month. Under the new attribution, an untagged early transfer dated e.g. Oct 30 pays November. So marking October paid would do nothing while October still showed as overdue.
- Fix: `already: true` only when the month is settled and a paid row exists. When nothing was received for the month, the existing pending/create flow runs.
- Cost if wrong: one extra paid row in that rare case. Each row still counts for one month only.

**3. [Rule 1 - Bug] Overview actions and React keys are per item month**
- Found during: Task 3
- Issue: overdue now holds prior-month shortfall items too. Mark paid and remind always used the selected month, and `key={leaseId}` could collide.
- Fix: the buttons pass `item.dueDate.slice(0, 7)` as the month, and the key is `leaseId-dueDate`.
- Cost if wrong: none for current-month items (same month as before).

**4. [Owner addition, via coordinator] Partial badge and paid-list partial items**
- An amber "Partly paid / Gedeeltelijk betaald / Partiellement payé / Teilweise bezahlt" badge next to the property name in the overdue, to-come and paid lists.
- paidItems now includes partly paid leases with rentDue = received, plus `remaining`. These show in amber with "Nog €25,00 open". Settled leases in paidItems show `expected`, so the list adds up to paidThisMonth.
- Amount colour logic lives in one place: `amountColorFor(bucket, item)`.
- The Achterstallig hint is derived from overdueThisMonth/overdueTotal, which include shortfalls, so it never says "Niets achterstallig" while a shortfall exists (checked in code, not in a browser).
- The worker reminder change (shortfall amount) is kept as planned. The owner confirmed it.

**5. [Rule 3 - Blocking] Test mocks extended**
- indexation.test.ts: the fake `where()` is now awaitable and a `payments` table was added. bankTransactions.test.ts: `indexationRecords` and `paymentAllocations` were added to the db mock. Both needed because the new code reads these tables.
- The worktree had no node_modules. I ran `pnpm install --frozen-lockfile --offline` from the existing lockfile, with no new packages.

## Assumption Drift (advisory)

- **Planned:** test "untagged row qualifying for two months -> the later month". **Actual:** no real payment day lets the windows overlap (due-8d..due+5d is 13 days, and consecutive due dates are at least 28 days apart). The test could not be built. **Why:** the code still picks the latest qualifying month, but that branch is unreachable. **Cost if wrong:** none.
- **Planned:** months with nothing received keep `rentDue = monthlyRent + charges` on the overview (as specified). **Note:** for a past month viewed after an indexation, an unpaid month therefore shows the new rent, not the rent in force then. Partly paid and settled months do use the rent in force on their due date. **Cost if wrong:** a cosmetic difference on past-month views of fully unpaid rent.

## Known Stubs

None.

## Threat Flags

None. No new routes. Dashboard batch loads are scoped to lease ids from rows that are already filtered by accessibleIds. The indexation bulk update is limited to this lease's pending, non-ignored, non-deposit rows at the old rent.

## Self-Check: PASSED

- FOUND: apps/api/src/services/monthReceived.ts, apps/api/src/services/__tests__/monthReceived.test.ts
- FOUND commits: 66decaf, 4eb3a16, a535112
