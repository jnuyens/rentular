/**
 * Regression tests for owner-scoping on the /bank-accounts/:id routes.
 *
 * These lock in the fix for the IDOR where GET/PATCH/DELETE/set-default
 * queried a payout account by id alone, letting any authenticated landlord
 * read or modify another landlord's bank account. Every :id query must now
 * filter on the caller's ownerId, and must reject an unauthenticated caller.
 *
 * Strategy: `eq`/`and` from drizzle-orm are spies, so we can assert that each
 * handler built a condition on `bankAccounts.ownerId` for the current user.
 * The `ownerId` column sentinel is "owner_id" (see the @rentular/db mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const eqMock = vi.fn((col: string, val: unknown) => ({ op: "eq", col, val }));
const andMock = vi.fn((...conds: unknown[]) => ({ op: "and", conds }));

const whereConditions: unknown[] = [];

vi.mock("@rentular/db", () => {
  const bankAccounts = {
    id: "id",
    ownerId: "owner_id",
    isArchived: "is_archived",
    isDefault: "is_default",
    __table: "bank_accounts",
  };
  const row = {
    id: "acc-1",
    ownerId: "owner-A",
    iban: "BE68539007547034",
    holderName: "Owner A",
  };
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereConditions.push(cond);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: (cond: unknown) => {
          whereConditions.push(cond);
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    insert: () => ({ values: async () => [{ insertId: 1 }] }),
  };
  return { bankAccounts, getDb: vi.fn(() => fakeDb) };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => eqMock(col, val),
  and: (...conds: unknown[]) => andMock(...conds),
}));

async function buildApp(userId: string | null) {
  const { bankAccountsRouter } = await import("../bankAccounts");
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    await next();
  });
  app.route("/bank-accounts", bankAccountsRouter);
  return app;
}

/** True when some eq() call scoped the query to this owner. */
function scopedToOwner(userId: string): boolean {
  return eqMock.mock.calls.some(
    ([col, val]) => col === "owner_id" && val === userId,
  );
}

beforeEach(() => {
  vi.resetModules();
  eqMock.mockClear();
  andMock.mockClear();
  whereConditions.length = 0;
});

describe("bankAccounts router — owner scoping (IDOR regression)", () => {
  it("GET /:id filters by the caller's ownerId", async () => {
    const app = await buildApp("owner-test");
    const res = await app.request("/bank-accounts/acc-1");
    expect(res.status).toBe(200);
    expect(scopedToOwner("owner-test")).toBe(true);
  });

  it("GET /:id rejects an unauthenticated caller with 401 and never queries", async () => {
    const app = await buildApp(null);
    const res = await app.request("/bank-accounts/acc-1");
    expect(res.status).toBe(401);
    expect(whereConditions).toHaveLength(0);
  });

  it("PATCH /:id filters the update by the caller's ownerId", async () => {
    const app = await buildApp("owner-test");
    const res = await app.request("/bank-accounts/acc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(scopedToOwner("owner-test")).toBe(true);
  });

  it("PATCH /:id rejects an unauthenticated caller with 401 and never writes", async () => {
    const app = await buildApp(null);
    const res = await app.request("/bank-accounts/acc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Renamed" }),
    });
    expect(res.status).toBe(401);
    expect(whereConditions).toHaveLength(0);
  });

  it("DELETE /:id archives only within the caller's ownerId", async () => {
    const app = await buildApp("owner-test");
    const res = await app.request("/bank-accounts/acc-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(scopedToOwner("owner-test")).toBe(true);
  });

  it("POST /:id/set-default scopes the default flag to the caller's ownerId", async () => {
    const app = await buildApp("owner-test");
    const res = await app.request("/bank-accounts/acc-1/set-default", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(scopedToOwner("owner-test")).toBe(true);
  });
});
