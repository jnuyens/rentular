import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, payments, bankStatements } from "@rentular/db";
import type { StatementRow } from "../lib/bankTransactionView";
import { pickPaymentForTransfer, type PendingPayment } from "./paymentPicker";
import { loadLeaseDeductions } from "./rentDeductions";
import { loadIndexRecords, preIndexationMatch } from "./monthReceived";
import { isRemainderNote } from "./expectedPayments";
import { findShortfallPlan } from "./shortfallMatch";

type Db = ReturnType<typeof getDb>;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
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
): Promise<{ paymentId: string; created: boolean }> {
  const paidDate = statement.bookingDate
    ? String(statement.bookingDate).slice(0, 10)
    : isoToday();
  const newPaymentId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(payments).values({
    id: newPaymentId,
    leaseId,
    amount: String(statement.amount),
    dueDate: paidDate,
    paidDate,
    status: "paid",
    method: "bank_transfer",
    notes: note,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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
  opts: { createWhenUnmatched?: boolean; allowFirstPartial?: boolean } = {},
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

  // Mark a pending row paid and match the statement to it.
  const markPaidAndMatch = async (
    paymentId: string,
    extra: Record<string, unknown>,
  ): Promise<{ paymentId: string; created: boolean }> => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(bankStatements)
      .set({
        matchStatus: "matched",
        matchedPaymentId: paymentId,
        matchedAt: new Date(),
      })
      .where(eq(bankStatements.id, statement.id));
    return { paymentId, created: false };
  };

  if (!target) {
    const records = (await loadIndexRecords(db, [leaseId])).get(leaseId) ?? [];
    const transfer = Number(statement.amount);
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
      allowFirstPartial: opts.allowFirstPartial,
    });
    if (plan) {
      const row = pending.find((p) => p.id === plan.rowId);
      const planNote =
        plan.kind === "settle"
          ? `Paid the rest of the month (${plan.amount.toFixed(2)})`
          : `Partial payment of ${plan.amount.toFixed(2)}, ${plan.remaining.toFixed(2)} still open`;
      const notes = [row?.notes, note, planNote].filter(Boolean).join("\n");
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
    if (!opts.createWhenUnmatched) return null;
    return recordPaidFromTransfer(
      db,
      statement,
      leaseId,
      `${note} (no pending payment matched this amount; the pending rent stays open)`,
    );
  }

  const combinedNotes = target.notes ? `${target.notes}\n${note}` : note;
  return markPaidAndMatch(target.id, { notes: combinedNotes });
}
