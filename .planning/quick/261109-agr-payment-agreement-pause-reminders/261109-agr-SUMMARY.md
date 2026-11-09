---
quick_id: 261109-agr
status: complete
completed: 2026-11-09
subsystem: payments, reminders, contract history
tags: [reminder-mute, agreement, reminders, internal-note]
commits:
  - 155ecdd feat(261109-agr): an agreement with the tenant pauses every reminder until the agreed date
  - b0c4083 feat(261109-agr): record and remove an agreement on an open amount
  - 3fe02de test(261109-agr): agreements pause reminders and restart the ladder
  - f9014ee refactor(261109-agr): mute late payment reminders per contract instead of per payment
  - 4222cbc feat(261109-agr): mute late payment reminders from the overdue lists and the contract page
key-files:
  created:
    - apps/api/src/services/reminderMute.ts
    - apps/api/src/services/reminderMuteStore.ts
    - apps/api/src/routes/reminderMute.ts
    - apps/api/src/services/__tests__/reminderMute.test.ts
    - apps/api/src/routes/__tests__/reminderMute.test.ts
    - apps/web/components/leases/ReminderMute.tsx
    - .planning/quick/261109-agr-payment-agreement-pause-reminders/prod-ddl.sql (not committed)
  modified:
    - packages/db/src/schema/leases.ts
    - packages/db/src/schema/communications.ts
    - apps/api/src/lib/communicationLog.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/services/communicationSchedule.ts
    - apps/api/src/services/leaseCommunications.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/services/reminderText.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/routes/leases.ts
    - apps/api/src/index.ts
    - apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/app/(dashboard)/payments/page.tsx
    - apps/web/app/(dashboard)/leases/[id]/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - Per contract, not per payment (owner scope change mid-task): leases.reminders_muted_until/_note/_by/_at; the per-payment agreement columns built first were removed before any DDL
  - Every open row due before the mute end date counts as muted; from that date they come back in ONE reminder (oldest muted row leads), plus the rent due on that date when there is one; once that rent is overdue it leads and carries the rest
  - The ladder restarts from the mute end date: reminders and landlord stamps from before it no longer count; a final-reminder hold set before the mute was set is replaced, a hold set after it still applies; without a mute the stopgap hold works as before
  - The due-date message is also skipped while muted, and on the end date when muted amounts are open (the evening reminder covers it); the landlord due-today heads-up is unchanged
  - Unmute clears the mute: reminders run on their normal ladder again (old reminders count), nothing restarts
  - Internal notes use a new communications type internal_note and channel internal, metadata.kind reminder_mute, excluded from the 7-day counter
metrics:
  completed: 2026-11-09
  commits: 5
---

# Quick 261109-agr: Mute late payment reminders per contract until a date

The landlord can mute a contract's late payment reminders until a date ("Volgende huur", "Volgende week" or a picked date, optional note) from each overdue item on the overview, from overdue rows on the payments page, and from a status block on the contract page. While muted nothing goes out for any open amount of that contract. From the end date one reminder covers everything that is still open, restarting at a friendly reminder, and it says what it includes ("Zoals afgesproken is dit bedrag inclusief € 25,00 van november.").

## Required deploy order

1. Back up the prod database.
2. Apply `.planning/quick/261109-agr-payment-agreement-pause-reminders/prod-ddl.sql` (four nullable columns on `leases`, `communications.channel` gains `internal`, `communications.type` gains `internal_note`; every existing value kept). **DDL first**: the code reads the new lease columns on every lease query, so deploying before the DDL breaks the overview, payments and contract pages. The columns cannot be absent.
3. Merge and deploy (build web, restart api and web). Never `db:generate`.
4. Carnotstraat 65 b102: mute the contract until 04/12 from the overview (overdue item, "Herinneringen dempen", "Volgende huur" prefills 04/12), so it is also noted in the contract history. The SQL alternative is commented at the end of prod-ddl.sql. The stopgap `final_reminder_held_at` on row 4d4c0e0e can stay: the mute replaces it once reminders resume, and without a mute it keeps holding as before.

Independent of other open quick tasks. The type enum in the DDL already includes `tenant_reply` (261107-rpl), so it is safe in either order.

## What changed

**Model (reminderMute.ts, pure).** `muteOf(lease)`, `isMuteActive`, `validateMuteUntil` (after today, at most 120 days ahead), `mutedRows` (open rent rows due before the end date), `companionRow` (open rent row due on the end date), `ladderState` (restart from the end date), `planForPayment` (normal / paused / rides_along / resumed), `combineReminder` (amount plus carried earlier amounts, capped at what the contract owes).

**Worker.** Phase A per overdue row: paused means nothing at all (no tenant reminder, no landlord late or final_pending email, no transfer-review hold). After the end date the lead row sends one reminder for all muted amounts (plus the rent due that day), days past due counted from the end date, and the reminder and landlord stamps are written on every covered row so each keeps its ladder if another gets paid. The due-date SMS is skipped while muted and on the end date when muted amounts are open. `{{amountContext}}` gains the carried-amount sentence (EN/NL/FR/DE, long and short).

**API.** `POST /api/v1/leases/:id/reminder-mute { until, note? }` and `DELETE` (owner, co-owner, manager; 401/403/404 otherwise; codes not_after_today, too_far, invalid_date). Each set, change and unmute adds an internal note to the contract history. Dashboard items (overdue and to-come) carry `mute` and `nextDueDate`; `GET /leases/:id/communications` carries `mute`, `nextDueDate`, internal notes with `audience: "internal"` and `mute` metadata; the schedule shows nothing while muted except the first step on the end date, condition `if_unpaid_after_mute` ("Alleen als het dan nog niet betaald is"), with the combined amount. `GET /payments?leaseId=` and `GET /leases` include the new lease columns as they are plain selects.

**Web.** `ReminderMute.tsx`: dialog, calm sky-blue "Gedempt tot 04/12" badge (note and who set it on hover), button, and the contract status block "Herinneringen gedempt tot 04/12" with note, who and when, and Wijzigen / Niet meer dempen. Overview: control on each overdue item, amounts of a muted contract shown calm instead of red, manual reminder asks "De herinneringen voor dit contract zijn gedempt tot 04/12. Toch een herinnering sturen?". Payments page: badge and menu action on overdue rows. Contract page: internal notes shown in the timeline as "Interne notitie" with the end date and note, labelled never sent.

## Verification (run, observed)

- `apps/api npx vitest run`: 69 files, 615 tests passed. New: `services/__tests__/reminderMute.test.ts` (20), `routes/__tests__/reminderMute.test.ts` (6), 2 in `leaseCommunications.test.ts`. They cover: silence 09/11 to 03/12 for Carnotstraat (with landlord late notices and due SMS enabled), on 04/12 exactly one friendly reminder for 950 explaining the 25 from November plus one landlord late notice for 950, then formal 07/12, final_pending 10/12, final 12/12, each once for both amounts; two muted months coming back in one reminder; paid during the mute (nothing, December gets its own due-date message); December paid but November not (November alone from 04/12); cap at what the contract owes; the stopgap hold with and without a mute; schedule projection; API validation (dates, 120 days, note length) and roles; internal note shape and the 7-day counter exclusion.
- `apps/api npx tsc --noEmit -p .`: clean. `apps/web npx tsc --noEmit -p .`: clean.
- `apps/web pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: exit 0.
- No em or en dashes in the added lines (grep count 0).
- Not verified: the worker against a real database (its decisions are the pure functions above, run day by day in the tests; the DB wiring around them was only type-checked), the UI in a browser, the DDL on MariaDB.

## Deviations from Plan

**1. Scope change from the owner: per contract instead of per payment**
- Found during: web work, by coordinator message.
- Planned: agreement columns on payments, per amount, POST /payments/:id/agreement.
- Actual: mute on leases, POST/DELETE /leases/:id/reminder-mute, quick choices next rent / next week / pick a date, control on overdue items and the contract page. The per-payment code was reworked, not kept alongside (commit f9014ee).
- Cost if wrong: if a per-amount pause is still wanted, the model would need a second scope; the pure decision functions are easy to extend.

**2. [Rule 2] Several muted months come back as one reminder**
- Found during: rework. With a contract-wide mute several open months can end at once; sending one restarted reminder per month on the same evening would break the "one message" rule. The oldest muted row leads, the others ride along and are stamped with it.
- Cost if wrong: a tenant with several open months gets one combined reminder instead of one per month after a mute.

**3. Due-date message skipped while muted**
- The owner's list names tenant late-payment reminders and landlord late/final_pending notices. The due-date SMS is also skipped while the contract is muted (a mute should be quiet). The landlord due-today heads-up still goes out.
- Cost if wrong: a tenant whose rent falls inside the mute gets no due-day nudge; easy to re-enable in sendDueDateTenantSms.

## Assumption Drift (advisory)

- Found during: rework. Planned: "When the payment gets paid, the agreement ends automatically." Actual: per contract, a mute is not ended by a payment; paid rows simply drop out, and a contract that owes nothing gets no reminder anyway. The mute status block still shows until the end date. Cost if wrong: the landlord may see "Herinneringen gedempt" on a contract that is already even; harmless, and Niet meer dempen clears it.
- Found during: rework. An expired mute stays stored on the lease (shown nowhere) so the restart from its end date keeps applying to rows that were muted. Cost if wrong: none expected; setting a new mute replaces it.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-endpoint | apps/api/src/routes/reminderMute.ts | POST/DELETE /leases/:id/reminder-mute, manager+ on the lease's property, date and note validated, change logged with user id as an internal note |

## Self-Check: PASSED

- FOUND: apps/api/src/services/reminderMute.ts, reminderMuteStore.ts, routes/reminderMute.ts, both test files, apps/web/components/leases/ReminderMute.tsx, prod-ddl.sql
- FOUND: commits 155ecdd, b0c4083, 3fe02de, f9014ee, 4222cbc
