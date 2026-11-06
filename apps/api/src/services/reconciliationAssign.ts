import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, payments, bankStatements } from "@rentular/db";
import type { StatementRow } from "../lib/bankTransactionView";
import { pickPaymentForTransfer, type PendingPayment } from "./paymentPicker";
import { loadLeaseDeductions } from "./rentDeductions";
import { loadIndexRecords, preIndexationMatch } from "./monthReceived";
import { isDepositNote, isRemainderNote } from "./expectedPayments";
import { findShortfallPlan, findSpillPlan } from "./shortfallMatch";
import { todayInZone } from "../lib/timezone";
import { CREDIT_MARKER, ODD_AMOUNT_MARKER } from "./contractBalance";

function cents(n: string | number): number {
  return Math.round((Number(n) || 0) * 100);
}

type Db = ReturnType<typeof getDb>;

function isoToday(): string {
  return todayInZone();
}

export type AssignableStatement = Pick<
  StatementRow,
  "id" | "amount" | "bookingDate" | "externalTransactionId"
>;

/** Record a paid payment straight from the transfer and match the statement to it. */
async function recordPaidFromTransfer(
  db: Db,
  statement: AssignableStatement,
  leaseId: string,
  note: string,
  opts: { amount?: number; link?: boolean } = {},
): Promise<{ paymentId: string; created: boolean }> {
  const paidDate = statement.bookingDate
    ? String(statement.bookingDate).slice(0, 10)
    : isoToday();
  const newPaymentId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(payments).values({
    id: newPaymentId,
    leaseId,
    amount: opts.amount != null ? String(opts.amount) : String(statement.amount),
    dueDate: paidDate,
    paidDate,
    status: "paid",
    method: "bank_transfer",
    notes: note,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (opts.link === false) return { paymentId: newPaymentId, created: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(bankStatements)
    .set({
      matchStatus: "matched",
      matchedPaymentId: newPaymentId,
      matchedAt: new Date(),
    })
    .where(eq(bankStatements.id, statement.id));
  return { paymentId: newPaymentId, created: true };
}

/**
 * Link a bank statement to a lease. Shared by the manual assign route and the
 * automatic IBAN matcher so both pick the same payment.
 *
 * - No pending payment on the lease: record a paid payment from the transfer.
 * - Otherwise pickPaymentForTransfer chooses the pending row (rent matching the
 *   amount, or the amount net of an applicable rent deduction, first; then a
 *   deposit of exactly that amount; then the oldest rent on an overpayment)
 *   and marks it paid, dated to the statement's booking date.
 * - A transfer of exactly the rent from before the latest indexation (the
 *   tenant did not adjust the standing order yet) is matched to the oldest
 *   pending rent row, recording the amount actually received and a note, so
 *   the missing difference stays visible.
 * - A transfer that pays what is still missing on a partly paid month (the
 *   exact shortfall, to the cent, or a further partial smaller than it) is
 *   booked on that month's pending row with the transfer as its amount. With
 *   allowFirstPartial (the sender is a known tenant account) a first partial
 *   on a month that received nothing yet is booked the same way.
 * - A transfer larger than the oldest open month needs (an overpayment, or
 *   with knownTenant any amount that fits nothing above) is spread over the
 *   open months, oldest first: each month gets what it misses, the next month
 *   the rest, and what is left after the last open month is recorded as a
 *   paid row marked as credit. Every row booked this way is marked as an odd
 *   amount so the landlord can check it. The statement is linked to the first
 *   row.
 * - knownTenant (the sender is a known account of this lease's tenant, or the
 *   transfer carries the lease's structured communication): a transfer is
 *   never left unmatched just because its amount is odd.
 * - Nothing fits: in the default (automatic) mode
 *   nothing is written and null is returned, so the transfer stays unmatched
 *   for review. With createWhenUnmatched (the manual route, where the landlord
 *   explicitly chose this lease) the transfer is recorded as a separate paid
 *   payment linked to the lease. That keeps the larger pending rent open, so
 *   reminders keep running and the ledger shows the money as unassigned,
 *   instead of silently closing a deposit or a bigger rent row.
 */
export async function assignStatementToLease(
  db: Db,
  statement: AssignableStatement,
  leaseId: string,
  note: string,
  opts: { createWhenUnmatched?: boolean; allowFirstPartial?: boolean; knownTenant?: boolean } = {},
): Promise<{ paymentId: string; created: boolean } | null> {
  const pending = (await db
    .select({
      id: payments.id,
      amount: payments.amount,
      dueDate: payments.dueDate,
      notes: payments.notes,
      rentAmount: payments.rentAmount,
      chargesAmount: payments.chargesAmount,
    })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "pending")))
    .orderBy(asc(payments.dueDate))) as Array<
    PendingPayment & { rentAmount?: string | null; chargesAmount?: string | null }
  >;

  if (pending.length === 0) {
    return recordPaidFromTransfer(db, statement, leaseId, note);
  }

  const deductions = await loadLeaseDeductions(db, leaseId);
  const target = pickPaymentForTransfer(
    pending,
    Number(statement.amount),
    deductions,
  );

  const paidDate = statement.bookingDate
    ? new Date(statement.bookingDate)
    : new Date();

  const markPaid = async (paymentId: string, extra: Record<string, unknown>): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(payments)
      .set({
        status: "paid",
        paidDate,
        ...extra,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  };
  const linkStatement = async (paymentId: string): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(bankStatements)
      .set({
        matchStatus: "matched",
        matchedPaymentId: paymentId,
        matchedAt: new Date(),
      })
      .where(eq(bankStatements.id, statement.id));
  };
  // Mark a pending row paid and match the statement to it.
  const markPaidAndMatch = async (
    paymentId: string,
    extra: Record<string, unknown>,
  ): Promise<{ paymentId: string; created: boolean }> => {
    await markPaid(paymentId, extra);
    await linkStatement(paymentId);
    return { paymentId, created: false };
  };

  const transfer = Number(statement.amount);

  // Spread the transfer over the open months, oldest first; the rest is credit.
  // Null when nothing could be booked that way.
  const bookSpill = async (): Promise<{ paymentId: string; created: boolean } | null> => {
    const spill = await findSpillPlan(db, leaseId, pending, transfer);
    if (spill.bookings.length === 0 && !(spill.credit > 0)) return null;
    const total = transfer.toFixed(2);
    let first: { paymentId: string; created: boolean } | null = null;
    for (const b of spill.bookings) {
      const row = pending.find((p) => p.id === b.rowId);
      const planNote =
        b.kind === "settle"
          ? `${b.amount.toFixed(2)} of a transfer of ${total} booked on this month, which is now paid`
          : `${b.amount.toFixed(2)} of a transfer of ${total} booked on this month, ${b.remaining.toFixed(2)} still open`;
      const notes = [row?.notes, note, planNote, ODD_AMOUNT_MARKER].filter(Boolean).join("\n");
      await markPaid(b.rowId, {
        amount: String(b.amount),
        ...(b.rentAmount != null ? { rentAmount: String(b.rentAmount) } : {}),
        ...(b.chargesAmount != null ? { chargesAmount: String(b.chargesAmount) } : {}),
        notes,
      });
      if (!first) {
        await linkStatement(b.rowId);
        first = { paymentId: b.rowId, created: false };
      }
      console.log(
        `[Reconciliation] ${b.amount.toFixed(2)} of ${total} booked on payment ${b.rowId} for lease ${leaseId} (${b.month})`,
      );
    }
    if (spill.credit > 0) {
      const creditNote = [
        note,
        `${spill.credit.toFixed(2)} of a transfer of ${total} left after every open month was paid`,
        CREDIT_MARKER,
        ODD_AMOUNT_MARKER,
      ].join("\n");
      const res = await recordPaidFromTransfer(db, statement, leaseId, creditNote, {
        amount: spill.credit,
        link: !first,
      });
      console.log(`[Reconciliation] ${spill.credit.toFixed(2)} credit recorded for lease ${leaseId}`);
      if (!first) first = res;
    }
    return first;
  };

  // A transfer above the picked rent row (an overpayment): the extra is booked
  // on the next open months or kept as credit, never dropped.
  if (target && !isDepositNote(target.notes) && cents(transfer) > cents(target.amount)) {
    const spilled = await bookSpill();
    if (spilled) return spilled;
  }

  if (!target) {
    const records = (await loadIndexRecords(db, [leaseId])).get(leaseId) ?? [];
    // A remainder row is already the indexation difference, never the old rent.
    const m = preIndexationMatch(
      pending.filter((p) => !isRemainderNote(p.notes)),
      transfer,
      records,
    );
    if (m) {
      const oldNote = `Paid the rent from before the indexation (${m.expectedOld.toFixed(2)} instead of ${Number(m.row.amount).toFixed(2)})`;
      const rentAmount =
        m.row.rentAmount != null
          ? String(Math.round((Number(m.row.rentAmount) - m.diff) * 100) / 100)
          : null;
      const notes = [m.row.notes, note, oldNote].filter(Boolean).join("\n");
      console.log(`[Reconciliation] pre-indexation amount matched payment ${m.row.id} for lease ${leaseId}`);
      return markPaidAndMatch(m.row.id, {
        amount: String(transfer),
        ...(rentAmount != null ? { rentAmount } : {}),
        notes,
      });
    }
    const plan = await findShortfallPlan(db, leaseId, pending, transfer, {
      allowFirstPartial: opts.allowFirstPartial || opts.knownTenant,
    });
    if (plan) {
      const row = pending.find((p) => p.id === plan.rowId);
      const planNote =
        plan.kind === "settle"
          ? `Paid the rest of the month (${plan.amount.toFixed(2)})`
          : `Partial payment of ${plan.amount.toFixed(2)}, ${plan.remaining.toFixed(2)} still open`;
      // A partial is an amount that fits no open payment: flag it for a check.
      const notes = [row?.notes, note, planNote, plan.kind === "partial" ? ODD_AMOUNT_MARKER : null]
        .filter(Boolean)
        .join("\n");
      console.log(
        `[Reconciliation] ${plan.kind === "settle" ? "shortfall settled" : "partial booked"} on payment ${plan.rowId} for lease ${leaseId} (${plan.month})`,
      );
      return markPaidAndMatch(plan.rowId, {
        amount: String(plan.amount),
        ...(plan.rentAmount != null ? { rentAmount: String(plan.rentAmount) } : {}),
        ...(plan.chargesAmount != null ? { chargesAmount: String(plan.chargesAmount) } : {}),
        notes,
      });
    }
    if (opts.knownTenant) {
      const spilled = await bookSpill();
      if (spilled) return spilled;
    }
    if (!opts.createWhenUnmatched) return null;
    return recordPaidFromTransfer(
      db,
      statement,
      leaseId,
      `${note} (no pending payment matched this amount; the pending rent stays open)`,
    );
  }

  const combinedNotes = target.notes ? `${target.notes}\n${note}` : note;
  // The row records what actually came in: a transfer that matched the rent
  // net of a deduction (e.g. 536.08 against 1050 minus a 513.92 property-tax
  // reduction) must not be booked as the full rent.
  return markPaidAndMatch(target.id, { notes: combinedNotes, amount: String(transfer) });
}
