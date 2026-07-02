/**
 * Focused router tests for the reconciliation manual-fallback endpoints.
 *
 * Verifies the status transitions the feature promises:
 *   - ignore : unmatched -> ignored (no payment change)
 *   - assign : unmatched -> matched, oldest pending payment -> paid + linked
 *   - assign : 409 when the lease has no pending payment
 *   - undo   : matched -> unmatched, linked payment reverted to pending
 *
 * A small stateful fake `db` records update() calls and mutates the tracked
 * statement so getOwnedStatement reflects writes on the follow-up read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Distinct sentinel table objects so the fake db can route by identity.
const bankStatements = { __t: "bank_statements" };
const bankConnections = { __t: "bank_connections" };
const payments = { __t: "payments" };
const leases = { __t: "leases" };
const leaseTenants = { __t: "lease_tenants" };
const properties = { __t: "properties" };
const tenants = { __t: "tenants" };

interface State {
  statement: Record<string, unknown>;
  pendingPayments: Array<{ id: string; notes: string | null }>;
  paymentUpdates: Array<Record<string, unknown>>;
  statementUpdates: Array<Record<string, unknown>>;
}

let state: State;

function rowsFor(table: unknown): unknown[] {
  if (table === bankStatements) {
    return [
      {
        statement: state.statement,
        connectionId: "conn-1",
        institutionName: "Test Bank",
        iban: "BE00 0000 0000 0000",
      },
    ];
  }
  if (table === leases) {
    // Satisfies both the lease-ownership check ({id}) and buildLeaseLabels
    // ({id, propertyName}).
    return [{ id: "lease-1", propertyName: "Main St 1" }];
  }
  if (table === payments) {
    // Satisfies the assign "oldest pending" select and buildTransactionRows'
    // payment lookup.
    if (state.pendingPayments.length === 0) return [];
    return [
      {
        id: "pay-1",
        notes: null,
        leaseId: "lease-1",
        amount: "500.00",
        dueDate: "2026-06-01",
        structuredCommunication: "+++123/4567/89012+++",
      },
    ];
  }
  if (table === leaseTenants) return [];
  return [];
}

function makeBuilder(table: unknown) {
  const b: Record<string, unknown> = {};
  b.from = (t: unknown) => makeBuilder(t);
  b.innerJoin = () => b;
  b.where = () => b;
  b.orderBy = () => b;
  b.limit = () => b;
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rowsFor(table)).then(resolve, reject);
  return b;
}

const fakeDb = {
  select: () => makeBuilder(null),
  update: (table: unknown) => ({
    set: (vals: Record<string, unknown>) => ({
      where: async () => {
        if (table === bankStatements) {
          state.statementUpdates.push(vals);
          Object.assign(state.statement, vals);
        } else if (table === payments) {
          state.paymentUpdates.push(vals);
        }
        return [{ affectedRows: 1 }];
      },
    }),
  }),
};

vi.mock("@rentular/db", () => ({
  getDb: () => fakeDb,
  bankStatements,
  bankConnections,
  payments,
  leases,
  leaseTenants,
  properties,
  tenants,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "EQ"),
  and: vi.fn(() => "AND"),
  asc: vi.fn(() => "ASC"),
  desc: vi.fn(() => "DESC"),
  inArray: vi.fn(() => "IN"),
}));

async function buildApp(userId: string | null) {
  const { bankTransactionsRouter } = await import("../bankTransactions");
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    await next();
  });
  app.route("/bank-transactions", bankTransactionsRouter);
  return app;
}

function freshStatement(overrides: Record<string, unknown> = {}) {
  return {
    id: "stmt-1",
    connectionId: "conn-1",
    externalTransactionId: "ext-tx-1",
    amount: "500.00",
    currency: "EUR",
    bookingDate: "2026-06-05",
    counterpartyNameEncrypted: null,
    counterpartyNameIv: null,
    counterpartyNameAuthTag: null,
    counterpartyIbanEncrypted: null,
    counterpartyIbanIv: null,
    counterpartyIbanAuthTag: null,
    structuredCommunication: "+++123/4567/89012+++",
    unstructuredCommunication: null,
    matchedPaymentId: null,
    matchStatus: "unmatched",
    matchedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  state = {
    statement: freshStatement(),
    pendingPayments: [{ id: "pay-1", notes: null }],
    paymentUpdates: [],
    statementUpdates: [],
  };
});

describe("bankTransactions router — reconciliation actions", () => {
  it("ignore: sets match_status to ignored without touching payments", async () => {
    const app = await buildApp("owner-1");
    const res = await app.request("/bank-transactions/stmt-1/ignore", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(state.statement.matchStatus).toBe("ignored");
    expect(state.paymentUpdates).toHaveLength(0);
  });

  it("assign: marks oldest pending payment paid and links the statement", async () => {
    const app = await buildApp("owner-1");
    const res = await app.request("/bank-transactions/stmt-1/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-1" }),
    });
    expect(res.status).toBe(200);
    // Payment marked paid, dated to the statement booking date.
    expect(state.paymentUpdates).toHaveLength(1);
    expect(state.paymentUpdates[0].status).toBe("paid");
    expect(state.paymentUpdates[0].paidDate).toBeInstanceOf(Date);
    // Statement linked + matched.
    expect(state.statement.matchStatus).toBe("matched");
    expect(state.statement.matchedPaymentId).toBe("pay-1");
    expect(state.statement.matchedAt).toBeInstanceOf(Date);
  });

  it("assign: returns 409 when the lease has no pending payment", async () => {
    state.pendingPayments = [];
    const app = await buildApp("owner-1");
    const res = await app.request("/bank-transactions/stmt-1/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("No pending payment");
    expect(state.paymentUpdates).toHaveLength(0);
  });

  it("undo: reverts a matched statement + payment back to pending/unmatched", async () => {
    state.statement = freshStatement({
      matchStatus: "matched",
      matchedPaymentId: "pay-1",
      matchedAt: new Date(),
    });
    const app = await buildApp("owner-1");
    const res = await app.request("/bank-transactions/stmt-1/undo", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(state.paymentUpdates).toHaveLength(1);
    expect(state.paymentUpdates[0].status).toBe("pending");
    expect(state.paymentUpdates[0].paidDate).toBeNull();
    expect(state.statement.matchStatus).toBe("unmatched");
    expect(state.statement.matchedPaymentId).toBeNull();
    expect(state.statement.matchedAt).toBeNull();
  });
});
