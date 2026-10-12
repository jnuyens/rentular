-- Older contracts: deposit and earlier payments presumed paid (quick task 261012-mko).
--
-- Adds the leases column the expected-payments generator reads when it creates
-- the auto-generated deposit row:
--   prior_payments_settled: 1 when the landlord confirmed (default) that the
--   deposit and the rent up to the moment the contract was added to Rentular
--   were already paid. For a contract whose start date lies before the day it
--   was added, the deposit row is then created as paid instead of pending.
--
-- Apply manually on the prod MariaDB BEFORE deploying the API change, otherwise
-- every lease query fails on an unknown column. Idempotent: safe to rerun.

ALTER TABLE leases ADD COLUMN IF NOT EXISTS prior_payments_settled TINYINT(1) NOT NULL DEFAULT 1;
