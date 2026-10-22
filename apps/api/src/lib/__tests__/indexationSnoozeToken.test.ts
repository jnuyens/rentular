import { describe, it, expect, beforeAll } from "vitest";

const SECRET = "test-secret-please-change-0123456789";

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

async function signRaw(payload: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(new TextEncoder().encode(SECRET));
}

describe("indexationSnoozeToken", () => {
  it("round-trips lease, snooze and language", async () => {
    const { signIndexationSnoozeToken, verifyIndexationSnoozeToken } = await import(
      "../indexationSnoozeToken"
    );
    const token = await signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "3m", lang: "nl" });
    expect(await verifyIndexationSnoozeToken(token)).toEqual({
      kind: "indexation-snooze",
      leaseId: "lease-1",
      snooze: "3m",
      lang: "nl",
    });
  });

  it("rejects a garbage token", async () => {
    const { verifyIndexationSnoozeToken } = await import("../indexationSnoozeToken");
    await expect(verifyIndexationSnoozeToken("not-a-jwt")).rejects.toThrow();
  });

  it("rejects a payment action token", async () => {
    const { verifyIndexationSnoozeToken } = await import("../indexationSnoozeToken");
    const { signLandlordActionToken } = await import("../landlordActionToken");
    const token = await signLandlordActionToken("paid", "p");
    await expect(verifyIndexationSnoozeToken(token)).rejects.toThrow();
  });

  it("is rejected by the payment action verifier", async () => {
    const { signIndexationSnoozeToken } = await import("../indexationSnoozeToken");
    const { verifyLandlordActionToken } = await import("../landlordActionToken");
    const token = await signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "1m", lang: "en" });
    await expect(verifyLandlordActionToken(token)).rejects.toThrow();
  });

  it("rejects an unknown snooze option", async () => {
    const { verifyIndexationSnoozeToken } = await import("../indexationSnoozeToken");
    const token = await signRaw({ kind: "indexation-snooze", leaseId: "lease-1", snooze: "2w", lang: "en" });
    await expect(verifyIndexationSnoozeToken(token)).rejects.toThrow();
  });

  it("falls back to English for an unknown language", async () => {
    const { signIndexationSnoozeToken, verifyIndexationSnoozeToken } = await import(
      "../indexationSnoozeToken"
    );
    const token = await signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "yearly", lang: "es" });
    expect((await verifyIndexationSnoozeToken(token)).lang).toBe("en");
    const raw = await signRaw({ kind: "indexation-snooze", leaseId: "lease-1", snooze: "1m", lang: "pt" });
    expect((await verifyIndexationSnoozeToken(raw)).lang).toBe("en");
  });
});
