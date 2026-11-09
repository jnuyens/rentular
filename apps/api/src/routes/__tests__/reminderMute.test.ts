/**
 * POST and DELETE /leases/:id/reminder-mute: who may mute a contract's
 * late-payment reminders, and which dates are accepted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const state = vi.hoisted(() => ({
  lease: null as Record<string, unknown> | null,
  role: null as string | null,
  saved: [] as unknown[],
  removed: [] as unknown[],
}));

vi.mock("@rentular/db", () => ({ getDb: vi.fn(() => ({})) }));

vi.mock("../../lib/timezone", () => ({
  getScheduleTimezone: () => "Europe/Brussels",
  todayInZone: () => "2026-11-09",
}));

vi.mock("../../lib/propertyAccess", () => {
  const levels: Record<string, number> = { viewer: 1, accountant: 2, manager: 3, co_owner: 4, owner: 5 };
  return {
    getUserPropertyRole: vi.fn(async () => state.role),
    hasMinimumRole: (role: string, min: string) => (levels[role] ?? 0) >= (levels[min] ?? 99),
  };
});

vi.mock("../../services/reminderMuteStore", () => ({
  loadLeaseForMute: vi.fn(async () => state.lease),
  saveMute: vi.fn(async (_db: unknown, input: unknown) => {
    state.saved.push(input);
  }),
  removeMute: vi.fn(async (_db: unknown, input: unknown) => {
    state.removed.push(input);
    return true;
  }),
  muteNames: vi.fn(async () => new Map([["user-1", "Jasper"]])),
  muteView: vi.fn((l: { remindersMutedUntil: string; remindersMutedNote: string | null }) => ({
    until: l.remindersMutedUntil,
    note: l.remindersMutedNote,
    by: "user-1",
    byName: "Jasper",
    at: null,
    active: true,
  })),
}));

async function app(userId: string | null) {
  const { reminderMuteRouter } = await import("../reminderMute");
  const a = new Hono();
  a.use("*", async (c, next) => {
    if (userId) c.set("userId" as never, userId as never);
    await next();
  });
  a.route("/leases", reminderMuteRouter);
  return a;
}

const post = (a: Hono, body: unknown) =>
  a.request("/leases/lease-1/reminder-mute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.lease = {
    id: "lease-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    paymentDay: 4,
    remindersMutedUntil: null,
    remindersMutedNote: null,
    remindersMutedBy: null,
    remindersMutedAt: null,
  };
  state.role = "manager";
  state.saved = [];
  state.removed = [];
});

describe("POST /leases/:id/reminder-mute", () => {
  it("mutes for a manager, with the note trimmed", async () => {
    const res = await post(await app("user-1"), { until: "2026-12-04", note: "  pays with December  " });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mute).toMatchObject({ until: "2026-12-04", note: "pays with December", byName: "Jasper" });
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

  it("no access to the property gives 404, no login 401, unknown lease 404", async () => {
    state.role = null;
    expect((await post(await app("user-2"), { until: "2026-12-04" })).status).toBe(404);
    expect((await post(await app(null), { until: "2026-12-04" })).status).toBe(401);
    state.lease = null;
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

  it("accepts next week and exactly 120 days ahead", async () => {
    const a = await app("user-1");
    expect((await post(a, { until: "2026-11-16" })).status).toBe(200);
    expect((await post(a, { until: "2027-03-09" })).status).toBe(200);
  });
});

describe("DELETE /leases/:id/reminder-mute", () => {
  it("unmutes for a manager, not for a viewer", async () => {
    const a = await app("user-1");
    expect((await a.request("/leases/lease-1/reminder-mute", { method: "DELETE" })).status).toBe(200);
    expect(state.removed).toHaveLength(1);
    state.role = "viewer";
    expect((await a.request("/leases/lease-1/reminder-mute", { method: "DELETE" })).status).toBe(403);
    expect(state.removed).toHaveLength(1);
  });
});
