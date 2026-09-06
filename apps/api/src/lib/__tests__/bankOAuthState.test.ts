import { describe, it, expect, beforeAll } from "vitest";
import { signOAuthState, verifyOAuthState } from "../bankOAuthState";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-change";
});

describe("OAuth state model round-trip", () => {
  it("preserves the ponto model through sign/verify", async () => {
    const token = await signOAuthState({
      ownerId: "u1",
      institutionId: "inst",
      model: "cpm",
    });
    const payload = await verifyOAuthState(token);
    expect(payload.ownerId).toBe("u1");
    expect(payload.model).toBe("cpm");
  });

  it("leaves model undefined when not provided", async () => {
    const token = await signOAuthState({ ownerId: "u2" });
    const payload = await verifyOAuthState(token);
    expect(payload.model).toBeUndefined();
  });
});
