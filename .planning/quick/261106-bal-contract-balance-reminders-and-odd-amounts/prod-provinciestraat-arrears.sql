-- Provinciestraat 199, Antwerpen (I. Ceulemans, rent 1090.00)
--
-- Marks the extra 1090.00 she paid on top of the rent in June to August 2026
-- as repayment of a month she missed before Rentular tracked her contract.
-- Without the mark the new contract balance would show it as 1090.00 credit
-- and keep her from being reminded for a month she really owes.
--
-- Representation (no schema change): one line in payments.notes
--   [arrears repayment: 410.00]
-- read by apps/api/src/services/contractBalance.ts (arrearsAmount). The same
-- mark can be set or removed in the app on the contract page.
--
-- Spread: 410.00 + 410.00 + 210.00 + 60.00 = 1090.00 on the rows
--   1500.00 (2026-06-28), 1500.00 (2026-07-29), 1300.00 (2026-08-04), 60.00 (2026-08-11)
--
-- Run after a backup. Idempotent: a row that already carries a mark is left alone.

-- ---------------------------------------------------------------------------
-- 1. Find the lease (expect exactly one row)
-- ---------------------------------------------------------------------------
SELECT l.id AS lease_id, l.status, l.monthly_rent, l.monthly_charges, l.payment_day, l.start_date,
       p.name, p.street, p.street_number, p.city,
       GROUP_CONCAT(CONCAT(t.first_name, ' ', t.last_name) SEPARATOR ', ') AS tenants
FROM leases l
JOIN properties p ON p.id = l.property_id
LEFT JOIN lease_tenants lt ON lt.lease_id = l.id
LEFT JOIN tenants t ON t.id = lt.tenant_id
WHERE p.street LIKE 'Provinciestraat%' AND p.street_number LIKE '199%' AND p.city LIKE 'Antwerp%'
  AND l.status = 'active'
GROUP BY l.id;

SET @lease_id := (
  SELECT l.id FROM leases l JOIN properties p ON p.id = l.property_id
  WHERE p.street LIKE 'Provinciestraat%' AND p.street_number LIKE '199%' AND p.city LIKE 'Antwerp%'
    AND l.status = 'active'
  LIMIT 1
);
SELECT @lease_id AS lease_id;

-- ---------------------------------------------------------------------------
-- 2. Before: the four rows to mark (expect exactly 4, none marked yet)
-- ---------------------------------------------------------------------------
SELECT id, status, amount, due_date, paid_date, is_ignored, notes
FROM payments
WHERE lease_id = @lease_id AND status = 'paid' AND is_ignored = 0
  AND ((amount = 1500.00 AND paid_date = '2026-06-28')
    OR (amount = 1500.00 AND paid_date = '2026-07-29')
    OR (amount = 1300.00 AND paid_date = '2026-08-04')
    OR (amount = 60.00   AND paid_date = '2026-08-11'))
ORDER BY paid_date;

-- All her rent rows, for context (the contract balance counts every paid row).
SELECT id, status, amount, due_date, paid_date, is_ignored, LEFT(notes, 80) AS notes
FROM payments
WHERE lease_id = @lease_id
ORDER BY due_date, paid_date;

-- ---------------------------------------------------------------------------
-- 3. Mark
-- ---------------------------------------------------------------------------
START TRANSACTION;

UPDATE payments
SET notes = CONCAT(IF(notes IS NULL OR notes = '', '', CONCAT(notes, '\n')), '[arrears repayment: 410.00]'),
    updated_at = NOW()
WHERE lease_id = @lease_id AND status = 'paid' AND is_ignored = 0
  AND amount = 1500.00 AND paid_date = '2026-06-28'
  AND (notes IS NULL OR notes NOT LIKE '%[arrears repayment:%');

UPDATE payments
SET notes = CONCAT(IF(notes IS NULL OR notes = '', '', CONCAT(notes, '\n')), '[arrears repayment: 410.00]'),
    updated_at = NOW()
WHERE lease_id = @lease_id AND status = 'paid' AND is_ignored = 0
  AND amount = 1500.00 AND paid_date = '2026-07-29'
  AND (notes IS NULL OR notes NOT LIKE '%[arrears repayment:%');

UPDATE payments
SET notes = CONCAT(IF(notes IS NULL OR notes = '', '', CONCAT(notes, '\n')), '[arrears repayment: 210.00]'),
    updated_at = NOW()
WHERE lease_id = @lease_id AND status = 'paid' AND is_ignored = 0
  AND amount = 1300.00 AND paid_date = '2026-08-04'
  AND (notes IS NULL OR notes NOT LIKE '%[arrears repayment:%');

UPDATE payments
SET notes = CONCAT(IF(notes IS NULL OR notes = '', '', CONCAT(notes, '\n')), '[arrears repayment: 60.00]'),
    updated_at = NOW()
WHERE lease_id = @lease_id AND status = 'paid' AND is_ignored = 0
  AND amount = 60.00 AND paid_date = '2026-08-11'
  AND (notes IS NULL OR notes NOT LIKE '%[arrears repayment:%');

-- Expect total_marked = 1090.00 and marked_rows = 4 before committing.
SELECT COUNT(*) AS marked_rows,
       SUM(CAST(REGEXP_SUBSTR(REGEXP_SUBSTR(notes, '\\[arrears repayment: [0-9.]+\\]'), '[0-9]+(\\.[0-9]+)?') AS DECIMAL(10,2))) AS total_marked
FROM payments
WHERE lease_id = @lease_id AND notes LIKE '%[arrears repayment:%';

-- COMMIT;   -- when the check above shows 4 rows and 1090.00
-- ROLLBACK; -- otherwise

-- ---------------------------------------------------------------------------
-- 4. After
-- ---------------------------------------------------------------------------
SELECT id, amount, paid_date, notes
FROM payments
WHERE lease_id = @lease_id AND notes LIKE '%[arrears repayment:%'
ORDER BY paid_date;

-- Expected contract balance afterwards (rent 1090.00, months from June 2026):
--   received 7630.00 (1500 + 1500 + 1300 + 60 + 1090 + 1090 + 1090), minus 1090.00 marked = 6540.00
--   expected June to November 2026 = 6 x 1090.00 = 6540.00
--   balance: even (Outstanding 0.00, Credit 0.00), provided the current months
--   are paid as listed. Check it on the contract page, or:
--   GET /api/v1/leases/<lease_id>/balance  -> owed 0, credit 0, arrearsRepaid 1090
--
-- Tracking window (fix of 2026-11-06): the window starts at the month her
-- FIRST RECEIVED payment pays for. That is June only when the 1500.00 of
-- 2026-06-28 is tagged to June (its due_date is a June date, e.g. 2026-06-01,
-- because it was booked on June's open row). If it is an untagged bank row
-- (due_date = paid_date = 2026-06-28), it lands in July's window (8 days
-- before 1 July), the window starts in July, expected is 5 x 1090.00 =
-- 5450.00 and she shows 1090.00 credit even with the marks. The report
-- column window_start tells which case it is. Since the owner reads the 28/06
-- transfer as June's rent, the fix in that case is to tag it to June
-- (after a backup, check it touches exactly 1 row):
--   UPDATE payments SET due_date = '2026-06-01', updated_at = NOW()
--   WHERE lease_id = @lease_id AND status = 'paid' AND amount = 1500.00
--     AND paid_date = '2026-06-28' AND due_date = '2026-06-28';
--
-- Undo (removes only the mark line):
--   UPDATE payments
--   SET notes = NULLIF(TRIM(BOTH '\n' FROM REGEXP_REPLACE(notes, '\\n?\\[arrears repayment: [0-9.]+\\]', '')), ''),
--       updated_at = NOW()
--   WHERE lease_id = @lease_id AND notes LIKE '%[arrears repayment:%';
