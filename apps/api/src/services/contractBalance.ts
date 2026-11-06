import { eq } from "drizzle-orm";
import { getDb, leases, paymentAllocations, payments } from "@rentular/db";
import { isDepositNote } from "./expectedPayments";
import {
  attributedMonth,
  dueDateForMonth,
  loadIndexRecords,
  monthSettlement,
  type IndexRecord,
  type MonthSettlement,
  type PaidRowLike,
} from "./monthReceived";
import { loadLeaseDeductions, type DeductionRow } from "./rentDeductions";

type Db = ReturnType<typeof getDb>;

/**
 * Marks money on a paid row that pays off older arrears (rent from before the
 * contract was tracked here, or otherwise not in the payment history). Such
 * money is not credit for later months. Stored as one line in the row's notes:
 * "[arrears repayment: 410.00]".
 */
export const ARREARS_MARKER = "arrears repayment";

const ARREARS_RE = /\[arrears repayment: (\d+(?:\.\d{1,2})?)\]/;

/** The arrears amount marked on a row's notes, or 0. */
export function arrearsAmount(notes: string | null | undefined): number {
  const m = notes ? ARREARS_RE.exec(notes) : null;
  return m ? Math.round(Number(m[1]) * 100) / 100 : 0;
}

/**
 * The notes with the arrears mark set to `amount` (removed when 0). Other
 * lines stay as they are, so the deposit and remainder prefixes are kept.
 */
export function withArrearsMark(notes: string | null | undefined, amount: number): string | null {
  const lines = (notes ?? "").split("\n").filter((l) => !ARREARS_RE.test(l));
  if (amount > 0) lines.push(`[${ARREARS_MARKER}: ${amount.toFixed(2)}]`);
  const out = lines.join("\n").replace(/^\n+|\n+$/g, "");
  return out.length > 0 ? out : null;
}

/** A transfer from a known tenant booked although its amount fit no open payment. */
export const ODD_AMOUNT_MARKER = "[odd amount]";
/** The part of such a transfer left over after every open month was paid. */
export const CREDIT_MARKER = "[credit]";

export function isOddAmountNote(notes: string | null | undefined): boolean {
  return notes != null && notes.includes(ODD_AMOUNT_MARKER);
}

export function isCreditNote(notes: string | null | undefined): boolean {
  return notes != null && notes.includes(CREDIT_MARKER);
}

/** A payment row of the lease, any status. */
export type BalanceRow = PaidRowLike & { id?: string };

export type BalanceLease = {
  monthlyRent: string | number | null;
  monthlyCharges: string | number | null;
  paymentDay: number | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
};

export type BalanceMonth = MonthSettlement & {
  month: string;
  /** What this month adds to the amount owed (its expected rent, or what came in when ignored). */
  counted: number;
  ignored: boolean;
};

export type ContractBalance = {
  /** Rent due so far, summed over the tracked months. */
  expected: number;
  /** Everything received as rent, without money marked as paying older arrears. */
  received: number;
  /** Money marked as paying older arrears. */
  arrearsRepaid: number;
  /**
   * Rent paid ahead for a month whose due date is still to come. It is not
   * credit: it settles that month once it is due.
   */
  paidInAdvance: number;
  /** What the tenant still owes on the contract (0 when even or in credit). */
  owed: number;
  /** What the tenant paid more than was due (0 when something is owed). */
  credit: number;
  /** First month of the tracking window (see trackingStart), or null when nothing is tracked yet. */
  fromMonth: string | null;
  perMonth: BalanceMonth[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cents(n: string | number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100);
}

function ymd(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function isRent(row: PaidRowLike): boolean {
  return !isDepositNote(row.notes);
}

function isOpen(status: string): boolean {
  return status === "pending" || status === "processing" || status === "failed";
}

/**
 * The first month of the tracking window, or null when nothing is tracked.
 *
 * The window starts at the month the first received rent payment pays for
 * (attributedMonth, the same attribution receivedForMonth uses), or at the
 * lease start month when that is later. Many tenants pay at the end of the
 * previous month: their first transfer seen here pays the next month, and
 * the month before it was paid before the bank data was imported. An open row
 * for such a month is left over from the expected-payments generator, so
 * months before the window are never owed and never reminded.
 *
 * A paid row whose whole amount is marked as paying older arrears does not
 * open the window: that money pays rent from before tracking. Without any
 * received rent the window starts at the due month of the first rent row
 * (or the lease start when later), so a tenant who never paid is still owed.
 */
export function trackingStart(lease: BalanceLease, rows: BalanceRow[]): string | null {
  const rentRows = rows.filter(isRent);
  const firstPaid =
    rentRows
      .filter((r) => r.status === "paid" && !r.isIgnored)
      .filter((r) => cents(arrearsAmount(r.notes)) < cents(r.amount))
      .map((r) => attributedMonth(r, lease.paymentDay))
      .sort()[0] ?? null;
  const firstRow =
    firstPaid ??
    rentRows
      .filter((r) => r.status !== "cancelled")
      .map((r) => ymd(r.dueDate).slice(0, 7))
      .sort()[0] ??
    null;
  const startMonth = lease.startDate ? ymd(lease.startDate).slice(0, 7) : null;
  if (firstRow && startMonth) return firstRow > startMonth ? firstRow : startMonth;
  return firstRow ?? startMonth;
}

/** True when `month` (YYYY-MM) lies before the contract's tracking window. */
export function beforeTrackingWindow(balance: Pick<ContractBalance, "fromMonth">, month: string): boolean {
  return balance.fromMonth != null && month.slice(0, 7) < balance.fromMonth;
}

/**
 * The balance of a whole contract on `today` (YYYY-MM-DD).
 *
 * Expected: every month from the start of the tracking window (see
 * trackingStart) whose due date is on or before today, with the exact settlement rule of monthReceived (rent in force
 * on the due date plus charges minus deductions). A month whose open row the
 * landlord set to ignore counts only what came in for it, so it neither adds
 * debt nor hides credit.
 *
 * Received: every paid rent row (not ignored, not a deposit) once, plus ledger
 * allocations taken from other money (e.g. a deposit applied to rent). Money
 * marked as paying older arrears is left out, so it is not credit.
 *
 * owed = expected - received when positive; credit is the opposite. Exact to
 * the cent.
 */
export function contractBalance(input: {
  lease: BalanceLease;
  rows: BalanceRow[];
  allocations: Array<{ periodMonth: string; amount: string | number; paymentId?: string | null }>;
  records: IndexRecord[];
  deductions: DeductionRow[];
  today: string;
}): ContractBalance {
  const { lease, rows, today } = input;
  const rentRows = rows.filter(isRent);

  // Received, counted per row so money is never counted twice.
  const paidRent = rentRows.filter((r) => r.status === "paid" && !r.isIgnored);
  const paidIds = new Set(paidRent.map((r) => r.id).filter(Boolean));
  let receivedCents = paidRent.reduce((s, r) => s + cents(r.amount), 0);
  for (const a of input.allocations) {
    // Allocations of a paid rent row only move that row's money to a month.
    if (!a.paymentId || paidIds.has(a.paymentId)) continue;
    receivedCents += cents(a.amount);
  }
  const arrearsCents = paidRent.reduce(
    (s, r) => s + Math.min(cents(arrearsAmount(r.notes)), cents(r.amount)),
    0,
  );
  receivedCents -= arrearsCents;

  // Rent paid ahead for a month that is not due yet (e.g. November's rent
  // paid on 05/11 for a due date of 08/11) is not credit: it belongs to that
  // coming month and only counts once the month is due.
  let advanceCents = 0;
  for (const r of paidRent) {
    const month = attributedMonth(r, lease.paymentDay);
    if (dueDateForMonth(month, lease.paymentDay) > today) {
      advanceCents += Math.max(0, cents(r.amount) - Math.min(cents(arrearsAmount(r.notes)), cents(r.amount)));
    }
  }
  receivedCents -= advanceCents;

  // The tracked months.
  const start = lease.startDate ? ymd(lease.startDate) : null;
  const end = lease.endDate ? ymd(lease.endDate) : null;
  const saneEnd = end && (!start || end >= start) ? end : null;
  const fromMonth = trackingStart(lease, rows);

  const allocByMonth = new Map<string, number>();
  for (const a of input.allocations) {
    allocByMonth.set(a.periodMonth, (allocByMonth.get(a.periodMonth) ?? 0) + (Number(a.amount) || 0));
  }

  const perMonth: BalanceMonth[] = [];
  let expectedCents = 0;
  if (fromMonth && fromMonth <= today.slice(0, 7)) {
    for (let month = fromMonth; month <= today.slice(0, 7); month = nextMonth(month)) {
      const due = dueDateForMonth(month, lease.paymentDay);
      if (due > today) continue;
      if (start && due < start) continue;
      if (saneEnd && due > saneEnd) continue;
      const s = monthSettlement({
        rows,
        allocationSum: allocByMonth.get(month) ?? 0,
        records: input.records,
        monthlyRent: Number(lease.monthlyRent) || 0,
        monthlyCharges: Number(lease.monthlyCharges) || 0,
        deductions: input.deductions,
        month,
        paymentDay: lease.paymentDay,
      });
      const ignored =
        !s.settled &&
        rentRows.some((r) => r.isIgnored && isOpen(r.status) && ymd(r.dueDate).slice(0, 7) === month);
      const counted = ignored ? Math.min(s.expected, s.received) : s.expected;
      expectedCents += cents(counted);
      perMonth.push({ ...s, month, counted: round2(counted), ignored });
    }
  }

  const balanceCents = expectedCents - receivedCents;
  return {
    expected: expectedCents / 100,
    received: receivedCents / 100,
    arrearsRepaid: arrearsCents / 100,
    paidInAdvance: advanceCents / 100,
    owed: balanceCents > 0 ? balanceCents / 100 : 0,
    credit: balanceCents < 0 ? -balanceCents / 100 : 0,
    fromMonth,
    perMonth,
  };
}

/**
 * What a reminder for one month may ask: the month's own amount, but never
 * more than the contract owes. Null when the contract is even or in credit,
 * so no reminder goes out.
 */
export function cappedReminderAmount(monthAmount: number, owed: number): number | null {
  if (!(cents(owed) > 0)) return null;
  return Math.min(cents(monthAmount), cents(owed)) / 100;
}

/**
 * What a reminder for `month` may ask under the contract balance: null when
 * the month lies before the tracking window or the contract owes nothing,
 * else the month's amount capped at what the contract owes.
 */
export function reminderAmountFor(
  balance: Pick<ContractBalance, "fromMonth" | "owed">,
  month: string,
  monthAmount: number,
): number | null {
  if (beforeTrackingWindow(balance, month)) return null;
  return cappedReminderAmount(monthAmount, balance.owed);
}

/** Everything contractBalance needs for one lease, loaded once. */
export type BalanceData = {
  lease: BalanceLease;
  rows: Array<BalanceRow & { id: string }>;
  allocations: Array<{ periodMonth: string; amount: string | number; paymentId: string }>;
  records: IndexRecord[];
  deductions: DeductionRow[];
};

export async function loadBalanceData(
  db: Db,
  leaseOrId: string | (BalanceLease & { id: string }),
): Promise<BalanceData | null> {
  let lease: (BalanceLease & { id: string }) | null =
    typeof leaseOrId === "string" ? null : leaseOrId;
  if (!lease || lease.startDate === undefined) {
    const id = typeof leaseOrId === "string" ? leaseOrId : leaseOrId.id;
    const found = (
      await db
        .select({
          id: leases.id,
          monthlyRent: leases.monthlyRent,
          monthlyCharges: leases.monthlyCharges,
          paymentDay: leases.paymentDay,
          startDate: leases.startDate,
          endDate: leases.endDate,
        })
        .from(leases)
        .where(eq(leases.id, id))
        .limit(1)
    )[0];
    if (!found) return null;
    lease = found;
  }
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
    .where(eq(payments.leaseId, lease.id));
  const allocations = await db
    .select({
      periodMonth: paymentAllocations.periodMonth,
      amount: paymentAllocations.amount,
      paymentId: paymentAllocations.paymentId,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.leaseId, lease.id));
  const records = (await loadIndexRecords(db, [lease.id])).get(lease.id) ?? [];
  const deductions = await loadLeaseDeductions(db, lease.id);
  return { lease, rows, allocations, records, deductions };
}

/** The contract balance of one lease on `today`, loaded from the database. */
export async function loadContractBalance(
  db: Db,
  leaseOrId: string | (BalanceLease & { id: string }),
  today: string,
): Promise<ContractBalance | null> {
  const data = await loadBalanceData(db, leaseOrId);
  return data ? contractBalance({ ...data, today }) : null;
}
