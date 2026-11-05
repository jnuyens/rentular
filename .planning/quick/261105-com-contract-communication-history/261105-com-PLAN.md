---
quick_id: 261105-com
type: quick
autonomous: true
---

# Quick Task 261105-com: Full communication history per contract (past and scheduled)

## Why

The lawyer of the tenant of Tervuursestraat 97 told the owner to "stop harassing". Rentular sent that tenant (lawyer in CC) three emails in six days: indexation letter 31/10, manual friendly reminder 04/11, automatic formal reminder 05/11 19:15. The owner needs, per contract, a complete and trustworthy record of every message that went to the tenant(s), over every channel, plus what is scheduled to go out next.

## Goal

On each contract (lease), a "Communicatie" history: every message sent to the tenants of that contract, newest first, whatever the channel (email, SMS, WhatsApp, Signal, letter/PDF, or anything added later) and whatever the kind (payment reminders friendly/formal/final, due-date SMS, indexation notification, welcome, renewal/termination, custom messages from the Communicatie page, manual reminders from the overview, reminders from the landlord magic-link email). Each entry: date and time (Europe/Brussels, dd/mm/yyyy HH:mm), channel, kind, recipients (to + cc), subject, status (queued/sent/delivered/failed/bounced, with error), who triggered it (automatic schedule, a named user, magic link), and the full body on expand. Plus a "Gepland" (scheduled) section listing what the system will send next for that contract and when, computed from the same logic the worker uses.

## Task 0 (do first, most urgent): never remind a tenant whose payment is already in the bank

Incident 2026-11-05: Tervuursestraat 97 (lease 167863a8-e57e-45c6-ad5a-dc9e16c65e9d). November: pending row 5a6f3b44 of 810 (due 02/11), plus a separate paid row of 740 (29/10) attributed to November, so the month's shortfall was 70. The tenant transferred exactly 70.00 on 05/11; the 19:00 bank sync imported it (bank_statements 14c0b0bf, from his known IBAN) but the matchers left it UNMATCHED because 70 fits no pending row amount (810). At 19:15 the worker sent the formal reminder for 70 anyway, and emailed the landlord asking whether he had paid. (Orchestrator already fixed the data by hand: row 5a6f3b44 is now paid 70.00 and the statement is matched to it.)

Fix both:
1. Matching (services/reconciliationAssign.ts assignStatementToLease and the automatic matchers that call it, plus expectedAmountsForLease in ibanMatcher.ts): when no pending row fits, check the month status of the oldest open month of the lease (loadMonthStatus / monthSettlement): if 0 < received < expected and the transfer equals the shortfall exactly (to the cent), settle it: mark that month's pending row paid with amount = transfer (rentAmount reduced accordingly), paidDate = booking date, append a note, match the statement. Also when the transfer is smaller than the shortfall but the month already has received > 0 (a further partial), record it the same way as a partial on that row (amount = transfer) so the month's received grows and a remainder row/shortfall reflects the rest; never leave a transfer from a known tenant IBAN unmatched just because the amount is partial. Unit tests with this exact case (810 pending, 740 paid, 70 transfer -> settled) and with a partial (810 pending, 740 paid, 50 transfer -> received 790, shortfall 20).
2. Safety net in paymentCheckWorker before sending ANY tenant reminder (friendly/formal/final, any channel) and in the due-date SMS: if the lease has an unmatched incoming bank statement (amount > 0) booked on or after the due date of the payment being reminded (or within 8 days before it) whose counterparty IBAN is a known tenant IBAN of that lease (tenantBankAccounts) or whose amount equals the amount being reminded, do NOT send the tenant reminder; instead log it, and (once per payment) email the landlord that a possibly matching transfer is waiting for review with a link to Reconciliatie. Manual reminders from the UI should show a warning in the response when such a transfer exists (do not block them). Unit tests.
3. Make sure the bank sync for the evening completes before the 19:15 reminder run, or the reminder run itself triggers matching first (it already runs after the 19:00 sync; verify the matchers run inside the sync and not later).

## Task 1: Every outgoing tenant message is logged against its contract (audit + fix)

- Audit every code path that sends something to a tenant: emailQueueWorker, smsQueueWorker, WhatsApp (lib/whatsapp.ts sendWhatsApp, used e.g. by routes/landlordActions.ts and the reminder dispatch sendReminderViaPreferredChannel), letters/PDF generation sent by mail, due-date tenant SMS (paymentCheckWorker sendDueDateTenantSms), manual reminders (services/manualReminder.ts), indexation notifications (routes/indexation.ts apply + any letter route), custom messages (routes/communications.ts), welcome/lease emails, MCP/API token tools that send messages (Phase 11), and anything else found by grepping queueEmail, queueSms, sendWhatsApp, sendEmail, nodemailer usage. List them all in the SUMMARY with: logged before? logged now?
- Make each path write exactly one communications row per message per channel, with lease_id set whenever the message concerns a contract, recipient email/phone, cc in metadata, the rendered subject and body, status updated by the worker (queued -> sent/failed with error_message), sent_at, and metadata.trigger = "schedule" | "manual" | "magic_link" | "api" plus metadata.triggeredBy (user id) when a person triggered it, and metadata.paymentId when it is a payment reminder. Never log twice for the same message (an email logged by the caller must not be logged again by the queue worker; pick one owner and dedupe).
- Messages to the landlord (late-payment emails to the owner, final_pending, digests, reports) are NOT tenant communications: keep them out of the tenant history, but log them too with a distinct type (e.g. landlord_notification) so they can be shown separately ("Meldingen aan jou") on the contract page.
- Add 'signal' to the communications.channel enum (and any other channel enum that must accept it) in the Drizzle schema, and write the production DDL to .planning/quick/261105-com-contract-communication-history/prod-ddl.sql (ALTER TABLE communications MODIFY channel ENUM(...) keeping existing values, plus any new type values such as landlord_notification, due_date_sms, manual_message). Never run db:generate; the orchestrator applies the DDL on prod after a backup. Code must keep working if the DDL is not yet applied only where trivially possible; otherwise note the required order (DDL first, then deploy) in the SUMMARY.
- Backfill is not required, but write a read-only script note in the SUMMARY on how old payment_reminders rows relate to communications.

## Task 2: API

- GET /api/v1/leases/:id/communications: role-checked like other lease routes (owner, co_owner, manager of the property; tenant data isolation), returns { past: [...], scheduled: [...] }.
- past: communications rows for the lease (tenant messages and, separately flagged, landlord notifications), newest first, paginated (default 100), with all fields above.
- scheduled: computed, not stored. For every open (pending, non-ignored, non-deposit) payment of the lease, project the next reminder steps with dates using the SAME functions the worker uses (determineReminderLevel, follow-up settings with defaults REMINDER_DEFAULTS friendly 0 / formal 3 / final 6 days after due, decideFinalReminder with FINAL_REMINDER_HOLD_DAYS = 2, landlord final_pending email first, the 19:15 evening run in the schedule timezone, reminders already sent across rows of the same lease+month count as sent, isPeriodSettled exact settlement). Also the upcoming due-date SMS if enabled, the next expected rent row's friendly reminder (only "if unpaid on the due date"), and the next indexation date if an indexation alert or letter is due. Each scheduled entry: planned date/time, channel (from the tenant's preferred channel resolution), kind, amount, recipient(s), and a short condition text ("only if still unpaid"). Unit tests with the two prod cases: Tervuursestraat (due 02/11, friendly sent 04/11 manual, formal sent 05/11) -> landlord final_pending email 08/11 19:15, tenant third reminder 10/11 19:15 unless held; Carnotstraat (remainder 25.00 due 04/11, friendly sent 04/11 manual) -> formal 07/11 19:15, landlord final_pending 10/11, third reminder 12/11.

## Task 3: Web

- Contract detail: add a "Communicatie" tab/section on the lease page (apps/web/app/(dashboard)/leases, find where a single contract is shown; if there is no detail page, add a drawer or route /leases/[id] consistent with the app) with: "Gepland" on top (with the conditions), then "Verzonden" timeline, each item with channel icon (mail, sms, WhatsApp, Signal, letter), kind label, date/time, recipients incl. CC, status badge (failed in red with the error), trigger ("automatisch", "door Jasper Nuyens", "via e-maillink"), expandable full body. A filter by channel and kind. A count summary like "3 berichten in de laatste 7 dagen" so frequency is obvious at a glance.
- Link to it from the overview items (overdue/to-come rows: a small "Communicatie" link) and from the tenant page if one exists.
- All strings in EN/NL/FR/DE with proper accents, human tone, no dashes.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET env if needed).
- No em-dashes or en-dashes; no Co-Authored-By lines. Never deploy, never touch prod, never send messages, never run db:generate.

## Expected on prod after DDL + deploy

- Tervuursestraat 97: past shows 31/10 indexation, 04/11 friendly (manual, by Jasper Nuyens), 05/11 19:15 formal (automatic), all with the lawyer in CC; scheduled shows the landlord pre-warning on 08/11 and the third reminder on 10/11 19:15 if still unpaid.
- Carnotstraat 65 b102: past shows 05/10 friendly, 31/10 indexation, 04/11 friendly; scheduled shows the formal reminder on 07/11 19:15.
