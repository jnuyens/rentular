import { eq, and, gte } from "drizzle-orm";
import { getDb, leases, payments } from "@rentular/db";

type LeaseRow = typeof leases.$inferSelect;

/** Marks an auto-generated deposit (waarborg) payment; excluded from reminders. */
export const DEPOSIT_NOTE = "auto-generated deposit";
const RENT_NOTE = "auto-generated expected payment";

/**
 * Compute the due dates (YYYY-MM-DD) for the expected rent payments of a lease,
 * for the current month plus `monthsAhead` future months.
 *
 * SAFETY: this only ever returns dates that are TODAY or in the FUTURE. It never
 * returns a past-due date, so generated payments can never trigger the overdue
 * reminder worker for rent that is (as far as the system knows) already paid.
 *
 * - The due day is the contract payment day, clamped to the last day of each
 *   month (e.g. day 31 becomes 30/28).
 * - The current month is only included when its due date is today or later.
 * - Months before the lease start date are excluded.
 */
export function computeExpectedDueDates(
  paymentDay: number,
  startDate: string | undefined,
  today: Date,
  count = 1
): string[] {
  const day = Math.max(1, Math.floor(paymentDay) || 1);
  const todayStr = toYMD(today);
  const startStr = startDate ? startDate.slice(0, 10) : undefined;

  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth(); // 0-based

  // Return the next `count` upcoming due dates (the soonest payment-day
  // occurrences that are today or later). We only surface the immediate upcoming
  // month(s); the monthly job rolls the schedule forward as each one passes.
  const results: string[] = [];
  for (let i = 0; i < count + 24 && results.length < count; i++) {
    const y = baseYear + Math.floor((baseMonth + i) / 12);
    const m = (baseMonth + i) % 12; // 0-based
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = Math.min(day, lastDay);
    const due = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (due < todayStr) continue; // never generate a past-due payment
    if (startStr && due < startStr) continue; // not before the lease starts
    results.push(due);
  }
  return results;
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Ensure the given active lease has pending expected-rent payments for the
 * current and upcoming months. Idempotent: a month already having any payment
 * (paid, pending, or otherwise) is skipped. Returns the number created.
 */
export async function ensureExpectedPayments(
  lease: LeaseRow,
  opts: { resetFuture?: boolean } = {}
): Promise<number> {
  if (lease.status !== "active") return 0;
  const rent = Number(lease.monthlyRent);
  if (!(rent > 0)) return 0;

  const db = getDb();
  const todayStr = toYMD(new Date());

  // When the contract's payment day changes, drop the not-yet-due auto-generated
  // rows so they can be re-created on the new day. Only touches system-generated,
  // still-pending, future rows -- never paid, matched, or past-due payments.
  if (opts.resetFuture) {
    await db
      .delete(payments)
      .where(
        and(
          eq(payments.leaseId, lease.id),
          eq(payments.status, "pending"),
          eq(payments.notes, RENT_NOTE),
          gte(payments.dueDate, todayStr)
        )
      );
  }

  const dueDates = computeExpectedDueDates(
    lease.paymentDay ?? 1,
    lease.startDate,
    new Date()
  );

  const existing = await db
    .select({ dueDate: payments.dueDate })
    .from(payments)
    .where(eq(payments.leaseId, lease.id));
  const existingMonths = new Set(
    existing.map((p) => String(p.dueDate).slice(0, 7))
  );

  const charges = Number(lease.monthlyCharges ?? 0) || 0;
  const method = lease.paymentMethod === "gocardless" ? "gocardless" : "bank_transfer";

  let created = 0;
  for (const due of dueDates) {
    const month = due.slice(0, 7);
    if (existingMonths.has(month)) continue;
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      leaseId: lease.id,
      status: "pending",
      amount: String(rent + charges),
      dueDate: due,
      method,
      rentAmount: String(rent),
      chargesAmount: String(charges),
      notes: RENT_NOTE,
    });
    existingMonths.add(month);
    created++;
  }

  // Deposit / warranty (waarborg): one pending payment due at contract start.
  // Idempotent by the deposit marker. Deposits are excluded from the tenant
  // reminder worker, so a past-due deposit does not trigger dunning emails.
  const deposit = Number(lease.deposit ?? 0) || 0;
  if (deposit > 0) {
    const existingDeposit = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.leaseId, lease.id), eq(payments.notes, DEPOSIT_NOTE))
      )
      .limit(1);
    if (existingDeposit.length === 0) {
      const depositDue = lease.startDate ? String(lease.startDate).slice(0, 10) : todayStr;
      await db.insert(payments).values({
        id: crypto.randomUUID(),
        leaseId: lease.id,
        status: "pending",
        amount: String(deposit),
        dueDate: depositDue,
        method,
        notes: DEPOSIT_NOTE,
      });
      created++;
    }
  }

  return created;
}

/**
 * Does this PAID payment cover the rent for a period due on `dueDate`? Handles
 * rent paid early (a few weeks before) or a little late, and small amount
 * differences, so a payment dated in the prior month still counts.
 */
export function coversMonthRent(
  p: { status: string; amount: string | number; dueDate: string; paidDate?: string | null; notes?: string | null },
  dueDate: string,
  rent: number
): boolean {
  if (p.status !== "paid") return false;
  if (p.notes === DEPOSIT_NOTE) return false; // a deposit is not the rent
  const amt = Number(p.amount);
  // At least the rent (partials don't fully cover); allow over-/multi-month
  // payments, but not something as large as a typical 2x+ deposit-sized amount
  // when it is way over.
  if (amt < rent * 0.9 || amt > rent * 3.5) return false;
  const ref = (p.paidDate ? String(p.paidDate) : String(p.dueDate)).slice(0, 10);
  const due = new Date(`${dueDate}T00:00:00`);
  const lo = new Date(due);
  lo.setDate(lo.getDate() - 15); // paid up to ~2 weeks early
  const hi = new Date(due);
  hi.setDate(hi.getDate() + 45); // or anytime during the rent period, plus grace
  const r = new Date(`${ref}T00:00:00`);
  return r >= lo && r <= hi;
}

/** The current month's rent due date (YYYY-MM-DD) for a lease. */
export function currentMonthDueDate(lease: LeaseRow, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(lease.paymentDay ?? 1) || 1), lastDay);
  return `${y}-${pad(m + 1)}-${pad(day)}`;
}

/**
 * Ensure the CURRENT calendar month is represented for this lease so the overview
 * reconciles: if the month's rent is already covered by a (possibly early)
 * payment, remove any stale auto-generated pending record and create nothing; if
 * it is genuinely unpaid, create a single pending record. Never touches a
 * previous month. Returns the number of pending records created.
 */
export async function ensureCurrentMonthPayment(lease: LeaseRow): Promise<number> {
  if (lease.status !== "active") return 0;
  const rent = Number(lease.monthlyRent);
  if (!(rent > 0)) return 0;

  const db = getDb();
  const now = new Date();
  const due = currentMonthDueDate(lease, now);
  const monthPrefix = due.slice(0, 7);

  // Never before the lease starts.
  const startStr = lease.startDate ? String(lease.startDate).slice(0, 10) : undefined;
  if (startStr && due < startStr) return 0;

  const existing = await db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      notes: payments.notes,
    })
    .from(payments)
    .where(eq(payments.leaseId, lease.id));

  // Rent already covered by a paid payment (including one paid early last month)?
  const covered = existing.some((p) => coversMonthRent(p, due, rent));
  if (covered) {
    // Drop any stale auto-generated pending record for this month (false overdue).
    const stale = existing.filter(
      (p) =>
        p.notes === RENT_NOTE &&
        p.status === "pending" &&
        String(p.dueDate).slice(0, 7) === monthPrefix
    );
    for (const s of stale) {
      await db.delete(payments).where(eq(payments.id, s.id));
    }
    return 0;
  }

  // Already has a record for this month (paid elsewhere, or a pending we made)?
  if (existing.some((p) => String(p.dueDate).slice(0, 7) === monthPrefix)) return 0;

  const charges = Number(lease.monthlyCharges ?? 0) || 0;
  const method = lease.paymentMethod === "gocardless" ? "gocardless" : "bank_transfer";
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    leaseId: lease.id,
    status: "pending",
    amount: String(rent + charges),
    dueDate: due,
    method,
    rentAmount: String(rent),
    chargesAmount: String(charges),
    notes: RENT_NOTE,
  });
  return 1;
}

/**
 * Generate expected payments for every active lease. Best-effort per lease.
 */
export async function ensureExpectedPaymentsForAllActive(): Promise<{
  leases: number;
  created: number;
}> {
  const db = getDb();
  const active = await db.select().from(leases).where(eq(leases.status, "active"));
  let created = 0;
  for (const lease of active) {
    try {
      created += await ensureExpectedPayments(lease);
    } catch (err) {
      console.error(
        `[Payments] expected-payment generation failed for lease ${lease.id}:`,
        err
      );
    }
  }
  return { leases: active.length, created };
}
