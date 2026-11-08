-- Quick task 261107-rpl: reply address per contract, tenant replies in the contract history.
-- Apply on prod (database `rentular`) after a backup, BEFORE deploying the code.
-- The code selects the new `direction` column on every communications read, so
-- deploying first would break the history page and the communications list.
-- Only additive: the type enum keeps every existing value, existing rows get direction 'outbound'.

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
    'tenant_reply'
  ) NOT NULL;

ALTER TABLE communications
  ADD COLUMN direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound' AFTER type;

CREATE TABLE IF NOT EXISTS lease_reply_tokens (
  id varchar(36) NOT NULL,
  lease_id varchar(36) NOT NULL,
  token varchar(40) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamp NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY lease_reply_tokens_token_unique (token),
  KEY lease_reply_tokens_lease_idx (lease_id),
  CONSTRAINT lease_reply_tokens_lease_id_leases_id_fk FOREIGN KEY (lease_id) REFERENCES leases (id)
);
-- If the foreign key is rejected (errno 150, charset or collation of leases.id
-- differs), run the CREATE TABLE again without the CONSTRAINT line. The code
-- does not depend on it.

-- Check afterwards:
-- SHOW COLUMNS FROM communications WHERE Field IN ('type','direction');
-- SHOW CREATE TABLE lease_reply_tokens;
