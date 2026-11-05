/**
 * Safety net before any tenant reminder: an unbooked incoming transfer that may
 * already pay the rent holds the reminder and tells the landlord once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queueEmail = vi.fn<(...a: unknown[]) => Promise<string>>(async () => "job-1");
vi.mock("../../jobs/emailQueueWorker", () => ({ queueEmail: (...a: unknown[]) => queueEmail(...a) }));
vi.mock("../../lib/bankTransactionView", () => ({ decryptOrNull: () => null }));

const state = vi.hoisted(() => ({ notifiedRows: [] as Array<{ id: string }> }));
const { users, fakeDb } = vi.hoisted(() => {
  const users = { __t: "users" };
  const fakeDb = {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              t === users
                ? [{ name: "Jasper Nuyens", email: "owner@example.com", locale: "nl" }]
                : state.notifiedRows,
            ),
        }),
      }),
    }),
  };
  return { users, fakeDb };
});
vi.mock("@rentular/db", async () => {
  const { mysqlTable, varchar, json } = await import("drizzle-orm/mysql-core");
  const communications = mysqlTable("communications", {
    id: varchar("id", { length: 36 }),
    leaseId: varchar("lease_id", { length: 36 }),
    metadata: json("metadata"),
  });
  return {
    getDb: () => fakeDb,
    bankConnections: {},
    bankStatements: {},
    communications,
    leaseTenants: {},
    tenantBankAccounts: {},
    tenants: {},
    users,
  };
});

import { findWaitingTransfer, holdForWaitingTransfer, type WaitingTransfer } from "../transferReview";

const tenantIban = "BE68539007547034";

function t(over: Partial<WaitingTransfer>): WaitingTransfer {
  return { id: "14c0b0bf", amount: 70, bookingDate: "2026-11-05", iban: tenantIban, ...over };
}

describe("findWaitingTransfer", () => {
  const input = { dueDate: "2026-11-02", amount: 70, tenantIbans: new Set([tenantIban]) };

  it("finds the Tervuursestraat transfer: 70.00 from the tenant's own account on 05/11", () => {
    expect(findWaitingTransfer([t({})], input)).toMatchObject({ id: "14c0b0bf", reason: "tenant_iban" });
  });

  it("finds a transfer from the tenant's account whatever the amount", () => {
    expect(findWaitingTransfer([t({ amount: 12.5 })], input)).toMatchObject({ reason: "tenant_iban" });
  });

  it("finds a transfer of exactly the reminded amount from an unknown account", () => {
    expect(findWaitingTransfer([t({ iban: "NL91ABNA0417164300" })], input)).toMatchObject({
      reason: "amount",
    });
    expect(findWaitingTransfer([t({ iban: null })], input)).toMatchObject({ reason: "amount" });
  });

  it("ignores another amount from an unknown account", () => {
    expect(findWaitingTransfer([t({ iban: "NL91ABNA0417164300", amount: 70.01 })], input)).toBeNull();
  });

  it("counts transfers up to 8 days before the due date, not earlier", () => {
    expect(findWaitingTransfer([t({ bookingDate: "2026-10-25" })], input)).not.toBeNull();
    expect(findWaitingTransfer([t({ bookingDate: "2026-10-24" })], input)).toBeNull();
  });

  it("ignores outgoing money", () => {
    expect(findWaitingTransfer([t({ amount: -70 })], input)).toBeNull();
  });

  it("prefers the tenant's own account over a same-amount transfer from elsewhere", () => {
    const other = t({ id: "other", iban: "NL91ABNA0417164300" });
    const mine = t({ id: "mine", amount: 30 });
    expect(findWaitingTransfer([other, mine], input)).toMatchObject({ id: "mine" });
  });
});

describe("holdForWaitingTransfer", () => {
  const base = {
    hit: { ...t({}), reason: "tenant_iban" as const },
    paymentId: "5a6f3b44",
    leaseId: "167863a8",
    ownerId: "owner-1",
    tenantName: "Tenant",
    propertyName: "Tervuursestraat 97",
    amount: 70,
    dueDate: "2026-11-02",
    what: "tenant reminder",
  };

  beforeEach(() => {
    queueEmail.mockClear();
    state.notifiedRows = [];
  });

  it("emails the landlord in his language with a link to the reconciliation page", async () => {
    await holdForWaitingTransfer(fakeDb as never, base);
    expect(queueEmail).toHaveBeenCalledTimes(1);
    const [opts, , meta] = queueEmail.mock.calls[0] as [
      { to: string; subject: string; body: string },
      unknown,
      { metadata: Record<string, unknown>; leaseId: string },
    ];
    expect(opts.to).toBe("owner@example.com");
    expect(opts.subject).toContain("Tervuursestraat 97");
    expect(opts.body).toContain("/reconciliation");
    expect(opts.body).toContain("05/11/2026");
    expect(meta.leaseId).toBe("167863a8");
    expect(meta.metadata).toMatchObject({ kind: "transfer_review", paymentId: "5a6f3b44" });
  });

  it("emails only once per payment", async () => {
    state.notifiedRows = [{ id: "already" }];
    await holdForWaitingTransfer(fakeDb as never, base);
    expect(queueEmail).not.toHaveBeenCalled();
  });
});
