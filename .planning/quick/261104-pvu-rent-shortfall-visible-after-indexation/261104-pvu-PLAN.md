---
phase: quick-261104-pvu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/services/monthReceived.ts
  - apps/api/src/services/__tests__/monthReceived.test.ts
  - apps/api/src/services/expectedPayments.ts
  - apps/api/src/services/__tests__/expectedPayments.test.ts
  - apps/api/src/jobs/paymentCheckWorker.ts
  - apps/api/src/routes/payments.ts
  - apps/api/src/routes/__tests__/writeGuards.test.ts
  - apps/api/src/services/manualReminder.ts
  - apps/api/src/services/__tests__/manualReminder.test.ts
  - apps/api/src/routes/indexation.ts
  - apps/api/src/services/reconciliationAssign.ts
  - apps/api/src/services/ibanMatcher.ts
  - apps/api/src/services/__tests__/ibanMatcher.test.ts
  - apps/web/app/(dashboard)/overview/page.tsx
  - apps/web/messages/en/common.json
  - apps/web/messages/nl/common.json
  - apps/web/messages/fr/common.json
  - apps/web/messages/de/common.json
autonomous: true
requirements: [QUICK-261104-PVU]

must_haves:
  truths:
    - "A rent month is settled only when the full expected amount for that month (rent in force on the due date + charges - deductions) has been received, to the cent (received >= expected - 0.01). No 90% floor, no 3.5x cap."
    - "Each paid row counts toward exactly one month; allocations combine with rows via max, never sum; deposits never count"
    - "Dashboard: settled months add expectedNet to paid; partially received months add received to paid and the shortfall to overdue (past due) or to come, with 'paid X of Y' and, when the tenant paid exactly the pre-indexation amount, a 'still paying the rent from before the indexation' note"
    - "Prior months are evaluated once per lease+month: settled months count 0, partial months count only their shortfall, unreceived months count their pending rows as today; never double counted"
    - "The payment check worker uses the same exact settlement with the rent in force on the due date; for a partially paid month the reminder and landlord late email amount is the shortfall"
    - "Mark-month-paid on a partially paid month records only the remaining amount; manual reminder asks for the shortfall and never creates a full-rent pending row for a partly paid month"
    - "Applying an indexation raises pending rent rows due on/after the effective date"
    - "A bank transfer equal to the pre-indexation amount of the oldest pending rent row is matched to that row, with a note"
    - "No new automatic reminder paths for months without a pending row"
  artifacts:
    - path: "apps/api/src/services/monthReceived.ts"
      provides: "rentForDate, dueDateForMonth, attributedMonth, receivedForMonth, monthSettlement, oldRentFor, preIndexationMatch, loadIndexRecords, loadMonthStatus"
      exports: ["rentForDate", "receivedForMonth", "monthSettlement", "preIndexationMatch", "loadMonthStatus"]
    - path: "apps/api/src/services/__tests__/monthReceived.test.ts"
      provides: "Unit tests incl. Carnotstraat 65 b102 and Tervuursestraat 97 fixtures and the ported coversMonthRent cases"
  key_links:
    - from: "apps/api/src/routes/payments.ts (GET /dashboard)"
      to: "monthReceived.monthSettlement"
      via: "per lease+month settlement for current and prior months"
      pattern: "monthSettlement\\("
    - from: "apps/api/src/jobs/paymentCheckWorker.ts"
      to: "monthReceived.loadMonthStatus"
      via: "periodSettlement replacing isPeriodSettled"
      pattern: "loadMonthStatus\\("
    - from: "apps/api/src/services/reconciliationAssign.ts"
      to: "monthReceived.preIndexationMatch"
      via: "fallback when pickPaymentForTransfer returns null"
      pattern: "preIndexationMatch\\("
    - from: "apps/web/app/(dashboard)/overview/page.tsx"
      to: "item.shortfall / item.expected / item.received / item.oldRent"
      via: "bucket item rendering"
      pattern: "item\\.shortfall"
---

<objective>
Rent coverage becomes exact: a month is paid only when its full expected amount has been received, to the cent. Under-paid months (especially a tenant still paying the pre-indexation rent) become visible on the overview, in prior-month overdue, in the payment check worker, mark-paid and manual reminders.

Purpose: Owner requirement: "especially after indexation, it's important to verify if the old amount is still being paid, at least for a few months", and the owner's correction that coverage must be exact (the 0.9x / 3.5x rule in coversMonthRent, introduced in commit 01bd76a, never matched that commit's own intent "treat any amount >= the rent as covering it").

Prod cases (verified by the orchestrator; executor must NOT touch prod and must NOT deploy):
- Carnotstraat 65 b102 (lease 2243d291-5d2a-4d4e-88bc-4361d3005362): indexed 900 to 925 effective 2026-11-01; Nov row (due 2026-11-04) bank-matched and paid 900 on 2026-11-02 (tagged). Expected Nov: received 900 of 925, shortfall 25 overdue, oldRent 900.
- Tervuursestraat 97 (lease 167863a8-e57e-45c6-ad5a-dc9e16c65e9d): indexed 780 to 810 effective 2026-11-01, payment day 2. Nov row 5a6f3b44 is pending, amount 810, due 2026-11-02. The only Nov transfer is a separate paid row 740 with dueDate = paidDate = 2026-10-29 (untagged, attributed to Nov by the window). Oct row due 2026-10-02 paid 2026-09-29, 780 (tagged to Oct). Expected: Oct settled (780 of 780, rent in force before the indexation), the 740 row does NOT count for Oct; Nov received 740 of 810, shortfall 70 overdue, counted ONCE (not 810 pending plus 70).
- With the exact rule only these two leases have paid rows below the contract amount since June, and all earlier ones equal the rent in force then, which is why rentForDate must be used for past months.
- Overview after deploy (Nov 2026), relative to the current 90% rule: Betaald drops by the two shortfalls (25 + 70 = 95; both leases are counted as fully paid today because 900 >= 0.9*925 and 740 >= 0.9*810), Achterstallig rises by 95, Verwacht stays 10189 unless a lease with an active deduction exists (see Task 2 note). Carnotstraat is flagged as still paying the pre-indexation rent.
</objective>

<execution_context>
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/workflows/execute-plan.md
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

Global rules for every task: no schema changes, never run db:generate, no em-dashes or en-dashes anywhere (code, comments, copy, commit messages), no Co-Authored-By lines in commits, match surrounding style (relative imports in API, `[Prefix]` logs), do not deploy, do not touch prod. Keep amountMatcher, ibanMatcher (except item f below), transactionMatcher and paymentPicker matching logic as is (they already use an exact 0.01 tolerance).

Fuzzy amount comparisons found by repo grep (multipliers against rent/amount, percent tolerances): only one, `apps/api/src/services/expectedPayments.ts:206` `if (amt < rent * 0.9 || amt > rent * 3.5) return false;` inside coversMonthRent. It is removed by this plan (coversMonthRent is deleted). The remaining tolerances are all exact-cent (0.01): amountMatcher.ts:44 AMOUNT_TOLERANCE, ibanMatcher.ts:15 AMOUNT_TOLERANCE, paymentPicker.ts:34 tolerance, transactionMatcher.ts:44 tolerance. Executor: rerun `grep -rnE "\* ?0\.[5-9]|\* ?1\.[1-9]|tolerance" apps/api/src apps/web/app apps/web/lib apps/web/components --include=*.ts --include=*.tsx | grep -v __tests__` after the change and fix anything new that compares an amount to rent with a non-cent tolerance.

<interfaces>
Verified line references (2026-11-04):

apps/api/src/services/expectedPayments.ts
- l.14 `export function isDepositNote(notes): boolean`
- l.196-232 `export function coversMonthRent(p, dueDate, rent): boolean` (to be deleted; attribution logic: tagged = p.dueDate month equals target month; untagged = p.dueDate == p.paidDate and paid within due-8d..due+5d)
- l.250 ensureCurrentMonthPayment(lease): rent = Number(lease.monthlyRent) (l.252); l.264-274 loads all rows of the lease (id, status, amount, dueDate, paidDate, notes); l.277 `covered = existing.some(p => coversMonthRent(p, due, rent))`; when covered, deletes stale auto-generated pending rows of that month (l.278-290).
- tests: apps/api/src/services/__tests__/expectedPayments.test.ts l.126-205 `describe("coversMonthRent")` with helpers tagged(amount, dueDate, paidDate, notes?) and bank(amount, date).

apps/api/src/services/rentDeductions.ts
- l.6 `export type DeductionRow`; l.49 `deductedAmount(rows, dueDate): number`; l.129 `loadLeaseDeductions(db, leaseId)` (single lease).

packages/db/src/schema/indexation.ts `indexationRecords`: id, leaseId, effectiveDate (date, string mode), previousRent, newRent (decimal strings), status enum calculated|notified|applied|disputed. Only "applied" and "notified" rows are real indexations.

packages/db `paymentAllocations`: leaseId, periodMonth (YYYY-MM), amount.

apps/api/src/jobs/paymentCheckWorker.ts
- l.42 imports coversMonthRent.
- l.56-86 `async function isPeriodSettled(db, leaseId, dueDate, monthlyRent): Promise<boolean>` (rent net of deductions, allocations >= due, else paid.some(coversMonthRent)).
- Call sites: l.214 (due-date notice loop, lease select l.205-212 has ownerId, propertyId, monthlyRent; message amount at l.265 `€${Number(p.amount).toFixed(2)}`), l.374 (overdue reminder flow; amounts at l.423, l.506, l.562 `Number(payment.amount)`; interest settings near l.457), l.679 (landlord late notify loop; amount at l.719).

apps/api/src/routes/payments.ts
- l.14 imports coversMonthRent.
- l.301 GET /dashboard. l.360-371 `rows` select (leaseId, status, amount, dueDate, paidDate, isIgnored, notes) innerJoin leases for accessibleIds; l.373 byLease (non-ignored). l.383-396 allocations for selected `month` only. l.420-485 per-lease loop (BucketItem l.425; rent = monthlyRent + monthlyCharges; due from paymentDay; start/end checks; `covered` l.469-472 compares against monthlyRent only). l.487 expectedThisMonth. l.496-509 priorCutoff + priorOverdue loop using coversMonthRent(q, p.dueDate, p.amount). l.511-527 response.
- l.670 POST /mark-month-paid: l.694-701 rows of the month; `alreadyPaid` returns `{ id, status: "paid", already: true }`; then pending target or a newly created pending row is marked paid.

apps/api/src/routes/__tests__/writeGuards.test.ts l.55 mocks `coversMonthRent: vi.fn()` in the expectedPayments mock.

apps/api/src/services/manualReminder.ts sendManualReminder l.29; l.71-78 rows of the month and `usable`; l.84-102 amount/paymentId (inserts a pending full-rent row when none exists); l.136+ paymentInfo { paymentId, amount, dueDate }. Test mocks @rentular/db with a select chain (manualReminder.test.ts l.50).

apps/api/src/routes/indexation.ts POST /apply/:leaseId l.976; previous rent l.1027-1028 (`calc.lease.currentMonthlyRent || calc.lease.monthlyRent`); calc.effectiveDate; lease update l.1048-1061.

apps/api/src/services/reconciliationAssign.ts assignStatementToLease l.72: pending select (id, amount, dueDate, notes) ordered by dueDate; l.95 pickPaymentForTransfer; l.101-109 `if (!target)` branch; l.111-132 mark paid + match statement.

apps/api/src/services/ibanMatcher.ts l.23 `expectedAmountsForLease(db, leaseId, monthlyRent): Promise<number[]>` returns [raw] or [raw, net]; ibanMatcher.test.ts mocks @rentular/db (l.50).

apps/web/app/(dashboard)/overview/page.tsx: bucket item type l.25-32, `eur` formatter l.51, `useTranslations("overview")` l.55, item rendering l.480-494. i18n namespace "overview" at en common.json l.1269.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Exact settlement helper + tests; switch ensureCurrentMonthPayment and the payment check worker to it</name>
  <files>apps/api/src/services/monthReceived.ts, apps/api/src/services/__tests__/monthReceived.test.ts, apps/api/src/services/expectedPayments.ts, apps/api/src/services/__tests__/expectedPayments.test.ts, apps/api/src/jobs/paymentCheckWorker.ts</files>
  <behavior>
    rentForDate:
    - records [{2026-11-01, 900, 925}], current 925: due 2026-11-04 -> 925; due 2026-10-04 -> 900; no records -> current.
    - two records (2025-11-01 880->900, 2026-11-01 900->925): due 2026-03-04 -> 900; due 2025-05-04 -> 880.
    attributedMonth / receivedForMonth:
    - tagged row (dueDate 2026-11-04, paidDate 2026-11-20) -> Nov only.
    - untagged row (dueDate == paidDate 2026-10-30), paymentDay 4 -> Nov (due-8d <= paid <= due+5d), not Oct.
    - untagged row qualifying for two months -> the later month; qualifying for none -> month of its dueDate.
    - deposit-note, ignored and non-paid rows -> 0. allocations 925 with rows 900 -> 925 (max, never sum).
    monthSettlement (exact rule), ported from the old coversMonthRent describe block (l.126-205 in expectedPayments.test.ts) with the same tagged()/bank() helpers and the same dates:
    - every case that was true there stays settled, every false stays unsettled, EXCEPT exact-rule changes: a 90% payment (e.g. 945 against 1050) is NOT settled; 1050 - 0.005 against 1050 IS settled; a 4x payment tagged to the month IS settled for that month only (no cap, no spill into the next month).
    - charges included: rent 900 + charges 50, received 900 -> shortfall 50.
    - deduction applies: rent 900, deduction 100 on that due date, received 800 -> settled.
    - expected <= 0 (full free period) -> settled.
    Fixture Carnotstraat 65 b102: records [{2026-11-01, 900, 925}], monthlyRent 925, charges 0, paymentDay 4, rows [paid 900 dueDate 2026-11-04 paidDate 2026-11-02]: Nov -> expected 925, received 900, shortfall 25, oldRent 900, settled false.
    Fixture Tervuursestraat 97: records [{2026-11-01, 780, 810}], monthlyRent 810, charges 0, paymentDay 2, rows [pending 810 due 2026-11-02; paid 740 due=paid 2026-10-29; paid 780 due 2026-10-02 paid 2026-09-29]: Nov -> expected 810, received 740, shortfall 70, oldRent null; Oct -> expected 780, received 780, settled true (the 740 row does not count for Oct).
    preIndexationMatch:
    - pending [{a, 925, 2026-11-04}], records [{2026-11-01, 900, 925}], transfer 900 -> { row a, diff 25, expectedOld 900 }; transfer 925 -> null; row due before effective date -> null; deposit-note rows skipped; newRent <= previousRent -> null.
  </behavior>
  <action>
Create apps/api/src/services/monthReceived.ts (style of rentDeductions.ts: pure functions plus async loaders taking `db` as a parameter):
- `IndexRecord = { effectiveDate: string; previousRent: number; newRent: number }`.
- `rentForDate(records, currentMonthlyRent, dueDate)`: newRent of the latest record with effectiveDate <= dueDate; else previousRent of the earliest record with effectiveDate > dueDate; else currentMonthlyRent (string compare on YYYY-MM-DD, sort a copy).
- `dueDateForMonth(month, paymentDay)`: day = min(max(1, floor(paymentDay ?? 1) || 1), last day of month), same as payments.ts l.441-443.
- `PaidRowLike = { status; amount: string|number; dueDate: string; paidDate?: string|Date|null; notes?: string|null; isIgnored?: boolean|null }`.
- `attributedMonth(row, paymentDay)`: tagged (no paidDate or dueDate day != paidDate day) -> month of dueDate. Untagged -> candidates = paidDate's month, the one before, the one after; qualifies when dueDateForMonth(candidate) satisfies due-8d <= paid <= due+5d (the window coversMonthRent used); pick the latest qualifying; none -> month of dueDate. Normalize a Date paidDate via toISOString().slice(0,10), strings via slice(0,10).
- `receivedForMonth(rows, month, paymentDay, allocationSum = 0)`: sum of paid, non-ignored, non-deposit (isDepositNote) rows attributed to month; return round2(allocationSum > 0 ? max(allocationSum, rowsSum) : rowsSum).
- `oldRentFor(records, dueDate, received, charges, deductions)`: previousRent of the latest record with effectiveDate <= dueDate when |received - (previousRent + charges - deductions)| < 0.01, else null.
- `monthSettlement(input: { rows; allocationSum; records; monthlyRent; monthlyCharges; deductions: DeductionRow[]; month; paymentDay })` returning `{ dueDate, expected, received, shortfall, oldRent, settled }`: dueDate = dueDateForMonth; expected = max(0, round2(rentForDate(records, monthlyRent, dueDate) + charges - deductedAmount(deductions, dueDate))); received = receivedForMonth; settled = expected <= 0 || received >= expected - 0.01; shortfall = settled ? 0 : round2(expected - received); oldRent = received > 0 && !settled ? oldRentFor(...) : null. Put this comment above it: "A month is settled only when the full expected amount for that month has been received, to the cent. Expected is the rent in force on the due date plus charges minus deductions. Each paid row counts for one month only; deposits never count."
- `preIndexationMatch(pending, transfer, records)`: oldest (by dueDate) non-deposit pending row; latest record with effectiveDate <= row.dueDate; diff = newRent - previousRent must be > 0; expectedOld = round2(Number(row.amount) - diff); match when |transfer - expectedOld| < 0.01; returns { row, diff, expectedOld } or null.
- `loadIndexRecords(db, leaseIds)`: one select on indexationRecords with inArray(leaseId) and inArray(status, ["applied","notified"]), grouped into Map<leaseId, IndexRecord[]> with Number() conversions; empty input returns an empty map without querying.
- `loadMonthStatus(db, lease: { id; monthlyRent; monthlyCharges; paymentDay }, month)`: loads the lease's paid rows (id, status, amount, dueDate, paidDate, notes, isIgnored), allocation sum for (leaseId, month), loadIndexRecords([id]), loadLeaseDeductions(db, id); returns monthSettlement(...) plus `paidRowId` (id of the first paid row attributed to the month, or null).

Tests: create monthReceived.test.ts with every case in <behavior> (pure functions only). Move the coversMonthRent describe block out of expectedPayments.test.ts into monthReceived.test.ts as monthSettlement cases (exact semantics); remove the coversMonthRent import there.

expectedPayments.ts ensureCurrentMonthPayment (l.250-290): replace `existing.some(coversMonthRent(...))` with monthSettlement using the already loaded `existing` rows (add isIgnored to that select), loadIndexRecords([lease.id]), loadLeaseDeductions, the month's allocation sum (one select on paymentAllocations for lease+month), lease.monthlyRent, lease.monthlyCharges, lease.paymentDay; covered = settled. Keep the stale-pending deletion only when settled (Tervuursestraat's pending 810 Nov row must survive). Leave coversMonthRent exported for now (payments.ts still imports it until Task 2 deletes it).

paymentCheckWorker.ts: replace isPeriodSettled with `async function periodSettlement(db, lease: { id; monthlyRent; monthlyCharges; paymentDay }, dueDate): Promise<{ settled: boolean; received: number; shortfall: number }>` that calls loadMonthStatus(db, lease, dueDate.slice(0,7)), so it uses the rent in force on the due date and includes charges. Add monthlyCharges, paymentDay (and id) to the lease selects feeding the three call sites (l.205-212, the lease select before l.374, the one before l.679). At each call site `continue` when settled. Message amount: when received > 0.01 and not settled, use the shortfall instead of Number(p.amount) / Number(payment.amount) at l.265, l.423, l.506, l.562, l.719 (compute `const amountDue = s.received > 0.01 ? s.shortfall : Number(payment.amount)` once per payment and use it everywhere the amount goes into a message, interest calculation or landlord email). Remove the coversMonthRent import. Do not add any new loop or reminder path; only pending rows already visited by these loops are affected.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/api && npx vitest run src/services/__tests__/monthReceived.test.ts src/services/__tests__/expectedPayments.test.ts && npx tsc --noEmit -p .</automated>
  </verify>
  <done>All settlement cases (including both prod fixtures and the ported coversMonthRent cases under exact semantics) pass; ensureCurrentMonthPayment and the worker no longer use coversMonthRent; API typechecks.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Dashboard, mark-month-paid, manual reminder, indexation apply, pre-indexation matcher; delete coversMonthRent</name>
  <files>apps/api/src/routes/payments.ts, apps/api/src/routes/__tests__/writeGuards.test.ts, apps/api/src/services/expectedPayments.ts, apps/api/src/services/manualReminder.ts, apps/api/src/services/__tests__/manualReminder.test.ts, apps/api/src/routes/indexation.ts, apps/api/src/services/reconciliationAssign.ts, apps/api/src/services/ibanMatcher.ts, apps/api/src/services/__tests__/ibanMatcher.test.ts</files>
  <behavior>
    - manualReminder: month with paid 900 attributed and expected 925 -> reminder amount 25, no payments insert.
    - manualReminder: Tervuursestraat-like month (pending 810 row, untagged 740 attributed) -> amount 70, paymentId = the pending row, no insert.
    - manualReminder: nothing received -> unchanged behaviour (existing tests pass).
  </behavior>
  <action>
(a) GET /dashboard (payments.ts l.301-527). Add leases.monthlyRent, leases.monthlyCharges, leases.paymentDay, leases.startDate, leases.endDate to the `rows` select (l.360-371) so prior-month evaluation has lease data for every row's lease. Batch-load once (no N+1): loadIndexRecords for all lease ids present in rows and activeLeaseRows; deductions via one inArray select on the rent deductions table grouped by leaseId with the same column shape loadLeaseDeductions returns; allocations widened (l.383-396) to no periodMonth filter or periodMonth >= the earliest month needed, keyed `${leaseId}|${periodMonth}`.
Current month loop: replace the `covered` check (l.469-472) with s = monthSettlement(lps, allocation for the month, records, monthlyRent, monthlyCharges, deductions, month, paymentDay). Charges are now part of the decision. Extend BucketItem with optional `shortfall?: boolean; expected?: number; received?: number; oldRent?: number`. If s.settled: paidThisMonth += s.expected, paidItems. Else if s.received > 0.01: paidThisMonth += s.received; add s.shortfall to overdueThisMonth (due < todayStr) or toComeThisMonth; push to that bucket with rentDue = s.shortfall, shortfall: true, expected: s.expected, received: s.received, oldRent when non-null. Else (nothing received): overdue/toCome exactly as today (rentDue = rent). Note for the summary: settled leases now add expected (net of deductions) instead of monthlyRent + charges; report any lease where this differs.
Prior months (replace l.496-508): build a Map keyed `${leaseId}|${YYYY-MM}` of candidate months from (i) every non-ignored, non-deposit pending/failed row with dueDate < priorCutoff (collect the row amounts per key) and (ii) for each active lease, the 6 calendar months before the selected month whose dueDateForMonth < priorCutoff, not before the lease start month, not after a sane end date. Evaluate each key once with monthSettlement (lease data from the row or activeLeaseRows). Contribution: settled -> 0; received > 0.01 -> shortfall, and push an overdueItems entry with dueDate = s.dueDate and the shortfall fields; nothing received -> the sum of that key's pending/failed row amounts (today's behaviour; lookback-only keys with nothing received contribute 0, no pending row means nothing to chase). overdueTotal = overdueThisMonth + priorOverdue. Comment that each lease+month is evaluated once so a pending row and a shortfall are never both counted.

(b) POST /mark-month-paid (l.694+): call loadMonthStatus(db, lease, month) first. If settled and a paid row exists -> existing already:true response. If received > 0.01 and shortfall > 0: if a non-ignored pending/processing row exists for the month, mark it paid with amount = rentAmount = String(shortfall), chargesAmount "0", paidDate, method, notes "remaining amount after partial payment" appended (reusing it avoids an orphaned pending row that would later be dunned); otherwise insert a new paid row { leaseId, status "paid", amount and rentAmount String(shortfall), chargesAmount "0", dueDate s.dueDate, paidDate (given date or today, same form as this handler's existing paid update), method, notes "remaining amount after partial payment" }; return `{ data: { id, status: "paid", remainder: shortfall } }`. Nothing received -> existing flow unchanged.

(c) manualReminder.ts (l.71-102): call loadMonthStatus(db, lease, input.periodMonth). When received > 0.01 and shortfall > 0: amount = shortfall; paymentId = usable?.id ?? status.paidRowId; dueForTemplate = usable?.dueDate ?? status.dueDate; never insert. Otherwise unchanged. Update manualReminder.test.ts select-chain mocks for the extra queries and add the <behavior> cases.

(d) indexation.ts POST /apply/:leaseId, after the lease update (l.1048-1061): previousRent = Number(value at l.1027-1028), diff = newRent - previousRent; when diff != 0, select this lease's payments with status "pending", isIgnored false, dueDate >= calc.effectiveDate; for each non-deposit row with rentAmount null or |Number(rentAmount) - previousRent| < 0.01: amount = String(round2(Number(amount) + diff)), rentAmount = String(newRent), updatedAt new Date(). Log `[Indexation] raised N pending rows for lease ${leaseId}`.

(e) reconciliationAssign.ts `if (!target)` (l.101): before returning null or recordPaidFromTransfer, records = (await loadIndexRecords(db, [leaseId])).get(leaseId) ?? []; m = preIndexationMatch(pending, Number(statement.amount), records). On a match: read the row's rentAmount; set status "paid", paidDate as the existing path, amount String(transfer), rentAmount reduced by m.diff when not null, notes appended "Paid the rent from before the indexation (X instead of Y)" with X = expectedOld.toFixed(2), Y = Number(row.amount).toFixed(2); match the statement like l.123-131; return { paymentId, created: false }. Applies in automatic and manual modes. Factor mark-paid + match-statement into one local function shared with the normal path.

(f) ibanMatcher.ts expectedAmountsForLease: load index records for the lease; when the latest record with effectiveDate <= oldestRent.dueDate has diff > 0, append round2(raw - diff) to the list (deduplicated). Adjust ibanMatcher.test.ts db mocks if the extra select breaks them.

(g) Delete coversMonthRent from expectedPayments.ts (no remaining callers), drop it from the payments.ts import and from the writeGuards.test.ts mock (l.55). Confirm with `grep -rn coversMonthRent apps/api/src` returning nothing.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/api && npx vitest run && npx tsc --noEmit -p . && ! grep -rn "coversMonthRent\|rent \* 0\.9\|rent \* 3\.5" src</automated>
  </verify>
  <done>Full API suite passes (about 410 existing plus new), API typecheck clean, coversMonthRent gone; dashboard counts each lease+month once with exact settlement and returns shortfall fields; mark-paid, reminder, indexation apply and matcher behave as described.</done>
</task>

<task type="auto">
  <name>Task 3: Overview UI shortfall line + i18n in four languages</name>
  <files>apps/web/app/(dashboard)/overview/page.tsx, apps/web/messages/en/common.json, apps/web/messages/nl/common.json, apps/web/messages/fr/common.json, apps/web/messages/de/common.json</files>
  <action>
In overview/page.tsx extend the bucket item type (l.25-32) with optional shortfall?: boolean, expected?: number, received?: number, oldRent?: number. In the item renderer (l.480-494, next to `{item.tenantName} &middot; {t("dueLabel")} ...`) add, when item.shortfall, a line under the tenant line: t("shortfallPaidOf", { received: eur(item.received ?? 0), expected: eur(item.expected ?? 0), remaining: eur(item.rentDue) }) and, when item.oldRent is set, a second line t("shortfallOldRent"). Use the existing eur() (l.51) and the muted text style (text-xs text-muted-foreground). The amount column keeps showing item.rentDue (the shortfall).

Add to the "overview" namespace in all four files:
- en: shortfallPaidOf "Paid {received} of {expected}. {remaining} still to pay."; shortfallOldRent "Still paying the rent from before the indexation."
- nl: "Betaald {received} van {expected}. Nog {remaining}."; "Betaalt nog de huur van vóór de indexering."
- fr: "Payé {received} sur {expected}. Reste {remaining}."; "Paie encore le loyer d'avant l'indexation."
- de: "{received} von {expected} bezahlt. Noch {remaining} offen."; "Zahlt noch die Miete von vor der Indexierung."
Keep JSON valid. No em-dashes or en-dashes.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/web && npx tsc --noEmit -p . && for l in en nl fr de; do node -e "const j=require('./messages/$l/common.json'); if(!j.overview.shortfallPaidOf||!j.overview.shortfallOldRent) process.exit(1)" || exit 1; done && ! grep -n $'—\|–' "app/(dashboard)/overview/page.tsx" messages/*/common.json ../api/src/services/monthReceived.ts</automated>
  </verify>
  <done>Web typecheck clean; keys present in all four locales; shortfall items render "paid X of Y" plus the pre-indexation note when oldRent is set; no em/en-dashes in changed files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser to API | mark-month-paid and manual reminder take leaseId/month from the client |
| bank import to matcher | transfer amounts come from external bank statements |
| worker to tenant | automatic reminders and landlord emails carry amounts |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pvu-01 | Elevation | POST /mark-month-paid remainder | mitigate | Existing getUserPropertyRole + hasMinimumRole(manager) check runs before the new branch; no new route |
| T-pvu-02 | Information disclosure | GET /dashboard batch loads | mitigate | Index records, deductions and allocations loaded only for lease ids from rows/activeLeaseRows already scoped to accessibleIds |
| T-pvu-03 | Tampering | preIndexationMatch auto-assign | mitigate | Exact 0.01 match on the oldest pending rent row of the already-resolved lease; note appended for audit |
| T-pvu-04 | Tampering | indexation apply bulk update | mitigate | Limited to this leaseId, pending, non-ignored, non-deposit rows with rentAmount null or equal to previousRent |
| T-pvu-05 | Repudiation | worker reminder amounts | mitigate | Shortfall amount only for pending rows the worker already visits; no new reminder paths |
</threat_model>

<verification>
- `cd apps/api && npx vitest run` all passing; `npx tsc --noEmit -p .` clean in apps/api and apps/web.
- `grep -rn coversMonthRent apps/api/src` empty; no schema or migration files in the diff.
- No em/en-dashes in changed files or commit messages; no Co-Authored-By lines.
</verification>

<success_criteria>
Coverage is exact to the cent everywhere (dashboard, prior-month overdue, ensureCurrentMonthPayment, payment check worker). Both prod fixtures produce the expected settlements in unit tests (Carnotstraat Nov 900/925 shortfall 25 with oldRent; Tervuursestraat Oct settled 780, Nov 740/810 shortfall 70 counted once). Partially paid months are visible with received, expected and remaining; mark-paid, manual reminder, indexation apply and the bank matcher handle partial and pre-indexation payments. Not deployed.
</success_criteria>

<output>
Create `.planning/quick/261104-pvu-rent-shortfall-visible-after-indexation/261104-pvu-SUMMARY.md` when done
</output>
