import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@rentular/db";
import { payments, leases } from "@rentular/db";
import type { IncomingTransaction } from "../lib/bankAccountData";

export interface MatchResult {
  paymentId: string;
  transactionId: string;
  confidence: "exact" | "amount_mismatch" | "unmatched";
  matchedAmount: number;
  expectedAmount: number;
}

/**
 * Match a single incoming bank transaction to an expected pending payment.
 * Per D-04: Match by Belgian structured communication (+++xxx/xxxx/xxxxx+++).
 * Per D-05: Exact amount + structured communication = auto-mark paid.
 * Per D-06: Amount mismatch = flagged for landlord review.
 */
export function matchTransaction(
  tx: IncomingTransaction,
  expectedPayments: Array<{
    id: string;
    structuredCommunication: string | null;
    amount: string;
  }>
): MatchResult | null {
  if (!tx.remittanceStructured) return null;
  if (tx.amount <= 0) return null; // Only match credits (incoming payments)

  // Normalize: strip non-digit characters, compare 12-digit Belgian OGM-VCS
  const txDigits = tx.remittanceStructured.replace(/[^0-9]/g, "");
  if (txDigits.length < 12) return null;

  for (const payment of expectedPayments) {
    if (!payment.structuredCommunication) continue;
    const paymentDigits = payment.structuredCommunication.replace(
      /[^0-9]/g,
      ""
    );

    if (txDigits === paymentDigits) {
      const expectedAmount = Number(payment.amount);
      const tolerance = 0.01; // Per Pitfall 4: decimal precision tolerance

      if (Math.abs(tx.amount - expectedAmount) < tolerance) {
        return {
          paymentId: payment.id,
          transactionId: tx.transactionId,
          confidence: "exact",
          matchedAmount: tx.amount,
          expectedAmount,
        };
      }

      return {
        paymentId: payment.id,
        transactionId: tx.transactionId,
        confidence: "amount_mismatch",
        matchedAmount: tx.amount,
        expectedAmount,
      };
    }
  }

  return null;
}

/**
 * Process a batch of incoming transactions against pending payments for an owner.
 * Per D-05: Exact matches are auto-marked as paid.
 * Per D-06: Mismatches are flagged (notes added) for landlord review.
 */
export async function processIncomingTransactions(
  ownerId: string,
  transactions: IncomingTransaction[]
): Promise<{ matched: number; mismatched: number; unmatched: number }> {
  const db = getDb();

  // Get all pending payments for this owner's leases that have structured communication
  const pendingPayments = await db
    .select({
      id: payments.id,
      structuredCommunication: payments.structuredCommunication,
      amount: payments.amount,
    })
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(
      and(eq(leases.ownerId, ownerId), inArray(payments.status, ["pending"]))
    );

  // Filter to payments with structured communication
  const matchablePayments = pendingPayments.filter(
    (p) => p.structuredCommunication
  );

  let matched = 0;
  let mismatched = 0;
  let unmatched = 0;

  for (const tx of transactions) {
    const result = matchTransaction(tx, matchablePayments);

    if (!result) {
      unmatched++;
      continue;
    }

    if (result.confidence === "exact") {
      // D-05: Auto-mark as paid
      await db
        .update(payments)
        .set({
          status: "paid",
          paidDate: new Date(tx.bookingDate),
          notes: `Auto-matched from bank transfer. Transaction: ${tx.transactionId}. Debtor: ${tx.debtorName || "unknown"}.`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, result.paymentId));

      matched++;
      console.log(
        `[TransactionMatcher] Exact match: payment ${result.paymentId} marked paid (${tx.amount} EUR)`
      );
    } else if (result.confidence === "amount_mismatch") {
      // D-06: Flag for landlord review
      await db
        .update(payments)
        .set({
          notes: `Amount mismatch from bank transfer. Expected: ${result.expectedAmount} EUR, Received: ${result.matchedAmount} EUR. Transaction: ${tx.transactionId}. Debtor: ${tx.debtorName || "unknown"}. Requires landlord review.`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, result.paymentId));

      mismatched++;
      console.log(
        `[TransactionMatcher] Amount mismatch: payment ${result.paymentId} (expected ${result.expectedAmount}, got ${result.matchedAmount})`
      );
    }
  }

  return { matched, mismatched, unmatched };
}
