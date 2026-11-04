import { describe, it, expect } from "vitest";
import { makeSettler, monthHistory, monthTotals, type MonthLease } from "../monthTotals";
import type { IndexRecord, PaidRowLike } from "../monthReceived";
import { DEPOSIT_NOTE } from "../expectedPayments";

// A row tagged to a rent period: its due date differs from its paid date.
const tagged = (amount: number, dueDate: string, paidDate: string): PaidRowLike => ({
  status: "paid",
  amount,
  dueDate,
  paidDate,
  notes: null,
});
// An untagged bank-imported row: due date equals paid date.
const bank = (amount: number, date: string): PaidRowLike => ({
  status: "paid",
  amount,
  dueDate: date,
  paidDate: date,
  notes: null,
});

const leases: MonthLease[] = [
  // Carnotstraat: indexed 900 -> 925 in November, tenant still pays 900.
  { id: "carnot", monthlyRent: "925", monthlyCharges: "0", paymentDay: 4, startDate: "2024-01-04", endDate: null },
  // Tervuursestraat: indexed 780 -> 810, paid 740 for November.
  { id: "tervuur", monthlyRent: "810", monthlyCharges: null, paymentDay: 2, startDate: "2023-05-02", endDate: null },
  // Paid in full every month from September.
  { id: "full", monthlyRent: "1000", monthlyCharges: "50", paymentDay: 1, startDate: "2026-01-01", endDate: null },
  // Paid far more than the rent in October.
  { id: "over", monthlyRent: "1200", monthlyCharges: "0", paymentDay: 1, startDate: "2025-01-01", endDate: null },
  // Started on 20 October, so its first rent month is November.
  { id: "late", monthlyRent: "700", monthlyCharges: "0", paymentDay: 15, startDate: "2026-10-20", endDate: null },
];

const rowsByLease = new Map<string, PaidRowLike[]>([
  ["carnot", [tagged(900, "2026-10-04", "2026-10-02"), tagged(900, "2026-11-04", "2026-11-02")]],
  [
    "tervuur",
    [
      { status: "pending", amount: 810, dueDate: "2026-11-02", paidDate: null },
      bank(740, "2026-10-29"),
      tagged(780, "2026-10-02", "2026-09-29"),
    ],
  ],
  [
    "full",
    [
      tagged(1050, "2026-09-01", "2026-08-30"),
      tagged(1050, "2026-10-01", "2026-09-30"),
      tagged(1050, "2026-11-01", "2026-10-31"),
      { ...bank(2100, "2026-09-03"), notes: DEPOSIT_NOTE },
    ],
  ],
  ["over", [bank(2000, "2026-10-01")]],
  ["late", [tagged(700, "2026-11-15", "2026-11-03")]],
]);

const recordsByLease = new Map<string, IndexRecord[]>([
  ["carnot", [{ effectiveDate: "2026-11-01", previousRent: 900, newRent: 925 }]],
  ["tervuur", [{ effectiveDate: "2026-11-01", previousRent: 780, newRent: 810 }]],
]);

const settle = makeSettler({
  rowsByLease,
  allocations: new Map(),
  recordsByLease,
  deductionsByLease: new Map(),
});

const today = "2026-11-05";
const round2 = (n: number) => Math.round(n * 100) / 100;

describe("monthTotals", () => {
  it("November: partial leases add what came in, settled leases their expected amount", () => {
    const t = monthTotals({ leases, month: "2026-11", today, settle });
    const byId = new Map(t.leases.map((r) => [r.lease.id, r]));
    expect(byId.get("carnot")!.status).toBe("partial");
    expect(byId.get("carnot")!.settlement).toMatchObject({ expected: 925, received: 900, shortfall: 25 });
    expect(byId.get("tervuur")!.status).toBe("partial");
    expect(byId.get("tervuur")!.settlement).toMatchObject({ expected: 810, received: 740, shortfall: 70 });
    expect(byId.get("full")!.status).toBe("paid");
    expect(byId.get("over")!.status).toBe("overdue");
    expect(byId.get("late")!.status).toBe("paid");
    expect(round2(t.paid)).toBe(900 + 740 + 1050 + 700);
    // Partial shortfalls are overdue from the due day on.
    expect(round2(t.overdue)).toBe(25 + 70 + 1200);
    expect(round2(t.toCome)).toBe(0);
    expect(round2(t.expected)).toBe(round2(t.paid + t.toCome + t.overdue));
  });

  it("counts an overpaid month at its expected amount only", () => {
    const t = monthTotals({ leases, month: "2026-10", today, settle });
    const over = t.leases.find((r) => r.lease.id === "over")!;
    expect(over.status).toBe("paid");
    expect(over.settlement.received).toBe(2000);
    expect(round2(t.paid)).toBe(900 + 780 + 1050 + 1200);
  });

  it("leaves out a lease for a month before it started", () => {
    const t = monthTotals({ leases, month: "2026-10", today, settle });
    expect(t.leases.some((r) => r.lease.id === "late")).toBe(false);
  });

  it("leaves out a lease after a sane end date", () => {
    const ended: MonthLease[] = [{ ...leases[2]!, endDate: "2026-09-30" }];
    expect(monthTotals({ leases: ended, month: "2026-10", today, settle }).leases).toHaveLength(0);
    expect(monthTotals({ leases: ended, month: "2026-09", today, settle }).leases).toHaveLength(1);
  });

  it("splits unpaid rent into overdue or still to come against today, not paid", () => {
    const early = monthTotals({ leases, month: "2026-11", today: "2026-10-20", settle });
    const late = monthTotals({ leases, month: "2026-11", today: "2026-11-30", settle });
    expect(early.paid).toBe(late.paid);
    expect(early.expected).toBe(late.expected);
    expect(round2(early.overdue)).toBe(0);
  });
});

describe("monthHistory", () => {
  const history = monthHistory({ leases, endMonth: "2026-11", months: 12, today, settle });

  it("returns 12 months oldest first, ending at the selected month", () => {
    expect(history).toHaveLength(12);
    expect(history[0]!.month).toBe("2025-12");
    expect(history[11]!.month).toBe("2026-11");
  });

  it("crosses a year boundary", () => {
    const h = monthHistory({ leases: [], endMonth: "2026-02", months: 12, today, settle });
    expect(h[0]!.month).toBe("2025-03");
    expect(h[11]!.month).toBe("2026-02");
    expect(h.every((e) => e.paid === 0 && e.expected === 0)).toBe(true);
  });

  it("each month's paid and expected equal the overview's figures with that month selected", () => {
    for (const e of history) {
      const t = monthTotals({ leases, month: e.month, today, settle });
      expect(e.paid).toBe(round2(t.paid));
      expect(e.expected).toBe(round2(t.expected));
    }
  });

  it("has the expected values for the fixture months", () => {
    const pick = (m: string) => history.find((e) => e.month === m)!;
    expect(pick("2026-08").paid).toBe(0);
    expect(pick("2026-09").paid).toBe(1050);
    expect(pick("2026-10").paid).toBe(3930);
    expect(pick("2026-11").paid).toBe(3390);
    expect(pick("2026-11").expected).toBe(925 + 810 + 1050 + 1200 + 700);
  });

  it("does not depend on which month ends the range", () => {
    const shorter = monthHistory({ leases, endMonth: "2026-10", months: 3, today, settle });
    for (const e of shorter) expect(e).toEqual(history.find((h) => h.month === e.month));
  });
});
