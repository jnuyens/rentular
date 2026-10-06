/**
 * Wave 0 RED test (T-11-05 Repudiation, T-11-07 Denial of Service) for the
 * Bearer rate-limit and audit-log guards.
 *
 * Pins the contract (implemented in Plan 04, apps/api/src/lib/apiTokenGuards.ts):
 *  - bearerRateLimit only engages when a tokenId is present, returns 429
 *    "Rate limit exceeded" (with Retry-After) once the per-token per-minute
 *    budget is exceeded, and fails open if Redis is unreachable.
 *  - bearerAuditLog inserts an api_tool_calls row after the handler runs, with
 *    tool / userId / tokenId / status / httpStatus and redacted args, and only
 *    when a tokenId is present.
 *  - redactAuditArgs masks token/secret/password/iban/authorization values.
 *
 * Expected RED until Plan 04 adds ../apiTokenGuards. Loaded via a non-literal
 * specifier so tsc stays green before the module exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const incrMock = vi.fn();
const expireMock = vi.fn(() => Promise.resolve(1));
const quitMock = vi.fn(() => Promise.resolve("OK"));

vi.mock("ioredis", () => {
  class MockRedis {
    incr = (...a: unknown[]) => incrMock(...(a as []));
    expire = (...a: unknown[]) => expireMock(...(a as []));
    quit = () => quitMock();
    constructor(..._args: unknown[]) {}
  }
  return { default: MockRedis, Redis: MockRedis };
});

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
  })),
  apiToolCalls: { id: "id", tool: "tool", userId: "user_id", tokenId: "token_id", __table: "api_tool_calls" },
}));

const guardsSpec: string = "../apiTokenGuards";

beforeEach(() => {
  vi.resetModules();
  incrMock.mockReset();
  expireMock.mockClear().mockResolvedValue(1);
  quitMock.mockClear();
  inserted.length = 0;
  process.env.REDIS_URL = "redis://localhost:6379";
  delete process.env.API_TOKEN_RATE_LIMIT_PER_MINUTE;
});

describe("bearerRateLimit (T-11-07)", () => {
  it("passes through and never touches Redis when there is no tokenId", async () => {
    const { bearerRateLimit } = await import(guardsSpec);
    const app = new Hono();
    app.use("*", bearerRateLimit);
    app.get("/x", (c) => c.json({ ok: true }));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
    expect(incrMock).not.toHaveBeenCalled();
  });

  it("allows the first hit (sets the 60s window) and rejects over the limit with 429", async () => {
    const { bearerRateLimit } = await import(guardsSpec);
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("tokenId", "tok-1");
      await next();
    });
    app.use("*", bearerRateLimit);
    app.get("/x", (c) => c.json({ ok: true }));

    incrMock.mockResolvedValueOnce(1);
    const ok = await app.request("/x");
    expect(ok.status).toBe(200);
    expect(expireMock).toHaveBeenCalledWith(expect.anything(), 60);

    incrMock.mockResolvedValueOnce(121);
    const limited = await app.request("/x");
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toBe("Rate limit exceeded");
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("fails open and logs when Redis incr rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bearerRateLimit } = await import(guardsSpec);
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("tokenId", "tok-1");
      await next();
    });
    app.use("*", bearerRateLimit);
    app.get("/x", (c) => c.json({ ok: true }));

    incrMock.mockRejectedValueOnce(new Error("redis down"));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("bearerAuditLog (T-11-05)", () => {
  async function buildAuditApp(opts: { tokenId: string | null; userId?: string | null }) {
    const { bearerAuditLog } = await import(guardsSpec);
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("tokenId", opts.tokenId);
      c.set("userId", opts.userId ?? "user-A");
      await next();
    });
    app.use("*", bearerAuditLog);
    app.post("/payments/mark-month-paid", (c) => c.json({ ok: true }, 201));
    app.post("/forbidden", (c) => c.json({ error: "no" }, 403));
    app.post("/boom", (c) => c.json({ error: "err" }, 500));
    return app;
  }

  it("records the real METHOD PATH and appends the X-Rentular-Tool hint, with redacted args and status ok", async () => {
    const app = await buildAuditApp({ tokenId: "tok-1" });
    const res = await app.request("/payments/mark-month-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Rentular-Tool": "mark_rent_paid" },
      body: JSON.stringify({ leaseId: "l1", secretThing: "x" }),
    });
    expect(res.status).toBe(201);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.tool).toBe("POST /payments/mark-month-paid (mark_rent_paid)");
    expect(row.userId).toBe("user-A");
    expect(row.tokenId).toBe("tok-1");
    expect(row.status).toBe("ok");
    expect(String(row.httpStatus)).toBe("201");
    expect(JSON.stringify(row.args)).not.toContain("secret");
    expect(JSON.stringify(row.args)).toContain("[redacted]");
  });

  it("falls back to METHOD PATH as the tool when no X-Rentular-Tool header is sent", async () => {
    const app = await buildAuditApp({ tokenId: "tok-1" });
    await app.request("/payments/mark-month-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "l1" }),
    });
    expect(inserted[0]!.tool).toBe("POST /payments/mark-month-paid");
  });

  it("records status forbidden for 403 and error for 500", async () => {
    const app = await buildAuditApp({ tokenId: "tok-1" });
    await app.request("/forbidden", { method: "POST" });
    await app.request("/boom", { method: "POST" });
    expect(inserted.map((r) => r.status)).toEqual(["forbidden", "error"]);
  });

  it("inserts nothing when there is no tokenId", async () => {
    const app = await buildAuditApp({ tokenId: null });
    await app.request("/payments/mark-month-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "l1" }),
    });
    expect(inserted).toHaveLength(0);
  });
});

describe("redactAuditArgs (T-11-05)", () => {
  it("masks token/secret/password/iban values at any depth and preserves the rest", async () => {
    const { redactAuditArgs } = await import(guardsSpec);
    const out = redactAuditArgs({ token: "a", nested: { password: "b", ok: 1 }, iban: "BE68539007547034" });
    expect(out.token).toBe("[redacted]");
    expect(out.nested.password).toBe("[redacted]");
    expect(out.nested.ok).toBe(1);
    expect(out.iban).toBe("[redacted]");
  });

  it("returns non-object input unchanged", async () => {
    const { redactAuditArgs } = await import(guardsSpec);
    expect(redactAuditArgs("hello")).toBe("hello");
    expect(redactAuditArgs(42)).toBe(42);
  });
});
