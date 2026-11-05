/**
 * A transfer that pays what is still missing on a partly paid month is booked
 * on that month's pending row, exact to the cent. Cases from Tervuursestraat 97
 * (November 2026): pending 810 due 02/11, a separate paid 740 on 29/10.
 */
import { describe, it, expect } from "vitest";
import { monthSettlement, type PaidRowLike } from "../monthReceived";
import { planShortfallTransfer, type ShortfallPendingRow } from "../shortfallMatch";
import { decideRemainderRows } from "../remainderRows";
import { DEPOSIT_NOTE } from "../expectedPayments";

const lease = { monthlyRent: 810, monthlyCharges: 0, paymentDay: 2 };
const pendingRow: ShortfallPendingRow = {
  id: "5a6f3b44",
  amount: "810.00",
  dueDate: "2026-11-02",
  notes: "auto-generated expected payment",
  rentAmount: "810.00",
  chargesAmount: "0.00",
};
const paid740: PaidRowLike = {
  status: "paid",
  amount: "740.00",
  dueDate: "2026-10-29",
  paidDate: "2026-10-29",
};

function settle(rows: PaidRowLike[]) {
  return monthSettlement({
    rows,
    allocationSum: 0,
    records: [],
    monthlyRent: lease.monthlyRent,
    monthlyCharges: lease.monthlyCharges,
    deductions: [],
    month: "2026-11",
    paymentDay: lease.paymentDay,
  });
}

/** The month after booking the plan: the pending row becomes paid with the transfer. */
function afterBooking(amount: number) {
  return settle([
    paid740,
    { status: "paid", amount: String(amount), dueDate: "2026-11-02", paidDate: "2026-11-05" },
  ]);
}

describe("planShortfallTransfer", () => {
  it("settles the month when the transfer is exactly the shortfall (810 pending, 740 paid, 70 in)", () => {
    const before = settle([paid740]);
    expect(before).toMatchObject({ expected: 810, received: 740, shortfall: 70, settled: false });

    const plan = planShortfallTransfer({
      settlement: before,
      month: "2026-11",
      monthRows: [pendingRow],
      transfer: 70,
    });
    expect(plan).toEqual({
      kind: "settle",
      rowId: "5a6f3b44",
      month: "2026-11",
      amount: 70,
      rentAmount: 70,
      chargesAmount: null,
      remaining: 0,
    });

    const after = afterBooking(plan!.amount);
    expect(after).toMatchObject({ received: 810, shortfall: 0, settled: true });
  });

  it("books a further partial (810 pending, 740 paid, 50 in): received 790, shortfall 20", () => {
    const plan = planShortfallTransfer({
      settlement: settle([paid740]),
      month: "2026-11",
      monthRows: [pendingRow],
      transfer: 50,
    });
    expect(plan).toMatchObject({ kind: "partial", rowId: "5a6f3b44", amount: 50, rentAmount: 50, remaining: 20 });

    const after = afterBooking(plan!.amount);
    expect(after).toMatchObject({ received: 790, shortfall: 20, settled: false });
    // Nothing is open any more, so the sweep adds a pending row for the 20 left.
    expect(decideRemainderRows({ settlement: after, openRows: [] })).toEqual([
      { kind: "insert", amount: 20 },
    ]);
  });

  it("is exact to the cent: 69.99 is a partial, 70.01 fits nothing", () => {
    const before = settle([paid740]);
    const base = { settlement: before, month: "2026-11", monthRows: [pendingRow] };
    expect(planShortfallTransfer({ ...base, transfer: 69.99 })).toMatchObject({
      kind: "partial",
      remaining: 0.01,
    });
    expect(planShortfallTransfer({ ...base, transfer: 70.01 })).toBeNull();
  });

  it("leaves a first partial alone unless the sender is a known tenant account", () => {
    const before = settle([]);
    expect(before).toMatchObject({ received: 0, shortfall: 810 });
    const base = { settlement: before, month: "2026-11", monthRows: [pendingRow], transfer: 400 };
    expect(planShortfallTransfer(base)).toBeNull();
    expect(planShortfallTransfer({ ...base, allowFirstPartial: true })).toMatchObject({
      kind: "partial",
      amount: 400,
      remaining: 410,
    });
  });

  it("never books on a settled month or on a deposit row", () => {
    const settled = settle([{ status: "paid", amount: "810.00", dueDate: "2026-11-02", paidDate: "2026-11-02" }]);
    expect(
      planShortfallTransfer({ settlement: settled, month: "2026-11", monthRows: [pendingRow], transfer: 70 }),
    ).toBeNull();
    expect(
      planShortfallTransfer({
        settlement: settle([paid740]),
        month: "2026-11",
        monthRows: [{ ...pendingRow, notes: DEPOSIT_NOTE }],
        transfer: 70,
      }),
    ).toBeNull();
  });

  it("takes the cut off the charges once the rent part is used up", () => {
    const plan = planShortfallTransfer({
      settlement: settle([paid740]),
      month: "2026-11",
      monthRows: [{ ...pendingRow, rentAmount: "760.00", chargesAmount: "50.00" }],
      transfer: 70,
    });
    expect(plan).toMatchObject({ rentAmount: 20, chargesAmount: null });
    const small = planShortfallTransfer({
      settlement: settle([paid740]),
      month: "2026-11",
      monthRows: [{ ...pendingRow, rentAmount: "700.00", chargesAmount: "110.00" }],
      transfer: 70,
    });
    expect(small).toMatchObject({ rentAmount: 0, chargesAmount: 70 });
  });
});
