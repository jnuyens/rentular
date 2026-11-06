-- prod-fix-timestamps.sql
--
-- One-time correction of TIMESTAMP values that the app wrote while every pooled
-- session ran in the server's SYSTEM time zone (Europe/Brussels).
--
-- RUN EXACTLY ONCE, with the app STOPPED (api + web, so no new writes land
-- between the old code stopping and the new code starting), after a backup:
--
--   mysql --default-character-set=utf8mb4 rentular < prod-fix-timestamps.sql
--
-- Do NOT pass --force: the marker INSERT below fails with a duplicate key on a
-- second run and the client must abort there (the open transaction is rolled
-- back when the client disconnects).
--
-- ---------------------------------------------------------------------------
-- Why the correction is "stored instant + Brussels offset at that instant"
-- ---------------------------------------------------------------------------
-- Drizzle writes a TIMESTAMP as the UTC wall clock W of the real instant T
-- ("2026-11-05 18:15:00" for T = 18:15Z). The SYSTEM session read W as Brussels
-- local time, so the server stored the instant X = W - offset(Brussels at X).
-- The real instant is therefore T = W = X + offset(Brussels at X).
--
-- Under SET time_zone = '+00:00' a SELECT returns X itself, and the fix is
--   col = col + INTERVAL offset(X) HOUR,   offset = 2 in CEST, 1 in CET.
-- That is the same as CONVERT_TZ(col, '+00:00', 'Europe/Brussels') read as UTC
-- (NOT CONVERT_TZ(col, 'Europe/Brussels', '+00:00'), which shifts the wrong way).
-- The offset is computed from the EU rule (CEST from the last Sunday of March
-- 01:00 UTC until the last Sunday of October 01:00 UTC) using a small helper
-- table, so the script does not depend on the mysql.time_zone* tables being
-- loaded. When they are loaded, pre-check (b2) compares both methods. Tested on
-- a local MariaDB 11 (TZ=Europe/Brussels): a half-hourly sweep of 2020-01-01 to
-- 2037-12-31 gave 0 differences between this rule and
-- CONVERT_TZ(x, '+00:00', 'Europe/Brussels').
--
-- Proof with the 2026-11-05 send that really happened at 19:15 Brussels
-- (= 18:15 UTC, CET, offset 1 h):
--
--   payment_reminders.sent_at (app-written, class B, corrected here)
--     before, read under SYSTEM : 2026-11-05 18:15:00
--     before, read under +00:00 : 2026-11-05 17:15:00   (X)
--     after,  read under +00:00 : 2026-11-05 18:15:00   (X + 1 h = T)
--     after,  read under SYSTEM : 2026-11-05 19:15:00
--
--   communications.created_at (DEFAULT current_timestamp, class A, untouched)
--     before and after, read under SYSTEM : 2026-11-05 19:15:00
--     before and after, read under +00:00 : 2026-11-05 18:15:00
--
-- After the fix both rows read 2026-11-05 18:15:00 under the UTC session the
-- app now uses, drizzle returns 2026-11-05T18:15:00.000Z, and the UI shows
-- 05/11/2026 19:15 (Europe/Brussels).
--
-- Known limit: an app write whose UTC wall clock fell inside the local DST
-- transition hour (02:00 to 03:00 UTC on the last Sunday of March or October)
-- was ambiguous or nonexistent as Brussels local time; such values may stay off
-- by 1 hour. Check (e) lists them.
--
-- Columns that are NOT touched: class A (only ever written by a DB default,
-- already correct) and class C bookkeeping columns written by both the default
-- and the app (created_at / updated_at on payments, leases, properties, tenants,
-- tenant_bank_accounts, bank_connections.updated_at, import_sessions.updated_at,
-- smtp_settings.updated_at). For those a row cannot be attributed to one writer,
-- so they are left as they are and may be up to 2 h early on app-written rows.
-- See the SUMMARY for the full classification.
--
-- Every UPDATE assigns ALL timestamp columns of its table (unchanged ones as
-- col = col) so an implicit ON UPDATE CURRENT_TIMESTAMP (possible on the first
-- TIMESTAMP column when explicit_defaults_for_timestamp is OFF) cannot fire.

SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- Pre-checks (read only). Save the output.
-- ---------------------------------------------------------------------------

-- (a) Session must be UTC.
SELECT @@session.time_zone AS session_tz, @@global.time_zone AS global_tz, @@system_time_zone AS system_tz;

-- (b) Time zone tables loaded? NULL means not loaded (the script does not need them).
SELECT CONVERT_TZ('2026-07-01 12:00:00', 'Europe/Brussels', '+00:00') AS tz_tables_check_expect_10_00;

-- (c) The 61 TIMESTAMP columns and any ON UPDATE clauses.
SELECT table_name, column_name, column_default, extra
FROM information_schema.columns
WHERE table_schema = DATABASE() AND data_type = 'timestamp'
ORDER BY table_name, ordinal_position;

-- (b2) Runs after the helper table below exists; see "Rule vs CONVERT_TZ".

-- Before values of the reference rows (latest reminder and latest communication).
SELECT 'before' AS phase, id, payment_id, sent_at FROM payment_reminders ORDER BY sent_at DESC LIMIT 5;
SELECT 'before' AS phase, id, type, created_at, sent_at FROM communications ORDER BY created_at DESC LIMIT 5;

-- ---------------------------------------------------------------------------
-- Helper objects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS _tz_fix_marker (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL
);

-- CEST windows in UTC, one row per year. DATETIME (not TIMESTAMP) so the bounds
-- are never converted by a session time zone.
CREATE TABLE IF NOT EXISTS _tz_fix_261106_dst (
  yr SMALLINT NOT NULL PRIMARY KEY,
  start_utc DATETIME NULL,
  end_utc DATETIME NULL
);
INSERT IGNORE INTO _tz_fix_261106_dst (yr) VALUES
  (2020),(2021),(2022),(2023),(2024),(2025),(2026),(2027),(2028),(2029),
  (2030),(2031),(2032),(2033),(2034),(2035),(2036),(2037);
-- Last Sunday of the month = last day - (DAYOFWEEK(last day) - 1) days (Sunday = 1).
UPDATE _tz_fix_261106_dst SET
  start_utc = TIMESTAMP(
    LAST_DAY(CONCAT(yr, '-03-01')) - INTERVAL (DAYOFWEEK(LAST_DAY(CONCAT(yr, '-03-01'))) - 1) DAY,
    '01:00:00'),
  end_utc = TIMESTAMP(
    LAST_DAY(CONCAT(yr, '-10-01')) - INTERVAL (DAYOFWEEK(LAST_DAY(CONCAT(yr, '-10-01'))) - 1) DAY,
    '01:00:00');

-- Expect 2026: 2026-03-29 01:00:00 .. 2026-10-25 01:00:00
SELECT * FROM _tz_fix_261106_dst WHERE yr BETWEEN 2024 AND 2027;

-- (b2) Rule vs CONVERT_TZ on the real data, before any change. Only meaningful
-- when (b) was not NULL; expect differences = 0.
SELECT COUNT(*) AS rows_checked,
       SUM(sent_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE sent_at >= d.start_utc AND sent_at < d.end_utc)) HOUR
           <> CONVERT_TZ(sent_at, '+00:00', 'Europe/Brussels')) AS differences
FROM payment_reminders;

-- ---------------------------------------------------------------------------
-- Correction (class B columns), applied once
-- ---------------------------------------------------------------------------
-- Offset expression for a column c (NULL stays NULL):
--   c + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d
--                            WHERE c >= d.start_utc AND c < d.end_utc)) HOUR

START TRANSACTION;

-- Fails with ERROR 1062 (duplicate entry) if the fix was already applied.
INSERT INTO _tz_fix_marker (id, applied_at) VALUES ('261106-tzs', UTC_TIMESTAMP());

UPDATE api_tokens SET
  expires_at   = expires_at   + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE expires_at   >= d.start_utc AND expires_at   < d.end_utc)) HOUR,
  last_used_at = last_used_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE last_used_at >= d.start_utc AND last_used_at < d.end_utc)) HOUR,
  revoked_at   = revoked_at   + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE revoked_at   >= d.start_utc AND revoked_at   < d.end_utc)) HOUR,
  created_at   = created_at;

UPDATE bank_connections SET
  consent_expires_at = consent_expires_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE consent_expires_at >= d.start_utc AND consent_expires_at < d.end_utc)) HOUR,
  last_sync_at       = last_sync_at       + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE last_sync_at       >= d.start_utc AND last_sync_at       < d.end_utc)) HOUR,
  created_at = created_at,
  updated_at = updated_at;

UPDATE bank_statements SET
  matched_at  = matched_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE matched_at >= d.start_utc AND matched_at < d.end_utc)) HOUR,
  imported_at = imported_at
WHERE matched_at IS NOT NULL;

UPDATE communications SET
  sent_at    = sent_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE sent_at >= d.start_utc AND sent_at < d.end_utc)) HOUR,
  queued_at  = queued_at,
  created_at = created_at
WHERE sent_at IS NOT NULL;

UPDATE health_index_values SET
  fetched_at = fetched_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE fetched_at >= d.start_utc AND fetched_at < d.end_utc)) HOUR;

UPDATE indexation_records SET
  notification_sent_at = notification_sent_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE notification_sent_at >= d.start_utc AND notification_sent_at < d.end_utc)) HOUR,
  created_at = created_at
WHERE notification_sent_at IS NOT NULL;

UPDATE payments SET
  landlord_notified_at       = landlord_notified_at       + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE landlord_notified_at       >= d.start_utc AND landlord_notified_at       < d.end_utc)) HOUR,
  landlord_due_notified_at   = landlord_due_notified_at   + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE landlord_due_notified_at   >= d.start_utc AND landlord_due_notified_at   < d.end_utc)) HOUR,
  landlord_final_notified_at = landlord_final_notified_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE landlord_final_notified_at >= d.start_utc AND landlord_final_notified_at < d.end_utc)) HOUR,
  final_reminder_held_at     = final_reminder_held_at     + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE final_reminder_held_at     >= d.start_utc AND final_reminder_held_at     < d.end_utc)) HOUR,
  created_at = created_at,
  updated_at = updated_at
WHERE landlord_notified_at IS NOT NULL
   OR landlord_due_notified_at IS NOT NULL
   OR landlord_final_notified_at IS NOT NULL
   OR final_reminder_held_at IS NOT NULL;

UPDATE payment_reminders SET
  sent_at = sent_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE sent_at >= d.start_utc AND sent_at < d.end_utc)) HOUR;

UPDATE smtp_settings SET
  last_verified_at = last_verified_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE last_verified_at >= d.start_utc AND last_verified_at < d.end_utc)) HOUR,
  created_at = created_at,
  updated_at = updated_at
WHERE last_verified_at IS NOT NULL;

UPDATE webhook_events SET
  received_at  = received_at  + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE received_at  >= d.start_utc AND received_at  < d.end_utc)) HOUR,
  processed_at = processed_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE processed_at >= d.start_utc AND processed_at < d.end_utc)) HOUR;

UPDATE property_managers SET
  invited_at            = invited_at            + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE invited_at            >= d.start_utc AND invited_at            < d.end_utc)) HOUR,
  accepted_at           = accepted_at           + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE accepted_at           >= d.start_utc AND accepted_at           < d.end_utc)) HOUR,
  invitation_expires_at = invitation_expires_at + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE invitation_expires_at >= d.start_utc AND invitation_expires_at < d.end_utc)) HOUR,
  created_at = created_at;

UPDATE users SET
  email_verified = email_verified + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE email_verified >= d.start_utc AND email_verified < d.end_utc)) HOUR,
  created_at = created_at,
  updated_at = updated_at
WHERE email_verified IS NOT NULL;

UPDATE password_reset_tokens SET
  expires    = expires + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE expires >= d.start_utc AND expires < d.end_utc)) HOUR,
  created_at = created_at;

UPDATE sessions SET
  expires = expires + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE expires >= d.start_utc AND expires < d.end_utc)) HOUR;

UPDATE verification_tokens SET
  expires = expires + INTERVAL (1 + EXISTS(SELECT 1 FROM _tz_fix_261106_dst d WHERE expires >= d.start_utc AND expires < d.end_utc)) HOUR;

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-checks (read only)
-- ---------------------------------------------------------------------------

SELECT * FROM _tz_fix_marker;

-- The reference reminder should now read 18:15 here (+00:00) for the 19:15
-- Brussels send, the same as its communications.created_at.
SELECT 'after' AS phase, id, payment_id, sent_at FROM payment_reminders ORDER BY sent_at DESC LIMIT 5;
SELECT 'after' AS phase, id, type, created_at, sent_at FROM communications ORDER BY created_at DESC LIMIT 5;

-- (d) App-written sent_at must now be at or just after the DB-default queued_at
-- of the same communication (send happens seconds after queueing). Expect 0.
SELECT COUNT(*) AS sent_before_queued
FROM communications
WHERE sent_at IS NOT NULL AND sent_at < queued_at - INTERVAL 1 MINUTE;

-- (e) Values in a DST transition hour (possibly still 1 h off).
SELECT 'payment_reminders' AS t, id, sent_at AS v FROM payment_reminders
WHERE (MONTH(sent_at) IN (3, 10)) AND DAYOFWEEK(sent_at) = 1 AND DAY(sent_at) > 24 AND HOUR(sent_at) BETWEEN 2 AND 4
UNION ALL
SELECT 'communications', id, sent_at FROM communications
WHERE (MONTH(sent_at) IN (3, 10)) AND DAYOFWEEK(sent_at) = 1 AND DAY(sent_at) > 24 AND HOUR(sent_at) BETWEEN 2 AND 4;

-- Helper table can be dropped after verification; keep _tz_fix_marker.
-- DROP TABLE _tz_fix_261106_dst;
