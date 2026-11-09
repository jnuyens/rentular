-- Quick task 261109-ebk: Enable Banking provider (own application), provider
-- choice per plan, re-login warnings.
-- Apply on prod (database `rentular`) after a backup, BEFORE deploying the code.
-- The code reads users.plan, bank_connections.reauth_warn_stage /
-- reauth_warned_at and the enable_banking_apps table, so deploying first would
-- break the bank connections pages, the payment-check worker and the overview.
-- Only additive: no enum value is removed, no column is dropped. The
-- communications enums are untouched (warnings use landlord_notification with
-- metadata.kind = 'bank_reauth_warning').

-- 1) Subscription plan. NULL = derived (paid above 3 properties, else free).
ALTER TABLE users
  ADD COLUMN plan ENUM('free','paid') NULL DEFAULT NULL AFTER vat_number;

-- 2) Re-login warning bookkeeping on bank connections.
ALTER TABLE bank_connections
  ADD COLUMN reauth_warn_stage TINYINT NULL DEFAULT NULL AFTER error_message,
  ADD COLUMN reauth_warned_at TIMESTAMP NULL DEFAULT NULL AFTER reauth_warn_stage;

-- 3) Make sure the provider enum has enable_banking (it should already; this
--    is a no-op then). Keeps every existing value.
ALTER TABLE bank_connections
  MODIFY provider ENUM('gocardless_bad','ponto','enable_banking') NOT NULL;

-- 4) A landlord's own Enable Banking application. The private key is stored
--    AES-256-GCM encrypted (same AUTH_SECRET-derived key as the bank tokens).
CREATE TABLE IF NOT EXISTS enable_banking_apps (
  id varchar(36) NOT NULL,
  owner_id varchar(255) NOT NULL,
  application_id varchar(64) NOT NULL,
  private_key_encrypted text NOT NULL,
  private_key_iv varchar(64) NOT NULL,
  private_key_auth_tag varchar(64) NOT NULL,
  environment ENUM('production','sandbox') NOT NULL DEFAULT 'production',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at timestamp NULL DEFAULT NULL,
  last_error text NULL,
  PRIMARY KEY (id),
  UNIQUE KEY enable_banking_apps_owner_id_unique (owner_id),
  CONSTRAINT enable_banking_apps_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES users (id)
);
-- If the foreign key is rejected (errno 150, charset or collation of users.id
-- differs), run the CREATE TABLE again without the CONSTRAINT line. The code
-- does not rely on the constraint.

-- Optional: mark known paying landlords explicitly (otherwise derived).
-- UPDATE users SET plan = 'paid' WHERE id IN ('...');
