/**
 * Wave 0 RED test (API-02, T-11-02 + T-11-06) for the Bearer branch of
 * authMiddleware and the CSRF exemption.
 *
 * Pins the fail-closed contract (implemented in Plan 02 / Plan 04):
 *  - A valid `Bearer rtl_...` resolves to the same userId as a cookie, plus a
 *    scope and tokenId.
 *  - Revoked / expired / unknown / non-rtl / pepper-missing Bearer tokens are
 *    rejected (userId null -> 401 via requireAuth), never 500, and never fall
 *    through to the cookie path.
 *  - When an Authorization header is present the cookie decode path is never
 *    reached (getCookie is not called).
 *  - CSRF is skipped only for `Bearer rtl_` requests; cookie requests with a
 *    bad Origin are still rejected.
 *
 * Expected RED until Plan 02 adds the Bearer branch and ../apiTokens, and
 * Plan 04 extracts shouldSkipCsrf into ../csrfPolicy. Not-yet-existing modules
 * are referenced through non-literal specifiers so tsc stays green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { csrf } from "hono/csrf";

const getCookieMock = vi.fn(() => undefined as string | undefined);
vi.mock("hono/cookie", () => ({ getCookie: (...a: unknown[]) => getCookieMock(...(a as [])) }));

const findActiveTokenByHash = vi.fn();
const hashToken = vi.fn((raw: string) => `hash(${raw})`);
const touchLastUsed = vi.fn(() => Promise.resolve());
vi.mock("../apiTokens", () => ({ findActiveTokenByHash, hashToken, touchLastUsed }));

vi.mock("../adminNotify", () => ({ notifyNewUserSignup: vi.fn() }));

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  })),
  users: { id: "id", email: "email" },
}));

vi.mock("drizzle-orm", () => ({ eq: (c: string, v: unknown) => ({ c, v }) }));

const csrfPolicySpec: string = "../csrfPolicy";

async function buildWhoamiApp(withRequireAuth: boolean) {
  const { authMiddleware } = await import("../authMiddleware");
  const app = new Hono();
  app.use("*", authMiddleware);
  if (withRequireAuth) {
    const { requireAuth } = await import("../routeAuth");
    app.use("*", requireAuth);
  }
  app.get("/whoami", (c) =>
    c.json({
      userId: c.get("userId"),
      tokenScope: c.get("tokenScope"),
      tokenId: c.get("tokenId"),
    }),
  );
  app.post("/whoami", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  vi.resetModules();
  getCookieMock.mockClear().mockReturnValue(undefined);
  findActiveTokenByHash.mockReset();
  hashToken.mockClear();
  touchLastUsed.mockClear();
  process.env.API_TOKEN_PEPPER = "0123456789abcdef0123456789abcdef";
  process.env.AUTH_SECRET = "test-auth-secret-value-0123456789";
});

describe("authMiddleware Bearer branch (API-02, T-11-02)", () => {
  it("accepts a valid Bearer rtl_ token and sets userId, tokenScope, tokenId", async () => {
    findActiveTokenByHash.mockResolvedValue({ id: "tok-1", userId: "user-A", scope: "read" });
    const app = await buildWhoamiApp(false);
    const res = await app.request("/whoami", {
      headers: { Authorization: "Bearer rtl_sometokenvalue" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-A");
    expect(body.tokenScope).toBe("read");
    expect(body.tokenId).toBe("tok-1");
    expect(hashToken).toHaveBeenCalledWith("rtl_sometokenvalue");
    expect(touchLastUsed).toHaveBeenCalledWith("tok-1");
    expect(getCookieMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked/expired/unknown Bearer token with 401 through requireAuth", async () => {
    findActiveTokenByHash.mockResolvedValue(null);
    const app = await buildWhoamiApp(true);
    const res = await app.request("/whoami", {
      headers: { Authorization: "Bearer rtl_revokedtoken" },
    });
    expect(res.status).toBe(401);
  });

  it("does not fall through to the cookie path when an Authorization header is present", async () => {
    findActiveTokenByHash.mockResolvedValue(null);
    getCookieMock.mockReturnValue("a-valid-looking-session-cookie");
    const app = await buildWhoamiApp(false);
    const res = await app.request("/whoami", {
      headers: {
        Authorization: "Bearer rtl_invalidtoken",
        Cookie: "__Secure-authjs.session-token=a-valid-looking-session-cookie",
      },
    });
    const body = await res.json();
    expect(body.userId).toBeNull();
    expect(getCookieMock).not.toHaveBeenCalled();
  });

  it("rejects a non-rtl Bearer token as a PAT attempt with no cookie fall-through", async () => {
    const app = await buildWhoamiApp(false);
    const res = await app.request("/whoami", {
      headers: { Authorization: "Bearer abc" },
    });
    const body = await res.json();
    expect(body.userId).toBeNull();
    expect(getCookieMock).not.toHaveBeenCalled();
  });

  it("returns 401 (not 500, no cookie fall-through) when the pepper lookup throws", async () => {
    findActiveTokenByHash.mockRejectedValue(new Error("API_TOKEN_PEPPER missing"));
    const app = await buildWhoamiApp(true);
    const res = await app.request("/whoami", {
      headers: { Authorization: "Bearer rtl_sometoken" },
    });
    expect(res.status).toBe(401);
    expect(getCookieMock).not.toHaveBeenCalled();
  });

  it("runs the cookie path unchanged when there is no Authorization header", async () => {
    const app = await buildWhoamiApp(false);
    const res = await app.request("/whoami");
    const body = await res.json();
    expect(body.userId).toBeNull();
    expect(getCookieMock).toHaveBeenCalled();
  });
});

describe("CSRF exemption for Bearer rtl_ (T-11-06)", () => {
  async function buildCsrfApp() {
    const { shouldSkipCsrf } = await import(csrfPolicySpec);
    const allowedOrigins = ["http://localhost:3000"];
    const app = new Hono();
    app.use("*", async (c, next) => {
      if (shouldSkipCsrf(c)) return next();
      return csrf({ origin: (origin: string) => allowedOrigins.includes(origin) })(c, next);
    });
    app.post("/x", (c) => c.json({ ok: true }));
    return app;
  }

  it("skips CSRF for a Bearer rtl_ POST with no Origin (200)", async () => {
    const app = await buildCsrfApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Authorization: "Bearer rtl_token" },
    });
    expect(res.status).toBe(200);
  });

  it("still rejects a cookie POST with a bad Origin (403)", async () => {
    const app = await buildCsrfApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows a cookie POST from the allowed Origin (200)", async () => {
    const app = await buildCsrfApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(200);
  });
});
