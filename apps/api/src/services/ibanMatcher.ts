import { eq, and, asc } from "drizzle-orm";
import { getDb, bankStatements, payments } from "@rentular/db";
import { decryptOrNull, type StatementRow } from "../lib/bankTransactionView";
import {
  normalizeIban,
  findCandidateLeasesByIban,
} from "./tenantBankAccounts";
import { assignStatementToLease } from "./reconciliationAssign";

type Db = ReturnType<typeof getDb>;

const AMOUNT_TOLERANCE = 0.01;

/** Expected amount for a lease: its oldest pending payment, else the rent. */
async function expectedAmountForLease(
  db: Db,
  leaseId: string,
  monthlyRent: string,
): Promise<number> {
  const p = await db
    .select({ amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "pending")))
    .orderBy(asc(payments.dueDate))
    .limit(1);
  return p[0] ? Number(p[0].amount) : Number(monthlyRent);
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
        const expected = await expectedAmountForLease(
          db,
          c.leaseId,
          c.monthlyRent,
        );
        if (Math.abs(txAmount - expected) < AMOUNT_TOLERANCE) {
          matching.push(c.leaseId);
        }
      }
      if (matching.length === 1) targetLeaseId = matching[0]!;
    }

    if (!targetLeaseId) continue;

    await assignStatementToLease(
      db,
      statement,
      targetLeaseId,
      `Auto-assigned by account number ${maskIban(iban)} from bank transfer ${statement.externalTransactionId}`,
    );
    assigned++;
    console.log(
      `[IbanMatcher] Auto-assigned statement ${statement.id} -> lease ${targetLeaseId} (IBAN ${maskIban(iban)})`,
    );
  }

  return assigned;
}
