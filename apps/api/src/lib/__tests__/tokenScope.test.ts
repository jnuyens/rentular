/**
 * Wave 0 RED test (API-02, T-11-03) for requireWriteScope and the guarantee
 * that a PAT (Bearer) request stays property/role scoped.
 *
 * Pins the contract (requireWriteScope implemented in Plan 04): a read-only
 * token cannot perform a write (POST -> 403 "Token is read-only"), a write
 * token and a cookie session (tokenScope null) pass, and the existing
 * property-access helpers still gate a PAT request (the Bearer path supplies
 * only userId + scope; it adds no new access).
 *
 * Expected RED until Plan 04 adds requireWriteScope to ../routeAuth. The export
 * is read through a non-literal specifier so tsc stays green beforehand; at
 * runtime it is undefined and mounting it throws, failing the cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const getAccessiblePropertyIds = vi.fn(async () => ["prop-1"]);
vi.mock("../propertyAccess", () => ({
  getAccessiblePropertyIds,
  ROLE_LEVEL: { viewer: 1, accountant: 2, manager: 3, co_owner: 4, owner: 5 },
  hasMinimumRole: () => true,
  getUserPropertyRole: vi.fn(),
}));

const routeAuthSpec: string = "../routeAuth";

type ScopeValue = "read" | "write" | null;

async function buildScopeApp(scope: ScopeValue, userId: string | null = "user-A") {
  const mod: any = await import(routeAuthSpec);
  const requireWriteScope = mod.requireWriteScope;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("tokenScope", scope);
    await next();
  });
  app.use("*", requireWriteScope);
  app.get("/thing", (c) => c.json({ ok: true }));
  app.post("/thing", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  vi.resetModules();
  getAccessiblePropertyIds.mockClear().mockResolvedValue(["prop-1"]);
});

describe("requireWriteScope (API-02, T-11-03)", () => {
  it("blocks a read-only token on POST with 403 'Token is read-only'", async () => {
    const app = await buildScopeApp("read");
    const res = await app.request("/thing", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Token is read-only");
  });

  it("lets a read-only token through on GET", async () => {
    const app = await buildScopeApp("read");
    const res = await app.request("/thing");
    expect(res.status).toBe(200);
  });

  it("lets a write token POST", async () => {
    const app = await buildScopeApp("write");
    const res = await app.request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("lets a cookie session (tokenScope null) POST unchanged", async () => {
    const app = await buildScopeApp(null);
    const res = await app.request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("PAT requests stay property scoped (API-02, T-11-03)", () => {
  async function buildPropertyApp() {
    const access: any = await import("../propertyAccess");
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("userId", "user-A");
      c.set("tokenScope", "write");
      await next();
    });
    app.get("/x/:propertyId", async (c) => {
      const allowed = await access.getAccessiblePropertyIds(c.get("userId"));
      if (!allowed.includes(c.req.param("propertyId"))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ ok: true });
    });
    return app;
  }

  it("denies a PAT request for a property the user cannot access", async () => {
    const app = await buildPropertyApp();
    const res = await app.request("/x/prop-2");
    expect(res.status).toBe(403);
  });

  it("allows a PAT request for a property the user can access", async () => {
    const app = await buildPropertyApp();
    const res = await app.request("/x/prop-1");
    expect(res.status).toBe(200);
  });
});
