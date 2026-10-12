---
phase: quick-261012-mko-fix-bank-matcher-assigning-rent-to-depos
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/services/rentDeductions.ts
  - apps/api/src/services/paymentPicker.ts
  - apps/api/src/services/reconciliationAssign.ts
  - apps/api/src/services/ibanMatcher.ts
  - apps/api/src/routes/bankTransactions.ts
  - apps/api/src/services/__tests__/paymentPicker.test.ts
  - apps/api/src/services/__tests__/rentDeductions.test.ts
  - apps/api/src/services/__tests__/ibanMatcher.test.ts
  - packages/db/src/schema/leases.ts
  - .planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/leases-prior-payments-settled.sql
  - apps/api/src/services/expectedPayments.ts
  - apps/api/src/routes/leases.ts
  - apps/api/src/services/smovinMapper.ts
  - apps/web/app/(dashboard)/leases/page.tsx
  - apps/api/src/services/ledger.ts
  - apps/api/src/routes/ledger.ts
  - apps/api/src/jobs/paymentCheckWorker.ts
  - apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx
  - apps/web/messages/en/common.json
  - apps/web/messages/nl/common.json
  - apps/web/messages/fr/common.json
  - apps/web/messages/de/common.json
  - .planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/prod-data-correction.sql
autonomous: true
requirements: [QUICK-261012-mko]

must_haves:
  truths:
    - "A rent-sized transfer from a known tenant IBAN is matched to the pending rent row, never to a pending deposit of a different amount"
    - "A transfer equal to rent minus an active rent deduction for that period is matched to the rent row and the period is treated as paid (no reminders)"
    - "A transfer that fits no pending payment (partial, no deduction) is left unmatched for manual review by the IBAN pass; the manual assign route still links it to the lease"
    - "Creating a lease whose start date is in the past asks whether the deposit and earlier payments were already made, defaulting to yes, in EN/NL/FR/DE; when yes, the deposit row is created as paid"
    - "The rent ledger shows per-period reductions, lets the landlord add one with a property-tax preset, and remove one"
    - "A prepared, idempotent prod SQL file corrects the three affected leases and presumes older-contract deposits paid; it is not executed"
  artifacts:
    - path: "apps/api/src/services/paymentPicker.ts"
      provides: "pickPaymentForTransfer pure selection logic"
      exports: ["pickPaymentForTransfer", "PendingPayment"]
    - path: "apps/api/src/services/rentDeductions.ts"
      provides: "Shared deduction helpers (applicable deductions for a due date, period rent due, loader)"
      exports: ["deductionsForDueDate", "deductedAmount", "periodRentDue", "loadLeaseDeductions", "loadLeaseFreePeriods"]
    - path: "apps/api/src/services/__tests__/paymentPicker.test.ts"
      provides: "Unit tests for the matcher priority rules"
    - path: "apps/api/src/services/__tests__/rentDeductions.test.ts"
      provides: "Unit tests for deduction applicability and period rent math"
    - path: "packages/db/src/schema/leases.ts"
      provides: "prior_payments_settled column"
      contains: "prior_payments_settled"
    - path: ".planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/prod-data-correction.sql"
      provides: "Prod data correction, transactional, with before/after SELECTs"
      contains: "262301326685"
  key_links:
    - from: "apps/api/src/services/reconciliationAssign.ts"
      to: "apps/api/src/services/paymentPicker.ts"
      via: "pickPaymentForTransfer(pending, amount, deductions)"
      pattern: "pickPaymentForTransfer"
    - from: "apps/api/src/services/ibanMatcher.ts"
      to: "assignStatementToLease null return"
      via: "skip and do not count when null"
      pattern: "if \\(!.*\\) continue"
    - from: "apps/api/src/services/expectedPayments.ts"
      to: "lease.priorPaymentsSettled"
      via: "deposit status decided at creation of the deposit row"
      pattern: "priorPaymentsSettled"
    - from: "apps/api/src/jobs/paymentCheckWorker.ts"
      to: "apps/api/src/services/rentDeductions.ts"
      via: "isPeriodSettled uses rent minus deductions"
      pattern: "deductedAmount|loadLeaseDeductions"
    - from: "apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx"
      to: "/api/v1/rent-adjustments/deductions"
      via: "POST on save, DELETE on remove"
      pattern: "rent-adjustments/deductions"
---

<objective>
Stop the bank matcher from assigning rent transfers to pending deposits, make it aware of rent deductions, presume deposits and earlier payments of older contracts paid (admin asked, default yes), surface rent deductions in the rent ledger with an easy "Add reduction" action, and prepare (not run) a prod data-correction SQL for the three affected leases.

Purpose: tenants were getting WhatsApp reminders for rent they had already paid because the IBAN pass marked the auto-generated deposit paid instead of the rent row. Bouchaouni's €536.08 was not a partial payment but rent minus a legally required onroerende voorheffing reduction (€513.92), which nothing in the system models today.

Output: pure, tested payment picker; deduction-aware matcher, ledger and reminder settle check; prior_payments_settled lease column plus hand DDL; lease form checkbox in four languages; ledger reduction UI; prod SQL file.
</objective>

<execution_context>
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/gsd/4.9.1/workflows/execute-plan.md
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/gsd/4.9.1/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@apps/api/src/services/reconciliationAssign.ts
@apps/api/src/services/ibanMatcher.ts
@apps/api/src/services/expectedPayments.ts
@apps/api/src/services/ledger.ts
@apps/api/src/routes/leases.ts
@apps/api/src/routes/bankTransactions.ts
@apps/api/src/routes/rentAdjustments.ts
@apps/api/src/jobs/paymentCheckWorker.ts
@packages/db/src/schema/leases.ts
@packages/db/src/schema/costs.ts
@apps/api/src/services/__tests__/ibanMatcher.test.ts
@apps/web/app/(dashboard)/leases/page.tsx
@apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx

<interfaces>
<!-- Existing contracts the executor builds against. Verified in the codebase on 2026-10-12. -->

From apps/api/src/services/expectedPayments.ts:
  export const DEPOSIT_NOTE = "auto-generated deposit";   // equality-checked by paymentCheckWorker (ne) and routes/payments.ts; must stay exact on deposit rows
  export async function ensureExpectedPayments(lease: LeaseRow, opts: { resetFuture?: boolean } = {}): Promise<number>
  export function coversMonthRent(p, dueDate: string, rent: number): boolean   // requires amt >= rent*0.9

From apps/api/src/services/reconciliationAssign.ts (current):
  export type AssignableStatement = Pick<StatementRow, "id" | "amount" | "bookingDate" | "externalTransactionId">;
  export async function assignStatementToLease(db, statement, leaseId, note): Promise<{ paymentId: string; created: boolean }>
  Callers: services/ibanMatcher.ts (auto pass) and routes/bankTransactions.ts POST /:statementId/assign (manual, line ~243).

From apps/api/src/services/ibanMatcher.ts:
  const AMOUNT_TOLERANCE = 0.01;
  async function expectedAmountForLease(db, leaseId, monthlyRent): Promise<number>   // oldest pending of any type, to be replaced
  export async function autoAssignByIban(db, ownerId, connectionId): Promise<number>  // returns count assigned

From packages/db/src/schema/costs.ts:
  rentDeductions: { id, leaseId, type: "temporary" | "permanent", amount: decimal, startDate: date(string), endDate: date(string) | null, reason varchar(500), notes, createdAt }
  rentFreePeriods: { id, leaseId, startDate, endDate (not null), reason, waiveCharges boolean, notes, createdAt }

From apps/api/src/routes/rentAdjustments.ts (mounted at /api/v1/rent-adjustments):
  POST /deductions  body { leaseId: uuid, type, amount: number > 0, startDate: YYYY-MM-DD, endDate?: YYYY-MM-DD, reason: 1..500, notes? }  -> checkLeasePropertyRole(userId, leaseId, "manager") then 201 { data }
  DELETE /deductions/:id  -> loads row, checkLeasePropertyRole(userId, row.leaseId, "co_owner") -> { message }
  GET /deductions?leaseId=&active=  -> active means startDate <= today AND (endDate null OR endDate >= today)

From apps/api/src/services/ledger.ts:
  export interface LedgerPeriod { month; dueDate; rentDue; allocated; balance; status: "paid"|"partial"|"open"|"overpaid"; allocations[] }
  export async function computeLedger(leaseId, opts: { months?: number }): Promise<Ledger | null>
  function dueDateFor(year, month0, paymentDay): string   // module-private, clamps day to month length
  autoReconcile() uses p.rentDue - p.allocated, so a reduced rentDue flows through automatically.

From apps/api/src/jobs/paymentCheckWorker.ts:
  async function isPeriodSettled(db, leaseId, dueDate, monthlyRent): Promise<boolean>   // lines ~52-80; called 3x with Number(lease.monthlyRent)

From packages/db/src/schema/leases.ts: leases has startDate (date string), deposit decimal, createdAt timestamp, landlordLateNotify boolean default true (pattern to copy for the new column).

Web lease form (apps/web/app/(dashboard)/leases/page.tsx): controlled booleans are kept in useState and spread into the JSON body in handleSubmit (see landlordLateNotify at lines ~138, ~224, ~495, toggle JSX at ~1344-1362). startDateState (line ~148) holds the start date input. Deposit input block is at ~1115-1140.

Web ledger page (apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx): fetch uses { credentials: "include" }; load() reloads; period rows at ~230-335 with AssignPanel (inline) and LedgerMarkPaid (dropdown) under the "Assign control" block; state assigning: string | null keyed by period month.

Message files: apps/web/messages/{en,nl,fr,de}/common.json. "leases" section: deposit keys at ~line 292-294. "ledger" section starts at line 1255 in all four files and ends with "markedPaid".
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Deduction-aware payment picker and matcher</name>
  <files>apps/api/src/services/rentDeductions.ts, apps/api/src/services/paymentPicker.ts, apps/api/src/services/reconciliationAssign.ts, apps/api/src/services/ibanMatcher.ts, apps/api/src/routes/bankTransactions.ts, apps/api/src/services/__tests__/paymentPicker.test.ts, apps/api/src/services/__tests__/rentDeductions.test.ts, apps/api/src/services/__tests__/ibanMatcher.test.ts</files>
  <behavior>
    paymentPicker.test.ts (vitest, same style as expectedPayments.test.ts, pure, no db mock):
    - Rent 1140 pending (due 2026-10-01) plus deposit 2080 pending (due 2026-03-01, notes DEPOSIT_NOTE): transfer 1140 picks the rent row, not the older deposit.
    - Only a deposit 1800 pending, transfer 900: returns null.
    - Deposit 2080 pending plus rent 1140, transfer 2080: picks the deposit (exact match).
    - Two rents pending (Sept 1000, Oct 1000), transfer 1000: picks the oldest (Sept).
    - Rent 1050 pending, transfer 536.08, no deductions: returns null (partial, manual review).
    - Rent 1050 pending due 2026-10-08, temporary deduction 513.92 from 2026-10-08 to 2026-11-07, transfer 536.08: picks the rent row (exact after deduction).
    - Same deduction but transfer 400: returns null.
    - Permanent deduction 50 starting 2026-01-01, rent 1000 due 2026-10-01, transfer 950: picks the rent row; transfer 950 for a rent due 2025-12-01 (before the deduction start): null.
    - Rent 1000 pending, transfer 1200 (overpayment): picks the rent row. Transfer 1200 when deposit 1200 and rent 1000 are both pending: picks the deposit (exact wins over overpayment).
    - Tolerance: 1139.995 vs 1140 matches; 1139.98 does not.
    rentDeductions.test.ts:
    - deductionsForDueDate: temporary applies only when start <= due <= end; permanent applies when start <= due; a mix returns both when both apply.
    - periodRentDue: rent 1050 charges 0, deduction 513.92 applicable -> rentDue 536.08, deductions listed; deduction larger than rent -> 0, never negative; free period covering the due date with waiveCharges false -> rentDue equals charges only; with waiveCharges true -> 0; no adjustments -> rent + charges.
  </behavior>
  <action>
    1. Create apps/api/src/services/rentDeductions.ts, the single shared place for "which deductions apply to a due date" (reused by the matcher here, by the ledger and the reminder worker in Task 3). Export:
       - type DeductionRow = { id: string; type: "temporary" | "permanent"; amount: string | number; startDate: string; endDate: string | null; reason: string }
       - type FreePeriodRow = { id: string; startDate: string; endDate: string; waiveCharges: boolean; reason: string }
       - deductionsForDueDate(rows, dueDate): DeductionRow[]. Compare YYYY-MM-DD strings (slice(0, 10) on both sides, the db returns date-mode strings). temporary: startDate <= due <= endDate. permanent: startDate <= due.
       - deductedAmount(rows, dueDate): number, rounded to 2 decimals.
       - periodRentDue({ monthlyRent, charges, dueDate, deductions, freePeriods }): { rentDue: number; grossRentDue: number; deductions: Array<{ id; amount: number; reason }>; rentFree: boolean }. A free period covering the due date zeroes the rent (and charges too when waiveCharges). Otherwise rentDue = max(0, round2(rent + charges - deducted)).
       - loadLeaseDeductions(db, leaseId): Promise<DeductionRow[]> (select from rentDeductions where leaseId) and loadLeaseFreePeriods(db, leaseId). Import rentDeductions and rentFreePeriods from @rentular/db; type Db = ReturnType<typeof getDb> as in reconciliationAssign.ts.
    2. Create apps/api/src/services/paymentPicker.ts with export type PendingPayment = { id: string; amount: string | number; dueDate: string; notes: string | null } and export function pickPaymentForTransfer(pending: PendingPayment[], amount: number, deductions: DeductionRow[] = [], tolerance = 0.01): PendingPayment | null. Import DEPOSIT_NOTE from ./expectedPayments; isDeposit(p) is notes === DEPOSIT_NOTE. Sort a copy by dueDate ascending. For a non-deposit row, its effective amount is Number(amount) minus deductedAmount(deductions, p.dueDate) (never below 0); a deposit always uses its raw amount. Priority, documented in a JSDoc block: (1) oldest non-deposit whose raw or effective amount is within tolerance of the transfer; (2) oldest deposit whose raw amount is within tolerance; (3) the oldest non-deposit row when the transfer is >= its effective amount minus tolerance (overpayment); (4) null. A deposit is never returned with a non-matching amount, and a smaller transfer with no matching deduction is never returned.
    3. Rewrite assignStatementToLease in reconciliationAssign.ts. New signature: assignStatementToLease(db, statement, leaseId, note, opts: { createWhenUnmatched?: boolean } = {}): Promise<{ paymentId: string; created: boolean } | null>. Select ALL pending rows for the lease with id, amount, dueDate, notes ordered by dueDate asc (drop limit(1)). If none: keep the existing "insert a paid payment from the transfer" branch unchanged (both callers). Else load deductions via loadLeaseDeductions and call pickPaymentForTransfer(pending, Number(statement.amount), deductions). If a target is found: keep the existing mark-paid update (status paid, paidDate from bookingDate, notes appended after a newline, bankStatements matched) against target.id. If null and opts.createWhenUnmatched: insert a paid payment from the transfer exactly like the no-pending branch, with the note suffixed by " (no pending payment matched this amount; the pending rent stays open)". If null otherwise: write nothing and return null. Update the JSDoc to describe the priority and the two modes. Decision, record it in the comment: the manual route sets createWhenUnmatched because the landlord explicitly chose the lease, so the transfer must end up linked to it; recording it as a separate paid payment keeps the larger pending rent open (reminders keep running, the ledger shows the money as unassigned) instead of silently closing a deposit or a bigger rent row. The automatic IBAN pass does not set it, so a non-fitting transfer stays unmatched for review.
    4. ibanMatcher.ts: replace expectedAmountForLease with a helper that selects all pending rows (id, amount, dueDate, notes, ordered by dueDate) and the lease deductions, and returns the candidate amounts for disambiguation: the oldest non-deposit pending row's raw amount and its deduction-adjusted amount, or [Number(monthlyRent)] when there is no non-deposit pending row (a pending deposit alone never defines the expected amount). A lease matches when the transfer is within AMOUNT_TOLERANCE of any of those. In the loop, capture the result of assignStatementToLease; when it is null, console.log "[IbanMatcher] Statement X fits no pending payment of lease Y, left for manual review" and continue without incrementing assigned.
    5. routes/bankTransactions.ts POST /:statementId/assign: pass { createWhenUnmatched: true }; the result is then always non-null, but narrow it with a 500 guard anyway so TypeScript is happy.
    6. Update apps/api/src/services/__tests__/ibanMatcher.test.ts fakeDb for the new query shapes: for t === payments return { orderBy: () => Promise.resolve([]) } (no limit), and for the rentDeductions table return Promise.resolve([]); add rentDeductions to the vi.mock("@rentular/db") object. Note the fakeDb in that file branches on the table object identity, so export a rentDeductions sentinel the same way payments is. The four existing cases must still pass (no pending rows -> expected amount is the rent).
    7. Write the two new test files per the behavior list; put the test file first, run it red, then implement.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && pnpm --filter @rentular/api test -- paymentPicker rentDeductions ibanMatcher</automated>
  </verify>
  <done>pickPaymentForTransfer and the deduction helpers are pure, exported and covered by the listed cases; assignStatementToLease never selects a deposit with a non-matching amount, returns null in auto mode when nothing fits, and the manual route still links the transfer; all api tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Older contracts: deposit and earlier payments presumed paid</name>
  <files>packages/db/src/schema/leases.ts, .planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/leases-prior-payments-settled.sql, apps/api/src/services/expectedPayments.ts, apps/api/src/routes/leases.ts, apps/api/src/services/smovinMapper.ts, apps/web/app/(dashboard)/leases/page.tsx, apps/web/messages/en/common.json, apps/web/messages/nl/common.json, apps/web/messages/fr/common.json, apps/web/messages/de/common.json</files>
  <action>
    Persistence decision (record it in the schema comment): persist the answer on the lease as prior_payments_settled rather than creating the deposit eagerly. The deposit row is produced lazily by ensureExpectedPayments from the create route, the update route, paymentCheckWorker and routes/payments.ts (ensureExpectedPaymentsForAllActive); a lease can be created as draft and activated later, or get its deposit amount filled in on a later edit. Only a column survives all of those paths. Eager creation would lose the answer the moment the deposit is generated on a later run.
    1. packages/db/src/schema/leases.ts: add priorPaymentsSettled: boolean("prior_payments_settled").default(true).notNull() next to landlordLateNotify, with a comment: "Older contract (start before it was added here): deposit and rent up to then are presumed already paid. Asked on create, default yes." Write the hand DDL file leases-prior-payments-settled.sql in the quick dir, same shape as the 261012-kpc file: header comment explaining the column and that it must be applied on prod MariaDB before deploying the API, then ALTER TABLE leases ADD COLUMN IF NOT EXISTS prior_payments_settled TINYINT(1) NOT NULL DEFAULT 1. No drizzle-kit (baseline is stale, see memory).
    2. expectedPayments.ts, deposit branch of ensureExpectedPayments: compute createdDay = toYMD(lease.createdAt ? new Date(lease.createdAt) : new Date()); olderContract = depositDue < createdDay; presumePaid = olderContract && lease.priorPaymentsSettled !== false. Insert the deposit with status presumePaid ? "paid" : "pending", paidDate presumePaid ? depositDue : null, notes exactly DEPOSIT_NOTE (no extra text: paymentCheckWorker and routes/payments.ts compare notes with equality and the idempotency check does too). Leases whose start date is today or later are never "older", so they keep the pending deposit. Rent stays forward-only; no past rent rows. Update the comment block above the deposit code accordingly. Existing pending deposits are deliberately not touched by this function; the prod backfill is the SQL file in Task 4.
    3. routes/leases.ts: add priorPaymentsSettled: z.boolean().optional().default(true) to createLeaseSchema and pass it into the insert. In PUT: when data.priorPaymentsSettled !== undefined set updates.priorPaymentsSettled. When it flips from false (existing[0].priorPaymentsSettled === false) to true and the lease's startDate is before DATE(createdAt), mark an existing pending auto-generated deposit paid: update payments set status "paid", paidDate = startDate where leaseId, notes = DEPOSIT_NOTE, status = "pending" (import DEPOSIT_NOTE and payments). The reverse flip leaves payments alone (the landlord can edit the payment by hand); say so in a comment.
    4. smovinMapper.ts mapSmovinLease: add priorPaymentsSettled: true to the returned object and its return type, with a comment that an import is by definition of contracts that predate Rentular. No checkbox in the import UI: import_sessions has no options column to carry the answer from the page to the write worker, and the import never sets a deposit amount anyway, so the default is the whole behaviour. Note that in the SUMMARY.
    5. Web lease form apps/web/app/(dashboard)/leases/page.tsx: add priorPaymentsSettled?: boolean to the Lease interface; add const [priorPaymentsSettled, setPriorPaymentsSettled] = useState(true); reset it in the modal effect (where setStartDateState is reset, ~line 335) to editingLease?.priorPaymentsSettled !== false; add priorPaymentsSettled to the body in handleSubmit next to landlordLateNotify. Compute startInPast = !!startDateState && startDateState < (today as YYYY-MM-DD, built with local date parts the way computeRefMonth style helpers do, not toISOString). Render, directly below the deposit block, only when startInPast, a toggle row copied from the landlordLateNotify toggle markup (title t("priorPaymentsSettled"), description t("priorPaymentsSettledHelp"), switch bound to priorPaymentsSettled). It must be a controlled state, not a named input, because handleSubmit spreads FormData and a checkbox would arrive as "on".
    6. Messages, "leases" section of all four common.json files, add after "depositTwoMonths":
       en: "priorPaymentsSettled": "Deposit and earlier payments already made", "priorPaymentsSettledHelp": "This contract started before you added it here. Leave this on if the deposit and the rent up to now were already paid, so nothing from before is treated as open."
       nl: "Waarborg en eerdere betalingen al voldaan", "Dit contract is gestart voor u het hier toevoegde. Laat dit aan staan als de waarborg en de huur tot nu al betaald zijn, zodat niets van vroeger als openstaand wordt beschouwd."
       fr: "Garantie et paiements antérieurs déjà réglés", "Ce contrat a commencé avant son ajout ici. Laissez cette option activée si la garantie et les loyers jusqu'à présent ont déjà été payés, pour que rien d'antérieur ne soit considéré comme ouvert."
       de: "Kaution und frühere Zahlungen bereits geleistet", "Dieser Vertrag begann, bevor er hier angelegt wurde. Lassen Sie dies aktiviert, wenn die Kaution und die Miete bis heute bereits bezahlt wurden, damit nichts aus der Vergangenheit als offen gilt."
       No em-dashes or en-dashes anywhere. Validate the four JSON files parse (node -e with JSON.parse) after editing.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && grep -c "prior_payments_settled" packages/db/src/schema/leases.ts && grep -c "priorPaymentsSettled" apps/api/src/services/expectedPayments.ts apps/api/src/routes/leases.ts apps/api/src/services/smovinMapper.ts 'apps/web/app/(dashboard)/leases/page.tsx' && for l in en nl fr de; do node -e "const m=require('./apps/web/messages/$l/common.json'); if(!m.leases.priorPaymentsSettledHelp) process.exit(1)"; done && ! grep -rn $'—\|–' apps/web/messages/*/common.json | grep -i "priorPayments" && pnpm --filter @rentular/api lint && pnpm --filter @rentular/web lint</automated>
  </verify>
  <done>Column, DDL file, schema, create/update routes, mapper default, lease form toggle (only when the start date is in the past, default on) and four locales are in place; a lease created with a past start date and the default answer gets a paid deposit dated at the start date with notes exactly "auto-generated deposit"; today/future start dates still get a pending deposit; api and web typecheck pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Rent deductions in the ledger, reminder settle check, and ledger "Add reduction" UI</name>
  <files>apps/api/src/services/ledger.ts, apps/api/src/routes/ledger.ts, apps/api/src/jobs/paymentCheckWorker.ts, apps/api/src/routes/rentAdjustments.ts, apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx, apps/web/messages/en/common.json, apps/web/messages/nl/common.json, apps/web/messages/fr/common.json, apps/web/messages/de/common.json</files>
  <behavior>
    Covered by rentDeductions.test.ts from Task 1 (periodRentDue is the period math). Add to that file:
    - periodEndFor(dueDate, paymentDay): for due 2026-10-08 with paymentDay 8 returns 2026-11-07; for due 2026-01-31 with paymentDay 31 returns 2026-02-27 (next due is Feb 28, clamped); for due 2026-12-01 returns 2026-12-31.
  </behavior>
  <action>
    1. ledger.ts computeLedger: load deductions and free periods once via loadLeaseDeductions / loadLeaseFreePeriods (Task 1 helper). Inside the period loop replace the constant rentDue with periodRentDue({ monthlyRent, charges, dueDate: due, deductions, freePeriods }). Extend LedgerPeriod with grossRentDue: number, deductions: Array<{ id: string; amount: number; reason: string }>, rentFree: boolean, and periodEnd: string (the day before the next period's due date, computed by a new exported pure helper periodEndFor(dueDate, paymentDay) placed in services/rentDeductions.ts so it is testable; use dueDateFor-equivalent clamping for the next month). totalCharged sums the reduced rentDue. autoReconcile and status derivation need no change because they read p.rentDue. routes/ledger.ts needs no change unless types are re-declared there; check.
    2. paymentCheckWorker.ts isPeriodSettled: load the lease deductions (loadLeaseDeductions) and compute due = max(0, monthlyRent - deductedAmount(rows, dueDate)). If due <= 0 return true. Use due instead of monthlyRent for both the allocation sum comparison and coversMonthRent(p, dueDate, due). Do not add a third copy of the date logic; only the shared helper. Update the JSDoc to say the rent net of applicable deductions is what counts as settled.
    3. Ownership check (security): confirm POST /deductions and DELETE /deductions/:id in routes/rentAdjustments.ts both go through checkLeasePropertyRole before touching data (they do today: manager for POST, co_owner for DELETE, and a missing lease yields ok false, so a foreign leaseId gets 403). Record the finding in the SUMMARY; change nothing unless a gap is found. Also confirm the ledger page's GET already uses authorizeLease.
    4. Ledger UI apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx: extend the Period interface with grossRentDue, deductions, rentFree, periodEnd. Add state const [reducing, setReducing] = useState<string | null>(null). Under the "Existing allocations" block and before the "Assign control" block, render the period's deductions, one line each in the same rounded bg-muted/50 style: t("reductionLine", { amount: eur(d.amount), reason: d.reason }) with an X button that calls removeDeduction(d.id) (DELETE `${apiUrl}/api/v1/rent-adjustments/deductions/${id}`, credentials include, toast t("reductionRemoved"), then load()). When p.rentFree show t("rentFree") as a muted line. After the Assign control block add, on every period row regardless of balance, either a ReductionPanel (when reducing === p.month) or a ghost Button sized like the Assign button with a Minus icon from lucide-react and label t("addReduction"). ReductionPanel is a new inline component modelled on AssignPanel: an amount Input (type number, step 0.01, min 0.01), a reason Input (free text), a preset button that sets the reason to t("reductionPreset"), Save and Cancel buttons; Save POSTs `${apiUrl}/api/v1/rent-adjustments/deductions` with JSON { leaseId, type: "temporary", amount: Number(amount), startDate: p.dueDate, endDate: p.periodEnd, reason }, credentials include, Content-Type application/json; on 201 toast t("reductionSaved"), setReducing(null), await load(); on error show the API error message via toast.error. Show p.grossRentDue struck through next to the rent amount when it differs from p.rentDue, so the reduction is visible at a glance.
    5. Messages, "ledger" section of all four files, add after "markedPaid":
       en: "addReduction": "Add reduction", "reductionAmount": "Amount", "reductionReason": "Reason", "reductionPreset": "Property tax reduction (onroerende voorheffing)", "reductionLine": "Reduction: -{amount} ({reason})", "reductionSaved": "Reduction added", "reductionRemoved": "Reduction removed", "saveReduction": "Save", "rentFree": "Rent-free period"
       nl: "Vermindering toevoegen", "Bedrag", "Reden", "Vermindering onroerende voorheffing", "Vermindering: -{amount} ({reason})", "Vermindering toegevoegd", "Vermindering verwijderd", "Opslaan", "Huurvrije periode"
       fr: "Ajouter une réduction", "Montant", "Motif", "Réduction du précompte immobilier", "Réduction : -{amount} ({reason})", "Réduction ajoutée", "Réduction supprimée", "Enregistrer", "Période de gratuité"
       de: "Ermäßigung hinzufügen", "Betrag", "Grund", "Ermäßigung Grundsteuer (onroerende voorheffing)", "Ermäßigung: -{amount} ({reason})", "Ermäßigung hinzugefügt", "Ermäßigung entfernt", "Speichern", "Mietfreie Zeit"
       No em-dashes or en-dashes. Validate JSON parses.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && pnpm --filter @rentular/api test -- rentDeductions && grep -c "periodRentDue" apps/api/src/services/ledger.ts && grep -c "deductedAmount\|loadLeaseDeductions" apps/api/src/jobs/paymentCheckWorker.ts && grep -c "rent-adjustments/deductions" 'apps/web/app/(dashboard)/ledger/[leaseId]/page.tsx' && for l in en nl fr de; do node -e "const m=require('./apps/web/messages/$l/common.json'); if(!m.ledger.reductionPreset) process.exit(1)"; done && pnpm --filter @rentular/api lint && pnpm --filter @rentular/web lint</automated>
  </verify>
  <done>Ledger periods carry rentDue net of applicable deductions (and rent-free periods), expose deductions and periodEnd; the worker's isPeriodSettled uses the same helper so a period paid net of a reduction never gets reminders; the ledger page can add a temporary reduction for a period (with the onroerende voorheffing preset) and remove one; the rent-adjustments routes are confirmed to check lease ownership; typechecks and tests pass.</done>
</task>

<task type="auto">
  <name>Task 4: Prod data-correction SQL (prepared, not run) and full verification</name>
  <files>.planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/prod-data-correction.sql</files>
  <action>
    Write prod-data-correction.sql in the quick dir for the prod MariaDB. Do NOT execute it and do not touch prod. Structure: a header comment (what happened on 2026-10-12, why each block exists, "review the BEFORE selects, run, compare the AFTER selects, then COMMIT"), then BEFORE SELECTs, START TRANSACTION, the four correction blocks, AFTER SELECTs, and COMMIT on its own line with a comment that ROLLBACK is the alternative. Every UPDATE is guarded so a rerun is a no-op. Column names: payments(status, paid_date, notes, updated_at, lease_id, due_date), bank_statements(match_status, matched_payment_id, matched_at), leases(start_date, created_at), rent_deductions(id, lease_id, type, amount, start_date, end_date, reason, notes, created_at).
    Block 1, Younes (lease 56f48045..., statement dbc44924-2fbe-48de-8f45-5e775ac5fd64, EUR 1140 on 2026-10-04):
      - UPDATE payments SET status='paid', paid_date='2026-10-04', notes=CONCAT_WS('\n', NULLIF(notes,''), 'Recorded from bank transfer e58182b0-3dfb-44e7-bd8b-db8b3ffc5b3c'), updated_at=NOW() WHERE id='ef9771fd-50e4-4841-855d-28d04f2647ae' AND (notes IS NULL OR notes NOT LIKE '%e58182b0-3dfb-44e7-bd8b-db8b3ffc5b3c%').
      - UPDATE bank_statements SET match_status='matched', matched_payment_id='ef9771fd-50e4-4841-855d-28d04f2647ae', matched_at=COALESCE(matched_at, NOW()) WHERE id='dbc44924-2fbe-48de-8f45-5e775ac5fd64' AND (matched_payment_id IS NULL OR matched_payment_id <> 'ef9771fd-50e4-4841-855d-28d04f2647ae').
      - UPDATE payments p JOIN leases l ON l.id=p.lease_id SET p.status='paid', p.paid_date=l.start_date, p.notes='auto-generated deposit', p.updated_at=NOW() WHERE p.id='1796027b-b945-42a0-8c9f-6f84f873413d' (deposit paid long before Rentular; notes reset to the exact marker so the reminder exclusion equality works again).
    Block 2, lease 2243d291-5d2a-4d4e-88bc-4361d3005362:
      - UPDATE bank_statements SET match_status='matched', matched_payment_id='96c8dcf6-c9e9-4c91-b235-6afe9bb89344', matched_at=COALESCE(matched_at, NOW()) WHERE id='e46e6ebb-df58-4120-8f34-54f6e2d7a925' AND (matched_payment_id IS NULL OR matched_payment_id <> '96c8dcf6-c9e9-4c91-b235-6afe9bb89344').
      - UPDATE payments SET status='paid', paid_date=COALESCE(paid_date,'2026-10-04'), updated_at=NOW() WHERE id='96c8dcf6-c9e9-4c91-b235-6afe9bb89344' AND status <> 'paid'.
      - Deposit ca24bbbd-0a46-4fff-8f83-0023d2f8c2d1: same join UPDATE as Block 1's deposit (paid, paid_date=l.start_date, notes exactly 'auto-generated deposit').
    Block 3, Bouchaouni (lease d253ef26-3cdd-4315-874a-ca9e73c99cca), NOT a partial payment: the landlord granted the legally required onroerende voorheffing reduction of 513.92 (aanslagjaar 2026, kohierartikel 262301326685, 4 gezinsbijslaggerechtigde kinderen), 1050 - 513.92 = 536.08 paid.
      - Keep payment 71ed942a-be09-49d4-9900-8e229e0d57f1 paid and statement 9babb52f-c925-4ad8-99ea-0cced072212a matched to it (no status change). UPDATE payments SET notes=CONCAT_WS('\n', NULLIF(notes,''), 'Rent reduced by 513.92: vermindering onroerende voorheffing aanslagjaar 2026 (kohierartikel 262301326685), deducted once with agreement of the landlord'), updated_at=NOW() WHERE id='71ed942a-be09-49d4-9900-8e229e0d57f1' AND (notes IS NULL OR notes NOT LIKE '%262301326685%').
      - INSERT INTO rent_deductions (id, lease_id, type, amount, start_date, end_date, reason, notes, created_at) SELECT '7b1c9e2a-5d3f-4c8e-9a1b-262301326685', 'd253ef26-3cdd-4315-874a-ca9e73c99cca', 'temporary', 513.92, '2026-10-08', '2026-11-07', 'Vermindering onroerende voorheffing aanslagjaar 2026 (kohierartikel 262301326685)', 'Added by data correction 2026-10-12 (quick task 261012-mko)', NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rent_deductions WHERE id='7b1c9e2a-5d3f-4c8e-9a1b-262301326685'). With Task 3 deployed this shows in the ledger as a reduction and the October period reads as paid.
    Block 4, remaining pending deposits of older contracts (the presumption): UPDATE payments p JOIN leases l ON l.id=p.lease_id SET p.status='paid', p.paid_date=p.due_date, p.updated_at=NOW() WHERE p.notes='auto-generated deposit' AND p.status='pending' AND p.due_date < DATE(l.created_at).
    BEFORE and AFTER SELECTs: the three statements by id (id, amount, booking_date, match_status, matched_payment_id); the six payments by id (id, lease_id, status, amount, due_date, paid_date, notes); the rent_deductions row by id; and the Block 4 candidate set (SELECT p.id, p.lease_id, p.amount, p.due_date, l.created_at ... same WHERE) so the reviewer sees exactly what Block 4 will touch (before) and that it is empty (after).
    Then run the full verification: pnpm --filter @rentular/api test, pnpm --filter @rentular/api lint, pnpm --filter @rentular/web lint. Fix anything red in files owned by this plan. Do not deploy.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && F=.planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/prod-data-correction.sql && grep -c "START TRANSACTION" $F && grep -c "COMMIT" $F && grep -c "262301326685" $F && grep -c "ef9771fd-50e4-4841-855d-28d04f2647ae" $F && grep -c "96c8dcf6-c9e9-4c91-b235-6afe9bb89344" $F && ! grep -q "status *= *'pending'.*71ed942a" $F && pnpm --filter @rentular/api test && pnpm --filter @rentular/api lint && pnpm --filter @rentular/web lint</automated>
  </verify>
  <done>prod-data-correction.sql exists, is transactional, idempotent, keeps Bouchaouni's payment paid and matched, inserts the fixed-id rent_deductions row, repoints the two statements, resets the two deposits, presumes remaining older-contract deposits paid, and shows before/after selects; it has not been executed. All api tests and both typechecks pass; nothing deployed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| bank feed -> matcher | Transfer amounts and counterparty IBANs come from the bank connection; the matcher decides which tenant payment they settle |
| web -> API (leases, rent-adjustments, ledger) | Authenticated landlord input: priorPaymentsSettled flag, deduction amount/reason/leaseId |
| operator -> prod DB | Hand-run SQL file |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-mko-01 | Tampering | paymentPicker / assignStatementToLease | mitigate | Deposit only settled on exact amount; smaller transfers never close a larger row; auto pass leaves them unmatched (Task 1 tests) |
| T-mko-02 | Elevation | POST/DELETE /rent-adjustments/deductions from the ledger | mitigate | Existing checkLeasePropertyRole (manager / co_owner) verified in Task 3; foreign leaseId yields 403, not a cross-landlord write |
| T-mko-03 | Tampering | priorPaymentsSettled on PUT /leases/:id | mitigate | Route already requires manager role on the property; flip to true only marks the lease's own DEPOSIT_NOTE pending row |
| T-mko-04 | Repudiation | Data-correction SQL | mitigate | Every changed payment gets an appended note naming the bank transfer or the deduction; BEFORE/AFTER selects kept with the file |
| T-mko-05 | Information disclosure | IBAN in matcher logs | accept | Existing maskIban keeps last 4 digits only; unchanged |
| T-mko-SC | Tampering | npm installs | accept | No new packages are installed in this plan |
</threat_model>

<verification>
- pnpm --filter @rentular/api test is green, including paymentPicker.test.ts, rentDeductions.test.ts and the updated ibanMatcher.test.ts
- pnpm --filter @rentular/api lint and pnpm --filter @rentular/web lint pass
- grep shows no U+2014 / U+2013 characters in any string added to the four message files or the SQL file
- The quick dir holds leases-prior-payments-settled.sql and prod-data-correction.sql; neither has been run
</verification>

<success_criteria>
- A 1140 transfer against a lease with a pending 2080 deposit and a pending 1140 rent marks the rent paid (unit test), and the IBAN pass counts a non-fitting transfer as not assigned
- A 536.08 transfer against a 1050 rent with an applicable 513.92 deduction matches the rent; without the deduction it is left for review
- New lease with a past start date: the form shows the "already made" toggle (default on) in all four languages; the deposit row is created paid with notes exactly "auto-generated deposit"; a lease starting today or later keeps a pending deposit
- Ledger shows reductions per period, lets the landlord add one with the property-tax preset and remove it; the reminder worker treats rent net of deductions as the amount due
- prod-data-correction.sql reviewed in the quick dir, not executed; no deploy
</success_criteria>

<output>
Create `.planning/quick/261012-mko-fix-bank-matcher-assigning-rent-to-depos/261012-mko-SUMMARY.md` when done. Record: the persistence decision (column, not eager creation), the manual-assign decision (createWhenUnmatched records a separate paid payment), the Smovin import default (no checkbox, reason), the rent-adjustments ownership check finding, and a reminder that both SQL files in the quick dir are pending manual application on prod.
</output>
