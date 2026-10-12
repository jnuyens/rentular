---
phase: quick-261012-kpc-soften-final-reminder-wording-and-gate-f
plan: 01
subsystem: payments / reminders
tags: [reminders, i18n, landlord-email, magic-link, worker]
requires: []
provides:
  - decideFinalReminder + FINAL_REMINDER_HOLD_DAYS (apps/api/src/services/paymentFollowUp.ts)
  - final_pending landlord email kind (apps/api/src/services/landlordLateEmail.ts)
  - hold magic-link action (apps/api/src/lib/landlordActionToken.ts, apps/api/src/routes/landlordActions.ts)
  - resolveReminderChannel (apps/api/src/services/reminderChannel.ts)
  - payments.landlord_final_notified_at, payments.final_reminder_held_at
affects: [paymentCheckWorker overdue-reminders job]
tech-stack:
  added: []
  patterns: [pure decision function gating a worker step, per-kind copy table with one body renderer]
key-files:
  created:
    - .planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql
  modified:
    - packages/shared/src/constants/index.ts
    - apps/web/app/(dashboard)/settings/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
    - packages/db/src/schema/payments.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/services/__tests__/paymentFollowUp.test.ts
    - apps/api/src/lib/landlordActionToken.ts
    - apps/api/src/routes/landlordActions.ts
    - apps/api/src/services/landlordLateEmail.ts
    - apps/api/src/services/reminderChannel.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
decisions:
  - Automatic third reminder is gated behind a landlord final_pending email and a 2 calendar day hold (UTC dates, not 48h)
  - final_pending landlord email goes out regardless of the contract's landlordLateNotify toggle
  - Landlord email failure does not stamp landlord_final_notified_at, so the next evening run retries
metrics:
  completed: 2026-10-12
  tasks: 3
---

# Quick 261012-kpc: Soften third reminder wording and gate it behind the landlord

The automatic third ("final") reminder now reads as a calm third reminder in en/nl/fr/de, the SMS/WhatsApp version no longer leaves a raw `{{totalOwed}}` behind, and the worker emails the landlord first with paid / record / hold / do-nothing options and waits 2 calendar days before anything reaches the tenant.

## IMPORTANT: apply the DDL before the next API deploy

`.planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql`

This must be applied by hand on the prod MariaDB **before** the next API deploy. The overdue-reminders worker now selects `landlord_final_notified_at` and `final_reminder_held_at`. Without these columns the job fails on an unknown column. The SQL uses `ADD COLUMN IF NOT EXISTS`, so rerunning it is safe. It was not applied anywhere. No drizzle-kit generate/push was run, and nothing changed under packages/db/drizzle.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 | a4c90f9 | Softer third reminder wording: shared email + SMS defaults, web settings duplicates (identical to the shared defaults), 7 web label keys x 4 languages, DB finalSubject default, PDF closing line |
| 2 (RED) | 502fccd | Failing vitest cases for decideFinalReminder |
| 2 (GREEN) | ae86a40 | decideFinalReminder + FINAL_REMINDER_HOLD_DAYS, two schema columns, hand DDL, `hold` signed action + route handler stamping finalReminderHeldAt |
| 3 | ab3e276 | final_pending landlord email on a shared renderer, resolveReminderChannel, worker gate |

## Verification (observed)

- `pnpm --filter @rentular/api test`: 32 files, 191 tests passed (includes 7 new decideFinalReminder cases; those 7 failed before the implementation, as expected)
- `pnpm --filter @rentular/api lint` (tsc --noEmit): exit 0
- `pnpm --filter @rentular/web lint` (tsc --noEmit): exit 0
- Old-wording grep (final notice / laatste aanmaning / dernier avis / mise en demeure / letzte mahnung / legal-step phrases) over the shared constants, settings page, four message files and payments schema: no matches
- The DEFAULT_SMS_TEMPLATES block contains no `{{totalOwed}}`
- All four common.json files parse
- No added line in the diff since b5136ba contains an em-dash or en-dash
- Late/due landlord emails are byte-identical before and after the refactor: I captured subject+body for en/nl/fr/de/unknown locale x (default, late, due) with a throwaway vitest harness (mocked sendEmail and token signer) before and after the change, and all 15 compared outputs matched. The harness file was deleted and not committed.

Not verified: no end-to-end run of the worker against a database or a real send. Per instructions, nothing was deployed and prod was not touched.

## Behaviour notes

- Worker, level "final": `notify_landlord` sends the final_pending email to managers (owner in CC), stamps landlord_final_notified_at on success, and skips the tenant that run. `wait` and `held` log and skip. `send` falls through to the existing send block, which inserts the paymentReminders row as before.
- No landlord recipient: logs `[PaymentCheck] no landlord recipient for final_pending on <id>` and skips the tenant. The plan specifies this. Note that such a payment never reaches the third reminder automatically.
- `sendOn` = the worker's `today` (UTC date) + 2 days. The email names the channel from resolveReminderChannel (email / SMS / WhatsApp, or E-Mail in de).
- The manual reminder paths (manualReminder.ts, landlord "remind" action) are unchanged and not gated.

## Deviations from Plan

None in behaviour. Small implementation choices:
- In landlordLateEmail.ts, options carry a link *target* (`paid`/`wait`/`remind`/`off`/`hold`/`record`) that is resolved to a URL at send time, instead of a pre-built link string. This keeps token signing limited to the actions the kind offers, as the plan asks.
- The nl/fr/de `chargeInterestDescription` and `finalNoticeDescription` translations were written to match the plan's English (the plan only gave "and equivalents"). The message files are unaccented, so the fr/de strings are unaccented too.
- `.planning/HANDOFF.json` shows as modified in the worktree. This task did not touch it, and it was not staged.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: payments-final-reminder-gate.sql
- FOUND commits: a4c90f9, 502fccd, ae86a40, ab3e276
