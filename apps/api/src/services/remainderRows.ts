import { and, eq, inArray } from "drizzle-orm";
import { getDb, leases, paymentAllocations, payments } from "@rentular/db";
import { isDepositNote, isRemainderNote, REMAINDER_NOTE } from "./expectedPayments";
import { dueDateForMonth, loadIndexRecords, monthSettlement, type MonthSettlement } from "./monthReceived";
import { loadLeaseDeductions } from "./rentDeductions";

type Db = ReturnType<typeof getDb>;

/** How many calendar months before the current one the sweep looks back. */
export const REMAINDER_LOOKBACK_MONTHS = 6;

/** An open (pending or processing) rent row of one lease month. */
export type OpenMonthRow = {
  id: string;
  status: string;
  amount: string | number;
  notes: string | null;
};

export type RemainderAction =
  | { kind: "insert"; amount: number }
  | { kind: "update"; id: string; amount: number }
  | { kind: "cancel"; id: string };

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * What to do with the remainder row of one lease month, given its exact
 * settlement and its open rent rows (not ignored, not deposits).
 *
 * - Partly paid and nothing open: add one pending row for the shortfall.
 * - Partly paid with a remainder row: keep it, with its amount set to the
 *   current shortfall. A second remainder row is cancelled.
 * - Partly paid with another open row (e.g. the month's pending rent): that row
 *   already carries the reminders, so a remainder row would be a duplicate and
 *   is cancelled.
 * - Settled: a remainder row left over is cancelled.
 * - Nothing received: nothing changes.
 */
export function decideRemainderRows(input: {
  settlement: Pick<MonthSettlement, "settled" | "received" | "shortfall">;
  openRows: OpenMonthRow[];
}): RemainderAction[] {
  const { settlement, openRows } = input;
  const remainders = openRows.filter((r) => r.status === "pending" && isRemainderNote(r.notes));
  const others = openRows.filter((r) => !remainders.includes(r));
  const cancelAll = (rows: OpenMonthRow[]): RemainderAction[] =>
    rows.map((r) => ({ kind: "cancel" as const, id: r.id }));

  if (settlement.settled) return cancelAll(remainders);
  if (!(settlement.received > 0 && settlement.shortfall > 0)) return [];
  if (others.length > 0) return cancelAll(remainders);

  const [keep, ...extra] = remainders;
  if (!keep) return [{ kind: "insert", amount: settlement.shortfall }];
  const actions: RemainderAction[] = cancelAll(extra);
  if (!sameAmount(Number(keep.amount), settlement.shortfall)) {
    actions.unshift({ kind: "update", id: keep.id, amount: settlement.shortfall });
  }
  return actions;
}

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m0 = Number(month.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m0 / 12);
  const nm = ((m0 % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

/**
 * The rent months of a lease the sweep looks at: the current month and the
 * previous REMAINDER_LOOKBACK_MONTHS, only once their due date has passed, not
 * before the lease starts and not after a sane end date.
 */
export function sweepMonths(
  lease: { startDate: string | null; endDate: string | null; paymentDay: number | null },
  today: string,
): string[] {
  const start = lease.startDate ? String(lease.startDate).slice(0, 10) : undefined;
  const end = lease.endDate ? String(lease.endDate).slice(0, 10) : undefined;
  const saneEnd = end && (!start || end >= start) ? end : undefined;
  const out: string[] = [];
  for (let back = 0; back <= REMAINDER_LOOKBACK_MONTHS; back++) {
    const month = shiftMonth(today.slice(0, 7), -back);
    const due = dueDateForMonth(month, lease.paymentDay);
    if (due >= today) continue;
    if (start && due < start) continue;
    if (saneEnd && due > saneEnd) continue;
    out.push(month);
  }
  return out;
}

/**
 * Give every partly paid rent month of the active leases a pending row for
 * exactly the missing amount, so the overdue reminders pick it up like any
 * unpaid rent. Idempotent: an existing remainder row is updated, a stale one
 * (the month got settled, or another open row exists) is cancelled.
 */
export async function sweepRemainderRows(
  db: Db,
  today: string,
): Promise<{ inserted: number; updated: number; cancelled: number }> {
  const counts = { inserted: 0, updated: 0, cancelled: 0 };
  const active = await db
    .select({
      id: leases.id,
      monthlyRent: leases.monthlyRent,
      monthlyCharges: leases.monthlyCharges,
      paymentDay: leases.paymentDay,
      paymentMethod: leases.paymentMethod,
      startDate: leases.startDate,
      endDate: leases.endDate,
    })
    .from(leases)
    .where(eq(leases.status, "active"));

  for (const lease of active) {
    try {
      if (!(Number(lease.monthlyRent || 0) > 0)) continue;
      const months = sweepMonths(
        {
          startDate: lease.startDate ? String(lease.startDate) : null,
          endDate: lease.endDate ? String(lease.endDate) : null,
          paymentDay: lease.paymentDay,
        },
        today,
      );
      if (months.length === 0) continue;

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
      const allocs = await db
        .select({ amount: paymentAllocations.amount, periodMonth: paymentAllocations.periodMonth })
        .from(paymentAllocations)
        .where(
          and(eq(paymentAllocations.leaseId, lease.id), inArray(paymentAllocations.periodMonth, months)),
        );
      const records = (await loadIndexRecords(db, [lease.id])).get(lease.id) ?? [];
      const deductions = await loadLeaseDeductions(db, lease.id);
      const method = lease.paymentMethod === "gocardless" ? "gocardless" : "bank_transfer";

      for (const month of months) {
        const allocationSum = allocs
          .filter((a) => a.periodMonth === month)
          .reduce((s, a) => s + (Number(a.amount) || 0), 0);
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
        const openRows = rows.filter(
          (r) =>
            (r.status === "pending" || r.status === "processing") &&
            !r.isIgnored &&
            !isDepositNote(r.notes) &&
            String(r.dueDate).slice(0, 7) === month,
        );
        for (const action of decideRemainderRows({ settlement, openRows })) {
          if (action.kind === "insert") {
            const amount = String(action.amount);
            await db.insert(payments).values({
              id: crypto.randomUUID(),
              leaseId: lease.id,
              status: "pending",
              amount,
              dueDate: settlement.dueDate,
              method,
              rentAmount: amount,
              chargesAmount: "0",
              notes: REMAINDER_NOTE,
            });
            counts.inserted++;
            console.log(`[Remainder] lease ${lease.id} ${month}: pending remainder of ${amount} added`);
          } else if (action.kind === "update") {
            const amount = String(action.amount);
            await db
              .update(payments)
              .set({ amount, rentAmount: amount, updatedAt: new Date() })
              .where(eq(payments.id, action.id));
            counts.updated++;
            console.log(`[Remainder] lease ${lease.id} ${month}: remainder ${action.id} set to ${amount}`);
          } else {
            await db
              .update(payments)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(and(eq(payments.id, action.id), eq(payments.status, "pending")));
            counts.cancelled++;
            console.log(`[Remainder] lease ${lease.id} ${month}: stale remainder ${action.id} cancelled`);
          }
        }
      }
    } catch (err) {
      console.error(`[Remainder] sweep failed for lease ${lease.id}:`, err);
    }
  }
  return counts;
}
