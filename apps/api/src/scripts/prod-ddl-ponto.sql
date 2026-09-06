-- Ponto production-readiness schema additions (Task 5).
-- Apply to the `rentular` MariaDB after `mysqldump rentular` backup.
-- Idempotent: drizzle-kit push is broken on this MariaDB, so we ship hand-written DDL.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS landlord_type ENUM('individual','company') NULL,
  ADD COLUMN IF NOT EXISTS vat_number VARCHAR(32) NULL;

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS ponto_model ENUM('ppm','cpm') NULL;
