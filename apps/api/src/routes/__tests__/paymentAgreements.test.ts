/**
 * POST and DELETE /payments/:id/agreement: who may record an agreement, and
 * which dates and payments are accepted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const state = vi.hoisted(() => ({
  payment: null as Record<string, unknown> | null,
  role: null as string | null,
  saved: [] as unknown[],
  removed: [] as unknown[],
}));

vi.mock("@rentular/db", () => ({ getDb: vi.fn(() => ({})) }));

vi.mock("../../lib/timezone", () => ({
  getScheduleTimezone: () => "Europe/Brussels",
  todayInZone: () => "2026-11-09",
}));

vi.mock("../../lib/propertyAccess", async () => {
  const levels: Record<string, number> = { viewer: 1, accountant: 2, manager: 3, co_owner: 4, owner: 5 };
  return {
    getUserPropertyRole: vi.fn(async () => state.role),
    hasMinimumRole: (role: string, min: string) => (levels[role] ?? 0) >= (levels[min] ?? 99),
  };
});

vi.mock("../../services/paymentAgreementStore", () => ({
  loadPaymentForAgreement: vi.fn(async () => state.payment),
  saveAgreement: vi.fn(async (_db: unknown, input: unknown) => {
    state.saved.push(input);
  }),
  removeAgreement: vi.fn(async (_db: unknown, input: unknown) => {
    state.removed.push(input);
    return true;
  }),
  agreementNames: vi.fn(async () => new Map([["user-1", "Jasper"]])),
  agreementView: vi.fn((row: { agreementUntil: string; agreementNote: string | null }) => ({
    until: row.agreementUntil,
    note: row.agreementNote,
    by: "user-1",
    byName: "Jasper",
    at: null,
    active: true,
  })),
}));

async function app(userId: string | null) {
  const { paymentAgreementsRouter } = await import("../paymentAgreements");
  const a = new Hono();
  a.use("*", async (c, next) => {
    if (userId) c.set("userId" as never, userId as never);
    await next();
  });
  a.route("/payments", paymentAgreementsRouter);
  return a;
}

const post = (a: Hono, body: unknown) =>
  a.request("/payments/pay-1/agreement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.payment = {
    id: "pay-1",
    leaseId: "lease-1",
    status: "pending",
    amount: "25.00",
    dueDate: "2026-11-04",
    notes: null,
    isIgnored: false,
    agreementUntil: null,
    agreementNote: null,
    agreementBy: null,
    agreementAt: null,
    ownerId: "owner-1",
    propertyId: "prop-1",
  };
  state.role = "manager";
  state.saved = [];
  state.removed = [];
});

describe("POST /payments/:id/agreement", () => {
  it("records an agreement for a manager", async () => {
    const res = await post(await app("user-1"), { until: "2026-12-04", note: "  pays with December  " });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.agreement).toMatchObject({ until: "2026-12-04", note: "pays with December", byName: "Jasper" });
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ userId: "user-1", until: "2026-12-04", note: "pays with December" });
  });

  it("owner and co-owner may too, a viewer or accountant may not", async () => {
    for (const role of ["owner", "co_owner"]) {
      state.role = role;
      expect((await post(await app("user-1"), { until: "2026-12-04" })).status).toBe(200);
    }
    for (const role of ["viewer", "accountant"]) {
      state.role = role;
      expect((await post(await app("user-1"), { until: "2026-12-04" })).status).toBe(403);
    }
    expect(state.saved).toHaveLength(2);
  });

  it("someone without access to the property gets 404, without login 401", async () => {
    state.role = null;
    expect((await post(await app("user-2"), { until: "2026-12-04" })).status).toBe(404);
    expect((await post(await app(null), { until: "2026-12-04" })).status).toBe(401);
    state.payment = null;
    state.role = "owner";
    expect((await post(await app("user-1"), { until: "2026-12-04" })).status).toBe(404);
    expect(state.saved).toHaveLength(0);
  });

  it("refuses today, the past, more than 120 days ahead and a bad format", async () => {
    const a = await app("user-1");
    const codes: string[] = [];
    for (const until of ["2026-11-09", "2026-10-01", "2027-03-10", "2026-02-31"]) {
      const res = await post(a, { until });
      expect(res.status).toBe(400);
      codes.push((await res.json()).code);
    }
    expect(codes).toEqual(["not_after_today", "not_after_today", "too_far", "invalid_date"]);
    expect((await post(a, { until: "04/12/2026" })).status).toBe(400);
    expect((await post(a, { until: "2026-12-04", note: "x".repeat(501) })).status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });

  it("accepts exactly 120 days ahead", async () => {
    expect((await post(await app("user-1"), { until: "2027-03-09" })).status).toBe(200);
  });

  it("only an open rent amount: not a paid row, an ignored row or a deposit", async () => {
    const a = await app("user-1");
    for (const patch of [{ status: "paid" }, { isIgnored: true }, { notes: "auto-generated deposit" }]) {
      state.payment = { ...state.payment!, ...patch };
      const res = await post(a, { until: "2026-12-04" });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("not_open");
    }
    expect(state.saved).toHaveLength(0);
  });
});

describe("DELETE /payments/:id/agreement", () => {
  it("removes it for a manager, not for a viewer", async () => {
    state.payment = { ...state.payment!, agreementUntil: "2026-12-04" };
    const a = await app("user-1");
    expect((await a.request("/payments/pay-1/agreement", { method: "DELETE" })).status).toBe(200);
    expect(state.removed).toHaveLength(1);
    state.role = "viewer";
    expect((await a.request("/payments/pay-1/agreement", { method: "DELETE" })).status).toBe(403);
    expect(state.removed).toHaveLength(1);
  });
});
