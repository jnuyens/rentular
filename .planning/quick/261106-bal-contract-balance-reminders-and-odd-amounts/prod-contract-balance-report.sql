-- Read-only report: the contract balance of every active lease of owner
-- a1e2c837-8130-438a-9a12-c285dda5cf27, the way the new reminder logic
-- (apps/api/src/services/contractBalance.ts) computes it, so the owner can
-- review before reminders start following it. Only SELECTs, nothing is changed.
--
-- Same rules as the code:
--   window: starts at the month the FIRST RECEIVED rent payment pays for
--           (attributedMonth: a row tagged to a rent period, due date <> paid
--           date, pays its due month; an untagged bank row, due date = paid
--           date, pays the month whose due date it lands near, up to 8 days
--           early or 5 days late, the later month winning; else its due month),
--           or at the lease start month when that is later. A paid row whose
--           whole amount is marked as older arrears does not open the window.
--           Without any received rent: the due month of the first rent row
--           (deposits and cancelled rows left out), or the lease start.
--           Open rows before the window are never owed and never reminded
--           (column open_rows_before_window counts them).
--   months: from the window start up to the last month whose due date is on
--           or before today; not before the start date, not after a sane end
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
-- Diagnostic columns: first_paid_on (date of the earliest paid rent row),
-- month_detail (each counted month as YYYY-MM=expected, with r=rent in force
-- and d=deduction when they differ from the lease rent or are not 0), so a
-- figure like "4 months, 3686.08 for rent 1050" can be traced to an
-- indexation record or a deduction.
--
-- Uses CURDATE() as today: run it in the Europe/Brussels day.
-- Needs MariaDB 10.2+ (recursive CTE) and REGEXP_SUBSTR.

WITH RECURSIVE
nums AS (
  SELECT 0 AS n
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 240
),
owner_leases AS (
  SELECT l.id, l.property_id, l.monthly_rent, l.monthly_charges, l.payment_day, l.start_date, l.end_date
  FROM leases l
  WHERE l.owner_id = 'a1e2c837-8130-438a-9a12-c285dda5cf27' AND l.status = 'active' AND l.monthly_rent > 0
),
rent_rows AS (
  SELECT p.lease_id, p.id, p.amount, p.due_date, p.paid_date,
         LEAST(p.amount, COALESCE(CAST(REGEXP_SUBSTR(REGEXP_SUBSTR(p.notes, '\\[arrears repayment: [0-9.]+\\]'), '[0-9]+(\\.[0-9]+)?') AS DECIMAL(10,2)), 0)) AS arrears
  FROM payments p
  JOIN owner_leases ol ON ol.id = p.lease_id
  WHERE p.status = 'paid' AND p.is_ignored = 0
    AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')
),
-- The month each paid rent row pays for (attributedMonth in monthReceived.ts).
paid_attr AS (
  SELECT x.lease_id, x.id, x.amount, x.arrears, x.paid_date,
         CASE
           WHEN x.paid_date IS NULL OR x.paid_date <> x.due_date
             THEN DATE_FORMAT(x.due_date, '%Y-%m-01')
           WHEN DATEDIFF(x.paid_date, DATE_ADD(x.m_next, INTERVAL LEAST(x.pd, DAY(LAST_DAY(x.m_next))) - 1 DAY)) BETWEEN -8 AND 5
             THEN x.m_next
           WHEN DATEDIFF(x.paid_date, DATE_ADD(x.m_base, INTERVAL LEAST(x.pd, DAY(LAST_DAY(x.m_base))) - 1 DAY)) BETWEEN -8 AND 5
             THEN x.m_base
           WHEN DATEDIFF(x.paid_date, DATE_ADD(x.m_prev, INTERVAL LEAST(x.pd, DAY(LAST_DAY(x.m_prev))) - 1 DAY)) BETWEEN -8 AND 5
             THEN x.m_prev
           ELSE DATE_FORMAT(x.due_date, '%Y-%m-01')
         END AS attr_month
  FROM (
    SELECT r.*,
           GREATEST(COALESCE(ol.payment_day, 1), 1) AS pd,
           CAST(DATE_FORMAT(r.paid_date, '%Y-%m-01') AS DATE) AS m_base,
           DATE_SUB(CAST(DATE_FORMAT(r.paid_date, '%Y-%m-01') AS DATE), INTERVAL 1 MONTH) AS m_prev,
           DATE_ADD(CAST(DATE_FORMAT(r.paid_date, '%Y-%m-01') AS DATE), INTERVAL 1 MONTH) AS m_next
    FROM rent_rows r
    JOIN owner_leases ol ON ol.id = r.lease_id
  ) x
),
lease_base AS (
  SELECT ol.*,
         GREATEST(
           COALESCE(
             (SELECT MIN(a.attr_month) FROM paid_attr a
              WHERE a.lease_id = ol.id AND a.arrears < a.amount),
             (SELECT DATE_FORMAT(MIN(p.due_date), '%Y-%m-01') FROM payments p
              WHERE p.lease_id = ol.id AND p.status <> 'cancelled'
                AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')),
             DATE_FORMAT(ol.start_date, '%Y-%m-01')
           ),
           DATE_FORMAT(ol.start_date, '%Y-%m-01')
         ) AS from_month
  FROM owner_leases ol
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
         SUM(GREATEST(0, ROUND(rent_in_force + COALESCE(monthly_charges, 0) - deducted, 2))) AS expected,
         GROUP_CONCAT(
           CONCAT(
             DATE_FORMAT(due, '%Y-%m'), '=',
             GREATEST(0, ROUND(rent_in_force + COALESCE(monthly_charges, 0) - deducted, 2)),
             IF(rent_in_force <> monthly_rent, CONCAT(' r=', rent_in_force), ''),
             IF(deducted <> 0, CONCAT(' d=', deducted), '')
           )
           ORDER BY due SEPARATOR '; '
         ) AS month_detail
  FROM due_months
  GROUP BY lease_id
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
       b.monthly_rent,
       b.payment_day,
       (SELECT MIN(r.paid_date) FROM rent_rows r WHERE r.lease_id = b.id) AS first_paid_on,
       DATE_FORMAT(b.from_month, '%Y-%m') AS window_start,
       e.from_month AS first_counted_month,
       COALESCE(e.months, 0) AS months,
       COALESCE(e.expected, 0) AS expected,
       r.gross - r.arrears AS received,
       r.arrears AS arrears_marked,
       GREATEST(0, COALESCE(e.expected, 0) - (r.gross - r.arrears)) AS owed,
       GREATEST(0, (r.gross - r.arrears) - COALESCE(e.expected, 0)) AS credit,
       (SELECT COUNT(*) FROM payments p
         WHERE p.lease_id = b.id AND p.status IN ('pending', 'processing', 'failed')
           AND p.due_date < b.from_month
           AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')) AS open_rows_before_window,
       (SELECT COUNT(*) FROM payments p
         WHERE p.lease_id = b.id AND p.is_ignored = 1 AND p.status IN ('pending', 'processing', 'failed')
           AND (p.notes IS NULL OR p.notes NOT LIKE 'auto-generated deposit%')) AS ignored_open_rows,
       e.month_detail
FROM lease_base b
JOIN properties pr ON pr.id = b.property_id
JOIN received r ON r.lease_id = b.id
LEFT JOIN expected e ON e.lease_id = b.id
ORDER BY owed DESC, credit DESC, pr.name;
