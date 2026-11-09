---
quick_id: 261109-agr
type: quick
autonomous: true
---

# Quick Task 261109-agr: "Agreement with the tenant": pause reminders for an open amount until a date

## Why

Carnotstraat 65 b102 (lease 2243d291-5d2a-4d4e-88bc-4361d3005362): after indexation the tenant paid 900 instead of 925 for November and told the owner he will pay the remaining 25 together with the December rent. The owner agrees and wants no more reminders this month, while the 25 stays visible as owed. Today the only UI option is "Ignore" on the payments page, which also removes the amount from the overview totals (routes/payments.ts skips isIgnored), so it is the wrong tool. The orchestrator has, as a stopgap, set payments.final_reminder_held_at on row 4d4c0e0e (pending 25.00 due 04/11) so the third reminder does not go out.

## Goal

From the overview (overdue item of a partly paid or unpaid month) and from the contract page, the landlord can record an agreement: "Afspraak met de huurder" with a date ("betaalt ten laatste op") and an optional note. Quick choices: "met de volgende huur" (prefills the next expected rent due date of that lease, e.g. 04/12), "einde van de maand", or a custom date.

While an agreement is active (today < agreed date) and the amount is still open:
- No tenant reminder of any level and no landlord late/final_pending emails for that payment (paymentCheckWorker, every channel, also the due-date message for that row) and no transfer-review hold changes needed. Manual reminders from the UI stay possible but show a confirmation: "Er is een afspraak tot 04/12. Toch een herinnering sturen?".
- The amount stays in Achterstallig and in all totals, shown with a calm style (not red): badge "Afspraak tot 04/12" plus the note on hover/expand. The contract page and the overview item show who recorded it and when.
- The communication schedule (services/communicationSchedule.ts) shows nothing for that payment until the agreed date, and then the next step with the condition "alleen als het dan nog niet betaald is".
- After the agreed date, if still unpaid: reminders resume. The reminder ladder for that payment restarts from the agreed date as the reference date (friendly on the agreed date at the evening run, formal +3, landlord pre-warning and final as usual), so the tenant is not hit with a formal or final on day one. When the agreed date equals the next rent's due date and the contract-balance logic (261106-bal) already reminds for the combined balance, make sure only ONE reminder goes out covering both amounts (no double message for the same lease the same evening), with the amount text explaining "inclusief € 25,00 van november".
- Recording, changing and removing an agreement is logged in the contract communication history as an internal note (not a message to the tenant): type 'other' with metadata.kind 'payment_agreement' and direction outbound is wrong; add a distinct, clearly internal kind that the history shows as "Afspraak genoteerd" with the date and note, and exclude it from the 7-day message counter. If a new type value is needed, write the DDL to prod-ddl.sql.
- When the payment gets paid, the agreement ends automatically.

Schema: on payments add `agreement_until date NULL`, `agreement_note varchar(500) NULL`, `agreement_by varchar(255) NULL`, `agreement_at timestamp NULL`. Prod DDL to `.planning/quick/261109-agr-payment-agreement-pause-reminders/prod-ddl.sql` (additive). Never run db:generate. Code must handle the columns being absent only if trivial; otherwise state "DDL first" in the SUMMARY.

API: POST /api/v1/payments/:id/agreement { until: YYYY-MM-DD (today < until <= today + 120 days), note?: string } and DELETE /api/v1/payments/:id/agreement, same access checks as the other payment routes (owner, co_owner, manager of the property). Include agreement fields in the dashboard items, lease payments and lease communications responses. Also expose the existing final-reminder hold state if useful, but do not build a second pause mechanism: the agreement is the one user-facing pause. Migrate the stopgap: a payment with final_reminder_held_at set and no agreement keeps working as today.

Web: button "Afspraak" on overdue items in the overview (next to the existing reminder action) and on the contract page per open amount; a small modal with the quick choices, date picker (dd/mm/yyyy display), note; remove agreement action. All strings EN/NL/FR/DE with proper accents, human tone, no dashes. NL suggestions: "Afspraak met de huurder", "Betaalt ten laatste op", "Met de volgende huur", "Geen herinneringen tot die datum. Het bedrag blijft zichtbaar als achterstallig.", "Afspraak tot 04/12".

Tests: worker skips all reminder kinds during an agreement and resumes after with the ladder restarted from the agreed date; one combined reminder when the agreed date equals the next due date; schedule projection; API validation and access; paid ends agreement; Carnotstraat case (25 open from 04/11, agreement until 04/12, December 925 due 04/12): no messages 09/11 to 03/12; on 04/12 if neither is paid, a single friendly reminder for 950 explaining the 25 from November.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed).
- No em-dashes or en-dashes; no Co-Authored-By lines. Never deploy, never touch prod, never send messages, never run db:generate.
