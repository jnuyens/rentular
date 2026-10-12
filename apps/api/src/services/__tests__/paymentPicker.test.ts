import { describe, it, expect } from "vitest";
import { pickPaymentForTransfer, type PendingPayment } from "../paymentPicker";
import { DEPOSIT_NOTE } from "../expectedPayments";
import type { DeductionRow } from "../rentDeductions";

function rent(id: string, amount: number, dueDate: string): PendingPayment {
  return { id, amount: amount.toFixed(2), dueDate, notes: "auto-generated expected payment" };
}

function deposit(id: string, amount: number, dueDate: string): PendingPayment {
  return { id, amount: amount.toFixed(2), dueDate, notes: DEPOSIT_NOTE };
}

function deduction(
  type: "temporary" | "permanent",
  amount: number,
  startDate: string,
  endDate: string | null,
): DeductionRow {
  return { id: "d1", type, amount: amount.toFixed(2), startDate, endDate, reason: "test" };
}

describe("pickPaymentForTransfer", () => {
  it("picks the rent row for a rent-sized transfer, not an older pending deposit", () => {
    const pending = [deposit("dep", 2080, "2026-03-01"), rent("oct", 1140, "2026-10-01")];
    expect(pickPaymentForTransfer(pending, 1140)?.id).toBe("oct");
  });

  it("never returns a deposit for a non-matching amount", () => {
    const pending = [deposit("dep", 1800, "2026-03-01")];
    expect(pickPaymentForTransfer(pending, 900)).toBeNull();
  });

  it("picks the deposit when the transfer matches it exactly", () => {
    const pending = [deposit("dep", 2080, "2026-03-01"), rent("oct", 1140, "2026-10-01")];
    expect(pickPaymentForTransfer(pending, 2080)?.id).toBe("dep");
  });

  it("picks the oldest of two matching rent rows", () => {
    const pending = [rent("oct", 1000, "2026-10-01"), rent("sep", 1000, "2026-09-01")];
    expect(pickPaymentForTransfer(pending, 1000)?.id).toBe("sep");
  });

  it("leaves a partial transfer without a deduction unmatched", () => {
    const pending = [rent("oct", 1050, "2026-10-08")];
    expect(pickPaymentForTransfer(pending, 536.08)).toBeNull();
  });

  it("matches rent minus an applicable temporary deduction", () => {
    const pending = [rent("oct", 1050, "2026-10-08")];
    const ded = [deduction("temporary", 513.92, "2026-10-08", "2026-11-07")];
    expect(pickPaymentForTransfer(pending, 536.08, ded)?.id).toBe("oct");
  });

  it("does not match an amount that fits neither rent nor rent minus deduction", () => {
    const pending = [rent("oct", 1050, "2026-10-08")];
    const ded = [deduction("temporary", 513.92, "2026-10-08", "2026-11-07")];
    expect(pickPaymentForTransfer(pending, 400, ded)).toBeNull();
  });

  it("applies a permanent deduction only from its start date", () => {
    const ded = [deduction("permanent", 50, "2026-01-01", null)];
    expect(pickPaymentForTransfer([rent("oct", 1000, "2026-10-01")], 950, ded)?.id).toBe("oct");
    expect(pickPaymentForTransfer([rent("dec", 1000, "2025-12-01")], 950, ded)).toBeNull();
  });

  it("assigns an overpayment to the oldest rent row", () => {
    expect(pickPaymentForTransfer([rent("oct", 1000, "2026-10-01")], 1200)?.id).toBe("oct");
  });

  it("prefers an exact deposit match over an overpayment of rent", () => {
    const pending = [rent("oct", 1000, "2026-10-01"), deposit("dep", 1200, "2026-10-01")];
    expect(pickPaymentForTransfer(pending, 1200)?.id).toBe("dep");
  });

  it("treats a deposit with an appended note as a deposit, not as rent", () => {
    const dep: PendingPayment = {
      id: "dep",
      amount: "2000.00",
      dueDate: "2026-03-01",
      notes: `${DEPOSIT_NOTE}\nAuto-assigned by IBAN match`,
    };
    expect(pickPaymentForTransfer([dep], 2500)).toBeNull();
    expect(pickPaymentForTransfer([dep, rent("oct", 1000, "2026-10-01")], 1200)?.id).toBe("oct");
  });

  it("uses a one cent tolerance", () => {
    expect(pickPaymentForTransfer([rent("oct", 1140, "2026-10-01")], 1139.995)?.id).toBe("oct");
    expect(pickPaymentForTransfer([rent("oct", 1140, "2026-10-01")], 1139.98)).toBeNull();
  });
});
