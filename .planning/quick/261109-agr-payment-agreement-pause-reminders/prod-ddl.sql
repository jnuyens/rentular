-- Quick task 261109-agr: mute late payment reminders per contract until a date.
-- Apply on prod (database `rentular`) after a backup, BEFORE deploying the code.
-- The code reads the new leases columns on every lease query (select * from
-- leases), so deploying first would break the contract, overview and payment pages.
-- Only additive: new nullable columns, and two enums widened keeping every
-- existing value (this list already includes 'tenant_reply' from 261107-rpl,
-- so it is safe whether or not that DDL was applied before).

ALTER TABLE leases
  ADD COLUMN reminders_muted_until date NULL DEFAULT NULL,
  ADD COLUMN reminders_muted_note varchar(500) NULL DEFAULT NULL,
  ADD COLUMN reminders_muted_by varchar(255) NULL DEFAULT NULL,
  ADD COLUMN reminders_muted_at timestamp NULL DEFAULT NULL;

ALTER TABLE communications
  MODIFY channel ENUM('email','sms','letter','whatsapp','signal','internal') NOT NULL;

ALTER TABLE communications
  MODIFY type ENUM(
    'payment_reminder_friendly',
    'payment_reminder_formal',
    'payment_reminder_final',
    'indexation_notification',
    'landlord_report',
    'custom',
    'welcome',
    'lease_renewal',
    'lease_termination',
    'other',
    'indexation_alert',
    'landlord_notification',
    'due_date_sms',
    'tenant_reply',
    'internal_note'
  ) NOT NULL;

-- Check afterwards:
-- SHOW COLUMNS FROM leases LIKE 'reminders_muted%';
-- SHOW COLUMNS FROM communications WHERE Field IN ('channel','type');

-- Optional, after deploy: Carnotstraat 65 b102 (lease 2243d291-5d2a-4d4e-88bc-4361d3005362).
-- The landlord can do this from the overview instead; then it is also noted in
-- the contract history. Doing it here leaves no history note.
-- UPDATE leases
--   SET reminders_muted_until = '2026-12-04',
--       reminders_muted_note = 'Betaalt de 25 euro van november samen met de huur van december',
--       reminders_muted_at = NOW()
--   WHERE id = '2243d291-5d2a-4d4e-88bc-4361d3005362';
-- The stopgap payments.final_reminder_held_at on row 4d4c0e0e can stay: a hold
-- set before the mute is replaced by it once reminders resume on 04/12, and
-- without a mute it keeps holding the third reminder as before.
