import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-change-0123456789";
});

describe("landlordActionToken", () => {
  it("round-trips an action + payment id", async () => {
    const { signLandlordActionToken, verifyLandlordActionToken } = await import(
      "../landlordActionToken"
    );
    const token = await signLandlordActionToken("paid", "pay-123");
    const decoded = await verifyLandlordActionToken(token);
    expect(decoded).toEqual({ action: "paid", paymentId: "pay-123" });
  });

  it("rejects a tampered/garbage token", async () => {
    const { verifyLandlordActionToken } = await import("../landlordActionToken");
    await expect(verifyLandlordActionToken("not-a-jwt")).rejects.toThrow();
  });

  it("carries each supported action", async () => {
    const { signLandlordActionToken, verifyLandlordActionToken } = await import(
      "../landlordActionToken"
    );
    for (const action of ["paid", "wait", "remind", "off"] as const) {
      const decoded = await verifyLandlordActionToken(
        await signLandlordActionToken(action, "p"),
      );
      expect(decoded.action).toBe(action);
    }
  });

  it("rejects a token from another link family that carries a kind", async () => {
    const { verifyLandlordActionToken } = await import("../landlordActionToken");
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ kind: "indexation-snooze", action: "paid", paymentId: "p" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1d")
      .sign(new TextEncoder().encode("test-secret-please-change-0123456789"));
    await expect(verifyLandlordActionToken(token)).rejects.toThrow();
  });
});
