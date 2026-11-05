-- Quick task 261105-com: per-contract communication history.
-- Apply on prod (database `rentular`) after a backup, BEFORE deploying the code.
-- Only widens enums: every existing value is kept, so existing rows are untouched.

ALTER TABLE communications
  MODIFY channel ENUM('email','sms','letter','whatsapp','signal') NOT NULL;

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
    'due_date_sms'
  ) NOT NULL;

ALTER TABLE payment_reminders
  MODIFY channel ENUM('email','sms','whatsapp','letter','signal') NOT NULL;

-- Check afterwards:
-- SHOW COLUMNS FROM communications WHERE Field IN ('channel','type');
-- SHOW COLUMNS FROM payment_reminders WHERE Field = 'channel';
