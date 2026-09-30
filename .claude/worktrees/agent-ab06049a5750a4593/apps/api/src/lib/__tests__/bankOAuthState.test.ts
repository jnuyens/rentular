import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { signOAuthState, verifyOAuthState } from "../bankOAuthState";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

beforeAll(() => {
  process.env.AUTH_SECRET = "test-auth-secret-for-bank-oauth-state-2026";
});

describe("signOAuthState / verifyOAuthState (Phase 9 / 09-02 / T-09-02-01, T-09-02-06)", () => {
  it("round-trips ownerId + institutionId and stamps a UUID nonce", async () => {
    const token = await signOAuthState({
      ownerId: "owner-123",
      institutionId: "fixture-belfius",
    });
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const payload = await verifyOAuthState(token);
    expect(payload.ownerId).toBe("owner-123");
    expect(payload.institutionId).toBe("fixture-belfius");
    expect(payload.connectionId).toBeUndefined();
    expect(payload.nonce).toMatch(UUID_REGEX);
  });

  it("round-trips a renewal payload (ownerId + connectionId)", async () => {
    const token = await signOAuthState({
      ownerId: "owner-9",
      connectionId: "conn-7",
    });
    const payload = await verifyOAuthState(token);
    expect(payload.ownerId).toBe("owner-9");
    expect(payload.connectionId).toBe("conn-7");
    expect(payload.institutionId).toBeUndefined();
    expect(payload.nonce).toMatch(UUID_REGEX);
  });

  it("rejects a token signed with a different secret", async () => {
    // Build a token externally with the WRONG secret. verifyOAuthState
    // reads AUTH_SECRET at call time, so this must fail signature verification.
    const wrongSecret = new TextEncoder().encode("WRONG-SECRET");
    const badToken = await new SignJWT({
      ownerId: "owner-attacker",
      nonce: "00000000-0000-0000-0000-000000000000",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(wrongSecret);

    await expect(verifyOAuthState(badToken)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const goodSecret = new TextEncoder().encode(
      process.env.AUTH_SECRET || "test-auth-secret-for-bank-oauth-state-2026"
    );
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({
      ownerId: "owner-stale",
      nonce: "11111111-1111-1111-1111-111111111111",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .sign(goodSecret);

    await expect(verifyOAuthState(expiredToken)).rejects.toThrow();
  });
});
