-- Read-only report: the contract balance of every active lease of owner
-- a1e2c837-8130-438a-9a12-c285dda5cf27, the way the new reminder logic
-- (apps/api/src/services/contractBalance.ts) computes it, so the owner can
-- review before reminders start following it.
--
-- Same rules as the code:
--   months: from the month of the first rent row (any status but cancelled,
--           deposits left out) or the lease start, whichever is later, up to
--           the last month whose due date is on or before today; not before
--           the start date, not after a sane end date
--   expected per month: rent in force on the due date (latest applied or
--           notified indexation on or before it, else the previous rent of the
--           first later one, else monthly_rent) + charges - rent deductions
--           that apply on the due date, never below 0
--   received: every paid rent row (not ignored, not a deposit) once, plus
--           ledger allocations taken from other payments, minus money marked
--           "[arrears repayment: x]"
--   balance = expected - received; > 0 is owed, < 0 is credit
--
-- One simplification: a month whose open row is set to ignore counts what came
-- in for it in the app (neutral); here it counts its full expected amount. The
-- column ignored_open_rows shows where that matters. The exact figure for one
-- lease is on its contract page (GET /api/v1/leases/<id>/balance).
--
-- Uses CURDATE() as today: run it in the Europe/Brussels day.
-- Needs MariaDB 10.2+ (recursive CTE) and REGEXP_SUBSTR.

WITH RECURSIVE
nums AS (
  SELECT 0 AS n
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 240
),
lease_base AS (
  SELECT l.id, l.property_id, l.monthly_rent, l.monthly_charges, l.payment_day, l.start_date, l.end_date,
         GREATEST(
           COALESCE(
             (SELECT DATE_FORMAT(MIN(p.due_date), '%Y-%m-01') FROM payments p
              WHERE p.lease_id = l.id AND p.status <> 'cancelled'
                AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')),
             DATE_FORMAT(l.start_date, '%Y-%m-01')
           ),
           DATE_FORMAT(l.start_date, '%Y-%m-01')
         ) AS from_month
  FROM leases l
  WHERE l.owner_id = 'a1e2c837-8130-438a-9a12-c285dda5cf27' AND l.status = 'active' AND l.monthly_rent > 0
),
months AS (
  SELECT b.id AS lease_id, b.monthly_rent, b.monthly_charges, b.start_date, b.end_date,
         DATE_ADD(
           DATE_ADD(b.from_month, INTERVAL nums.n MONTH),
           INTERVAL LEAST(GREATEST(COALESCE(b.payment_day, 1), 1),
                          DAY(LAST_DAY(DATE_ADD(b.from_month, INTERVAL nums.n MONTH)))) - 1 DAY
         ) AS due
  FROM lease_base b
  JOIN nums ON DATE_ADD(b.from_month, INTERVAL nums.n MONTH) <= CURDATE()
),
due_months AS (
  SELECT m.*,
         COALESCE(
           (SELECT ir.new_rent FROM indexation_records ir
            WHERE ir.lease_id = m.lease_id AND ir.status IN ('applied', 'notified') AND ir.effective_date <= m.due
            ORDER BY ir.effective_date DESC LIMIT 1),
           (SELECT ir.previous_rent FROM indexation_records ir
            WHERE ir.lease_id = m.lease_id AND ir.status IN ('applied', 'notified') AND ir.effective_date > m.due
            ORDER BY ir.effective_date ASC LIMIT 1),
           m.monthly_rent
         ) AS rent_in_force,
         COALESCE(
           (SELECT SUM(d.amount) FROM rent_deductions d
            WHERE d.lease_id = m.lease_id AND d.start_date <= m.due
              AND (d.type = 'permanent' OR (d.end_date IS NOT NULL AND m.due <= d.end_date))),
           0
         ) AS deducted
  FROM months m
  WHERE m.due <= CURDATE()
    AND m.due >= m.start_date
    AND (m.end_date IS NULL OR m.end_date < m.start_date OR m.due <= m.end_date)
),
expected AS (
  SELECT lease_id,
         MIN(DATE_FORMAT(due, '%Y-%m')) AS from_month,
         COUNT(*) AS months,
         SUM(GREATEST(0, ROUND(rent_in_force + COALESCE(monthly_charges, 0) - deducted, 2))) AS expected
  FROM due_months
  GROUP BY lease_id
),
rent_rows AS (
  SELECT p.lease_id, p.id, p.amount,
         LEAST(p.amount, COALESCE(CAST(REGEXP_SUBSTR(REGEXP_SUBSTR(p.notes, '\\[arrears repayment: [0-9.]+\\]'), '[0-9]+(\\.[0-9]+)?') AS DECIMAL(10,2)), 0)) AS arrears
  FROM payments p
  JOIN lease_base b ON b.id = p.lease_id
  WHERE p.status = 'paid' AND p.is_ignored = 0
    AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')
),
received AS (
  SELECT b.id AS lease_id,
         COALESCE((SELECT SUM(r.amount) FROM rent_rows r WHERE r.lease_id = b.id), 0)
         + COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                     WHERE a.lease_id = b.id
                       AND a.payment_id NOT IN (SELECT r.id FROM rent_rows r WHERE r.lease_id = b.id)), 0)
           AS gross,
         COALESCE((SELECT SUM(r.arrears) FROM rent_rows r WHERE r.lease_id = b.id), 0) AS arrears
  FROM lease_base b
)
SELECT pr.name AS property,
       pr.street, pr.street_number, pr.city,
       (SELECT GROUP_CONCAT(CONCAT(t.first_name, ' ', t.last_name) SEPARATOR ', ')
          FROM lease_tenants lt JOIN tenants t ON t.id = lt.tenant_id WHERE lt.lease_id = b.id) AS tenants,
       b.id AS lease_id,
       e.from_month,
       COALESCE(e.months, 0) AS months,
       COALESCE(e.expected, 0) AS expected,
       r.gross - r.arrears AS received,
       r.arrears AS arrears_marked,
       GREATEST(0, COALESCE(e.expected, 0) - (r.gross - r.arrears)) AS owed,
       GREATEST(0, (r.gross - r.arrears) - COALESCE(e.expected, 0)) AS credit,
       (SELECT COUNT(*) FROM payments p
         WHERE p.lease_id = b.id AND p.is_ignored = 1 AND p.status IN ('pending', 'processing', 'failed')
           AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')) AS ignored_open_rows
FROM lease_base b
JOIN properties pr ON pr.id = b.property_id
JOIN received r ON r.lease_id = b.id
LEFT JOIN expected e ON e.lease_id = b.id
ORDER BY owed DESC, credit DESC, pr.name;
