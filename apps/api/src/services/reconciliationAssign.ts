import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, payments, bankStatements } from "@rentular/db";
import type { StatementRow } from "../lib/bankTransactionView";

type Db = ReturnType<typeof getDb>;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export type AssignableStatement = Pick<
  StatementRow,
  "id" | "amount" | "bookingDate" | "externalTransactionId"
>;

/**
 * Link a bank statement to a lease: mark the lease's oldest pending payment
 * paid (dated to the statement's booking date), or record a paid payment from
 * the transfer when the lease has no pending payment. Shared by the manual
 * assign route and the automatic IBAN matcher so both behave identically.
 * Returns the linked payment id.
 */
export async function assignStatementToLease(
  db: Db,
  statement: AssignableStatement,
  leaseId: string,
  note: string,
): Promise<{ paymentId: string; created: boolean }> {
  const pending = await db
    .select({ id: payments.id, notes: payments.notes })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "pending")))
    .orderBy(asc(payments.dueDate))
    .limit(1);

  if (!pending[0]) {
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

  const combinedNotes = pending[0].notes
    ? `${pending[0].notes}\n${note}`
    : note;
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
    .where(eq(payments.id, pending[0].id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(bankStatements)
    .set({
      matchStatus: "matched",
      matchedPaymentId: pending[0].id,
      matchedAt: new Date(),
    })
    .where(eq(bankStatements.id, statement.id));
  return { paymentId: pending[0].id, created: false };
}
