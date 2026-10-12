-- Prod data correction for the bank matcher bug (quick task 261012-mko).
--
-- What happened (found 2026-10-12): the automatic IBAN matcher marked the
-- lease's OLDEST pending payment paid, whatever its amount. On leases with an
-- auto-generated pending deposit (due at the contract start, long before
-- Rentular), the October rent transfer closed the deposit instead of the rent
-- row. The rent row stayed pending and the tenants got reminders for rent they
-- had already paid.
--
-- Blocks:
--   1. Younes: point the EUR 1140 transfer of 2026-10-04 at the October rent
--      row, mark that rent paid, and restore the deposit (paid long before
--      Rentular) with notes reset to the exact 'auto-generated deposit' marker,
--      so the reminder exclusion (equality on notes) works again.
--   2. Lease 2243d291: same repair, statement to the rent row, rent paid,
--      deposit restored.
--   3. Bouchaouni: NOT a partial payment. The landlord granted the legally
--      required onroerende voorheffing reduction of 513.92 (aanslagjaar 2026,
--      kohierartikel 262301326685, 4 gezinsbijslaggerechtigde kinderen), so
--      1050 - 513.92 = 536.08 was paid. The payment stays paid and matched; a
--      note is added and the reduction is recorded as a rent deduction for the
--      October period, so the ledger shows it and the period reads as paid.
--   4. Every remaining pending auto-generated deposit of an older contract
--      (deposit due before the lease was added to Rentular) is presumed paid,
--      the same rule the API now applies to new leases.
--
-- Every UPDATE/INSERT is guarded, so a rerun is a no-op.
--
-- How to run: review the BEFORE selects, run the whole file up to and
-- including the AFTER selects, compare them, then COMMIT (or ROLLBACK).
-- Apply leases-prior-payments-settled.sql first; this file does not depend on
-- the new column, but block 4 matches the behaviour of the deployed code.

-- ===================== BEFORE =====================

SELECT id, amount, booking_date, match_status, matched_payment_id
FROM bank_statements
WHERE id IN (
  'dbc44924-2fbe-48de-8f45-5e775ac5fd64',
  'e46e6ebb-df58-4120-8f34-54f6e2d7a925',
  '9babb52f-c925-4ad8-99ea-0cced072212a'
);

SELECT id, lease_id, status, amount, due_date, paid_date, notes
FROM payments
WHERE id IN (
  'ef9771fd-50e4-4841-855d-28d04f2647ae',
  '1796027b-b945-42a0-8c9f-6f84f873413d',
  '96c8dcf6-c9e9-4c91-b235-6afe9bb89344',
  'ca24bbbd-0a46-4fff-8f83-0023d2f8c2d1',
  '71ed942a-be09-49d4-9900-8e229e0d57f1'
);

SELECT id, lease_id, type, amount, start_date, end_date, reason
FROM rent_deductions
WHERE id = '7b1c9e2a-5d3f-4c8e-9a1b-262301326685';

-- Block 4 candidates (what block 4 will mark paid).
SELECT p.id, p.lease_id, p.amount, p.due_date, l.created_at
FROM payments p
JOIN leases l ON l.id = p.lease_id
WHERE p.notes = 'auto-generated deposit'
  AND p.status = 'pending'
  AND p.due_date < DATE(l.created_at);

START TRANSACTION;

-- ===================== Block 1: Younes =====================

UPDATE payments
SET status = 'paid',
    paid_date = '2026-10-04',
    notes = CONCAT_WS('\n', NULLIF(notes, ''), 'Recorded from bank transfer e58182b0-3dfb-44e7-bd8b-db8b3ffc5b3c'),
    updated_at = NOW()
WHERE id = 'ef9771fd-50e4-4841-855d-28d04f2647ae'
  AND (notes IS NULL OR notes NOT LIKE '%e58182b0-3dfb-44e7-bd8b-db8b3ffc5b3c%');

UPDATE bank_statements
SET match_status = 'matched',
    matched_payment_id = 'ef9771fd-50e4-4841-855d-28d04f2647ae',
    matched_at = COALESCE(matched_at, NOW())
WHERE id = 'dbc44924-2fbe-48de-8f45-5e775ac5fd64'
  AND (matched_payment_id IS NULL OR matched_payment_id <> 'ef9771fd-50e4-4841-855d-28d04f2647ae');

-- Deposit paid long before Rentular; notes reset to the exact marker.
UPDATE payments p
JOIN leases l ON l.id = p.lease_id
SET p.status = 'paid',
    p.paid_date = l.start_date,
    p.notes = 'auto-generated deposit',
    p.updated_at = NOW()
WHERE p.id = '1796027b-b945-42a0-8c9f-6f84f873413d'
  AND (p.status <> 'paid' OR p.paid_date <> l.start_date OR p.paid_date IS NULL
       OR p.notes IS NULL OR p.notes <> 'auto-generated deposit');

-- ===================== Block 2: lease 2243d291-5d2a-4d4e-88bc-4361d3005362 =====================

UPDATE bank_statements
SET match_status = 'matched',
    matched_payment_id = '96c8dcf6-c9e9-4c91-b235-6afe9bb89344',
    matched_at = COALESCE(matched_at, NOW())
WHERE id = 'e46e6ebb-df58-4120-8f34-54f6e2d7a925'
  AND (matched_payment_id IS NULL OR matched_payment_id <> '96c8dcf6-c9e9-4c91-b235-6afe9bb89344');

UPDATE payments
SET status = 'paid',
    paid_date = COALESCE(paid_date, '2026-10-04'),
    updated_at = NOW()
WHERE id = '96c8dcf6-c9e9-4c91-b235-6afe9bb89344'
  AND status <> 'paid';

UPDATE payments p
JOIN leases l ON l.id = p.lease_id
SET p.status = 'paid',
    p.paid_date = l.start_date,
    p.notes = 'auto-generated deposit',
    p.updated_at = NOW()
WHERE p.id = 'ca24bbbd-0a46-4fff-8f83-0023d2f8c2d1'
  AND (p.status <> 'paid' OR p.paid_date <> l.start_date OR p.paid_date IS NULL
       OR p.notes IS NULL OR p.notes <> 'auto-generated deposit');

-- ===================== Block 3: Bouchaouni (lease d253ef26-3cdd-4315-874a-ca9e73c99cca) =====================
-- Payment 71ed942a stays paid and statement 9babb52f stays matched to it.

UPDATE payments
SET notes = CONCAT_WS('\n', NULLIF(notes, ''), 'Rent reduced by 513.92: vermindering onroerende voorheffing aanslagjaar 2026 (kohierartikel 262301326685), deducted once with agreement of the landlord'),
    updated_at = NOW()
WHERE id = '71ed942a-be09-49d4-9900-8e229e0d57f1'
  AND (notes IS NULL OR notes NOT LIKE '%262301326685%');

INSERT INTO rent_deductions (id, lease_id, type, amount, start_date, end_date, reason, notes, created_at)
SELECT '7b1c9e2a-5d3f-4c8e-9a1b-262301326685',
       'd253ef26-3cdd-4315-874a-ca9e73c99cca',
       'temporary',
       513.92,
       '2026-10-08',
       '2026-11-07',
       'Vermindering onroerende voorheffing aanslagjaar 2026 (kohierartikel 262301326685)',
       'Added by data correction 2026-10-12 (quick task 261012-mko)',
       NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM rent_deductions WHERE id = '7b1c9e2a-5d3f-4c8e-9a1b-262301326685'
);

-- ===================== Block 4: older contracts, deposit presumed paid =====================

UPDATE payments p
JOIN leases l ON l.id = p.lease_id
SET p.status = 'paid',
    p.paid_date = p.due_date,
    p.updated_at = NOW()
WHERE p.notes = 'auto-generated deposit'
  AND p.status = 'pending'
  AND p.due_date < DATE(l.created_at);

-- ===================== AFTER =====================

SELECT id, amount, booking_date, match_status, matched_payment_id
FROM bank_statements
WHERE id IN (
  'dbc44924-2fbe-48de-8f45-5e775ac5fd64',
  'e46e6ebb-df58-4120-8f34-54f6e2d7a925',
  '9babb52f-c925-4ad8-99ea-0cced072212a'
);

SELECT id, lease_id, status, amount, due_date, paid_date, notes
FROM payments
WHERE id IN (
  'ef9771fd-50e4-4841-855d-28d04f2647ae',
  '1796027b-b945-42a0-8c9f-6f84f873413d',
  '96c8dcf6-c9e9-4c91-b235-6afe9bb89344',
  'ca24bbbd-0a46-4fff-8f83-0023d2f8c2d1',
  '71ed942a-be09-49d4-9900-8e229e0d57f1'
);

SELECT id, lease_id, type, amount, start_date, end_date, reason
FROM rent_deductions
WHERE id = '7b1c9e2a-5d3f-4c8e-9a1b-262301326685';

-- Must be empty now.
SELECT p.id, p.lease_id, p.amount, p.due_date, l.created_at
FROM payments p
JOIN leases l ON l.id = p.lease_id
WHERE p.notes = 'auto-generated deposit'
  AND p.status = 'pending'
  AND p.due_date < DATE(l.created_at);

-- Happy with the AFTER selects? Commit. Otherwise run ROLLBACK; instead.
COMMIT;
