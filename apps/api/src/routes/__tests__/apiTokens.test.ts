/**
 * Wave 0 RED test (API-03, T-11-08) for the /api-tokens management router.
 *
 * Pins the contract (router implemented in Plan 02): the caller only ever sees
 * their own tokens projected to ApiTokenPublic (never tokenHash), create
 * returns the plaintext once, delete is owner-scoped (404 otherwise), and the
 * whole router is session-only: a PAT caller (tokenId set) gets 403 and the
 * service is never touched (a token cannot mint or revoke tokens).
 *
 * Expected RED until Plan 02 adds ../apiTokens. The router is loaded through a
 * non-literal specifier so tsc stays green before the file exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const listTokens = vi.fn();
const mintToken = vi.fn();
const revokeToken = vi.fn();
vi.mock("../../lib/apiTokens", () => ({ listTokens, mintToken, revokeToken }));

const routerSpec: string = "../apiTokens";

async function buildApp(userId: string | null, tokenId: string | null = null) {
  const mod: any = await import(routerSpec);
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("tokenId", tokenId);
    await next();
  });
  app.route("/api-tokens", mod.apiTokensRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
  listTokens.mockReset();
  mintToken.mockReset();
  revokeToken.mockReset();
});

describe("/api-tokens ownership scoping (API-03, T-11-08)", () => {
  it("GET lists only the caller's tokens and never leaks tokenHash", async () => {
    listTokens.mockResolvedValue([
      { id: "tok-1", name: "Claude", scope: "write", createdAt: "2026-01-01T00:00:00Z", expiresAt: null, lastUsedAt: null, tokenHash: "LEAK" },
    ]);
    const app = await buildApp("user-A");
    const res = await app.request("/api-tokens");
    expect(res.status).toBe(200);
    expect(listTokens).toHaveBeenCalledWith("user-A");
    const text = await res.text();
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain("LEAK");
  });

  it("GET returns 401 when unauthenticated", async () => {
    const app = await buildApp(null);
    const res = await app.request("/api-tokens");
    expect(res.status).toBe(401);
  });

  it("POST mints a token and returns 201 with the plaintext once (no tokenHash)", async () => {
    mintToken.mockResolvedValue({
      token: "rtl_freshplaintextvalue",
      record: { id: "tok-2", name: "Claude", scope: "write", createdAt: "2026-01-01T00:00:00Z", expiresAt: null, lastUsedAt: null },
    });
    const app = await buildApp("user-A");
    const res = await app.request("/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Claude", scope: "write", expiresInDays: 90 }),
    });
    expect(res.status).toBe(201);
    expect(mintToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-A", name: "Claude", scope: "write", expiresInDays: 90 }),
    );
    const body = await res.json();
    expect(body.token).toMatch(/^rtl_/);
    expect(JSON.stringify(body.data)).not.toContain("tokenHash");
  });

  it("POST rejects an invalid body with 400", async () => {
    const app = await buildApp("user-A");
    const res = await app.request("/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", scope: "admin", expiresInDays: 0 }),
    });
    expect(res.status).toBe(400);
    expect(mintToken).not.toHaveBeenCalled();
  });

  it("DELETE revokes by owner + id and 404s when it is not the caller's token", async () => {
    revokeToken.mockResolvedValue(false);
    const app = await buildApp("user-A");
    const res = await app.request("/api-tokens/tok-9", { method: "DELETE" });
    expect(revokeToken).toHaveBeenCalledWith("user-A", "tok-9");
    expect(res.status).toBe(404);
  });
});

describe("/api-tokens is session-only (API-03, T-11-08)", () => {
  it("rejects a PAT caller (tokenId set) on GET, POST and DELETE with 403", async () => {
    const app = await buildApp("user-A", "tok-1");

    const get = await app.request("/api-tokens");
    expect(get.status).toBe(403);
    expect((await get.json()).error).toBe("Token management requires a browser session");

    const post = await app.request("/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", scope: "read" }),
    });
    expect(post.status).toBe(403);

    const del = await app.request("/api-tokens/tok-9", { method: "DELETE" });
    expect(del.status).toBe(403);

    expect(listTokens).not.toHaveBeenCalled();
    expect(mintToken).not.toHaveBeenCalled();
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
