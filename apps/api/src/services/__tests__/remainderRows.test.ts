import { describe, it, expect } from "vitest";
import { decideRemainderRows, sweepMonths, type OpenMonthRow } from "../remainderRows";
import { monthSettlement, rowIdsForMonth, type IndexRecord, type PaidRowLike } from "../monthReceived";
import { pickPaymentForTransfer } from "../paymentPicker";
import { REMAINDER_NOTE, isRemainderNote } from "../expectedPayments";

const carnotRecords: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 900, newRent: 925 }];
const tervRecords: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 780, newRent: 810 }];

type Row = PaidRowLike & { id: string };

function openRowsOf(rows: Row[], month: string): OpenMonthRow[] {
  return rows
    .filter(
      (r) =>
        (r.status === "pending" || r.status === "processing") &&
        !r.isIgnored &&
        String(r.dueDate).slice(0, 7) === month,
    )
    .map((r) => ({ id: r.id, status: r.status, amount: r.amount, notes: r.notes ?? null }));
}

function carnot(rows: Row[]) {
  return monthSettlement({
    rows,
    allocationSum: 0,
    records: carnotRecords,
    monthlyRent: 925,
    monthlyCharges: 0,
    deductions: [],
    month: "2026-11",
    paymentDay: 4,
  });
}

// Prod: paid 900 (the rent from before the indexation) for November 2026.
const carnotPaid: Row = {
  id: "27ccf731-f0a3-4635-a7cf-2cb2edca1c7e",
  status: "paid",
  amount: "900.00",
  dueDate: "2026-11-04",
  paidDate: "2026-11-02",
  notes: "auto-generated expected payment",
};

describe("decideRemainderRows", () => {
  it("Carnotstraat 65 b102: adds one pending remainder of 25", () => {
    const rows = [carnotPaid];
    const actions = decideRemainderRows({ settlement: carnot(rows), openRows: openRowsOf(rows, "2026-11") });
    expect(actions).toEqual([{ kind: "insert", amount: 25 }]);
  });

  it("is idempotent: an existing remainder of the right amount is left alone", () => {
    const rows: Row[] = [
      carnotPaid,
      { id: "rem", status: "pending", amount: "25.00", dueDate: "2026-11-04", paidDate: null, notes: REMAINDER_NOTE },
    ];
    const s = carnot(rows);
    // A pending remainder is not money received: the shortfall stays 25.
    expect(s).toMatchObject({ received: 900, shortfall: 25 });
    expect(decideRemainderRows({ settlement: s, openRows: openRowsOf(rows, "2026-11") })).toEqual([]);
  });

  it("updates the remainder when another partial payment arrives", () => {
    const rows: Row[] = [
      carnotPaid,
      { id: "p2", status: "paid", amount: "10.00", dueDate: "2026-11-04", paidDate: "2026-11-06", notes: null },
      { id: "rem", status: "pending", amount: "25.00", dueDate: "2026-11-04", paidDate: null, notes: REMAINDER_NOTE },
    ];
    expect(decideRemainderRows({ settlement: carnot(rows), openRows: openRowsOf(rows, "2026-11") })).toEqual([
      { kind: "update", id: "rem", amount: 15 },
    ]);
  });

  it("settles the month when the tenant pays exactly the remainder", () => {
    const pending: Row = {
      id: "rem",
      status: "pending",
      amount: "25.00",
      dueDate: "2026-11-04",
      paidDate: null,
      notes: REMAINDER_NOTE,
    };
    // The bank matcher picks the remainder for a transfer of exactly 25.
    const picked = pickPaymentForTransfer([{ id: pending.id, amount: pending.amount, dueDate: pending.dueDate, notes: pending.notes ?? null }], 25);
    expect(picked?.id).toBe("rem");
    const rows: Row[] = [carnotPaid, { ...pending, status: "paid", paidDate: "2026-11-10" }];
    const s = carnot(rows);
    expect(s.settled).toBe(true);
    expect(decideRemainderRows({ settlement: s, openRows: openRowsOf(rows, "2026-11") })).toEqual([]);
  });

  it("cancels a remainder that is stale because the month got settled otherwise", () => {
    const rows: Row[] = [
      carnotPaid,
      { id: "p2", status: "paid", amount: "25.00", dueDate: "2026-11-04", paidDate: "2026-11-08", notes: null },
      { id: "rem", status: "pending", amount: "25.00", dueDate: "2026-11-04", paidDate: null, notes: REMAINDER_NOTE },
    ];
    expect(decideRemainderRows({ settlement: carnot(rows), openRows: openRowsOf(rows, "2026-11") })).toEqual([
      { kind: "cancel", id: "rem" },
    ]);
  });

  it("Tervuursestraat 97: the pending 810 row already carries the reminders, no remainder", () => {
    const rows: Row[] = [
      { id: "nov", status: "pending", amount: "810.00", dueDate: "2026-11-02", paidDate: null, notes: "auto-generated expected payment" },
      { id: "bank", status: "paid", amount: "740.00", dueDate: "2026-10-29", paidDate: "2026-10-29", notes: null },
    ];
    const s = monthSettlement({
      rows,
      allocationSum: 0,
      records: tervRecords,
      monthlyRent: 810,
      monthlyCharges: 0,
      deductions: [],
      month: "2026-11",
      paymentDay: 2,
    });
    expect(s).toMatchObject({ received: 740, shortfall: 70 });
    expect(decideRemainderRows({ settlement: s, openRows: openRowsOf(rows, "2026-11") })).toEqual([]);
  });

  it("does nothing for a month with nothing received", () => {
    expect(
      decideRemainderRows({ settlement: { settled: false, received: 0, shortfall: 925 }, openRows: [] }),
    ).toEqual([]);
  });

  it("cancels a second remainder row", () => {
    const openRows: OpenMonthRow[] = [
      { id: "a", status: "pending", amount: "25.00", notes: REMAINDER_NOTE },
      { id: "b", status: "pending", amount: "25.00", notes: REMAINDER_NOTE },
    ];
    expect(
      decideRemainderRows({ settlement: { settled: false, received: 900, shortfall: 25 }, openRows }),
    ).toEqual([{ kind: "cancel", id: "b" }]);
  });
});

describe("sweepMonths", () => {
  const lease = { startDate: "2025-01-01", endDate: null, paymentDay: 4 };

  it("includes the current month once its due date has passed", () => {
    const months = sweepMonths(lease, "2026-11-05");
    expect(months[0]).toBe("2026-11");
    expect(months).toHaveLength(7);
    expect(months[6]).toBe("2026-05");
  });

  it("leaves the current month out on its due day", () => {
    expect(sweepMonths(lease, "2026-11-04")[0]).toBe("2026-10");
  });

  it("skips months before the lease starts", () => {
    expect(sweepMonths({ ...lease, startDate: "2026-09-01" }, "2026-11-05")).toEqual([
      "2026-11",
      "2026-10",
      "2026-09",
    ]);
  });

  it("skips months after a sane end date", () => {
    expect(sweepMonths({ ...lease, endDate: "2026-10-31" }, "2026-11-05")[0]).toBe("2026-10");
  });
});

describe("remainder rows and reminder history", () => {
  it("shares the reminder history of the month's paid row", () => {
    const rows: Row[] = [
      carnotPaid,
      { id: "rem", status: "pending", amount: "25.00", dueDate: "2026-11-04", paidDate: null, notes: REMAINDER_NOTE },
      { id: "oct", status: "paid", amount: "900.00", dueDate: "2026-10-04", paidDate: "2026-10-02", notes: null },
    ];
    expect(rowIdsForMonth(rows, "2026-11", 4).sort()).toEqual(["27ccf731-f0a3-4635-a7cf-2cb2edca1c7e", "rem"]);
  });

  it("does not let a small older remainder swallow a later full rent transfer", () => {
    const pending = [
      { id: "rem", amount: "25.00", dueDate: "2026-11-04", notes: REMAINDER_NOTE },
      { id: "dec", amount: "925.00", dueDate: "2026-12-04", notes: "auto-generated expected payment" },
    ];
    // 900 is neither 25 nor 925: no overpayment pick of the remainder.
    expect(pickPaymentForTransfer(pending, 900)).toBeNull();
    expect(pickPaymentForTransfer(pending, 925)?.id).toBe("dec");
  });

  it("recognises the marker", () => {
    expect(isRemainderNote(REMAINDER_NOTE)).toBe(true);
    expect(isRemainderNote(`${REMAINDER_NOTE}\nAuto-assigned by IBAN match`)).toBe(true);
    expect(isRemainderNote("auto-generated expected payment")).toBe(false);
    expect(isRemainderNote(null)).toBe(false);
  });
});
