---
quick_id: 261106-tzs
type: quick
autonomous: true
---

# Quick Task 261106-tzs: All timestamps stored and read as true UTC, shown in the right local time zone

## Facts (verified on prod 2026-11-06)

- MariaDB `@@global.time_zone = SYSTEM`, system zone CET/CEST (Europe/Brussels). Node on m1 runs Europe/Berlin (same offsets), APP_TIMEZONE=Europe/Brussels.
- All 61 time-of-day columns are `TIMESTAMP` (internally UTC, converted to/from the SESSION time zone on read/write); 20 `DATE` columns (calendar dates, no time zone, leave as they are). List: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=database() AND data_type='timestamp'`.
- packages/db/src/connection.ts creates the mysql2 pool with no `timezone` and no session time_zone. Drizzle's mysql `timestamp(mode: "date")` writes the UTC wall clock string (toISOString without Z) and reads strings back appending Z (verify in node_modules/drizzle-orm/mysql-core/columns/timestamp.js).
- Consequence today: values written by the app (e.g. `sentAt: new Date()`, `matchedAt`, `landlordNotifiedAt`, `updatedAt: new Date()`) are UTC wall strings that MariaDB interprets as Brussels local time, so they are stored 1 h (winter) / 2 h (summer) too early internally but round-trip correctly inside the app. Values written by DB defaults (`DEFAULT current_timestamp()`, e.g. communications.created_at, queued_at, payments.created_at, imported_at) are correct internally but read back by the app 1 or 2 hours too late. Raw SQL comparisons (NOW(), BETWEEN on timestamps) mix both. Example: communications.created_at 2026-11-05 19:15 (sent at 19:15 Brussels) is returned as 19:15Z and shown as 20:15; payment_reminders.sent_at for the same send reads 18:15 (app-written).

## Goal

Store every timestamp as true UTC, read it back as true UTC, and show it in the time zone that belongs to the data (resolveTimezone() in apps/api/src/lib/timezone.ts: monitored bank account's tz, else landlord's, else APP_TIMEZONE Europe/Brussels; see memory "Scheduling timezone"). DATE columns stay calendar dates.

## Task 1: Connection fix + data correction script (do not run on prod)

- Pool: force UTC sessions. In packages/db/src/connection.ts pass `timezone: "Z"` to mysql2 and make every pooled connection run `SET time_zone = '+00:00'` (pool `connection` event or an init query; verify drizzle's own date handling agrees, add a unit/integration-style test using a mocked driver if a real DB is not available). After this, DB defaults (current_timestamp) produce UTC and drizzle writes are interpreted as UTC.
- Classify every TIMESTAMP column by who writes it, from the code (grep each column's TS property name in apps/api, apps/web (NextAuth DrizzleAdapter writes sessions.expires, users.email_verified, verification_tokens.expires), packages): (A) only DB default, never set by code; (B) only set by code; (C) mixed (default on insert, code on update, e.g. updated_at). Put the table in the SUMMARY.
- Write `.planning/quick/261106-tzs-timestamps-utc-and-location-aware-display/prod-fix-timestamps.sql` that corrects historic values written by the app (classes B and the code-written part of C) so they become true UTC: under `SET time_zone='+00:00'`, `col = CONVERT_TZ(col, 'Europe/Brussels', '+00:00')` is NOT right; derive the exact correction: the stored internal value is (UTC wall clock interpreted as Brussels local), so the true UTC instant = stored instant + Brussels offset at that moment. With session +00:00, reading gives the stored instant as wall clock X; the correct value is CONVERT_TZ(X, '+00:00', 'Europe/Brussels') read as UTC wall clock... derive carefully, prove it with the concrete prod pair (payment_reminders.sent_at 2026-11-05 18:15 under SYSTEM for a send that really happened 19:15 Brussels = 18:15 UTC; communications.created_at 19:15 under SYSTEM for the same send) and write the expected before/after values for these two rows as comments. Requires the MariaDB time zone tables (check `SELECT CONVERT_TZ('2026-07-01 12:00','Europe/Brussels','+00:00')` is not NULL; if they are not loaded, implement the DST rule in SQL with explicit last-Sunday-of-March/October boundaries instead, and say so).
- For class C columns (updated_at etc.) where a row may come from either source, decide per column with evidence (e.g. compare updated_at with created_at on rows never updated, or note that the code always sets updatedAt on update and the default only on insert, so rows with updated_at = created_at are default-written). Document the rule used per column. Columns that are pure bookkeeping (updated_at) may be left as they are if exactness cannot be established, but say so explicitly.
- The script must be idempotent-safe: a marker table or comment instructions so it is applied exactly once, plus SELECT checks before/after. The orchestrator runs it on prod right after deploying the connection fix, after a backup.

## Task 2: Display and comparisons in the right zone

- API: always return timestamps as ISO 8601 with Z (true UTC). Audit raw SQL (sql`...` templates, NOW(), CURDATE(), DATE(col)) and JS date maths that assumed the old behaviour (e.g. "today" computed with new Date().toISOString().slice(0,10) in UTC near midnight, the 19:15 worker, isoToday() helpers, dashboard todayStr, receivedForMonth attribution windows, reminder schedule projections, communications history), and make "today" and day boundaries come from the location's zone via the timezone helpers (Intl, no new heavy deps). List every changed place in the SUMMARY.
- Web: one shared formatter (e.g. apps/web/lib/formatDate.ts already has formatDate dd/mm/yyyy; add formatDateTime) that renders a UTC instant in the relevant zone (the landlord's, or the bank account's for bank data; default Europe/Brussels) as dd/mm/yyyy HH:mm, and use it everywhere times of day are shown (communications history page /leases/[id], communications page, bank transactions, reconciliation, indexation records, API tokens last used, etc.). Dates without time (due dates) stay DATE strings, never shifted.
- Tests: the two prod rows above display as 05/11/2026 19:15 after the fix; a DST case (summer timestamp shows +2 h, winter +1 h); "today" at 23:30 Brussels on the last day of a month is that month, not the next.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed).
- A parallel quick task (261106-bal) edits apps/api/src/services/reconciliationAssign.ts, paymentPicker.ts, ibanMatcher.ts, amountMatcher.ts, transferReview.ts, remainderRows.ts, monthReceived.ts/monthTotals.ts balance logic and paymentCheckWorker.ts reminder decisions. Avoid editing those files except for strictly time-related lines; keep such edits minimal to ease the merge.
- No em-dashes or en-dashes; no Co-Authored-By. Never deploy, never touch prod, never run db:generate.
