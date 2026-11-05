import { eq } from "drizzle-orm";
import { getDb, leases } from "@rentular/db";
import { isDepositNote } from "./expectedPayments";
import { loadMonthStatus, type MonthSettlement } from "./monthReceived";

type Db = ReturnType<typeof getDb>;

/** A pending rent row as the matchers see it. */
export type ShortfallPendingRow = {
  id: string;
  amount: string | number;
  dueDate: string;
  notes?: string | null;
  rentAmount?: string | number | null;
  chargesAmount?: string | number | null;
};

export type ShortfallPlan = {
  kind: "settle" | "partial";
  rowId: string;
  month: string;
  /** The amount the row is recorded paid with: exactly the transfer. */
  amount: number;
  rentAmount: number | null;
  chargesAmount: number | null;
  /** What the month still misses after this transfer (0 when settled). */
  remaining: number;
};

/** Amount in whole cents, so comparisons are exact to the cent. */
function cents(n: string | number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100);
}

function ymd(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * How a transfer that fits no pending row by amount can still be booked on a
 * partly paid month. `settlement` is the exact month status (monthReceived).
 *
 * - The month already received something and the transfer is exactly the
 *   shortfall, to the cent: the month's pending row is recorded paid with the
 *   transfer as its amount, which settles the month.
 * - The month already received something and the transfer is smaller than the
 *   shortfall: the same, as a further partial. The month's received grows and
 *   the remainder sweep asks for the rest.
 * - `allowFirstPartial`: also book a partial when nothing was received yet.
 *   Only used when the sender is a known tenant account of this lease.
 *
 * A transfer larger than the shortfall, or a month that is already settled,
 * gives null: that needs a person to look at it.
 */
export function planShortfallTransfer(input: {
  settlement: Pick<MonthSettlement, "settled" | "received" | "shortfall" | "expected">;
  month: string;
  monthRows: ShortfallPendingRow[];
  transfer: number;
  allowFirstPartial?: boolean;
}): ShortfallPlan | null {
  const { settlement, monthRows } = input;
  const transfer = cents(input.transfer);
  if (transfer <= 0) return null;
  if (settlement.settled) return null;
  const receivedSomething = cents(settlement.received) > 0;
  if (!receivedSomething && !input.allowFirstPartial) return null;

  // Shortfall of the month; with nothing received it is the whole expected amount.
  const shortfall = receivedSomething ? cents(settlement.shortfall) : cents(settlement.expected);
  if (shortfall <= 0 || transfer > shortfall) return null;

  const row = [...monthRows]
    .filter((r) => !isDepositNote(r.notes))
    .sort((a, b) => (ymd(a.dueDate) < ymd(b.dueDate) ? -1 : ymd(a.dueDate) > ymd(b.dueDate) ? 1 : 0))[0];
  if (!row) return null;

  // The row now carries only the transfer: take the difference off the rent
  // part first, then off the charges.
  let cut = cents(row.amount) - transfer;
  let rentAmount: number | null = null;
  let chargesAmount: number | null = null;
  if (row.rentAmount != null) {
    const rent = cents(row.rentAmount);
    const fromRent = Math.min(Math.max(cut, 0), rent);
    rentAmount = (rent - fromRent) / 100;
    cut -= fromRent;
  }
  if (row.chargesAmount != null && cut > 0) {
    const charges = cents(row.chargesAmount);
    chargesAmount = (charges - Math.min(cut, charges)) / 100;
  }

  const remaining = (shortfall - transfer) / 100;
  return {
    kind: remaining === 0 ? "settle" : "partial",
    rowId: row.id,
    month: input.month,
    amount: transfer / 100,
    rentAmount,
    chargesAmount,
    remaining,
  };
}

/** The lease fields the month status needs. */
async function loadLeaseForStatus(db: Db, leaseId: string) {
  const rows = await db
    .select({
      id: leases.id,
      monthlyRent: leases.monthlyRent,
      monthlyCharges: leases.monthlyCharges,
      paymentDay: leases.paymentDay,
    })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The open rent months of a lease, oldest first, with their exact settlement:
 * one entry per month that has a pending rent row (deposits left out). Months
 * already settled are skipped; their pending row is a leftover the remainder
 * sweep cleans up.
 */
export async function openMonthsForLease(
  db: Db,
  leaseId: string,
  pending: ShortfallPendingRow[],
): Promise<Array<{ month: string; settlement: MonthSettlement; rows: ShortfallPendingRow[] }>> {
  const rent = pending.filter((p) => !isDepositNote(p.notes));
  if (rent.length === 0) return [];
  const lease = await loadLeaseForStatus(db, leaseId);
  if (!lease || !(Number(lease.monthlyRent || 0) > 0)) return [];
  const months = [...new Set(rent.map((p) => ymd(p.dueDate).slice(0, 7)))].sort();
  const out: Array<{ month: string; settlement: MonthSettlement; rows: ShortfallPendingRow[] }> = [];
  for (const month of months) {
    const settlement = await loadMonthStatus(db, lease, month);
    if (settlement.settled) continue;
    out.push({ month, settlement, rows: rent.filter((p) => ymd(p.dueDate).slice(0, 7) === month) });
  }
  return out;
}

/**
 * The shortfall plan for the oldest open month of a lease, or null. Only the
 * oldest open month is considered: money that comes in pays the oldest debt.
 */
export async function findShortfallPlan(
  db: Db,
  leaseId: string,
  pending: ShortfallPendingRow[],
  transfer: number,
  opts: { allowFirstPartial?: boolean } = {},
): Promise<ShortfallPlan | null> {
  const open = await openMonthsForLease(db, leaseId, pending);
  const oldest = open[0];
  if (!oldest) return null;
  return planShortfallTransfer({
    settlement: oldest.settlement,
    month: oldest.month,
    monthRows: oldest.rows,
    transfer,
    allowFirstPartial: opts.allowFirstPartial,
  });
}

/**
 * The exact shortfall of the oldest partly paid open month of a lease, or
 * null when no open month has received anything yet. A transfer of exactly
 * this amount is what the tenant still owes.
 */
export async function oldestShortfall(
  db: Db,
  leaseId: string,
  pending: ShortfallPendingRow[],
): Promise<number | null> {
  const open = await openMonthsForLease(db, leaseId, pending);
  const oldest = open[0];
  if (!oldest) return null;
  return oldest.settlement.received > 0 && oldest.settlement.shortfall > 0
    ? oldest.settlement.shortfall
    : null;
}
