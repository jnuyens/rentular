import { describe, it, expect } from "vitest";
import {
  arrearsAmount,
  cappedReminderAmount,
  contractBalance,
  reminderAmountFor,
  trackingStart,
  withArrearsMark,
  type BalanceRow,
} from "../contractBalance";
import { monthSettlement, type IndexRecord } from "../monthReceived";
import { planShortfallTransfer, planSpill } from "../shortfallMatch";
import { DEPOSIT_NOTE } from "../expectedPayments";

function paid(id: string, amount: number, date: string, notes: string | null = null): BalanceRow {
  return { id, status: "paid", amount: String(amount), dueDate: date, paidDate: date, notes, isIgnored: false };
}

function pending(id: string, amount: number, due: string, notes: string | null = null): BalanceRow {
  return { id, status: "pending", amount: String(amount), dueDate: due, paidDate: null, notes, isIgnored: false };
}

const noData = { allocations: [], records: [] as IndexRecord[], deductions: [] };

describe("contractBalance", () => {
  it("Akpinar, November: 740 of 810 paid leaves 70 owed, the 70 settles the contract", () => {
    const lease = { monthlyRent: "810.00", monthlyCharges: "0.00", paymentDay: 2, startDate: "2019-05-01", endDate: null };
    const rows = [paid("oct", 810, "2026-10-02"), paid("nov-740", 740, "2026-11-02"), pending("rem", 70, "2026-11-02")];
    const before = contractBalance({ lease, rows, ...noData, today: "2026-11-04" });
    expect(before.expected).toBe(1620);
    expect(before.received).toBe(1550);
    expect(before.owed).toBe(70);
    expect(before.credit).toBe(0);
    expect(cappedReminderAmount(70, before.owed)).toBe(70);

    const after = contractBalance({
      lease,
      rows: [...rows.slice(0, 2), { ...rows[2]!, status: "paid", paidDate: "2026-11-05" }],
      ...noData,
      today: "2026-11-06",
    });
    expect(after.owed).toBe(0);
    expect(cappedReminderAmount(70, after.owed)).toBeNull();
  });

  it("Carnot: the old rent after the indexation leaves exactly 25 owed", () => {
    const lease = { monthlyRent: "925.00", monthlyCharges: "0.00", paymentDay: 4, startDate: "2020-11-01", endDate: null };
    const records: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 900, newRent: 925 }];
    const rows = [paid("oct", 900, "2026-10-04"), paid("nov", 900, "2026-11-04")];
    const b = contractBalance({ lease, rows, allocations: [], records, deductions: [], today: "2026-11-10" });
    expect(b.expected).toBe(1825);
    expect(b.owed).toBe(25);
    const nov = b.perMonth.find((m) => m.month === "2026-11")!;
    expect(nov.shortfall).toBe(25);
    expect(cappedReminderAmount(nov.shortfall, b.owed)).toBe(25);
  });

  it("a double rent counts as credit: the next month is not reminded", () => {
    const lease = { monthlyRent: "800.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2025-06-01", endDate: null };
    const rows = [paid("jan", 1600, "2026-01-01"), pending("feb", 800, "2026-02-01")];
    const b = contractBalance({ lease, rows, ...noData, today: "2026-02-10" });
    expect(b.expected).toBe(1600);
    expect(b.received).toBe(1600);
    expect(b.owed).toBe(0);
    expect(cappedReminderAmount(800, b.owed)).toBeNull();
    // The month itself stays exact: February received nothing.
    expect(b.perMonth.find((m) => m.month === "2026-02")!.settled).toBe(false);

    const march = contractBalance({ lease, rows, ...noData, today: "2026-03-10" });
    expect(march.owed).toBe(800);
  });

  it("an odd 500 against 810 is a partial and only 310 is reminded", () => {
    const settlement = monthSettlement({
      rows: [],
      allocationSum: 0,
      records: [],
      monthlyRent: 810,
      monthlyCharges: 0,
      deductions: [],
      month: "2026-11",
      paymentDay: 2,
    });
    const plan = planShortfallTransfer({
      settlement,
      month: "2026-11",
      monthRows: [{ id: "nov", amount: "810.00", dueDate: "2026-11-02", rentAmount: "810.00", chargesAmount: "0.00" }],
      transfer: 500,
      allowFirstPartial: true,
    });
    expect(plan).toMatchObject({ kind: "partial", rowId: "nov", amount: 500, remaining: 310, rentAmount: 500 });

    const lease = { monthlyRent: "810.00", monthlyCharges: "0.00", paymentDay: 2, startDate: "2025-01-01", endDate: null };
    const b = contractBalance({
      lease,
      rows: [{ ...paid("nov", 500, "2026-11-05"), dueDate: "2026-11-02" }, pending("rem", 310, "2026-11-02")],
      ...noData,
      today: "2026-11-06",
    });
    expect(b.owed).toBe(310);
    expect(cappedReminderAmount(310, b.owed)).toBe(310);
  });

  it("Provinciestraat: the extra 1090 is credit unless marked as paying older arrears", () => {
    const lease = { monthlyRent: "1090.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2024-09-01", endDate: null };
    // The owner reads the 28/06 transfer as June's rent (plus 410 arrears), so
    // the row is tagged to June: due 2026-06-01, paid 2026-06-28.
    const base = [
      { ...paid("p1", 1500, "2026-06-28"), dueDate: "2026-06-01" },
      paid("p2", 1500, "2026-07-29"),
      paid("p3", 1300, "2026-08-04"),
      paid("p4", 60, "2026-08-11"),
      paid("p5", 1090, "2026-08-30"),
      paid("p6", 1090, "2026-09-30"),
      paid("p7", 1090, "2026-10-30"),
    ];
    const unmarked = contractBalance({ lease, rows: base, ...noData, today: "2026-11-06" });
    expect(unmarked.fromMonth).toBe("2026-06");
    expect(unmarked.expected).toBe(6540);
    expect(unmarked.received).toBe(7630);
    expect(unmarked.credit).toBe(1090);
    expect(unmarked.owed).toBe(0);

    const marks: Record<string, number> = { p1: 410, p2: 410, p3: 210, p4: 60 };
    const marked = base.map((r) => (marks[r.id!] ? { ...r, notes: withArrearsMark(r.notes, marks[r.id!]!) } : r));
    const b = contractBalance({ lease, rows: marked, ...noData, today: "2026-11-06" });
    expect(b.arrearsRepaid).toBe(1090);
    expect(b.received).toBe(6540);
    expect(b.owed).toBe(0);
    expect(b.credit).toBe(0);

    // December not paid yet: with the marks she owes December, without them it hid behind the credit.
    const dec = contractBalance({ lease, rows: marked, ...noData, today: "2026-12-05" });
    expect(dec.owed).toBe(1090);
    expect(contractBalance({ lease, rows: base, ...noData, today: "2026-12-05" }).owed).toBe(0);

    // As an untagged bank import (due date = paid date) the 28/06 transfer lands
    // in the window of July's rent, so the window starts in July and the same
    // marks leave one month of credit.
    const untagged = marked.map((r) => (r.id === "p1" ? { ...r, dueDate: "2026-06-28" } : r));
    const u = contractBalance({ lease, rows: untagged, ...noData, today: "2026-11-06" });
    expect(u.fromMonth).toBe("2026-07");
    expect(u.expected).toBe(5450);
    expect(u.received).toBe(6540);
    expect(u.credit).toBe(1090);
  });

  it("deposits never count, and an ignored month neither adds debt nor hides credit", () => {
    const lease = { monthlyRent: "500.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2026-01-01", endDate: null };
    const rows = [
      paid("dep", 1000, "2026-01-01", DEPOSIT_NOTE),
      paid("jan", 500, "2026-01-01"),
      { ...pending("feb", 500, "2026-02-01"), isIgnored: true },
    ];
    const b = contractBalance({ lease, rows, ...noData, today: "2026-02-10" });
    expect(b.received).toBe(500);
    expect(b.expected).toBe(500);
    expect(b.owed).toBe(0);
  });

  it("starts at the lease start when the first row is older", () => {
    const lease = { monthlyRent: "700.00", monthlyCharges: "50.00", paymentDay: 1, startDate: "2026-03-01", endDate: null };
    const rows = [paid("x", 750, "2026-02-27"), pending("apr", 750, "2026-04-01")];
    const b = contractBalance({ lease, rows, ...noData, today: "2026-04-03" });
    expect(b.fromMonth).toBe("2026-03");
    expect(b.expected).toBe(1500);
    expect(b.owed).toBe(750);
  });
});

describe("tracking window: starts at the month of the first received payment", () => {
  // Real prod cases (2026-11-06). These tenants pay at the end of the previous
  // month; the June row left by the expected-payments generator was paid in May,
  // before the bank data was imported.
  it("Tervuursestraat 97 (Akpinar, 780, 810 from 2026-11-01): July to November is even", () => {
    const lease = { monthlyRent: "810.00", monthlyCharges: "0.00", paymentDay: 2, startDate: "2019-05-01", endDate: null };
    const records: IndexRecord[] = [{ effectiveDate: "2026-11-01", previousRent: 780, newRent: 810 }];
    const rows = [
      pending("jun", 780, "2026-06-02"),
      paid("p-jul", 780, "2026-06-29"),
      paid("p-aug", 780, "2026-07-29"),
      paid("p-sep", 780, "2026-08-29"),
      paid("p-oct", 780, "2026-09-29"),
      paid("p-nov", 810, "2026-10-29"),
    ];
    expect(trackingStart(lease, rows)).toBe("2026-07");
    const b = contractBalance({ lease, rows, allocations: [], records, deductions: [], today: "2026-11-06" });
    expect(b.fromMonth).toBe("2026-07");
    expect(b.perMonth.map((m) => [m.month, m.expected])).toEqual([
      ["2026-07", 780],
      ["2026-08", 780],
      ["2026-09", 780],
      ["2026-10", 780],
      ["2026-11", 810],
    ]);
    expect(b.expected).toBe(3930);
    expect(b.received).toBe(3930);
    expect(b.owed).toBe(0);
    expect(b.credit).toBe(0);
    // The June leftover is never reminded, even once something is owed later.
    expect(reminderAmountFor(b, "2026-06", 780)).toBeNull();
    const dec = contractBalance({ lease, rows, allocations: [], records, deductions: [], today: "2026-12-05" });
    expect(dec.owed).toBe(810);
    expect(reminderAmountFor(dec, "2026-06", 780)).toBeNull();
    expect(reminderAmountFor(dec, "2026-12", 810)).toBe(810);
  });

  it("Oude Haachtsesteenweg 75A1 Diegem (Almazan, 1150): no phantom June", () => {
    const lease = { monthlyRent: "1150.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2023-03-01", endDate: null };
    const rows = [
      pending("jun", 1150, "2026-06-01"),
      paid("p-jul", 1150, "2026-06-30"),
      paid("p-aug", 1150, "2026-07-30"),
      paid("p-sep", 1150, "2026-08-30"),
      paid("p-oct", 1150, "2026-09-30"),
      paid("p-nov", 1150, "2026-10-30"),
    ];
    const b = contractBalance({ lease, rows, ...noData, today: "2026-11-06" });
    expect(b.fromMonth).toBe("2026-07");
    expect(b.expected).toBe(5750);
    expect(b.received).toBe(5750);
    expect(b.owed).toBe(0);
    expect(reminderAmountFor(b, "2026-06", 1150)).toBeNull();
  });

  it("Smisstraat 38 studio 5 (Nascimento, 618, pays 650): the extra 32 a month is credit", () => {
    const lease = { monthlyRent: "618.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2024-01-01", endDate: null };
    const rows = [
      pending("jun", 618, "2026-06-01"),
      paid("p-jul", 618, "2026-06-30"),
      paid("p-aug", 618, "2026-07-30"),
      paid("p-sep", 650, "2026-08-30"),
      paid("p-oct", 650, "2026-09-30"),
      paid("p-nov", 650, "2026-10-30"),
    ];
    // The old rule counted June: 6 x 618 = 3708 against 3186 received, 522 owed.
    const b = contractBalance({ lease, rows, ...noData, today: "2026-11-06" });
    expect(b.fromMonth).toBe("2026-07");
    expect(b.expected).toBe(3090);
    expect(b.received).toBe(3186);
    expect(b.owed).toBe(0);
    expect(b.credit).toBe(96);
  });

  it("a payment row tagged to its rent month keeps that month as the start", () => {
    const lease = { monthlyRent: "1090.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2024-09-01", endDate: null };
    const rows = [{ ...paid("jun", 1090, "2026-06-28"), dueDate: "2026-06-01" }, paid("jul", 1090, "2026-07-30")];
    expect(trackingStart(lease, rows)).toBe("2026-06");
  });

  it("money marked entirely as older arrears does not open the window", () => {
    const lease = { monthlyRent: "800.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2025-01-01", endDate: null };
    const rows = [
      paid("arrears", 800, "2026-05-15", withArrearsMark(null, 800)),
      paid("jun", 800, "2026-06-01"),
    ];
    expect(trackingStart(lease, rows)).toBe("2026-06");
  });

  it("without any received rent the window starts at the first rent row, so it is still owed", () => {
    const lease = { monthlyRent: "700.00", monthlyCharges: "0.00", paymentDay: 1, startDate: "2026-09-01", endDate: null };
    const rows = [pending("sep", 700, "2026-09-01"), pending("oct", 700, "2026-10-01")];
    const b = contractBalance({ lease, rows, ...noData, today: "2026-10-05" });
    expect(b.fromMonth).toBe("2026-09");
    expect(b.owed).toBe(1400);
    expect(reminderAmountFor(b, "2026-09", 700)).toBe(700);
  });
});

describe("arrears marks", () => {
  it("stores, reads and removes the mark, keeping the other lines", () => {
    const notes = withArrearsMark("Auto-assigned by IBAN", 410);
    expect(notes).toBe("Auto-assigned by IBAN\n[arrears repayment: 410.00]");
    expect(arrearsAmount(notes)).toBe(410);
    expect(arrearsAmount(withArrearsMark(notes, 210.5))).toBe(210.5);
    expect(withArrearsMark(notes, 0)).toBe("Auto-assigned by IBAN");
    expect(withArrearsMark(null, 0)).toBeNull();
    expect(withArrearsMark(`${DEPOSIT_NOTE}\nx`, 5)!.startsWith(DEPOSIT_NOTE)).toBe(true);
  });
});

describe("planSpill", () => {
  const month = (m: string, received = 0) => ({
    month: m,
    settlement: {
      dueDate: `${m}-02`,
      expected: 810,
      received,
      shortfall: 810 - received,
      oldRent: null,
      settled: false,
    },
    rows: [{ id: m, amount: String(810 - received), dueDate: `${m}-02`, rentAmount: String(810 - received), chargesAmount: "0.00" }],
  });

  it("fills the oldest open month and spills the rest to the next one", () => {
    const plan = planSpill({ openMonths: [month("2026-10"), month("2026-11")], transfer: 1200 });
    expect(plan.bookings.map((b) => [b.rowId, b.amount, b.kind, b.remaining])).toEqual([
      ["2026-10", 810, "settle", 0],
      ["2026-11", 390, "partial", 420],
    ]);
    expect(plan.credit).toBe(0);
  });

  it("keeps what is left after every open month as credit", () => {
    const plan = planSpill({ openMonths: [month("2026-10", 740), month("2026-11")], transfer: 1000 });
    expect(plan.bookings.map((b) => [b.rowId, b.amount])).toEqual([
      ["2026-10", 70],
      ["2026-11", 810],
    ]);
    expect(plan.credit).toBe(120);
  });

  it("is all credit without open months", () => {
    expect(planSpill({ openMonths: [], transfer: 250.55 })).toEqual({ bookings: [], credit: 250.55 });
  });
});
