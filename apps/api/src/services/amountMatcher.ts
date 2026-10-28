import { eq, and } from "drizzle-orm";
import {
  getDb,
  bankStatements,
  bankConnections,
  bankAccounts,
  leases,
  payments,
} from "@rentular/db";
import { decryptOrNull, type StatementRow } from "../lib/bankTransactionView";
import {
  normalizeIban,
  findCandidateLeasesByIban,
  learnTenantAccountFromStatement,
} from "./tenantBankAccounts";
import { assignStatementToLease } from "./reconciliationAssign";
import { expectedAmountsForLease } from "./ibanMatcher";
import { isDepositNote } from "./expectedPayments";
import { localYmd, addDays } from "./indexationCalc";

/**
 * Third matching pass, after the structured-communication matcher and the
 * known-IBAN matcher: assign a still-unmatched incoming credit by its amount
 * when exactly one active lease has pending rent of that amount due around the
 * booking date. On success the sender's IBAN is learned on the tenant, so the
 * next transfer from that account is handled by the IBAN pass.
 *
 * Skipped on purpose:
 * - transfers from the owner's own accounts (bank connections and registered
 *   bank accounts). An owner moving money between his own accounts often
 *   moves round amounts that look exactly like a rent.
 * - transfers from an IBAN already known as a tenant account; those are the
 *   IBAN pass's job and it has already decided.
 *
 * Ambiguity leaves the transfer for manual review: several leases with the
 * same rent due in the window, or another unmatched credit of the same amount
 * in the window from a different or unknown IBAN.
 *
 * Returns the number of statements auto-assigned.
 */

type Db = ReturnType<typeof getDb>;

const AMOUNT_TOLERANCE = 0.01;
const WINDOW_DAYS_BEFORE = 45;
const WINDOW_DAYS_AFTER = 35;

interface OwnerCredit {
  id: string;
  amount: number;
  bookingDate: string;
  iban: string | null;
}

interface PendingRentRow {
  leaseId: string;
  monthlyRent: string;
  dueDate: string;
}

function maskIban(iban: string): string {
  return iban.length > 4 ? `****${iban.slice(-4)}` : iban;
}

/** Local midnight of a YYYY-MM-DD string; new Date("YYYY-MM-DD") would be UTC. */
function parseLocalYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function statementIban(s: {
  counterpartyIbanEncrypted: string | null;
  counterpartyIbanIv: string | null;
  counterpartyIbanAuthTag: string | null;
}): string | null {
  return (
    normalizeIban(
      decryptOrNull(
        s.counterpartyIbanEncrypted,
        s.counterpartyIbanIv,
        s.counterpartyIbanAuthTag,
      ),
    ) || null
  );
}

export async function autoAssignByAmount(
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

  if (!rows.some((s) => Number(s.amount) > 0)) return 0;

  // Every unmatched credit of this owner, across all connections, for the
  // ambiguity guard.
  const ownerRows = await db
    .select({
      id: bankStatements.id,
      amount: bankStatements.amount,
      bookingDate: bankStatements.bookingDate,
      counterpartyIbanEncrypted: bankStatements.counterpartyIbanEncrypted,
      counterpartyIbanIv: bankStatements.counterpartyIbanIv,
      counterpartyIbanAuthTag: bankStatements.counterpartyIbanAuthTag,
    })
    .from(bankStatements)
    .innerJoin(bankConnections, eq(bankConnections.id, bankStatements.connectionId))
    .where(
      and(
        eq(bankConnections.ownerId, ownerId),
        eq(bankStatements.matchStatus, "unmatched"),
      ),
    );
  let ownerCredits: OwnerCredit[] = ownerRows
    .map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      bookingDate: String(r.bookingDate).slice(0, 10),
      iban: statementIban(r),
    }))
    .filter((r) => r.amount > 0);

  // The owner's own accounts, archived ones included: an old own account is
  // still the owner's money.
  const connectionIbans = await db
    .select({ iban: bankConnections.iban })
    .from(bankConnections)
    .where(eq(bankConnections.ownerId, ownerId));
  const accountIbans = await db
    .select({ iban: bankAccounts.iban })
    .from(bankAccounts)
    .where(eq(bankAccounts.ownerId, ownerId));
  const ownIbans = new Set<string>();
  for (const r of [...connectionIbans, ...accountIbans]) {
    const n = normalizeIban(r.iban);
    if (n) ownIbans.add(n);
  }

  const pendingRows = await db
    .select({
      leaseId: leases.id,
      monthlyRent: leases.monthlyRent,
      dueDate: payments.dueDate,
      notes: payments.notes,
    })
    .from(payments)
    .innerJoin(leases, eq(leases.id, payments.leaseId))
    .where(
      and(
        eq(leases.ownerId, ownerId),
        eq(leases.status, "active"),
        eq(payments.status, "pending"),
      ),
    );
  const pendingRent: PendingRentRow[] = pendingRows
    .filter((r) => !isDepositNote(r.notes))
    .map((r) => ({
      leaseId: r.leaseId,
      monthlyRent: String(r.monthlyRent),
      dueDate: String(r.dueDate).slice(0, 10),
    }));

  let assigned = 0;

  for (const statement of rows) {
    // Only incoming credits are rent.
    const txAmount = Number(statement.amount);
    if (!(txAmount > 0)) continue;

    const iban = statementIban(statement);
    if (iban) {
      if (ownIbans.has(iban)) {
        console.log(
          `[AmountMatcher] Statement ${statement.id} comes from own account ${maskIban(iban)}, skipped`,
        );
        continue;
      }
      // Checked per statement so an IBAN learned earlier in this run sends
      // the next transfer from it to the IBAN pass instead.
      const known = await findCandidateLeasesByIban(db, ownerId, iban);
      if (known.length > 0) continue;
    }

    const booking = parseLocalYmd(String(statement.bookingDate).slice(0, 10));
    if (!booking) continue;
    const windowStart = localYmd(addDays(booking, -WINDOW_DAYS_BEFORE));
    const windowEnd = localYmd(addDays(booking, WINDOW_DAYS_AFTER));

    const candidates = new Map<string, string>();
    for (const p of pendingRent) {
      if (p.dueDate >= windowStart && p.dueDate <= windowEnd) {
        candidates.set(p.leaseId, p.monthlyRent);
      }
    }
    if (candidates.size === 0) continue;

    const matching: string[] = [];
    for (const [leaseId, monthlyRent] of candidates) {
      const expected = await expectedAmountsForLease(db, leaseId, monthlyRent);
      if (expected.some((e) => Math.abs(txAmount - e) < AMOUNT_TOLERANCE)) {
        matching.push(leaseId);
      }
    }
    if (matching.length !== 1) {
      if (matching.length > 1) {
        console.log(
          `[AmountMatcher] Statement ${statement.id} amount fits ${matching.length} leases, left for manual review`,
        );
      }
      continue;
    }
    const leaseId = matching[0]!;

    const competing = ownerCredits.some(
      (o) =>
        o.id !== statement.id &&
        Math.abs(o.amount - txAmount) < AMOUNT_TOLERANCE &&
        o.bookingDate >= windowStart &&
        o.bookingDate <= windowEnd &&
        (iban === null || o.iban === null || o.iban !== iban),
    );
    if (competing) {
      console.log(
        `[AmountMatcher] Statement ${statement.id} shares its amount with another unmatched transfer, left for manual review`,
      );
      continue;
    }

    const result = await assignStatementToLease(
      db,
      statement,
      leaseId,
      `Auto-assigned by unique amount from bank transfer ${statement.externalTransactionId}`,
    );
    if (!result) {
      console.log(
        `[AmountMatcher] Statement ${statement.id} fits no pending payment of lease ${leaseId}, left for manual review`,
      );
      continue;
    }
    assigned++;
    ownerCredits = ownerCredits.filter((o) => o.id !== statement.id);

    try {
      await learnTenantAccountFromStatement(db, { leaseId, statement });
    } catch (err) {
      console.warn(
        `[AmountMatcher] learnTenantAccount failed for statement ${statement.id}`,
        err,
      );
    }
    console.log(
      `[AmountMatcher] Auto-assigned statement ${statement.id} -> lease ${leaseId} (${iban ? `IBAN ${maskIban(iban)}` : "no IBAN"})`,
    );
  }

  return assigned;
}
