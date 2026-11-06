/**
 * assignStatementToLease: a transfer that matches the rent net of a deduction
 * is booked at the amount that actually came in, not the full rent.
 * Real case 2026-10: Arendonckstraat 27, rent 1050.00 with a 513.92
 * property-tax reduction for October, the tenant paid 536.08.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  inserts: [] as Array<Record<string, unknown>>,
  pending: [] as Array<Record<string, unknown>>,
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
  loadLeaseDeductions: async () => [
    {
      id: "ded-1",
      reason: "Vermindering onroerende voorheffing",
      type: "temporary",
      amount: "513.92",
      startDate: "2026-10-08",
      endDate: "2026-11-07",
    },
  ],
}));
vi.mock("../monthReceived", async (orig) => ({
  ...(await orig<typeof import("../monthReceived")>()),
  loadIndexRecords: async () => new Map(),
}));

const fakeDb = {
  select: () => ({
    from: (t: { __t: string }) => ({
      where: () =>
        t.__t === "leases"
          ? { limit: async () => [{ id: "lease-1", monthlyRent: "1050.00", monthlyCharges: "0.00", paymentDay: 8 }] }
          : { orderBy: async () => h.pending },
    }),
  }),
  update: (t: { __t: string }) => ({
    set: (set: Record<string, unknown>) => ({
      where: async () => {
        h.updates.push({ table: t.__t, set });
      },
    }),
  }),
  insert: () => ({
    values: async (v: Record<string, unknown>) => {
      h.inserts.push(v);
    },
  }),
};

describe("assignStatementToLease: deduction-net transfer", () => {
  beforeEach(() => {
    h.updates.length = 0;
    h.inserts.length = 0;
    h.pending = [
      {
        id: "oct",
        amount: "1050.00",
        dueDate: "2026-10-08",
        notes: "auto-generated expected payment",
        rentAmount: "1050.00",
        chargesAmount: "0.00",
      },
    ];
  });

  it("books 536.08 on the October row, not 1050.00", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeDb as any,
      { id: "stmt-1", amount: "536.08", bookingDate: "2026-10-04", externalTransactionId: "ext-1" },
      "lease-1",
      "Auto-assigned by account number",
    );
    expect(res?.paymentId).toBe("oct");
    const paid = h.updates.find((u) => u.table === "payments" && u.set.status === "paid");
    expect(paid?.set.amount).toBe("536.08");
  });
});
