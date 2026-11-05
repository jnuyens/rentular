---
quick_id: 261105-com
status: complete
completed: 2026-11-05
commits:
  - d6382c1 fix(261105-com): never remind a tenant whose transfer is already in the bank
  - 31b1985 feat(261105-com): log every outgoing message against its contract
  - b23eba2 feat(261105-com): contract communication history endpoint
  - 245ccc3 feat(261105-com): communication page per contract
key-files:
  created:
    - apps/api/src/services/shortfallMatch.ts
    - apps/api/src/services/transferReview.ts
    - apps/api/src/lib/communicationLog.ts
    - apps/api/src/services/communicationSchedule.ts
    - apps/api/src/services/leaseCommunications.ts
    - apps/web/app/(dashboard)/leases/[id]/page.tsx
    - .planning/quick/261105-com-contract-communication-history/prod-ddl.sql
  modified:
    - apps/api/src/services/reconciliationAssign.ts
    - apps/api/src/services/ibanMatcher.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/jobs/smsQueueWorker.ts
    - apps/api/src/services/manualReminder.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/services/reminderChannel.ts
    - apps/api/src/services/landlordLateEmail.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/routes/landlordActions.ts
    - apps/api/src/routes/communications.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/routes/leases.ts
    - packages/db/src/schema/communications.ts
    - packages/db/src/schema/payments.ts
    - apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/app/(dashboard)/leases/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
---

# Quick Task 261105-com: Communication history per contract, and no reminder when the money is in the bank

## Required deploy order

1. Back up the prod database.
2. Apply `.planning/quick/261105-com-contract-communication-history/prod-ddl.sql` (widens three enums, keeps every existing value).
3. Deploy the code (build web, `pm2 restart` web and api).

Order matters. With the code deployed before the DDL, MariaDB rejects (strict mode) or blanks (non-strict) inserts of the new values `landlord_notification` and `due_date_sms`. Logging is best effort, so sending keeps working, but those rows are lost or end up with an empty type. Task 0 alone (commit d6382c1) needs no DDL: its transfer-review email uses type `other`. Commit 31b1985 switches it to `landlord_notification`.

## Task 0: no reminder when the payment is already in the bank

- **Matching** (`shortfallMatch.ts`, wired into `assignStatementToLease`). When no pending row fits the amount and the pre-indexation rule does not apply, the oldest open month of the lease is checked with `loadMonthStatus` (exact, to the cent):
  - received > 0 and transfer == shortfall: the month's pending row is marked paid with amount = transfer (`rentAmount` reduced first, then `chargesAmount`), paidDate = booking date, a note is added and the statement is matched. Tervuursestraat case: 810 pending, 740 paid, 70 in, settled.
  - received > 0 and transfer < shortfall: booked the same way as a partial. 50 in: received 790, shortfall 20, and the remainder sweep adds a pending row for the 20.
  - Transfer larger than the shortfall: still left for review.
  - IBAN pass only (`allowFirstPartial`): a partial from a known tenant account on a month that received nothing yet is also booked as a partial, so a transfer from a known tenant IBAN is never left unmatched just because it is partial.
  - `expectedAmountsForLease` now includes the oldest open shortfall, so the amount matcher and the multi-lease IBAN disambiguation recognise a transfer of exactly the missing amount.
- **Safety net** (`transferReview.ts`). Before every tenant reminder in the 19:15 run (any level, any channel), and before the due-date message: if an unmatched or mismatched incoming statement on the owner's connections, booked on or after due date minus 8 days, comes from a known tenant IBAN of the lease or equals the reminded amount to the cent, nothing goes to the tenant. The landlord late and final_pending emails for that payment are skipped too. The landlord gets one email per payment (deduped on `communications.metadata.kind = transfer_review` + `paymentId`) in his language, with a link to `/reconciliation`. Manual reminders are not blocked. The API returns `waitingTransfer` and the overview shows a warning toast.
- **Timing**. The 19:00 `check-overdue-payments` job runs `syncBankConnection` per connection, and the IBAN and amount matchers run inside it (verified in `bankConnectionSync.ts`). The worker runs with BullMQ default concurrency 1 on one queue, so the 19:15 jobs only start after the 19:00 job has finished. On top of that, both 19:15 jobs (`overdue-reminders` and `due-reminder-sms`) now rerun the IBAN and amount matchers over already imported statements first. This is local work only, with no bank API call.

## Task 1: send-path audit

| # | Path | Recipient | Logged before | Logged now |
|---|------|-----------|---------------|------------|
| 1 | `paymentFollowUp.sendReminder` email (worker, manual, magic link) | tenant (+CC) | yes, no trigger | yes, with trigger, triggeredBy, paymentId, level, amount, testPhase |
| 2 | `paymentFollowUp.sendReminder` extra SMS when smsEnabled | tenant | yes, no trigger | yes, same metadata |
| 3 | `reminderChannel` WhatsApp reminder | tenant | **no** | yes (`sendWhatsAppLogged`: queued, then sent with bridge id or failed with error) |
| 4 | `reminderChannel` SMS reminder | tenant | yes, no trigger | yes, with metadata |
| 5 | `paymentCheckWorker.sendDueDateTenantSms` WhatsApp | tenant | **no** | yes, type `due_date_sms` |
| 6 | `paymentCheckWorker.sendDueDateTenantSms` SMS | tenant | yes, as `payment_reminder_friendly` | yes, type `due_date_sms` |
| 7 | `manualReminder` (overview, MCP `send_reminder` through `/payments/send-reminder`) | tenant | through 1, 3, 4, no trigger | trigger `manual`, or `api` when the request carries an API token, triggeredBy = user |
| 8 | `landlordActions` remind by email | tenant | through 1, no trigger | trigger `magic_link`; now also recorded in `payment_reminders` |
| 9 | `landlordActions` remind by SMS | tenant | yes, no trigger | trigger `magic_link`; now also in `payment_reminders` |
| 10 | `landlordActions` remind by WhatsApp | tenant | **no** | yes, trigger `magic_link`; now also in `payment_reminders` |
| 11 | `routes/indexation.ts` apply with notification | tenant (+CC) | yes, no trigger | trigger manual/api, triggeredBy |
| 12 | `routes/communications.ts` custom email / SMS | tenant (+CC) | yes, no trigger | trigger manual/api, triggeredBy |
| 13 | `routes/communications.ts` resend | tenant | new row, original metadata lost | new row keeps the original metadata, adds `resendOf`, trigger, triggeredBy |
| 14 | `landlordLateEmail` late / due / final_pending (direct `sendEmail`) | landlord, managers | **no** | yes, type `landlord_notification`, metadata.kind, paymentId; the signed one-click links are replaced by `[link]` in the stored copy |
| 15 | `transferReview` review email (new) | landlord | n/a | yes, `landlord_notification`, kind `transfer_review` |
| 16 | `indexationAlerts` digest email | landlord, managers | yes, `leaseId` only when one lease | yes, plus `metadata.leaseIds`, so a digest shows on every listed contract |
| 17 | `indexationAlerts` digest WhatsApp | landlord | yes | yes, plus trigger |
| 18 | `landlordReportWorker` | landlord | yes, `landlord_report`, no lease | unchanged (not about one contract) |
| 19 | `paymentCheckWorker` consent renewal warning | landlord | yes, `other`, no lease | unchanged (about a bank connection) |
| 20 | `propertyManagers` invitation emails | invited user | no | unchanged (account mail, not a contract message) |
| 21 | `routes/auth.ts` (reset, verify), `support.ts`, `healthIndexWorker`, `adminNotify`, `settings` SMTP test, `routes/sms.ts` test | user or admin | no | unchanged (account and system mail) |
| 22 | Letters / PDF | tenant | the only PDF is the attachment of the third reminder email (row 1) | logged with that email |
| 23 | Signal | none | no sender exists | `signal` accepted by the schema and the UI, ready for a sender |

Single owner per message: `queueEmail`/`queueSms` insert the row (only when meta is passed) and the queue workers only update it. Direct sends (WhatsApp, landlord emails) log through `communicationLog.ts`. No path logs twice. The email worker now clears `error_message` when a retry succeeds.

Schema: `communications.channel` + `signal`; `communications.type` + `landlord_notification`, `due_date_sms`; `payment_reminders.channel` + `signal`. I did not add a `manual_message` type: manual messages are `custom` with `trigger = manual`.

### Old rows and payment_reminders (read-only note, no backfill done)

Rows logged before this deploy have no `metadata.trigger`, so the page shows no "automatic" or "by ..." line for them. WhatsApp reminders and landlord emails sent before the deploy were never logged and cannot appear. A `payment_reminders` row (payment_id, type, channel, sent_at) corresponds to the communications row with `lease_id = payments.lease_id`, `type = CONCAT('payment_reminder_', type)`, the same channel, created within a few minutes of `sent_at`. To inspect the pairing for one lease:

```sql
SELECT pr.id AS reminder_id, pr.type, pr.channel, pr.sent_at,
       c.id AS communication_id, c.created_at, c.status
FROM payment_reminders pr
JOIN payments p ON p.id = pr.payment_id
LEFT JOIN communications c
  ON c.lease_id = p.lease_id
 AND c.type = CONCAT('payment_reminder_', pr.type)
 AND c.channel = pr.channel
 AND c.created_at BETWEEN pr.sent_at - INTERVAL 10 MINUTE AND pr.sent_at + INTERVAL 10 MINUTE
WHERE p.lease_id = '167863a8-e57e-45c6-ad5a-dc9e16c65e9d'
ORDER BY pr.sent_at;
```

`payment_reminders` does not record who sent a reminder. To label the 04/11 manual reminders as "by Jasper Nuyens" on prod, that metadata has to be set by hand (`JSON_SET(metadata, '$.trigger', 'manual', '$.triggeredBy', '<user id>')`) on those specific rows.

## Task 2: API

`GET /api/v1/leases/:id/communications?limit=100&offset=0` (owner, co_owner, manager; 404 without access, 403 below manager) returns `{ lease, past, scheduled, total, lastSevenDays, limit, offset }`.

- `past`: newest first, with audience (tenant or landlord), channel, type, recipients and CC, subject, body, status, error, trigger, triggeredBy name, paymentId, kind, testPhase and timestamps. It also includes indexation digests whose `metadata.leaseIds` contains the lease.
- `scheduled`: computed by `projectReminderLadder`, which replays the 19:15 worker day by day with `determineReminderLevel` and `decideFinalReminder` (hold `FINAL_REMINDER_HOLD_DAYS` calendar days), the owner's follow-up days (default 0/3/6), reminders sent on any row of the same lease month (`rowIdsForMonth`), exact settlement, and the first run still to come in the schedule timezone. It also covers the landlord late notice, the due-date message when enabled, the next expected rent's first reminder ("only if unpaid on the due date") and the next indexation alert (09:00). When a transfer is waiting for review, entries carry `on_hold_transfer_review`.
- Tests cover both prod cases. Tervuursestraat: landlord 08/11 19:15, third reminder 10/11 19:15. Carnotstraat: formal 07/11 19:15, landlord 10/11, third 12/11.

## Task 3: Web

New page `/leases/[id]`: "Gepland" on top with conditions and times in Brussels time, then "Verzonden" (tenant messages), then "Meldingen aan jou" (landlord notices). Each item shows the channel icon, kind, dd/mm/yyyy HH:mm, To and CC, a status badge (failed in red with the error), the trigger and an expandable full body. The page has a channel and kind filter, a "N berichten in de laatste 7 dagen" pill (amber from 3 up) and "Toon oudere berichten" pagination. Linked from the contracts list (menu and mobile card) and from both overview lists. The tenants page shows no contracts, so it has no link. All strings are in EN/NL/FR/DE.

## Verification (observed)

- `apps/api`: `npx vitest run`: 57 files, 508 tests passed. `npx tsc --noEmit -p .`: no errors.
- `apps/web`: `npx tsc --noEmit -p .`: no errors. `pnpm build` (placeholder DB_PASSWORD and AUTH_SECRET) succeeded, and `/leases/[id]` was built.
- New tests: `shortfallMatch.test.ts` (70 settles, 50 leaves 20, cent-exactness, first partial, deposit, charges cut), `reconciliationAssignShortfall.test.ts` (wiring), `transferReview.test.ts` (IBAN, amount, 8-day window, once per payment), `communicationLog.test.ts` (queued to sent or failed, link redaction), `communicationSchedule.test.ts` (both prod cases, hold, DST), `leaseCommunications.test.ts`.
- Not verified: anything against a live DB, Redis, the bank or the WhatsApp bridge. The JSON_EXTRACT, JSON_CONTAINS and JSON_QUOTE SQL in `transferReview.alreadyNotified` and `loadPastCommunications` is untested against MariaDB. Check it on prod after the DDL by opening the Tervuursestraat contract page.

## Deviations

1. **[Rule 2] Magic-link reminders were not recorded in `payment_reminders`**, so the worker could send another friendly reminder for the same month. They are now recorded. Cost if wrong: one extra row per magic-link reminder, which only advances the ladder.
2. **[Rule 2] Signed landlord action links redacted in the logged copy**, so a manager reading the history cannot act through a stored token. Cost if wrong: the stored body differs from the sent body by the links only.
3. **[Rule 2] When a transfer waits for review, the landlord late and final_pending emails for that payment are held as well**, replaced by the single review email. Cost if wrong: the landlord learns of the late rent through the review email instead of the late notice.
4. **[Rule 3] Dependencies installed in the worktree** with `pnpm install --frozen-lockfile --offline` (lockfile only, nothing added).
5. The IBAN pass books a first partial from a known tenant account (`allowFirstPartial`). The plan's partial rule mentioned only months with received > 0, but it also says a transfer from a known tenant IBAN must never be left unmatched because it is partial. Cost if wrong: a small non-rent transfer from a tenant account (for example a utility refund) is booked as partial rent and has to be moved by hand.

## Threat flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: data-exposure | apps/api/src/routes/leases.ts | New read endpoint returning message bodies (tenant PII). Restricted to manager and above on the property. |
