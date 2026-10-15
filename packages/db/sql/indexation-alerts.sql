-- Indexation due alerts: WhatsApp number and opt-out per user, per-lease dedup,
-- and the communications enum values used to log WhatsApp alerts.
-- Apply to the `rentular` MariaDB after a `mysqldump rentular` backup.
-- Idempotent: safe to run more than once. Hand-written because the drizzle-kit
-- 0000 baseline is stale and `db:generate` would replay unrelated changes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  ADD COLUMN IF NOT EXISTS indexation_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS indexation_alert_sent_for DATE NULL;

-- MODIFY with a superset of the existing values keeps current rows intact and
-- can be re-run without effect.
ALTER TABLE communications
  MODIFY COLUMN channel ENUM('email','sms','letter','whatsapp')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN type ENUM(
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
    'indexation_alert'
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
