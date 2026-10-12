import { isDepositNote } from "./expectedPayments";
import { deductedAmount, type DeductionRow } from "./rentDeductions";

export type PendingPayment = {
  id: string;
  amount: string | number;
  dueDate: string;
  notes: string | null;
};

function isDeposit(p: PendingPayment): boolean {
  return isDepositNote(p.notes);
}

/**
 * Choose which pending payment of a lease an incoming transfer settles.
 *
 * Rows are considered oldest first (by due date). A rent row's effective
 * amount is its amount minus the rent deductions that apply to its due date;
 * a deposit always uses its own amount. Priority:
 *   1. the oldest rent row whose amount or effective amount equals the transfer
 *   2. the oldest deposit whose amount equals the transfer
 *   3. the oldest rent row when the transfer covers its effective amount
 *      (an overpayment)
 *   4. nothing (null): the transfer fits no pending payment
 *
 * A deposit is never picked for a different amount, and a transfer smaller
 * than the rent is never picked unless a deduction explains the difference.
 */
export function pickPaymentForTransfer(
  pending: PendingPayment[],
  amount: number,
  deductions: DeductionRow[] = [],
  tolerance = 0.01,
): PendingPayment | null {
  const sorted = [...pending].sort((a, b) =>
    String(a.dueDate).slice(0, 10).localeCompare(String(b.dueDate).slice(0, 10)),
  );
  const fits = (expected: number) => Math.abs(amount - expected) < tolerance;

  const rents = sorted
    .filter((p) => !isDeposit(p))
    .map((p) => {
      const raw = Number(p.amount);
      const effective = Math.max(
        0,
        Math.round((raw - deductedAmount(deductions, String(p.dueDate))) * 100) /
          100,
      );
      return { p, raw, effective };
    });
  const deposits = sorted.filter(isDeposit);

  const exactRent = rents.find((r) => fits(r.raw) || fits(r.effective));
  if (exactRent) return exactRent.p;

  const exactDeposit = deposits.find((p) => fits(Number(p.amount)));
  if (exactDeposit) return exactDeposit;

  const oldestRent = rents[0];
  if (oldestRent && amount >= oldestRent.effective - tolerance) {
    return oldestRent.p;
  }

  return null;
}
