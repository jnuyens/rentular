---
quick_id: 261106-tzs
status: complete
completed: 2026-11-06
duration: ~16 min
commits:
  - aa559e2 fix(261106-tzs): run every database session in UTC
  - a6b0ac3 feat(261106-tzs): location-aware today and timestamp display
key-files:
  created:
    - apps/api/src/lib/__tests__/dbUtcSession.test.ts
    - apps/api/src/lib/__tests__/timestampDisplay.test.ts
    - .planning/quick/261106-tzs-timestamps-utc-and-location-aware-display/prod-fix-timestamps.sql (not committed)
  modified:
    - packages/db/src/connection.ts
    - packages/db/src/index.ts
    - apps/api/src/lib/timezone.ts
    - apps/web/lib/dateLocale.ts
    - (plus the call sites listed under "Changed places")
decisions:
  - Pool sessions run in UTC (mysql2 timezone Z plus SET time_zone = '+00:00' on each new connection)
  - Historic app-written TIMESTAMPs are corrected with stored + Brussels offset at that instant, using an EU DST rule table (no dependency on mysql.time_zone tables)
  - Mixed-writer bookkeeping columns (created_at/updated_at written by both DB default and code) are left as they are
---

# Quick Task 261106-tzs: timestamps stored as true UTC, shown in the right zone

Every pooled DB session now runs in UTC, so drizzle's UTC wall clock strings and
the server's CURRENT_TIMESTAMP defaults finally agree. A one-time SQL script
corrects historic app-written values. "Today" and day boundaries in the API and
web come from the location zone (Europe/Brussels today), and the web has one
formatter that shows a UTC instant as dd/mm/yyyy HH:mm in that zone.

## Task 1: connection fix and data correction

- `packages/db/src/connection.ts`: `buildPoolOptions()` adds `timezone: "Z"`
  (mysql2 serializes JS Date params and parses raw Date results as UTC), and
  `applyUtcSession()` runs `SET time_zone = '+00:00'` on the pool's
  `connection` event. mysql2 emits that event synchronously after the
  handshake and before the connection reaches its first caller
  (lib/base/pool.js), so the SET is queued ahead of any app query.
- Drizzle 0.36.4 (`mysql-core/columns/timestamp.js`): writes
  `toISOString().slice(0, -1).replace("T", " ")`, reads `new Date(value + "+0000")`;
  the mysql2 session forces TIMESTAMP/DATETIME/DATE to strings via `typeCast`.
  So the session zone was the only missing piece.
- End-to-end check against a throwaway local MariaDB 11 container with
  TZ=Europe/Brussels (SYSTEM = CET, like prod) and Node TZ=Europe/Berlin:
  a drizzle write of 18:15Z stored UNIX_TIMESTAMP 1793902500 (= 18:15Z exactly),
  a DEFAULT current_timestamp row read back as the real current instant, the
  session reported `+00:00`, and a raw `sql` Date comparison matched.

### Column classification (all 61 TIMESTAMP columns)

A = only a DB default writes it (already correct, untouched).
B = only the app writes it (stored 1 h / 2 h early, corrected by the script).
C = DB default on insert plus app writes (insert or update); left as they are.

| Table | Column | Class | Writers (evidence) |
|---|---|---|---|
| api_tool_calls | created_at | A | apiTokenGuards insert has no createdAt |
| api_tokens | expires_at | B | lib/apiTokens create (now + days) |
| api_tokens | last_used_at | B | lib/apiTokens touch `new Date()` |
| api_tokens | revoked_at | B | lib/apiTokens revoke `new Date()` |
| api_tokens | created_at | A | insert omits createdAt |
| bank_connections | consent_expires_at | B | bankConnections route, paymentCheckWorker renewal |
| bank_connections | last_sync_at | B | bankConnectionSync `new Date()` |
| bank_connections | created_at | A | insert omits createdAt |
| bank_connections | updated_at | C | default on insert, code on updates (bankConnections, bankConnectionSync, paymentCheckWorker) |
| bank_accounts | created_at | A | |
| bank_accounts | updated_at | A | no code writes |
| bank_statements | imported_at | A | importer row omits it |
| bank_statements | matched_at | B | bankTransactions, reconciliationAssign, bankConnectionSync |
| costs | created_at | A | |
| costs | updated_at | A | no code writes |
| rent_free_periods | created_at | A | |
| rent_deductions | created_at | A | |
| import_sessions | created_at | A | |
| import_sessions | updated_at | C | import routes and import workers set it on update |
| leases | created_at | C | Smovin import inserts it; other inserts default |
| leases | updated_at | C | gocardless, webhooks, landlordActions, indexation updates |
| communications | queued_at | A | |
| communications | sent_at | B | email/sms workers, communicationLog, indexationAlerts |
| communications | created_at | A | |
| payment_allocations | created_at | A | |
| payment_allocations | updated_at | A | no code writes |
| health_index_values | fetched_at | B | healthIndex.ts is the only insert and sets it |
| indexation_records | notification_sent_at | B | indexation route |
| indexation_records | created_at | A | |
| properties | created_at | C | Smovin import inserts it |
| properties | updated_at | C | Smovin import inserts it |
| payments | landlord_notified_at | B | paymentCheckWorker |
| payments | landlord_due_notified_at | B | paymentCheckWorker |
| payments | landlord_final_notified_at | B | paymentCheckWorker |
| payments | final_reminder_held_at | B | landlordActions |
| payments | created_at | C | webhooks, payments routes, reconciliationAssign, import set it; expectedPayments, ledger, remainderRows, manualReminder default |
| payments | updated_at | C | many update paths set it; default on insert |
| payment_reminders | sent_at | B | all 4 inserts set `sentAt: new Date()` |
| payment_follow_up_settings | created_at | A | |
| payment_follow_up_settings | updated_at | A | no code writes |
| smtp_settings | last_verified_at | B | settings route |
| smtp_settings | created_at | A | |
| smtp_settings | updated_at | C | settings route on update |
| maintenance_tasks | created_at | A | |
| maintenance_tasks | updated_at | A | no code writes |
| tenants | created_at | C | Smovin import inserts it |
| tenants | updated_at | C | gocardless, webhooks updates |
| tenant_bank_accounts | created_at | C | services/tenantBankAccounts sets it, routes/tenants defaults |
| webhook_events | received_at | B | the only insert sets `receivedAt: new Date()` |
| webhook_events | processed_at | B | webhooks route |
| property_managers | invited_at | B | all 4 inserts and the re-invite update set it |
| property_managers | accepted_at | B | propertyManagers, properties, importWriteWorker |
| property_managers | invitation_expires_at | B | propertyManagers invite |
| property_managers | created_at | A | |
| users | email_verified | B | NextAuth DrizzleAdapter (OAuth) / auth route sets null |
| users | created_at | A | |
| users | updated_at | A | no code writes |
| password_reset_tokens | expires | B | auth route (now + 1 h) |
| password_reset_tokens | created_at | A | |
| sessions | expires | B | NextAuth adapter only (strategy is jwt, so normally empty) |
| verification_tokens | expires | B | NextAuth adapter only (unused) |

Totals: 25 A, 24 B, 12 C = 61.

Rule for class C: a row's created_at/updated_at cannot be attributed to the
default or to the app from the row itself (both writers produce
created_at = updated_at on insert, and updates leave no trace of who wrote
them). These are bookkeeping columns, so they are left as they are and may be
up to 2 h early on app-written rows. The only logic use is
`leases.createdAt` (date part, expectedPayments backfill floor) where a 2 h
error can only matter for a lease created between 00:00 and 02:00.

### prod-fix-timestamps.sql

Path: `.planning/quick/261106-tzs-timestamps-utc-and-location-aware-display/prod-fix-timestamps.sql` (not committed).

Derivation: drizzle wrote the UTC wall clock W of the real instant T; the
SYSTEM session read W as Brussels local, so the server stored
X = W - offset(Brussels at X). Under `SET time_zone = '+00:00'` a SELECT returns
X, and T = X + offset(X), offset 2 h in CEST and 1 h in CET. This equals
`CONVERT_TZ(X, '+00:00', 'Europe/Brussels')` read as UTC (the plan correctly
warned that `CONVERT_TZ(col, 'Europe/Brussels', '+00:00')` is wrong).

- The offset comes from a helper table `_tz_fix_261106_dst` with the EU CEST
  window per year (last Sunday of March 01:00 UTC to last Sunday of October
  01:00 UTC), so the mysql.time_zone tables are not required. On the local
  MariaDB 11 a half-hourly sweep of 2020 to 2037 (330k instants) had 0
  differences against CONVERT_TZ. Pre-check (b2) repeats that comparison on
  prod's payment_reminders when the tz tables are loaded.
- Proof with the reference rows (19:15 Brussels send = 18:15 UTC, CET):
  - payment_reminders.sent_at: SYSTEM 18:15 before, +00:00 17:15 before,
    +00:00 18:15 after, SYSTEM 19:15 after.
  - communications.created_at: unchanged, SYSTEM 19:15, +00:00 18:15.
  Both read 2026-11-05 18:15 under the UTC session, the API returns
  2026-11-05T18:15:00.000Z and the UI shows 05/11/2026 19:15. Reproduced on the
  local container with the same rows.
- Exactly-once: `_tz_fix_marker` with primary key `261106-tzs`, inserted
  inside the transaction; a second run fails with ERROR 1062 and the mysql
  client aborts (verified locally; data unchanged on rerun). Do not use --force.
- Every UPDATE assigns all TIMESTAMP columns of its table (unchanged ones as
  `col = col`). Locally, with explicit_defaults_for_timestamp OFF,
  password_reset_tokens.expires got an implicit `ON UPDATE current_timestamp()`;
  the explicit assignment kept it from firing.
- Known limit: app writes whose UTC wall clock fell in 02:00 to 03:00 UTC on a
  DST switch Sunday were ambiguous/nonexistent as Brussels local time and may
  remain 1 h off. Check (e) lists candidates.

## Task 2: today, comparisons and display

New helpers:
- `apps/api/src/lib/timezone.ts`: `ymdInZone`, `todayInZone`,
  `dayOfMonthInZone`, `toUtcIso` (zone-less DB strings are UTC).
- `apps/web/lib/dateLocale.ts`: `DISPLAY_TIMEZONE`
  (NEXT_PUBLIC_APP_TIMEZONE or Europe/Brussels), `formatDateTime`,
  `ymdInZone`, `todayInZone`, `monthInZone`, `addDaysYmd`, `monthEndYmd`;
  `formatDate` now shows an instant's date in the zone and keeps calendar dates
  (yyyy-mm-dd, or UTC midnight) unshifted.

### Changed places

API (UTC date -> zone date):
- jobs/paymentCheckWorker.ts: worker `today` (one line, plus import)
- jobs/landlordReportWorker.ts: report day, report date and month start from the schedule zone (was Node-local day plus UTC date)
- routes/webhooks.ts: paid date, GoCardless due date, mandate flag note date
- routes/gocardless.ts: mandate cancelled note date
- routes/landlordActions.ts: "mark paid" paidDate
- routes/rentAdjustments.ts: active-deduction "today"
- routes/payments.ts: overdue summary today, two default paid dates
- routes/maintenance.ts: completion date and default next due; month add uses UTC methods on calendar dates
- services/paymentStateMachine.ts: default paidDate
- services/ledger.ts: default paid date
- services/reconciliationAssign.ts: `isoToday()` body (one line, plus import)
- services/smovinMapper.ts: default lease start
- services/indexationAlerts.ts: `alertCycleDate` today string
- services/bankConnectionSync.ts: sync window start date
- services/expectedPayments.ts: `toYMD` and base year/month (was Node-local getters)

API (timestamp serialization to ISO with Z):
- lib/bankTransactionView.ts `toIsoDateTime` (returned raw strings unchanged before)
- services/leaseCommunications.ts `iso()` (parsed zone-less strings as server-local)
- lib/apiTokens.ts `toIso()`

Drizzle-selected Date values were already serialized by JSON as ISO with Z;
after the session fix they are the true instants. No raw `NOW()`, `CURDATE()`
or `DATE(col)` SQL exists in apps/api/src. `sql` templates passing a JS Date
(leaseCommunications seven-day count) are correct because mysql2 now
serializes Dates as UTC.

Web:
- leases/[id] (communication history): local Brussels formatter replaced by `formatDateTime`
- communications page: both created-at displays use `formatDateTime` (was browser locale and zone)
- bank-connections list and detail: last sync as `formatDateTime`, created date via `formatDate`
- mandates page and BankTransactionsTable: `fmtDate` delegates to `formatDate` (booking dates stay calendar dates)
- ApiTokensCard: last used as `formatDateTime`
- payments page: today, month prefix, paid window start and month end from the zone (month end was the day before: local midnight through toISOString)
- overview page: current month (4 places) from the zone
- onboarding: signing date default from the zone

Not changed (calendar arithmetic, no instant involved): communicationSchedule
day numbers, indexationCalc anniversary math, indexation route
anniversaryDate, monthReceived/shortfallMatch/transferReview `ymd` helpers
(DATE values; with mysql2 `timezone: "Z"` a raw DATE parses as UTC midnight so
the UTC slice is right). bankTransactionView `toIsoDate` likewise.

Overlap with 261106-bal: only the two one-line "today" edits in
paymentCheckWorker.ts and reconciliationAssign.ts (plus their import lines).

## Checks (observed)

- api vitest: 59 files, 519 tests passed (includes the new
  dbUtcSession.test.ts, 4 tests, and timestampDisplay.test.ts, 7 tests; the
  display tests also pass with TZ=America/Los_Angeles).
- `npx tsc --noEmit -p .` in apps/api: no errors. In apps/web: no errors.
- apps/web `pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: succeeded.
- SQL script: run twice on a local MariaDB 11 (TZ=Europe/Brussels) seeded with
  the reference rows; first run corrected them as documented, second run
  stopped at the marker with ERROR 1062.
- Not verified: anything on prod (not allowed), the real prod column
  defaults/ON UPDATE clauses (pre-check (c) prints them), whether prod has the
  tz tables (pre-check (b)).

## Deploy and SQL order (for the orchestrator)

1. Merge to main, then on m1 pull, `pnpm install --frozen-lockfile`, build the
   web app (old processes keep serving meanwhile).
2. Back up: `mysqldump --single-transaction rentular > rentular-pre-tzs-$(date +%F-%H%M).sql`.
3. Stop the app so nothing writes between old and new code: `pm2 stop` the
   rentular api (which hosts the BullMQ workers) and web.
4. Run `mysql rentular < prod-fix-timestamps.sql | tee tzs-fix.log`
   (no `--force`). Check in the log: session_tz `+00:00`; (b2) differences 0
   when (b) is not NULL; the "after" payment_reminders row for the 2026-11-05
   send reads 18:15:00; sent_before_queued 0.
5. Start api and web with the new code (`pm2 restart`).
6. Verification queries below.

Order matters: running the SQL after new code has written rows would shift
those rows too, which is why the app is stopped across steps 3 to 5.

## Verification queries (after deploy)

```sql
SET time_zone = '+00:00';
-- Applied once
SELECT * FROM _tz_fix_marker;
-- Reference rows: both 2026-11-05 18:15 (UI shows 05/11/2026 19:15)
SELECT sent_at FROM payment_reminders WHERE sent_at BETWEEN '2026-11-05 18:00' AND '2026-11-05 18:30';
SELECT created_at, queued_at, sent_at FROM communications WHERE created_at BETWEEN '2026-11-05 18:00' AND '2026-11-05 18:30';
-- New writes after restart: app-written sent_at at or after DB-default queued_at, both near now
SELECT queued_at, sent_at, TIMESTAMPDIFF(SECOND, queued_at, sent_at) AS lag_s, UTC_TIMESTAMP() AS now_utc
FROM communications ORDER BY created_at DESC LIMIT 5;
-- No sent_at earlier than its queue time anywhere
SELECT COUNT(*) FROM communications WHERE sent_at < queued_at - INTERVAL 1 MINUTE;
```

In the UI: /leases/<id> communication history and /communications show the
19:15 send as 05/11/2026 19:15.

## Deviations from Plan

None in scope. Notes:
- The plan said apps/web/lib/formatDate.ts; the existing helper lives in
  apps/web/lib/dateLocale.ts, so formatDateTime was added there.
  Cost if wrong: none (naming only).
- Web has no test runner; the web formatter is tested from the API vitest
  suite by loading apps/web/lib/dateLocale.ts by path at runtime (keeps the
  API tsc rootDir clean). Cost if wrong: the test path breaks if the file moves.

## Assumption Drift (advisory)

- Found during: Task 1. Planned: correct class B and the code-written part of
  C. Actual: C columns left untouched, because the row cannot be attributed
  to a writer. Why: both writers yield created_at = updated_at on insert.
  Cost if wrong: app-written created_at/updated_at stay up to 2 h early (display only).

## Self-Check: PASSED

- FOUND: packages/db/src/connection.ts, apps/api/src/lib/__tests__/dbUtcSession.test.ts,
  apps/api/src/lib/__tests__/timestampDisplay.test.ts, prod-fix-timestamps.sql
- FOUND commits: aa559e2, a6b0ac3
