import { monthSettlement, type IndexRecord, type MonthSettlement, type PaidRowLike } from "./monthReceived";
import type { DeductionRow } from "./rentDeductions";

/** The lease terms needed to place a lease's rent in a month. */
export type MonthLease = {
  id: string;
  monthlyRent: string | number | null;
  monthlyCharges: string | number | null;
  paymentDay: number | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
};

/** How one lease's rent for a month stands. */
export type LeaseMonthStatus = "paid" | "partial" | "overdue" | "toCome";

export type LeaseMonthResult<L extends MonthLease> = {
  lease: L;
  /** Due date of the month's rent (YYYY-MM-DD). */
  due: string;
  /** Monthly rent plus charges from the lease terms, used when nothing came in. */
  rent: number;
  settlement: MonthSettlement;
  status: LeaseMonthStatus;
};

/**
 * The overview's figures for one month. paid + toCome + overdue === expected,
 * and only leases whose rent is due in the month are counted.
 */
export type MonthTotals<L extends MonthLease> = {
  month: string;
  paid: number;
  toCome: number;
  overdue: number;
  expected: number;
  leases: Array<LeaseMonthResult<L>>;
};

export type Settler<L extends MonthLease = MonthLease> = (lease: L, month: string) => MonthSettlement;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m0 = Number(month.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m0 / 12);
  const nm = ((m0 % 12) + 12) % 12;
  return `${ny}-${pad(nm + 1)}`;
}

/**
 * A settle function over data that was loaded once: paid rows per lease,
 * ledger allocations keyed `leaseId|YYYY-MM`, indexations and deductions.
 */
export function makeSettler(data: {
  rowsByLease: Map<string, PaidRowLike[]>;
  allocations: Map<string, number>;
  recordsByLease: Map<string, IndexRecord[]>;
  deductionsByLease: Map<string, DeductionRow[]>;
}): Settler {
  return (lease, month) =>
    monthSettlement({
      rows: data.rowsByLease.get(lease.id) ?? [],
      allocationSum: data.allocations.get(`${lease.id}|${month}`) ?? 0,
      records: data.recordsByLease.get(lease.id) ?? [],
      monthlyRent: Number(lease.monthlyRent || 0),
      monthlyCharges: Number(lease.monthlyCharges || 0),
      deductions: data.deductionsByLease.get(lease.id) ?? [],
      month,
      paymentDay: lease.paymentDay,
    });
}

/**
 * Lease-centric totals for `month`. A settled lease adds its expected amount
 * to paid; a partly paid lease adds what came in, and the rest is overdue from
 * its due day on (the due day included), else still to come; a lease with
 * nothing received is overdue after its due day, else still to come. Leases
 * that had not started yet, or whose (sane) end date lies before the due day,
 * are left out.
 *
 * `today` (YYYY-MM-DD) only splits overdue from still to come; paid and
 * expected do not depend on it.
 */
export function monthTotals<L extends MonthLease>(input: {
  leases: L[];
  month: string;
  today: string;
  settle: (lease: L, month: string) => MonthSettlement;
}): MonthTotals<L> {
  const { month, today } = input;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  let paid = 0;
  let toCome = 0;
  let overdue = 0;
  const results: Array<LeaseMonthResult<L>> = [];

  for (const l of input.leases) {
    const rent = Number(l.monthlyRent || 0) + Number(l.monthlyCharges || 0);
    if (!(rent > 0)) continue;
    const dueDay = Math.min(Math.max(1, Math.floor(l.paymentDay ?? 1) || 1), lastDay);
    const due = `${month}-${pad(dueDay)}`;
    const startStr = l.startDate ? String(l.startDate).slice(0, 10) : undefined;
    if (startStr && due < startStr) continue;
    // A corrupt end date before the start must never hide an active lease's rent.
    const endStr = l.endDate ? String(l.endDate).slice(0, 10) : undefined;
    if (endStr && (!startStr || endStr >= startStr) && due > endStr) continue;

    const s = input.settle(l, month);
    let status: LeaseMonthStatus;
    if (s.settled) {
      paid += s.expected;
      status = "paid";
    } else if (s.received > 0.01) {
      paid += s.received;
      if (due <= today) overdue += s.shortfall;
      else toCome += s.shortfall;
      status = "partial";
    } else if (due < today) {
      overdue += rent;
      status = "overdue";
    } else {
      toCome += rent;
      status = "toCome";
    }
    results.push({ lease: l, due, rent: round2(rent), settlement: s, status });
  }

  return { month, paid, toCome, overdue, expected: paid + toCome + overdue, leases: results };
}

export type HistoryEntry = { month: string; paid: number; expected: number };

/**
 * The overview's paid and expected figures for each of the `months` months
 * ending at `endMonth` (oldest first). Each entry is exactly what the overview
 * shows when that month is selected.
 */
export function monthHistory<L extends MonthLease>(input: {
  leases: L[];
  endMonth: string;
  months: number;
  today: string;
  settle: (lease: L, month: string) => MonthSettlement;
}): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (let i = input.months - 1; i >= 0; i--) {
    const month = shiftMonth(input.endMonth, -i);
    const t = monthTotals({ leases: input.leases, month, today: input.today, settle: input.settle });
    out.push({ month, paid: round2(t.paid), expected: round2(t.expected) });
  }
  return out;
}
