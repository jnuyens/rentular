-- Third reminder landlord gate (quick task 261012-kpc).
--
-- Adds the two payments columns the overdue-reminders worker reads to gate the
-- automatic third reminder behind a landlord email and a 2 day hold:
--   landlord_final_notified_at: when the landlord got the "third reminder pending" email
--   final_reminder_held_at:     when the landlord clicked "hold" (never auto-send)
--
-- Apply manually on the prod MariaDB BEFORE deploying the API change, otherwise
-- the overdue-reminders job fails on an unknown column. Idempotent: safe to rerun.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS landlord_final_notified_at TIMESTAMP NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_reminder_held_at TIMESTAMP NULL;
