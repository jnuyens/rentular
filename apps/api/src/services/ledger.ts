import { and, eq } from "drizzle-orm";
import {
  getDb,
  payments,
  paymentAllocations,
  leases,
  properties,
  leaseTenants,
  tenants,
} from "@rentular/db";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LedgerPeriod {
  month: string; // YYYY-MM
  dueDate: string; // YYYY-MM-DD
  rentDue: number;
  allocated: number;
  balance: number; // rentDue - allocated (negative = overpaid)
  status: "paid" | "partial" | "open" | "overpaid";
  allocations: Array<{
    id: string;
    paymentId: string;
    amount: number;
    paidDate: string | null;
    auto: boolean;
  }>;
}

export interface LedgerPayment {
  id: string;
  amount: number;
  paidDate: string | null;
  dueDate: string;
  status: string;
  method: string;
  notes: string | null;
  allocated: number;
  unallocated: number;
}

export interface Ledger {
  lease: {
    id: string;
    propertyName: string;
    tenantName: string;
    monthlyRent: number;
    charges: number;
    rentDue: number;
    paymentDay: number;
    startDate: string | null;
    currency: string;
  };
  periods: LedgerPeriod[];
  payments: LedgerPayment[];
  summary: {
    totalCharged: number;
    totalAllocated: number;
    totalReceived: number;
    totalUnallocated: number;
    openBalance: number; // sum of positive period balances
  };
}

/** Clamp a payment day to a given year/month, returning YYYY-MM-DD. */
function dueDateFor(year: number, month0: number, paymentDay: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(paymentDay) || 1), lastDay);
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

/**
 * Build the rent ledger for a lease: the monthly rent periods, the received
 * payments, and the allocations linking them. `months` limits how far back the
 * periods go (default 24; 0 = from the lease start).
 */
export async function computeLedger(
  leaseId: string,
  opts: { months?: number } = {},
): Promise<Ledger | null> {
  const db = getDb();
  const leaseRows = await db.select().from(leases).where(eq(leases.id, leaseId)).limit(1);
  const lease = leaseRows[0];
  if (!lease) return null;

  const propRow = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.id, lease.propertyId))
    .limit(1);
  const tenantRows = await db
    .select({ first: tenants.firstName, last: tenants.lastName })
    .from(leaseTenants)
    .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
    .where(eq(leaseTenants.leaseId, leaseId));

  const monthlyRent = Number(lease.monthlyRent || 0);
  const charges = Number(lease.monthlyCharges || 0);
  const rentDue = round2(monthlyRent + charges);
  const paymentDay = lease.paymentDay ?? 1;
  const startStr = lease.startDate ? String(lease.startDate).slice(0, 10) : null;

  const payRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      paidDate: payments.paidDate,
      dueDate: payments.dueDate,
      status: payments.status,
      method: payments.method,
      notes: payments.notes,
      isIgnored: payments.isIgnored,
    })
    .from(payments)
    .where(eq(payments.leaseId, leaseId));

  const allocRows = await db
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.leaseId, leaseId));

  // Group allocations by period and by payment.
  const allocByMonth = new Map<string, typeof allocRows>();
  const allocatedByPayment = new Map<string, number>();
  const paidDateByPayment = new Map<string, string | null>();
  for (const p of payRows) paidDateByPayment.set(p.id, p.paidDate ? String(p.paidDate) : null);
  for (const a of allocRows) {
    const arr = allocByMonth.get(a.periodMonth) ?? [];
    arr.push(a);
    allocByMonth.set(a.periodMonth, arr);
    allocatedByPayment.set(a.paymentId, (allocatedByPayment.get(a.paymentId) ?? 0) + Number(a.amount));
  }

  // Build the period list: from the later of (lease start, now - months) to now.
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth(); // 0-based
  const monthsBack = opts.months === undefined ? 24 : opts.months;

  let startY: number;
  let startM: number;
  if (startStr) {
    startY = Number(startStr.slice(0, 4));
    startM = Number(startStr.slice(5, 7)) - 1;
  } else {
    startY = curY;
    startM = curM;
  }
  if (monthsBack > 0) {
    // Floor of the window: now - (monthsBack-1) months.
    const floor = new Date(curY, curM - (monthsBack - 1), 1);
    if (floor > new Date(startY, startM, 1)) {
      startY = floor.getFullYear();
      startM = floor.getMonth();
    }
  }

  const periods: LedgerPeriod[] = [];
  let totalCharged = 0;
  let iy = startY;
  let im = startM;
  while (iy < curY || (iy === curY && im <= curM)) {
    const month = `${iy}-${String(im + 1).padStart(2, "0")}`;
    const due = dueDateFor(iy, im, paymentDay);
    // Skip a first partial month whose due date precedes the lease start.
    if (!(startStr && due < startStr)) {
      const allocs = (allocByMonth.get(month) ?? []).map((a) => ({
        id: a.id,
        paymentId: a.paymentId,
        amount: Number(a.amount),
        paidDate: paidDateByPayment.get(a.paymentId) ?? null,
        auto: a.createdBy === null,
      }));
      const allocated = round2(allocs.reduce((s, a) => s + a.amount, 0));
      const balance = round2(rentDue - allocated);
      let status: LedgerPeriod["status"] = "open";
      if (allocated <= 0.005) status = "open";
      else if (balance > 0.005) status = "partial";
      else if (balance < -0.005) status = "overpaid";
      else status = "paid";
      periods.push({ month, dueDate: due, rentDue, allocated, balance, status, allocations: allocs });
      totalCharged = round2(totalCharged + rentDue);
    }
    im++;
    if (im > 11) {
      im = 0;
      iy++;
    }
  }
  periods.reverse(); // newest first

  const paymentsOut: LedgerPayment[] = payRows
    .map((p) => {
      const allocated = round2(allocatedByPayment.get(p.id) ?? 0);
      const amount = Number(p.amount);
      return {
        id: p.id,
        amount,
        paidDate: p.paidDate ? String(p.paidDate) : null,
        dueDate: String(p.dueDate),
        status: p.status,
        method: p.method,
        notes: p.notes ?? null,
        allocated,
        unallocated: round2(amount - allocated),
      };
    })
    .sort((a, b) => String(b.paidDate || b.dueDate).localeCompare(String(a.paidDate || a.dueDate)));

  const totalAllocated = round2(allocRows.reduce((s, a) => s + Number(a.amount), 0));
  const totalReceived = round2(
    payRows.filter((p) => p.status === "paid" && !p.isIgnored).reduce((s, p) => s + Number(p.amount), 0),
  );
  const openBalance = round2(
    periods.reduce((s, p) => s + (p.balance > 0 ? p.balance : 0), 0),
  );

  return {
    lease: {
      id: lease.id,
      propertyName: propRow[0]?.name || lease.propertyId,
      tenantName: tenantRows.map((t) => `${t.first} ${t.last}`.trim()).join(", ") || "-",
      monthlyRent,
      charges,
      rentDue,
      paymentDay,
      startDate: startStr,
      currency: "EUR",
    },
    periods,
    payments: paymentsOut,
    summary: {
      totalCharged,
      totalAllocated,
      totalReceived,
      totalUnallocated: round2(totalReceived - totalAllocated),
      openBalance,
    },
  };
}

/**
 * Auto-reconcile a lease: allocate each paid payment's unallocated amount to the
 * oldest open rent periods first (standard "oldest balance first" accounting).
 * Only fills gaps; never moves or removes existing allocations. Returns the
 * number of allocations created.
 */
export async function autoReconcile(leaseId: string, userId: string | null): Promise<number> {
  const db = getDb();
  const ledger = await computeLedger(leaseId, { months: 0 });
  if (!ledger) return 0;

  // Remaining owed per period, oldest first.
  const openPeriods = [...ledger.periods]
    .reverse() // oldest first
    .map((p) => ({ month: p.month, dueDate: p.dueDate, remaining: round2(p.rentDue - p.allocated) }))
    .filter((p) => p.remaining > 0.005);

  // Unallocated money per paid payment, oldest first.
  const openPayments = ledger.payments
    .filter((p) => p.status === "paid" && p.unallocated > 0.005)
    .sort((a, b) => String(a.paidDate || a.dueDate).localeCompare(String(b.paidDate || b.dueDate)))
    .map((p) => ({ id: p.id, remaining: p.unallocated }));

  const toInsert: Array<{
    id: string;
    paymentId: string;
    leaseId: string;
    periodMonth: string;
    periodDueDate: string;
    amount: string;
    createdBy: string | null;
  }> = [];

  let pi = 0;
  for (const period of openPeriods) {
    while (period.remaining > 0.005 && pi < openPayments.length) {
      const pay = openPayments[pi]!;
      if (pay.remaining <= 0.005) {
        pi++;
        continue;
      }
      const take = round2(Math.min(period.remaining, pay.remaining));
      toInsert.push({
        id: crypto.randomUUID(),
        paymentId: pay.id,
        leaseId,
        periodMonth: period.month,
        periodDueDate: period.dueDate,
        amount: take.toFixed(2),
        createdBy: null,
      });
      period.remaining = round2(period.remaining - take);
      pay.remaining = round2(pay.remaining - take);
    }
  }

  for (const row of toInsert) {
    await db.insert(paymentAllocations).values(row);
  }
  return toInsert.length;
}

/** Create one allocation, validating it does not over-allocate the payment. */
export async function createAllocation(input: {
  leaseId: string;
  paymentId: string;
  periodMonth: string;
  amount: number;
  note?: string | null;
  userId: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = getDb();
  const amount = round2(input.amount);
  if (!(amount > 0)) return { ok: false, error: "Amount must be positive" };

  const payRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      leaseId: payments.leaseId,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.id, input.paymentId))
    .limit(1);
  const pay = payRows[0];
  if (!pay || pay.leaseId !== input.leaseId) return { ok: false, error: "Payment not found for this lease" };
  if (pay.status !== "paid") return { ok: false, error: "Only received payments can be allocated" };

  const existing = await db
    .select({ amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, input.paymentId));
  const already = round2(existing.reduce((s, a) => s + Number(a.amount), 0));
  const unallocated = round2(Number(pay.amount) - already);
  if (amount > unallocated + 0.005) {
    return { ok: false, error: `Only ${unallocated.toFixed(2)} of this payment is still unallocated` };
  }

  const m = /^(\d{4})-(\d{2})$/.exec(input.periodMonth);
  if (!m) return { ok: false, error: "Invalid period" };
  const leaseRow = await db
    .select({ paymentDay: leases.paymentDay })
    .from(leases)
    .where(eq(leases.id, input.leaseId))
    .limit(1);
  const day = leaseRow[0]?.paymentDay ?? 1;
  const periodDueDate = dueDateFor(Number(m[1]), Number(m[2]) - 1, day);

  const id = crypto.randomUUID();
  await db.insert(paymentAllocations).values({
    id,
    paymentId: input.paymentId,
    leaseId: input.leaseId,
    periodMonth: input.periodMonth,
    periodDueDate,
    amount: amount.toFixed(2),
    note: input.note ?? null,
    createdBy: input.userId,
  });
  return { ok: true, id };
}

/** Remove one allocation; returns false if it does not belong to the lease. */
export async function deleteAllocation(leaseId: string, allocationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: paymentAllocations.id })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.id, allocationId), eq(paymentAllocations.leaseId, leaseId)))
    .limit(1);
  if (!rows[0]) return false;
  await db.delete(paymentAllocations).where(eq(paymentAllocations.id, allocationId));
  return true;
}
