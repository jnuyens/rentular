---
phase: quick-261015-e1u
plan: 01
subsystem: indexation, notifications, settings, auth
tags: [indexation, whatsapp, email, bullmq, i18n, deep-link]
requires: [WhatsApp bridge (lib/whatsapp.ts), BullMQ/Redis, health index cache]
provides: [daily indexation due digest, users.whatsapp_number, users.indexation_alerts_enabled, leases.indexation_alert_sent_for, /indexation?lease=<id> deep link, login callbackUrl]
affects: [routes/indexation.ts (calc moved to service), Settings > Profile, login redirect]
tech-stack:
  added: []
  patterns: [pure decision functions + thin DB orchestrator, per-lease dedup column, schedule tz via getScheduleTimezone]
key-files:
  created:
    - packages/db/sql/indexation-alerts.sql
    - apps/api/src/services/indexationCalc.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/jobs/indexationAlertWorker.ts
    - apps/api/src/services/__tests__/indexationCalc.test.ts
    - apps/api/src/services/__tests__/indexationAlerts.test.ts
  modified:
    - packages/db/src/schema/users.ts
    - packages/db/src/schema/leases.ts
    - packages/db/src/schema/communications.ts
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/lib/sms.ts
    - apps/api/src/lib/__tests__/sms.test.ts
    - apps/api/src/routes/settings.ts
    - apps/api/src/routes/__tests__/settings.test.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/index.ts
    - apps/web/app/(dashboard)/settings/page.tsx
    - apps/web/app/(dashboard)/indexation/page.tsx
    - apps/web/app/(auth)/login/page.tsx
    - apps/web/middleware.ts
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - Dedup compares indexationAlertSentFor >= applicableFrom (string compare on YYYY-MM-DD), so a lease is alerted once per applicableFrom and again next year
  - Digest text is identical for WhatsApp and email; sendWhatsApp appends WHATSAPP_SIGNATURE
  - Login callbackUrl only honours relative paths; "//" and "/\" are rejected
metrics:
  completed: 2026-10-15
  tasks: 3
  commits: 3
---

# Quick 261015-e1u: Indexation due WhatsApp alerts Summary

Daily 09:00 digest (schedule timezone) that tells each property owner and accepted manager/co-owner, once per lease per anniversary year, that an indexation can now be applied, on WhatsApp when they set a number (email otherwise, nothing when they opt out), with a link per lease to `/indexation?lease=<id>` that highlights the lease and survives the login redirect.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 144fb0f | Schema, DDL file, toE164, PUT/GET /settings/profile, Settings > Profile card, i18n |
| 2 | 9b61740 | indexationCalc service (moved), indexationAlerts service, 09:00 worker, tests |
| 3 | 1b23dca | Indexation page deep link + highlight, middleware callbackUrl keeps query, login honours callbackUrl |

## SQL file (not executed anywhere)

`packages/db/sql/indexation-alerts.sql`: idempotent `ADD COLUMN IF NOT EXISTS` for `users.whatsapp_number`, `users.indexation_alerts_enabled`, `leases.indexation_alert_sent_for`, and `MODIFY COLUMN` superset enums on `communications.channel` (+ `whatsapp`) and `communications.type` (+ `indexation_alert`). Apply after a `mysqldump rentular` backup. This must be applied before deploying the new API, otherwise every `users` select that Drizzle expands (and the new worker) will fail on the unknown columns.

## Verification (observed)

- `pnpm --filter @rentular/api test`: 36 test files passed, 246 tests passed (includes new indexationCalc.test.ts with 3 tests and indexationAlerts.test.ts with 14 tests, toE164 tests in sms.test.ts, i18n completeness).
- `pnpm --filter @rentular/api lint` (tsc --noEmit): clean, exit 0.
- `DB_PASSWORD=placeholder AUTH_SECRET=placeholder pnpm --filter @rentular/web lint` (tsc --noEmit): clean, exit 0.
- `DB_PASSWORD=placeholder AUTH_SECRET=placeholder pnpm --filter @rentular/web build`: exit 0; /indexation and /login build as dynamic routes, no Suspense complaint. One "Failed to copy traced files" warning for the marketing page standalone output, unrelated to this change.
- Plan greps: `computeIndexationCore` in routes/indexation.ts is import + 3 call sites only; `0 9 * * *` in indexationAlertWorker.ts; `setupIndexationAlertSchedule` in index.ts; `pathname + req.nextUrl.search` in middleware.ts; 5 `lease-${` ids in the indexation page.
- No em or en dashes in any added line (scripted check over each task diff and new files; the digest test also asserts this for all 4 languages).
- Not verified: anything live. No browser check of the Settings card, highlight styling or login round trip; no real WhatsApp send; no DB run of runIndexationAlerts (it has no unit test by design, only the pure functions do). No deploy, no m1 access, no database touched.

## Example digest (WhatsApp body, 2 leases)

WhatsApp gets this body plus WHATSAPP_SIGNATURE appended by sendWhatsApp; email uses the same body with the subject line.

English (subject: "Rent indexation due for 2 leases"):

```
Hello Jasper,

The rent indexation can now be applied for 2 leases:

Residentie Zuid, Kerkstraat 12, 2000 Antwerpen
Current rent: EUR 850.00
New rent: EUR 872.40
https://www.rentular.com/indexation?lease=3f2a9c1e

Studio Centrum, Veldstraat 3, 9000 Gent
Current rent: EUR 640.00
New rent: EUR 657.35
https://www.rentular.com/indexation?lease=8b7d4e20

Open each link to review and apply the indexation.
```

Dutch (subject: "Huurindexering mogelijk voor 2 huurcontracten"):

```
Hallo Jasper,

Voor 2 huurcontracten mag je de huur nu indexeren:

Residentie Zuid, Kerkstraat 12, 2000 Antwerpen
Huidige huur: EUR 850.00
Nieuwe huur: EUR 872.40
https://www.rentular.com/indexation?lease=3f2a9c1e

Studio Centrum, Veldstraat 3, 9000 Gent
Huidige huur: EUR 640.00
Nieuwe huur: EUR 657.35
https://www.rentular.com/indexation?lease=8b7d4e20

Open elke link om de indexering na te kijken en toe te passen.
```

(Rendered by the real `renderDigest`; the closing line was then made count-aware, so the 1-lease variant ends with "Open the link to review and apply it." / "Open de link om de indexering na te kijken en toe te passen.")

## First run after deploy (catch-up)

A lease is alerted when `canApply` is true, the index for the month before its latest anniversary is published, and no alert has been recorded for its current `applicableFrom`. That also covers days the cron missed. It also means the first 09:00 run after deploy sends an alert for every active, indexation-enabled lease whose indexation is already applicable and not yet applied, however long ago it became applicable. Each recipient still gets just one digest, and every one of those leases is then marked, so day two is quiet.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] settings.test.ts mock of lib/sms lacked toE164**
- Found during: Task 1. settings.ts now imports `toE164`; the existing `vi.mock("../../lib/sms")` would not export it. Added `toE164: vi.fn((p) => p)` to the mock. Commit 144fb0f.

**2. [Rule 1 - Bug] propertyManagers.userId is nullable**
- Found during: Task 2 typecheck. Pending invites can have no linked user; those rows are now skipped when building recipients. Commit 9b61740.

**3. [Rule 2 - Security] Open redirect via "/\"**
- Found during: Task 3. Browsers treat `/\evil.com` like `//evil.com`, so the login callbackUrl check also rejects a leading `/\`. Commit 1b23dca.

**4. Moved code had an en dash in a comment**
- The Flanders EPC helper comment for the freeze period used an en dash between the two dates; it was rewritten to "Oct 1, 2022 to Sep 30, 2023" in the new service file. The "(preserved exactly from stub)" note in that section header was dropped. Logic is unchanged.

**5. Small additions beyond the plan text**
- `renderDigest` takes an optional 4th `recipientName` for the greeting ("Hello Jasper,"); the plan's 3-arg signature still works.
- The Save button in ProfileTab moved from inside the landlord type card to below both cards, so one button clearly saves the whole tab.
- Worktree had no node_modules; ran `pnpm install --frozen-lockfile --offline` (lockfile only, no new packages, lockfile unchanged).

## Uncertainties

- `summary.failed` counts a WhatsApp failure even when the email fallback then succeeds. It's only used in the log line.
- If the WhatsApp bridge is not configured on the server, users who set a number get email. That is per plan, but they may not expect it.
- `PUT /settings/profile` returns `indexationAlertsEnabled: true` when the field is omitted (onboarding call), not the stored value. The Settings UI always sends the field, so it is not affected.
- WhatsApp communications rows use the recipient's user id as `ownerId` (per plan). A property owner's Communications page will not show the alerts their managers received.
- Highlight classes use `bg-[hsl(var(--primary))]/10`; I expect Tailwind 3.4 to emit the alpha variant for that arbitrary hsl value, but I did not check it visually.
- `applicableFrom` and `canApply` keep the existing UTC date maths from the route. At 09:00 Brussels time that is the same calendar day, so no change in practice.
- The DDL assumes `utf8mb4_unicode_ci` for the new varchar/enum columns, matching the plan. If prod tables use a different default collation it still works, but the column collation will differ from the table default.
- Nothing has been seen live yet: the Settings card, the highlight, the login round trip with OAuth and a real WhatsApp delivery are all still to check in prod.

## Threat model check

T-e1u-01 to T-e1u-05 mitigations are in place: zod + toE164 with 400 invalid_phone, only the caller's own user row is updated; recipients are the owner plus accepted manager+ members (unit tested); relative-only callbackUrl; one digest per person per run plus a per-lease dedup column and a per-user opt-out; every WhatsApp send (sent or failed) logged to communications, email logged by queueEmail.

## Self-Check: PASSED

- Files exist: packages/db/sql/indexation-alerts.sql, apps/api/src/services/indexationCalc.ts, apps/api/src/services/indexationAlerts.ts, apps/api/src/jobs/indexationAlertWorker.ts, both new test files.
- Commits exist on branch worktree-agent-a6d57dd5f35bc7ce9: 144fb0f, 9b61740, 1b23dca.
