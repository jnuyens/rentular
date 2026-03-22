import { eq, and, inArray } from "drizzle-orm";
import { getDb, payments, leases } from "@rentular/db";

// Rentular internal payment statuses (must match payments.status enum)
export type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded";

// Valid state transitions. Key = current status, value = allowed next statuses.
// Per Pitfall 2 (out-of-order events): allow "forward" jumps (e.g., pending -> paid directly)
const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending:    ["processing", "paid", "cancelled", "failed"],
  processing: ["paid", "failed", "cancelled"],
  paid:       ["refunded", "failed"],  // failed = charged_back / late_failure_settled
  failed:     ["processing", "cancelled"],  // processing = retry
  cancelled:  ["paid"],  // extremely rare: mandate cascade cancelled but GC confirms
  refunded:   [],  // terminal state
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// GoCardless payment.action -> Rentular PaymentStatus
export const GC_PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  created:                   "processing",
  submitted:                 "processing",
  confirmed:                 "paid",
  paid_out:                  "paid",
  failed:                    "failed",
  cancelled:                 "cancelled",
  charged_back:              "failed",
  late_failure_settled:      "failed",
  customer_approval_denied:  "cancelled",
};

// GoCardless mandate.action -> internal status string
export const GC_MANDATE_STATUS_MAP: Record<string, string> = {
  active:     "active",
  cancelled:  "cancelled",
  failed:     "failed",
  expired:    "expired",
  created:    "pending",
  submitted:  "pending",
  reinstated: "active",
};

// Mandate statuses that trigger cascade cancellation of pending payments (per D-13)
export const MANDATE_TERMINAL_STATUSES = ["cancelled", "failed", "expired"];

/**
 * Transition a payment to a new status with validation.
 * Returns true if transition was applied, false if skipped (invalid transition).
 * Throws if payment not found.
 */
export async function transitionPayment(
  paymentId: string,
  newStatus: PaymentStatus,
  metadata?: { paidDate?: string; gocardlessPaymentId?: string }
): Promise<boolean> {
  const db = getDb();
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
  });

  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const currentStatus = payment.status as PaymentStatus;
  if (!canTransition(currentStatus, newStatus)) {
    console.log(`[StateMachine] Skipping invalid transition: ${currentStatus} -> ${newStatus} for payment ${paymentId}`);
    return false;
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (metadata?.paidDate) {
    updateData.paidDate = metadata.paidDate;
  } else if (newStatus === "paid" && !payment.paidDate) {
    updateData.paidDate = new Date().toISOString().split("T")[0];
  }

  if (metadata?.gocardlessPaymentId) {
    updateData.gocardlessPaymentId = metadata.gocardlessPaymentId;
  }

  await db.update(payments)
    .set(updateData)
    .where(eq(payments.id, paymentId));

  console.log(`[StateMachine] Payment ${paymentId}: ${currentStatus} -> ${newStatus}`);
  return true;
}

/**
 * Cascade mandate cancellation: cancel all pending/processing payments for leases using this mandate (per D-13).
 * Returns the number of payments cancelled.
 */
export async function cascadeMandateCancellation(mandateId: string): Promise<number> {
  const db = getDb();

  // Find leases using this mandate
  const affectedLeases = await db
    .select({ id: leases.id })
    .from(leases)
    .where(eq(leases.gocardlessMandateId, mandateId));

  if (affectedLeases.length === 0) return 0;

  const leaseIds = affectedLeases.map((l) => l.id);

  // Cancel all pending/processing payments for those leases
  const result = await db.update(payments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        inArray(payments.leaseId, leaseIds),
        inArray(payments.status, ["pending", "processing"]),
      )
    );

  const count = (result as any)[0]?.affectedRows ?? 0;

  if (count > 0) {
    console.log(`[StateMachine] Mandate ${mandateId} cascade: cancelled ${count} pending/processing payments across ${leaseIds.length} lease(s)`);
  }

  return count;
}
