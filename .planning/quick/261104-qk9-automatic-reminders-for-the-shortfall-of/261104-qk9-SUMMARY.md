---
quick_id: 261104-qk9
status: complete
completed: 2026-11-04
commits:
  - 4916768
  - f01cca4
key-files:
  created:
    - apps/api/src/services/remainderRows.ts
    - apps/api/src/services/reminderText.ts
    - apps/api/src/services/__tests__/remainderRows.test.ts
    - apps/api/src/services/__tests__/reminderText.test.ts
  modified:
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/services/monthReceived.ts (two new exports appended at the end only)
    - apps/api/src/services/expectedPayments.ts (REMAINDER_NOTE, isRemainderNote appended)
    - apps/api/src/services/paymentPicker.ts
    - apps/api/src/services/reconciliationAssign.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/services/reminderChannel.ts
    - apps/api/src/services/manualReminder.ts
    - apps/api/src/services/landlordLateEmail.ts
    - apps/api/src/services/__tests__/reminderChannel.test.ts
    - packages/shared/src/constants/index.ts
    - apps/web/app/(dashboard)/settings/page.tsx
---

# Quick 261104-qk9: Automatic reminders for the shortfall of partly paid months

Partly paid months now get a pending remainder row for exactly the shortfall, which the 19:15 overdue reminders pick up like any other unpaid rent. The reminder texts use Belgian amounts and dd/mm/yyyy dates, and say when the amount is only the rest of the month's rent.

## Task 1: Remainder rows (commit 4916768)

- `services/remainderRows.ts`: `decideRemainderRows` is a pure function returning insert, update or cancel actions. `sweepMonths` covers the current month plus the 6 before it, once the due date has passed (due < today), within the lease's start date and a sane end date. `sweepRemainderRows(db, today)` applies the actions for every active lease.
  - Partly paid with nothing open: insert one pending row. amount = rentAmount = shortfall, chargesAmount 0, dueDate is the month's due date, method is the lease default, notes = `REMAINDER_NOTE` ("remaining amount after partial payment", the same text the mark-paid route already writes).
  - An existing remainder row gets its amount updated when the shortfall changes. A second remainder row is cancelled.
  - The month has another open row (Tervuursestraat: pending 810 plus paid 740): no remainder. A stale remainder next to such a row is cancelled.
  - Settled: any leftover remainder row is cancelled. Nothing received at all: no change.
- The worker runs the sweep at the start of Phase A, before it selects overdue rows. Errors are caught and logged.
- Reminder history: the ladder now reads the payment_reminders of every row in the same lease month (`rowIdsForMonth`: paid rows by attributed month, other rows by due month, deposits excluded). The manual friendly reminder on Carnotstraat's paid row 27ccf731... therefore counts for the new remainder row. I picked this over copying reminder rows: it needs no data writes and also covers other multi-row months.
- No double counting: a pending remainder is not money received, so the settlement still gives received 900, shortfall 25 (tested). The `/dashboard` code is unchanged. It deduplicates per lease+month and uses the exact settlement, so November still shows Carnotstraat 25 once.

## Task 2: Reminder texts (commit f01cca4)

- `services/reminderText.ts` contains:
  - `formatReminderAmount`: "€ 70,00" for NL and EN, "70,00 €" for FR and DE.
  - `formatReminderDate`: dd/mm/yyyy.
  - `amountContextText`: long (email) and short (SMS/WhatsApp) copy in EN/NL/FR/DE, for two cases: a generic partial payment, and a payment of the old rent after an indexation (with the long date "1er novembre 2026").
  - `withAmountContext` and `renderReminderTemplate`.
- `getTemplateVariables` is now exported and language-aware, and it fills `{{amountContext}}`. These variables are used by:
  - email bodies, the in-email SMS path and the WhatsApp/SMS short path in reminderChannel
  - the due-day SMS amount in the worker
  - the landlord late email amount
  - the final reminder PDF due date
- Templates without `{{amountContext}}` get the sentence inserted automatically:
  - emails: in its own paragraph after the paragraph that names `{{amount}}`
  - short messages: before the " - {{ownerName}}" signature
- The worker and manual reminders pass a `remainder` context (expected, received, oldRent, indexation date) for partly paid months.
- The French and German default email and SMS templates now have proper accents and umlauts (shared constants plus the matching copy in the web settings page).

## Verification (observed)

- `cd apps/api && npx vitest run`: 49 files, 461 tests passed.
- `npx tsc --noEmit -p .` in apps/api: exit 0, no output. In apps/web: exit 0, no output.
- New tests:
  - remainderRows.test.ts (15): both prod fixtures (Carnotstraat inserts 25, Tervuursestraat does nothing), idempotency, update, exact-pay settles, stale cancel, duplicate cancel, month window, shared reminder history, matcher guard.
  - reminderText.test.ts (12): NL Tervuursestraat and FR Carnotstraat for email and SMS, owner placeholder handling, all four languages, no dashes.
- Not verified here: a real worker run against a database. The expected prod outcome (one 25.00 remainder for Carnotstraat November, none for Tervuursestraat) is covered by the unit tests only.
- I installed workspace dependencies in the worktree with `pnpm install --frozen-lockfile --offline` (lockfile only, no new packages) so vitest could run.

## Deviations from Plan

1. **[Rule 1 - Bug] Remainder rows kept out of the overpayment and pre-indexation matchers**
   - Found during: Task 1
   - Issue: in `pickPaymentForTransfer`, the overpayment fallback picks the oldest rent row the transfer covers. With a pending 25 remainder for November, Carnotstraat's next 900 transfer (December, old rent again) would have closed the 25 row, and December would have stayed unpaid. `preIndexationMatch` would also have looked at the remainder row first.
   - Fix: the overpayment fallback skips remainder rows (an exact 25 still matches), and reconciliationAssign leaves remainder rows out of `preIndexationMatch`.
   - Cost if wrong: an overpayment that should close a remainder now closes the next rent row instead. The money is still recorded, just on the next month.
   - Files: paymentPicker.ts, reconciliationAssign.ts. Commit 4916768.
2. **[Rule 2] Landlord late email amount and due-day SMS amount use the Belgian format too.** These do not share the tenant renderer, but they had the same "EUR 70.00" / "€70.00" problem. The landlord email copy itself (FR/DE without accents, "--" separators) was left alone.
   - Cost if wrong: cosmetic only.
3. **Web settings default copy** (apps/web settings page) got the same FR/DE accent fixes, so the editor shows what tenants receive. The reminderChannel test assertion changed from "850.00" to "€ 850,00".
   - Cost if wrong: none functionally.

## Assumption Drift (advisory)

- Found during: Task 2.
- Planned: add `{{amountContext}}` to the default templates.
- Actual: the default template texts do not contain the placeholder. The sentence is inserted automatically into every template that lacks it, defaults included.
- Why: `sendReminder` decides whether a template is "customised" by comparing it with the EN default, and the settings route stores the EN default in the database. Changing the EN default text would make every owner who saved the defaults look customised, and their tenants would get English text whatever their language.
- Cost if wrong: owners who want the sentence somewhere else can still place `{{amountContext}}` themselves.

## Notes for the orchestrator

- On the first run after deploy, Carnotstraat November also triggers the landlord "late" email (if landlordLateNotify is on), because the new row has no landlordNotifiedAt yet. The paid row never went through the pending loop, so the landlord has not had that email for the 25 yet.
- Known edge: a remainder row for a lease with a rent deduction has an effective amount of shortfall minus deduction in the picker's exact-match rule. Exact matches of the raw amount still work.
- Known edge: if the paid part of a month is later refunded or ignored (received drops to 0), the remainder row stays as it is. The month is then reminded for the remainder amount only, not the full rent.

## Self-Check: PASSED

- FOUND: apps/api/src/services/remainderRows.ts, apps/api/src/services/reminderText.ts, both test files
- FOUND commits: 4916768, f01cca4
