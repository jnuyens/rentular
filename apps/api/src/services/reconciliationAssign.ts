import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, payments, bankStatements } from "@rentular/db";
import type { StatementRow } from "../lib/bankTransactionView";
import { pickPaymentForTransfer, type PendingPayment } from "./paymentPicker";
import { loadLeaseDeductions } from "./rentDeductions";

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
 * - Nothing fits (e.g. a partial transfer): in the default (automatic) mode
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
  opts: { createWhenUnmatched?: boolean } = {},
): Promise<{ paymentId: string; created: boolean } | null> {
  const pending = (await db
    .select({
      id: payments.id,
      amount: payments.amount,
      dueDate: payments.dueDate,
      notes: payments.notes,
    })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "pending")))
    .orderBy(asc(payments.dueDate))) as PendingPayment[];

  if (pending.length === 0) {
    return recordPaidFromTransfer(db, statement, leaseId, note);
  }

  const deductions = await loadLeaseDeductions(db, leaseId);
  const target = pickPaymentForTransfer(
    pending,
    Number(statement.amount),
    deductions,
  );

  if (!target) {
    if (!opts.createWhenUnmatched) return null;
    return recordPaidFromTransfer(
      db,
      statement,
      leaseId,
      `${note} (no pending payment matched this amount; the pending rent stays open)`,
    );
  }

  const combinedNotes = target.notes ? `${target.notes}\n${note}` : note;
  const paidDate = statement.bookingDate
    ? new Date(statement.bookingDate)
    : new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(payments)
    .set({
      status: "paid",
      paidDate,
      notes: combinedNotes,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, target.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(bankStatements)
    .set({
      matchStatus: "matched",
      matchedPaymentId: target.id,
      matchedAt: new Date(),
    })
    .where(eq(bankStatements.id, statement.id));
  return { paymentId: target.id, created: false };
}
