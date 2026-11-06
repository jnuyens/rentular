import { eq, and, asc, inArray } from "drizzle-orm";
import { getDb, bankStatements, leases, payments } from "@rentular/db";
import { decryptOrNull, type StatementRow } from "../lib/bankTransactionView";
import {
  normalizeIban,
  findCandidateLeasesByIban,
} from "./tenantBankAccounts";
import { assignStatementToLease } from "./reconciliationAssign";
import { isDepositNote } from "./expectedPayments";
import type { PendingPayment } from "./paymentPicker";
import { deductedAmount, loadLeaseDeductions } from "./rentDeductions";
import { loadIndexRecords } from "./monthReceived";
import { oldestShortfall } from "./shortfallMatch";

type Db = ReturnType<typeof getDb>;

const AMOUNT_TOLERANCE = 0.01;

/**
 * Amounts a transfer for this lease is expected to be: the oldest pending
 * rent row's amount, that amount net of applicable rent deductions, and the
 * amount from before the latest indexation in force on its due date (a tenant
 * who has not adjusted the standing order yet), or the monthly rent when no
 * rent row is pending. A pending deposit on its own never defines the
 * expected amount.
 */
export async function expectedAmountsForLease(
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
  const amounts = net === raw ? [raw] : [raw, net];

  const due = String(oldestRent.dueDate).slice(0, 10);
  const latest = ((await loadIndexRecords(db, [leaseId])).get(leaseId) ?? [])
    .filter((r) => r.effectiveDate <= due)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0))
    .pop();
  const diff = latest ? Math.round((latest.newRent - latest.previousRent) * 100) / 100 : 0;
  if (diff > 0) {
    const old = Math.round((raw - diff) * 100) / 100;
    if (!amounts.some((a) => Math.abs(a - old) < AMOUNT_TOLERANCE)) amounts.push(old);
  }

  // What is still missing on a partly paid month, exact to the cent: a tenant
  // who paid most of the month and now sends the rest.
  try {
    const short = await oldestShortfall(db, leaseId, pending);
    if (short != null && short > 0 && !amounts.some((a) => Math.abs(a - short) < AMOUNT_TOLERANCE)) {
      amounts.push(short);
    }
  } catch (err) {
    console.warn(`[IbanMatcher] shortfall lookup failed for lease ${leaseId}:`, err);
  }
  return amounts;
}

function maskIban(iban: string): string {
  return iban.length > 4 ? `****${iban.slice(-4)}` : iban;
}

/** The digits of a Belgian structured communication, or "" when it has fewer than 12. */
function commDigits(v: string | null | undefined): string {
  const d = (v ?? "").replace(/[^0-9]/g, "");
  return d.length >= 12 ? d : "";
}

/**
 * The owner's active leases whose structured communication (on the lease or
 * on one of its pending payments) equals `digits`.
 */
async function findLeasesByStructuredCommunication(
  db: Db,
  ownerId: string,
  digits: string,
): Promise<Array<{ leaseId: string; monthlyRent: string }>> {
  const leaseRows = await db
    .select({
      leaseId: leases.id,
      monthlyRent: leases.monthlyRent,
      comm: leases.structuredCommunication,
    })
    .from(leases)
    .where(and(eq(leases.ownerId, ownerId), eq(leases.status, "active")));
  const paymentRows = await db
    .select({ leaseId: payments.leaseId, comm: payments.structuredCommunication })
    .from(payments)
    .innerJoin(leases, eq(leases.id, payments.leaseId))
    .where(
      and(eq(leases.ownerId, ownerId), eq(leases.status, "active"), eq(payments.status, "pending")),
    );
  const ids = new Set<string>();
  for (const r of leaseRows) if (commDigits(r.comm) === digits) ids.add(r.leaseId);
  for (const r of paymentRows) if (commDigits(r.comm) === digits) ids.add(r.leaseId);
  return leaseRows
    .filter((r) => ids.has(r.leaseId))
    .map((r) => ({ leaseId: r.leaseId, monthlyRent: String(r.monthlyRent) }));
}

/**
 * Second matching pass, after the structured-communication matcher: assign
 * still-unbooked incoming credits from a known tenant: the sender IBAN is a
 * known tenant account, or the transfer carries a lease's structured
 * communication. Transfers the first pass flagged as a different amount are
 * looked at too, as long as they are not linked to a payment.
 *
 * - The tenant maps to exactly one active lease -> auto-assign. The amount
 *   need not fit: an odd amount is booked on the oldest open month (see
 *   assignStatementToLease, knownTenant).
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
  const rows = (
    (await db
      .select()
      .from(bankStatements)
      .where(
        and(
          eq(bankStatements.connectionId, connectionId),
          inArray(bankStatements.matchStatus, ["unmatched", "mismatched_amount"]),
        ),
      )) as StatementRow[]
  ).filter((s) => s.matchStatus === "unmatched" || !s.matchedPaymentId);

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
    const digits = commDigits(statement.structuredCommunication);
    if (!iban && !digits) continue;

    let candidates = iban ? await findCandidateLeasesByIban(db, ownerId, iban) : [];
    let byComm = false;
    if (candidates.length === 0 && digits) {
      candidates = await findLeasesByStructuredCommunication(db, ownerId, digits);
      byComm = candidates.length > 0;
    }
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
      byComm
        ? `Auto-assigned by structured communication from bank transfer ${statement.externalTransactionId}`
        : `Auto-assigned by account number ${maskIban(iban)} from bank transfer ${statement.externalTransactionId}`,
      // The transfer comes from this lease's tenant, so an odd amount is
      // booked on the open months instead of being left unmatched.
      { allowFirstPartial: true, knownTenant: true },
    );
    if (!result) {
      console.log(
        `[IbanMatcher] Statement ${statement.id} fits no pending payment of lease ${targetLeaseId}, left for manual review`,
      );
      continue;
    }
    assigned++;
    console.log(
      `[IbanMatcher] Auto-assigned statement ${statement.id} -> lease ${targetLeaseId} (${byComm ? "structured communication" : `IBAN ${maskIban(iban)}`})`,
    );
  }

  return assigned;
}
