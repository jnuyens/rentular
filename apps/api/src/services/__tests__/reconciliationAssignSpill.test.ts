/**
 * assignStatementToLease with a transfer from a known tenant whose amount fits
 * no open payment: the oldest open month first, the excess on the next open
 * months, what is left as credit. Never left unmatched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MonthSettlement } from "../monthReceived";

const h = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  inserts: [] as Array<Record<string, unknown>>,
  settlements: {} as Record<string, MonthSettlement & { paidRowId: string | null }>,
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
  loadLeaseDeductions: async () => [],
}));
vi.mock("../monthReceived", async (orig) => ({
  ...(await orig<typeof import("../monthReceived")>()),
  loadIndexRecords: async () => new Map(),
  loadMonthStatus: async (_db: unknown, _lease: unknown, month: string) => h.settlements[month],
}));

function row(id: string, amount: string, dueDate: string) {
  return {
    id,
    amount,
    dueDate,
    notes: "auto-generated expected payment",
    rentAmount: amount,
    chargesAmount: "0.00",
  };
}

function open(month: string, expected: number, received = 0) {
  return {
    dueDate: `${month}-02`,
    expected,
    received,
    shortfall: expected - received,
    oldRent: null,
    settled: false,
    paidRowId: null,
  };
}

const fakeDb = {
  select: () => ({
    from: (t: { __t: string }) => ({
      where: () =>
        t.__t === "leases"
          ? { limit: async () => [{ id: "lease-1", monthlyRent: "810.00", monthlyCharges: "0.00", paymentDay: 2 }] }
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

const statement = (amount: string) => ({
  id: "stmt-1",
  amount,
  bookingDate: "2026-11-05",
  externalTransactionId: "ext",
});

beforeEach(() => {
  h.updates = [];
  h.inserts = [];
  h.pending = [row("oct", "810.00", "2026-10-02"), row("nov", "810.00", "2026-11-02")];
  h.settlements = { "2026-10": open("2026-10", 810), "2026-11": open("2026-11", 810) };
});

describe("assignStatementToLease, known tenant, odd amount", () => {
  it("books an odd 500 against 810 as a partial on the oldest month, flagged", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(fakeDb as never, statement("500.00"), "lease-1", "Auto", {
      allowFirstPartial: true,
      knownTenant: true,
    });
    expect(res).toEqual({ paymentId: "oct", created: false });
    const pay = h.updates.find((u) => u.table === "payments")!;
    expect(pay.set).toMatchObject({ status: "paid", amount: "500" });
    expect(String(pay.set.notes)).toContain("310.00 still open");
    expect(String(pay.set.notes)).toContain("[odd amount]");
  });

  it("fills the oldest month and spills the excess onto the next one", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    const res = await assignStatementToLease(fakeDb as never, statement("1200.00"), "lease-1", "Auto", {
      knownTenant: true,
    });
    expect(res).toEqual({ paymentId: "oct", created: false });
    const pays = h.updates.filter((u) => u.table === "payments");
    expect(pays.map((p) => p.set.amount)).toEqual(["810", "390"]);
    expect(String(pays[1]!.set.notes)).toContain("390.00 of a transfer of 1200.00");
    expect(String(pays[1]!.set.notes)).toContain("[odd amount]");
    const links = h.updates.filter((u) => u.table === "bank_statements");
    expect(links).toHaveLength(1);
    expect(links[0]!.set).toMatchObject({ matchedPaymentId: "oct" });
    expect(h.inserts).toEqual([]);
  });

  it("records what is left after every open month as credit", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    await assignStatementToLease(fakeDb as never, statement("2000.00"), "lease-1", "Auto", { knownTenant: true });
    expect(h.updates.filter((u) => u.table === "payments").map((p) => p.set.amount)).toEqual(["810", "810"]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ amount: "380", status: "paid" });
    expect(String(h.inserts[0]!.notes)).toContain("[credit]");
    // The statement stays linked to the first month only.
    expect(h.updates.filter((u) => u.table === "bank_statements")).toHaveLength(1);
  });

  it("books a double rent on both months instead of dropping the excess", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    await assignStatementToLease(fakeDb as never, statement("1620.00"), "lease-1", "Auto");
    expect(h.updates.filter((u) => u.table === "payments").map((p) => p.set.amount)).toEqual(["810", "810"]);
  });

  it("still leaves an odd amount from an unknown sender unmatched", async () => {
    const { assignStatementToLease } = await import("../reconciliationAssign");
    h.settlements["2026-10"] = open("2026-10", 810, 740);
    const res = await assignStatementToLease(fakeDb as never, statement("100.00"), "lease-1", "Auto");
    expect(res).toBeNull();
    expect(h.updates).toEqual([]);
  });
});
