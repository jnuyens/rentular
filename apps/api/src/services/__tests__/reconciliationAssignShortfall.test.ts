/**
 * assignStatementToLease books a transfer that pays the rest of a partly paid
 * month on that month's pending row instead of leaving it unmatched
 * (Tervuursestraat 97, 05/11/2026: 70.00 against a pending 810 with 740 paid).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MonthSettlement } from "../monthReceived";

const h = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  settlement: null as null | (MonthSettlement & { paidRowId: string | null }),
}));

vi.mock("@rentular/db", () => ({
  getDb: () => null,
  payments: { __t: "payments", leaseId: "lease_id", status: "status", dueDate: "due_date", id: "id" },
  bankStatements: { __t: "bank_statements", id: "id" },
  leases: { __t: "leases" },
}));
vi.mock("drizzle-orm", () => ({ eq: () => null, and: () => null, asc: () => null }));
vi.mock("../rentDeductions", async (orig) => ({
  ...(await orig<typeof import("../rentDeductions")>()),
  loadLeaseDeductions: async () => [],
}));
vi.mock("../monthReceived", async (orig) => ({
  ...(await orig<typeof import("../monthReceived")>()),
  loadIndexRecords: async () => new Map(),
  loadMonthStatus: async () => h.settlement,
}));

const pending = [
  {
    id: "5a6f3b44",
    amount: "810.00",
    dueDate: "2026-11-02",
    notes: "auto-generated expected payment",
    rentAmount: "810.00",
    chargesAmount: "0.00",
  },
];

const fakeDb = {
  select: () => ({
    from: (t: { __t: string }) => ({
      where: () =>
        t.__t === "leases"
          ? { limit: async () => [{ id: "lease-1", monthlyRent: "810.00", monthlyCharges: "0.00", paymentDay: 2 }] }
          : { orderBy: async () => pending },
    }),
  }),
  update: (t: { __t: string }) => ({
    set: (set: Record<string, unknown>) => ({
      where: async () => {
        h.updates.push({ table: t.__t, set });
      },
    }),
  }),
  insert: () => {
    throw new Error("must not create a separate payment");
  },
};

const statement = { id: "14c0b0bf", amount: "70.00", bookingDate: "2026-11-05", externalTransactionId: "ext" };

beforeEach(() => {
  h.updates = [];
  h.settlement = {
    dueDate: "2026-11-02",
    expected: 810,
    received: 740,
    shortfall: 70,
    oldRent: null,
    settled: false,
    paidRowId: "paid-740",
  };
});

describe("assignStatementToLease on a partly paid month", () => {
  it("settles the month's pending row with the exact shortfall and matches the statement", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(fakeDb as never, statement, "lease-1", "Auto-assigned");
    expect(res).toEqual({ paymentId: "5a6f3b44", created: false });
    const pay = h.updates.find((u) => u.table === "payments")!;
    expect(pay.set).toMatchObject({ status: "paid", amount: "70", rentAmount: "70" });
    expect(String(pay.set.notes)).toContain("Paid the rest of the month (70.00)");
    const st = h.updates.find((u) => u.table === "bank_statements")!;
    expect(st.set).toMatchObject({ matchStatus: "matched", matchedPaymentId: "5a6f3b44" });
  });

  it("books a smaller transfer as a further partial", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(fakeDb as never, { ...statement, amount: "50.00" }, "lease-1", "x");
    expect(res?.paymentId).toBe("5a6f3b44");
    const pay = h.updates.find((u) => u.table === "payments")!;
    expect(pay.set).toMatchObject({ amount: "50" });
    expect(String(pay.set.notes)).toContain("Partial payment of 50.00, 20.00 still open");
  });

  it("leaves a transfer larger than the shortfall unmatched", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(fakeDb as never, { ...statement, amount: "100.00" }, "lease-1", "x");
    expect(res).toBeNull();
    expect(h.updates).toEqual([]);
  });
});
