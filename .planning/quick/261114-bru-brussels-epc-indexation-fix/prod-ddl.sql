-- 261114-bru: Brussels EPB correction factor and lease registration.
-- Additive only. Run BEFORE deploying the code that reads these columns.
-- Prod is MariaDB (host DB `rentular`), which supports ADD COLUMN IF NOT EXISTS.

ALTER TABLE `leases`
  ADD COLUMN IF NOT EXISTS `lease_registered` boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS `brussels_epc_factor` decimal(12,9) NULL,
  ADD COLUMN IF NOT EXISTS `brussels_epc_factor_label` varchar(4) NULL,
  ADD COLUMN IF NOT EXISTS `brussels_epc_factor_set_at` date NULL;
