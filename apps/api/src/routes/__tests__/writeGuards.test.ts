/**
 * Wave 0 RED test (MCP-03, T-11-04) for manager+ hardening on the two write
 * endpoints a PAT could reach: POST /ledger/:leaseId/record-payment and
 * POST /payments/send-reminder.
 *
 * Pins the contract (hardening lands in Plan 03): a viewer or accountant is
 * refused (403) and the underlying service is never called; a manager is
 * allowed. Existing property-scoping is preserved (inaccessible -> 403,
 * unknown lease -> 404).
 *
 * Currently RED: both handlers only check property access, so a viewer still
 * passes. hasMinimumRole uses the real role ordering so only the missing gate
 * is under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { PropertyManagerRole } from "@rentular/shared";

const getAccessiblePropertyIds = vi.fn(async () => ["prop-1"]);
const getUserPropertyRole = vi.fn();
const ROLE_LEVEL: Record<string, number> = { viewer: 1, accountant: 2, manager: 3, co_owner: 4, owner: 5 };
function hasMinimumRole(role: PropertyManagerRole, min: PropertyManagerRole): boolean {
  return (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? Infinity);
}
vi.mock("../../lib/propertyAccess", () => ({
  getAccessiblePropertyIds,
  getUserPropertyRole,
  hasMinimumRole,
  ROLE_LEVEL,
}));

const recordPeriodPayment = vi.fn(async () => ({ ok: true }));
vi.mock("../../services/ledger", () => ({
  recordPeriodPayment,
  computeLedger: vi.fn(async () => ({})),
  autoReconcile: vi.fn(async () => 0),
  createAllocation: vi.fn(async () => ({ ok: true, id: "a1" })),
  deleteAllocation: vi.fn(async () => true),
}));

const sendManualReminder = vi.fn(async () => ({ ok: true }));
vi.mock("../../services/manualReminder", () => ({ sendManualReminder }));

vi.mock("../../lib/gocardless", () => ({
  createPayment: vi.fn(),
  retryPayment: vi.fn(),
  cancelPayment: vi.fn(),
  isGoCardlessConfigured: vi.fn(() => false),
}));
vi.mock("../../services/paymentStateMachine", () => ({ transitionPayment: vi.fn() }));
vi.mock("../../services/expectedPayments", () => ({
  ensureExpectedPaymentsForAllActive: vi.fn(),
  ensureCurrentMonthPayment: vi.fn(),
  coversMonthRent: vi.fn(),
  DEPOSIT_NOTE: "deposit",
}));

let leaseRows: unknown[] = [{ id: "lease-1", propertyId: "prop-1" }];

function chainable(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        const r = Promise.resolve(leaseRows);
        return r.then.bind(r);
      }
      if (prop === "catch" || prop === "finally") {
        const r = Promise.resolve(leaseRows);
        return (r as any)[prop].bind(r);
      }
      return () => chainable();
    },
  });
}

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    select: () => chainable(),
    insert: () => chainable(),
    update: () => chainable(),
    delete: () => chainable(),
  })),
  payments: {},
  paymentAllocations: {},
  leases: { id: "id", propertyId: "property_id" },
  properties: {},
  leaseTenants: {},
  tenants: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: string, v: unknown) => ({ c, v })),
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  desc: vi.fn((c: unknown) => c),
  lt: vi.fn(), gte: vi.fn(), lte: vi.fn(), inArray: vi.fn(), like: vi.fn(), sql: vi.fn(),
}));

async function buildApp() {
  const { ledgerRouter } = await import("../ledger");
  const { paymentsRouter } = await import("../payments");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", "user-A");
    await next();
  });
  app.route("/ledger", ledgerRouter);
  app.route("/payments", paymentsRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
  getAccessiblePropertyIds.mockClear().mockResolvedValue(["prop-1"]);
  getUserPropertyRole.mockReset();
  recordPeriodPayment.mockClear();
  sendManualReminder.mockClear();
  leaseRows = [{ id: "lease-1", propertyId: "prop-1" }];
});

describe("POST /ledger/:leaseId/record-payment (MCP-03, T-11-04)", () => {
  async function post(role: PropertyManagerRole) {
    getUserPropertyRole.mockResolvedValue(role);
    const app = await buildApp();
    return app.request("/ledger/lease-1/record-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodMonth: "2026-03", amount: 850 }),
    });
  }

  it("refuses a viewer (403) and never records", async () => {
    const res = await post("viewer");
    expect(res.status).toBe(403);
    expect(recordPeriodPayment).not.toHaveBeenCalled();
  });

  it("refuses an accountant (403) and never records", async () => {
    const res = await post("accountant");
    expect(res.status).toBe(403);
    expect(recordPeriodPayment).not.toHaveBeenCalled();
  });

  it("allows a manager (201) and records once", async () => {
    const res = await post("manager");
    expect(res.status).toBe(201);
    expect(recordPeriodPayment).toHaveBeenCalledTimes(1);
  });

  it("403 when the lease property is not accessible", async () => {
    getAccessiblePropertyIds.mockResolvedValue([]);
    getUserPropertyRole.mockResolvedValue("manager");
    const app = await buildApp();
    const res = await app.request("/ledger/lease-1/record-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodMonth: "2026-03", amount: 850 }),
    });
    expect(res.status).toBe(403);
  });

  it("404 when the lease is unknown", async () => {
    leaseRows = [];
    getUserPropertyRole.mockResolvedValue("manager");
    const app = await buildApp();
    const res = await app.request("/ledger/lease-1/record-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodMonth: "2026-03", amount: 850 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /payments/send-reminder (MCP-03, T-11-04)", () => {
  async function post(role: PropertyManagerRole) {
    getUserPropertyRole.mockResolvedValue(role);
    const app = await buildApp();
    return app.request("/payments/send-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-1", month: "2026-03", level: "friendly" }),
    });
  }

  it("refuses a viewer (403) and never sends", async () => {
    const res = await post("viewer");
    expect(res.status).toBe(403);
    expect(sendManualReminder).not.toHaveBeenCalled();
  });

  it("allows a manager (200) and sends once", async () => {
    const res = await post("manager");
    expect(res.status).toBe(200);
    expect(sendManualReminder).toHaveBeenCalledTimes(1);
  });

  it("403 when the lease property is not accessible", async () => {
    getAccessiblePropertyIds.mockResolvedValue([]);
    getUserPropertyRole.mockResolvedValue("manager");
    const app = await buildApp();
    const res = await app.request("/payments/send-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-1", month: "2026-03", level: "friendly" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 when the lease is unknown", async () => {
    leaseRows = [];
    getUserPropertyRole.mockResolvedValue("manager");
    const app = await buildApp();
    const res = await app.request("/payments/send-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-1", month: "2026-03", level: "friendly" }),
    });
    expect(res.status).toBe(404);
  });
});
