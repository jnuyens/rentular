import { eq, and, asc } from "drizzle-orm";
import { getDb, bankStatements, payments } from "@rentular/db";
import { decryptOrNull, type StatementRow } from "../lib/bankTransactionView";
import {
  normalizeIban,
  findCandidateLeasesByIban,
} from "./tenantBankAccounts";
import { assignStatementToLease } from "./reconciliationAssign";
import { isDepositNote } from "./expectedPayments";
import type { PendingPayment } from "./paymentPicker";
import { deductedAmount, loadLeaseDeductions } from "./rentDeductions";

type Db = ReturnType<typeof getDb>;

const AMOUNT_TOLERANCE = 0.01;

/**
 * Amounts a transfer for this lease is expected to be: the oldest pending
 * rent row's amount and that amount net of applicable rent deductions, or the
 * monthly rent when no rent row is pending. A pending deposit on its own never
 * defines the expected amount.
 */
async function expectedAmountsForLease(
  db: Db,
  leaseId: string,
  monthlyRent: string,
): Promise<number[]> {
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
  const oldestRent = pending.find((p) => !isDepositNote(p.notes));
  if (!oldestRent) return [Number(monthlyRent)];
  const raw = Number(oldestRent.amount);
  const deductions = await loadLeaseDeductions(db, leaseId);
  const net = Math.max(
    0,
    Math.round(
      (raw - deductedAmount(deductions, String(oldestRent.dueDate))) * 100,
    ) / 100,
  );
  return net === raw ? [raw] : [raw, net];
}

function maskIban(iban: string): string {
  return iban.length > 4 ? `****${iban.slice(-4)}` : iban;
}

/**
 * Second matching pass, after the structured-communication matcher: assign
 * still-unmatched incoming credits whose sender IBAN is a known tenant account.
 *
 * - IBAN maps to exactly one active lease  -> auto-assign.
 * - IBAN maps to several leases (e.g. a parent paying two student rooms) ->
 *   disambiguate by amount; assign only when exactly one lease's expected
 *   amount matches the transfer, otherwise leave it for manual review.
 *
 * Returns the number of statements auto-assigned.
 */
export async function autoAssignByIban(
  db: Db,
  ownerId: string,
  connectionId: string,
): Promise<number> {
  const rows = (await db
    .select()
    .from(bankStatements)
    .where(
      and(
        eq(bankStatements.connectionId, connectionId),
        eq(bankStatements.matchStatus, "unmatched"),
      ),
    )) as StatementRow[];

  let assigned = 0;

  for (const statement of rows) {
    // Only incoming credits are rent.
    if (Number(statement.amount) <= 0) continue;

    const iban = normalizeIban(
      decryptOrNull(
        statement.counterpartyIbanEncrypted,
        statement.counterpartyIbanIv,
        statement.counterpartyIbanAuthTag,
      ),
    );
    if (!iban) continue;

    const candidates = await findCandidateLeasesByIban(db, ownerId, iban);
    if (candidates.length === 0) continue;

    let targetLeaseId: string | null = null;
    if (candidates.length === 1) {
      targetLeaseId = candidates[0]!.leaseId;
    } else {
      const txAmount = Number(statement.amount);
      const matching: string[] = [];
      for (const c of candidates) {
        const expected = await expectedAmountsForLease(
          db,
          c.leaseId,
          c.monthlyRent,
        );
        if (expected.some((e) => Math.abs(txAmount - e) < AMOUNT_TOLERANCE)) {
          matching.push(c.leaseId);
        }
      }
      if (matching.length === 1) targetLeaseId = matching[0]!;
    }

    if (!targetLeaseId) continue;

    const result = await assignStatementToLease(
      db,
      statement,
      targetLeaseId,
      `Auto-assigned by account number ${maskIban(iban)} from bank transfer ${statement.externalTransactionId}`,
    );
    if (!result) {
      console.log(
        `[IbanMatcher] Statement ${statement.id} fits no pending payment of lease ${targetLeaseId}, left for manual review`,
      );
      continue;
    }
    assigned++;
    console.log(
      `[IbanMatcher] Auto-assigned statement ${statement.id} -> lease ${targetLeaseId} (IBAN ${maskIban(iban)})`,
    );
  }

  return assigned;
}
