import { describe, it, expect } from "vitest";
import {
  attributedMonth,
  monthSettlement,
  preIndexationMatch,
  receivedForMonth,
  rentForDate,
  type IndexRecord,
  type PaidRowLike,
} from "../monthReceived";
import { DEPOSIT_NOTE } from "../expectedPayments";
import type { DeductionRow } from "../rentDeductions";

const APPENDED_DEPOSIT_NOTE = `${DEPOSIT_NOTE}\nAuto-assigned by IBAN match`;

const carnotRecords: IndexRecord[] = [
  { effectiveDate: "2026-11-01", previousRent: 900, newRent: 925 },
];

describe("rentForDate", () => {
  it("uses the new rent from the effective date and the old rent before it", () => {
    expect(rentForDate(carnotRecords, 925, "2026-11-04")).toBe(925);
    expect(rentForDate(carnotRecords, 925, "2026-10-04")).toBe(900);
  });

  it("falls back to the current rent without indexations", () => {
    expect(rentForDate([], 925, "2026-10-04")).toBe(925);
  });

  it("handles several indexations", () => {
    const records: IndexRecord[] = [
      { effectiveDate: "2026-11-01", previousRent: 900, newRent: 925 },
      { effectiveDate: "2025-11-01", previousRent: 880, newRent: 900 },
    ];
    expect(rentForDate(records, 925, "2026-03-04")).toBe(900);
    expect(rentForDate(records, 925, "2025-05-04")).toBe(880);
  });
});

describe("attributedMonth / receivedForMonth", () => {
  it("counts a tagged row for its due date's month only", () => {
    const row: PaidRowLike = { status: "paid", amount: 925, dueDate: "2026-11-04", paidDate: "2026-11-20" };
    expect(attributedMonth(row, 4)).toBe("2026-11");
    expect(receivedForMonth([row], "2026-11", 4)).toBe(925);
    expect(receivedForMonth([row], "2026-12", 4)).toBe(0);
  });

  it("counts an untagged row paid a few days early for the next month", () => {
    const row: PaidRowLike = { status: "paid", amount: 925, dueDate: "2026-10-30", paidDate: "2026-10-30" };
    expect(attributedMonth(row, 4)).toBe("2026-11");
    expect(receivedForMonth([row], "2026-10", 4)).toBe(0);
  });

  it("accepts a Date paid date", () => {
    const row: PaidRowLike = {
      status: "paid",
      amount: 925,
      dueDate: "2026-10-30",
      paidDate: new Date("2026-10-30T00:00:00Z"),
    };
    expect(attributedMonth(row, 4)).toBe("2026-11");
  });

  it("falls back to the row's own month when no due date is near", () => {
    const row: PaidRowLike = { status: "paid", amount: 925, dueDate: "2026-10-18", paidDate: "2026-10-18" };
    expect(attributedMonth(row, 4)).toBe("2026-10");
  });

  it("ignores deposits, ignored rows and non-paid rows", () => {
    const rows: PaidRowLike[] = [
      { status: "paid", amount: 1850, dueDate: "2026-11-04", paidDate: "2026-11-04", notes: DEPOSIT_NOTE },
      { status: "paid", amount: 925, dueDate: "2026-11-04", paidDate: "2026-11-05", isIgnored: true },
      { status: "pending", amount: 925, dueDate: "2026-11-04", paidDate: null },
    ];
    expect(receivedForMonth(rows, "2026-11", 4)).toBe(0);
  });

  it("takes the larger of allocations and rows, never the sum", () => {
    const rows: PaidRowLike[] = [
      { status: "paid", amount: 900, dueDate: "2026-11-04", paidDate: "2026-11-02" },
    ];
    expect(receivedForMonth(rows, "2026-11", 4, 925)).toBe(925);
    expect(receivedForMonth(rows, "2026-11", 4, 100)).toBe(900);
  });
});

describe("monthSettlement", () => {
  // A pending record marked paid keeps its period's due date (tagged to a month).
  const tagged = (
    amount: number,
    dueDate: string,
    paidDate: string,
    notes?: string | null,
  ): PaidRowLike => ({ status: "paid", amount, dueDate, paidDate, notes: notes ?? null });
  // A bank-imported payment has due date == paid date (not tagged to a period).
  const bank = (amount: number, date: string): PaidRowLike => ({
    status: "paid",
    amount,
    dueDate: date,
    paidDate: date,
    notes: null,
  });
  const settle = (
    rows: PaidRowLike[],
    dueDate: string,
    rent: number,
    extra: { charges?: number; deductions?: DeductionRow[]; records?: IndexRecord[]; allocationSum?: number } = {},
  ) =>
    monthSettlement({
      rows,
      allocationSum: extra.allocationSum ?? 0,
      records: extra.records ?? [],
      monthlyRent: rent,
      monthlyCharges: extra.charges ?? 0,
      deductions: extra.deductions ?? [],
      month: dueDate.slice(0, 7),
      paymentDay: Number(dueDate.slice(8, 10)),
    });

  it("counts on-time rent for its month", () => {
    expect(settle([tagged(1050, "2026-09-08", "2026-09-08")], "2026-09-08", 1050).settled).toBe(true);
  });

  it("counts rent paid late in its month (by due date), and not the next month", () => {
    const row = tagged(1150, "2026-09-02", "2026-09-27");
    expect(settle([row], "2026-09-02", 1150).settled).toBe(true);
    expect(settle([row], "2026-10-02", 1150).settled).toBe(false);
  });

  it("does not let a bank payment late in a month bleed into the next month", () => {
    expect(settle([bank(1050, "2026-09-24")], "2026-09-08", 1050).settled).toBe(true);
    expect(settle([bank(1050, "2026-09-24")], "2026-10-08", 1050).settled).toBe(false);
  });

  it("counts a bank payment a few days early, even in the prior month", () => {
    expect(settle([bank(1090, "2026-08-30")], "2026-09-01", 1090).settled).toBe(true);
  });

  it("does not match a payment for a clearly different month", () => {
    expect(settle([bank(1050, "2026-07-15")], "2026-09-08", 1050).settled).toBe(false);
    expect(settle([bank(1050, "2026-11-20")], "2026-09-08", 1050).settled).toBe(false);
  });

  it("allows an over-payment", () => {
    expect(settle([tagged(1140, "2026-09-01", "2026-09-03")], "2026-09-01", 1040).settled).toBe(true);
  });

  it("does not count a partial payment as full coverage", () => {
    const s = settle([tagged(400, "2026-09-01", "2026-09-03")], "2026-09-01", 1040);
    expect(s.settled).toBe(false);
    expect(s.shortfall).toBe(640);
  });

  it("does not let a deposit payment cover the rent", () => {
    expect(settle([tagged(2080, "2026-09-01", "2026-09-01", DEPOSIT_NOTE)], "2026-09-01", 1040).settled).toBe(false);
  });

  it("does not let a deposit with an appended note cover the rent", () => {
    expect(
      settle([tagged(1040, "2026-09-01", "2026-09-01", APPENDED_DEPOSIT_NOTE)], "2026-09-01", 1040).settled,
    ).toBe(false);
  });

  it("ignores non-paid records", () => {
    const pending: PaidRowLike = { status: "pending", amount: 1040, dueDate: "2026-09-01", paidDate: null, notes: null };
    expect(settle([pending], "2026-09-01", 1040).settled).toBe(false);
  });

  it("does not settle a 90% payment", () => {
    const s = settle([tagged(945, "2026-09-08", "2026-09-08")], "2026-09-08", 1050);
    expect(s.settled).toBe(false);
    expect(s.shortfall).toBe(105);
  });

  it("settles when short by less than a cent, not when short by a full cent", () => {
    expect(settle([tagged(1050 - 0.005, "2026-09-08", "2026-09-08")], "2026-09-08", 1050).settled).toBe(true);
    const oneCent = settle([tagged(1049.99, "2026-09-08", "2026-09-08")], "2026-09-08", 1050);
    expect(oneCent.settled).toBe(false);
    expect(oneCent.shortfall).toBe(0.01);
  });

  it("settles a large payment tagged to the month for that month only", () => {
    const row = tagged(4200, "2026-09-08", "2026-09-08");
    expect(settle([row], "2026-09-08", 1050).settled).toBe(true);
    expect(settle([row], "2026-10-08", 1050).settled).toBe(false);
  });

  it("includes charges in the expected amount", () => {
    const s = settle([tagged(900, "2026-09-04", "2026-09-04")], "2026-09-04", 900, { charges: 50 });
    expect(s.expected).toBe(950);
    expect(s.shortfall).toBe(50);
  });

  it("subtracts deductions that apply on the due date", () => {
    const deductions: DeductionRow[] = [
      { id: "d1", type: "permanent", amount: "100", startDate: "2026-01-01", endDate: null, reason: "tax" },
    ];
    const s = settle([tagged(800, "2026-09-04", "2026-09-04")], "2026-09-04", 900, { deductions });
    expect(s.expected).toBe(800);
    expect(s.settled).toBe(true);
  });

  it("is settled when nothing is owed", () => {
    const deductions: DeductionRow[] = [
      { id: "d1", type: "temporary", amount: "900", startDate: "2026-09-01", endDate: "2026-09-30", reason: "free" },
    ];
    const s = settle([], "2026-09-04", 900, { deductions });
    expect(s.expected).toBe(0);
    expect(s.settled).toBe(true);
  });

  it("Carnotstraat 65 b102: still paying the rent from before the indexation", () => {
    const s = monthSettlement({
      rows: [tagged(900, "2026-11-04", "2026-11-02")],
      allocationSum: 0,
      records: carnotRecords,
      monthlyRent: 925,
      monthlyCharges: 0,
      deductions: [],
      month: "2026-11",
      paymentDay: 4,
    });
    expect(s).toMatchObject({ dueDate: "2026-11-04", expected: 925, received: 900, shortfall: 25, oldRent: 900, settled: false });
  });

  it("Tervuursestraat 97: October settled at the old rent, November short by 70 once", () => {
    const records: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 780, newRent: 810 }];
    const rows: PaidRowLike[] = [
      { status: "pending", amount: 810, dueDate: "2026-11-02", paidDate: null },
      bank(740, "2026-10-29"),
      tagged(780, "2026-10-02", "2026-09-29"),
    ];
    const base = { rows, allocationSum: 0, records, monthlyRent: 810, monthlyCharges: 0, deductions: [], paymentDay: 2 };
    const nov = monthSettlement({ ...base, month: "2026-11" });
    expect(nov).toMatchObject({ expected: 810, received: 740, shortfall: 70, oldRent: null, settled: false });
    const oct = monthSettlement({ ...base, month: "2026-10" });
    expect(oct).toMatchObject({ expected: 780, received: 780, settled: true, shortfall: 0 });
  });
});

describe("preIndexationMatch", () => {
  const pending = [{ id: "a", amount: "925", dueDate: "2026-11-04", notes: null as string | null }];

  it("matches a transfer equal to the old rent", () => {
    const m = preIndexationMatch(pending, 900, carnotRecords);
    expect(m).not.toBeNull();
    expect(m!.row.id).toBe("a");
    expect(m!.diff).toBe(25);
    expect(m!.expectedOld).toBe(900);
  });

  it("does not match the new rent itself", () => {
    expect(preIndexationMatch(pending, 925, carnotRecords)).toBeNull();
  });

  it("does not match a row due before the indexation", () => {
    expect(preIndexationMatch([{ ...pending[0]!, dueDate: "2026-10-04" }], 900, carnotRecords)).toBeNull();
  });

  it("skips deposit rows", () => {
    expect(preIndexationMatch([{ ...pending[0]!, notes: DEPOSIT_NOTE }], 900, carnotRecords)).toBeNull();
  });

  it("does not match a rent decrease", () => {
    const lower: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 950, newRent: 925 }];
    expect(preIndexationMatch(pending, 950, lower)).toBeNull();
  });
});
