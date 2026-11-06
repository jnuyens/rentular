# 261106-bal fix: tracking window starts at the first received payment's month

Found on prod (read-only report, 2026-11-06) before deploy. Three leases show exactly one month owed that is not real:
- Oude Haachtsesteenweg 75A1 Diegem (C. Almazan, rent 1150): from_month 2026-06, owed 1150.00
- Tervuursestraat 97 (A. Akpinar, 780, 810 from 2026-11-01): from_month 2026-06, expected 4710, received 3930, owed 780.00
- Smisstraat 38 studio 5 (R. Nascimento, rent 618, pays 650): from_month 2026-06, owed 522.00

These tenants pay at the end of the previous month (Akpinar 29/06 for July, Diegem 30/07 for August). Their first tracked rent row (June, due-date month) was paid in May, before Rentular imported bank data, so the rule "count from the due-date month of the first rent row" (apps/api/src/services/contractBalance.ts) is wrong for prepayers.

Correct rule: the tracking window starts at the month the FIRST RECEIVED payment is attributed to (attributedMonth of the earliest paid, non-deposit, non-ignored rent row, with the same attribution window as receivedForMonth), or the lease start month if later. Months before that are outside the window; an open (pending) row whose month is before the window start never counts as owed and is never reminded (it is an artefact of the expected-payments generator).

Expected after the fix: Akpinar Jul to Nov = 4 x 780 + 810 = 3930 expected vs 3930 received -> owed 0; Diegem and studio 5 owe no phantom month. Also verify and explain in the SUMMARY: Smisstraat 38 studio 4 (credit 685), Arendonckstraat 27 Mechelen (4 months expected 3686.08 for rent 1050, credit 513.92: why not 4200?), studio 5's 650 vs 618 overpayment (32/month becomes credit, intended).

Apply the same rule in: contractBalance.ts (+ tests with these real numbers as fixtures), the reminder gate in paymentCheckWorker/manualReminder/landlordActions (they use loadContractBalance), the communications schedule projection (leaseCommunications/communicationSchedule), the ContractBalanceCard, and prod-contract-balance-report.sql (keep it read-only).

Checks: api vitest green, apps/api and apps/web `npx tsc --noEmit -p .`, apps/web `pnpm build`. No prod access, no deploy, no dashes, no Co-Authored-By.
