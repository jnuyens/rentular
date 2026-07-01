import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// D-09: the Stripe client must be lazily constructed so that importing the
// module (which happens at API boot via the router) never runs `new Stripe()`
// when STRIPE_SECRET_KEY is unset. These tests prove the boot-guard.

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

describe("stripe lib boot-guard (D-09)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
    }
    vi.resetModules();
  });

  it("does not throw at import when STRIPE_SECRET_KEY is unset", async () => {
    await expect(import("../stripe")).resolves.toBeDefined();
  });

  it("isStripeConfigured() reflects presence of STRIPE_SECRET_KEY", async () => {
    const mod = await import("../stripe");
    expect(mod.isStripeConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_configured";
    expect(mod.isStripeConfigured()).toBe(true);
  });

  it("getStripeClient() throws a descriptive error when STRIPE_SECRET_KEY is unset", async () => {
    const mod = await import("../stripe");
    expect(() => mod.getStripeClient()).toThrow(/STRIPE_SECRET_KEY is not set/);
  });
});
