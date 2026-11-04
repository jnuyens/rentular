import { and, eq, inArray } from "drizzle-orm";
import { getDb, indexationRecords, paymentAllocations, payments } from "@rentular/db";
import { isDepositNote } from "./expectedPayments";
import { deductedAmount, loadLeaseDeductions, type DeductionRow } from "./rentDeductions";

type Db = ReturnType<typeof getDb>;

/** One real indexation of a lease (status applied or notified). */
export type IndexRecord = {
  effectiveDate: string;
  previousRent: number;
  newRent: number;
};

/** The fields of a payment row needed to decide which month it pays. */
export type PaidRowLike = {
  status: string;
  amount: string | number;
  dueDate: string;
  paidDate?: string | Date | null;
  notes?: string | null;
  isIgnored?: boolean | null;
};

export type MonthSettlement = {
  dueDate: string;
  expected: number;
  received: number;
  shortfall: number;
  /** The pre-indexation amount when the tenant paid exactly that, else null. */
  oldRent: number | null;
  settled: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymd(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function sortedByDate(records: IndexRecord[]): IndexRecord[] {
  return [...records].sort((a, b) =>
    ymd(a.effectiveDate) < ymd(b.effectiveDate) ? -1 : ymd(a.effectiveDate) > ymd(b.effectiveDate) ? 1 : 0,
  );
}

/** The latest indexation that took effect on or before `dueDate`, if any. */
function latestRecordOnOrBefore(records: IndexRecord[], dueDate: string): IndexRecord | null {
  const due = ymd(dueDate);
  const before = sortedByDate(records).filter((r) => ymd(r.effectiveDate) <= due);
  return before.length > 0 ? before[before.length - 1]! : null;
}

/**
 * The rent in force on `dueDate`. After an indexation that is its new rent;
 * before the first indexation it is that indexation's previous rent. Without
 * any indexation it is the lease's current monthly rent.
 */
export function rentForDate(
  records: IndexRecord[],
  currentMonthlyRent: number,
  dueDate: string,
): number {
  const due = ymd(dueDate);
  const latest = latestRecordOnOrBefore(records, due);
  if (latest) return latest.newRent;
  const next = sortedByDate(records).find((r) => ymd(r.effectiveDate) > due);
  if (next) return next.previousRent;
  return currentMonthlyRent;
}

/** The due date (YYYY-MM-DD) of a month's rent, with the payment day clamped to the month length. */
export function dueDateForMonth(month: string, paymentDay: number | null | undefined): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(paymentDay ?? 1) || 1), lastDay);
  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m0 = Number(month.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m0 / 12);
  const nm = ((m0 % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}

/**
 * The month a payment row pays for. A row tagged to a rent period (its due date
 * differs from its paid date, e.g. a pending record marked paid) pays its due
 * date's month. An untagged bank-imported row (due date == paid date) pays the
 * month whose due date it lands near: up to 8 days early or 5 days late. When
 * no month fits, the month of its date is used.
 */
export function attributedMonth(row: PaidRowLike, paymentDay: number | null | undefined): string {
  const due = ymd(row.dueDate);
  const paid = row.paidDate ? ymd(row.paidDate) : null;
  if (!paid || paid !== due) return due.slice(0, 7);

  const paidDay = dayNumber(paid);
  const base = paid.slice(0, 7);
  let best: string | null = null;
  for (const candidate of [shiftMonth(base, -1), base, shiftMonth(base, 1)]) {
    const d = dayNumber(dueDateForMonth(candidate, paymentDay));
    if (paidDay >= d - 8 && paidDay <= d + 5) best = candidate; // later candidates win
  }
  return best ?? due.slice(0, 7);
}

function countsAsRent(row: PaidRowLike): boolean {
  return row.status === "paid" && !row.isIgnored && !isDepositNote(row.notes);
}

/**
 * Amount received for `month`: the paid rent rows attributed to it, or the
 * ledger allocations for it when those are larger. The two are alternative
 * views of the same money, so they are never added together.
 */
export function receivedForMonth(
  rows: PaidRowLike[],
  month: string,
  paymentDay: number | null | undefined,
  allocationSum = 0,
): number {
  return round2(unroundedReceived(rows, month, paymentDay, allocationSum));
}

function unroundedReceived(
  rows: PaidRowLike[],
  month: string,
  paymentDay: number | null | undefined,
  allocationSum: number,
): number {
  const rowsSum = rows
    .filter((r) => countsAsRent(r) && attributedMonth(r, paymentDay) === month)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return allocationSum > 0 ? Math.max(allocationSum, rowsSum) : rowsSum;
}

/**
 * The rent from before the latest indexation in force on `dueDate`, when the
 * received amount equals exactly what the tenant owed at that old rent.
 */
export function oldRentFor(
  records: IndexRecord[],
  dueDate: string,
  received: number,
  charges: number,
  deductions: number,
): number | null {
  const latest = latestRecordOnOrBefore(records, dueDate);
  if (!latest) return null;
  const owedAtOldRent = latest.previousRent + charges - deductions;
  return Math.abs(received - owedAtOldRent) < 0.01 ? latest.previousRent : null;
}

/** Short by a full cent or more? Measured in tenths of a cent to absorb float noise. */
function isShort(expected: number, received: number): boolean {
  return Math.round((expected - received) * 1000) >= 10;
}

// A month is settled only when the full expected amount for that month has
// been received, to the cent. Expected is the rent in force on the due date
// plus charges minus deductions. Each paid row counts for one month only;
// deposits never count.
export function monthSettlement(input: {
  rows: PaidRowLike[];
  allocationSum: number;
  records: IndexRecord[];
  monthlyRent: number;
  monthlyCharges: number;
  deductions: DeductionRow[];
  month: string;
  paymentDay: number | null | undefined;
}): MonthSettlement {
  const dueDate = dueDateForMonth(input.month, input.paymentDay);
  const charges = Number(input.monthlyCharges) || 0;
  const deducted = deductedAmount(input.deductions, dueDate);
  const rent = rentForDate(input.records, Number(input.monthlyRent) || 0, dueDate);
  const expected = Math.max(0, round2(rent + charges - deducted));
  const rawReceived = unroundedReceived(input.rows, input.month, input.paymentDay, input.allocationSum);
  const received = round2(rawReceived);
  const settled = expected <= 0 || !isShort(expected, rawReceived);
  const shortfall = settled ? 0 : round2(expected - received);
  const oldRent =
    received > 0 && !settled ? oldRentFor(input.records, dueDate, received, charges, deducted) : null;
  return { dueDate, expected, received, shortfall, oldRent, settled };
}

/**
 * A transfer that equals the pre-indexation amount of the oldest pending rent
 * row: the tenant still pays the rent from before the indexation. Returns the
 * row, the indexation difference and the old amount, or null.
 */
export function preIndexationMatch<
  T extends { amount: string | number; dueDate: string; notes?: string | null },
>(
  pending: T[],
  transfer: number,
  records: IndexRecord[],
): { row: T; diff: number; expectedOld: number } | null {
  const rows = pending
    .filter((p) => !isDepositNote(p.notes))
    .sort((a, b) => (ymd(a.dueDate) < ymd(b.dueDate) ? -1 : ymd(a.dueDate) > ymd(b.dueDate) ? 1 : 0));
  const row = rows[0];
  if (!row) return null;
  const record = latestRecordOnOrBefore(records, row.dueDate);
  if (!record) return null;
  const diff = round2(record.newRent - record.previousRent);
  if (!(diff > 0)) return null;
  const expectedOld = round2(Number(row.amount) - diff);
  if (Math.abs(transfer - expectedOld) >= 0.01) return null;
  return { row, diff, expectedOld };
}

/** Applied and notified indexations of the given leases, keyed by lease id. */
export async function loadIndexRecords(
  db: Db,
  leaseIds: string[],
): Promise<Map<string, IndexRecord[]>> {
  const out = new Map<string, IndexRecord[]>();
  const ids = [...new Set(leaseIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      leaseId: indexationRecords.leaseId,
      effectiveDate: indexationRecords.effectiveDate,
      previousRent: indexationRecords.previousRent,
      newRent: indexationRecords.newRent,
    })
    .from(indexationRecords)
    .where(
      and(
        inArray(indexationRecords.leaseId, ids),
        inArray(indexationRecords.status, ["applied", "notified"]),
      ),
    );
  for (const r of rows) {
    const list = out.get(r.leaseId) ?? [];
    list.push({
      effectiveDate: String(r.effectiveDate).slice(0, 10),
      previousRent: Number(r.previousRent),
      newRent: Number(r.newRent),
    });
    out.set(r.leaseId, list);
  }
  return out;
}

/**
 * Settlement of one lease's rent month, loaded from the database: paid rows,
 * ledger allocations, indexations and deductions. `paidRowId` is the first paid
 * row counted for the month, or null.
 */
export async function loadMonthStatus(
  db: Db,
  lease: {
    id: string;
    monthlyRent: string | number | null;
    monthlyCharges: string | number | null;
    paymentDay: number | null;
  },
  month: string,
): Promise<MonthSettlement & { paidRowId: string | null }> {
  const rows = await db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      notes: payments.notes,
      isIgnored: payments.isIgnored,
    })
    .from(payments)
    .where(and(eq(payments.leaseId, lease.id), eq(payments.status, "paid")));
  const allocs = await db
    .select({ amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.leaseId, lease.id), eq(paymentAllocations.periodMonth, month)));
  const allocationSum = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const records = (await loadIndexRecords(db, [lease.id])).get(lease.id) ?? [];
  const deductions = await loadLeaseDeductions(db, lease.id);

  const settlement = monthSettlement({
    rows,
    allocationSum,
    records,
    monthlyRent: Number(lease.monthlyRent) || 0,
    monthlyCharges: Number(lease.monthlyCharges) || 0,
    deductions,
    month,
    paymentDay: lease.paymentDay,
  });
  const paidRow = rows.find(
    (r) => countsAsRent(r) && attributedMonth(r, lease.paymentDay) === month,
  );
  return { ...settlement, paidRowId: paidRow?.id ?? null };
}
