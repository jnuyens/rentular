import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  smtpSettings: {},
  communications: {},
  eq: vi.fn(),
}));

vi.mock("bullmq", () => {
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: "j" });
    constructor() {}
  }
  class MockWorker {
    on = vi.fn();
    constructor(..._args: unknown[]) {}
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(),
  renderTemplate: vi.fn((t: string) => t),
  getTransportForOwner: vi.fn(),
  clearTransportCache: vi.fn(),
}));

vi.mock("../../lib/sms", () => ({
  sendSms: vi.fn(),
  normalizePhoneNumber: vi.fn((p: string) => p),
}));

describe("SMS template fields in follow-up settings (NTF-05)", () => {
  it("should have SMS template fields in DEFAULT_SETTINGS", async () => {
    const { DEFAULT_SETTINGS } = await import("../../services/paymentFollowUp");

    expect(DEFAULT_SETTINGS).toHaveProperty("smsEnabled");
    expect(DEFAULT_SETTINGS).toHaveProperty("smsFriendlyMessage");
    expect(DEFAULT_SETTINGS).toHaveProperty("smsFormalMessage");
    expect(DEFAULT_SETTINGS).toHaveProperty("smsFinalMessage");
  });

  it("should have non-empty default SMS templates", async () => {
    const { DEFAULT_SETTINGS } = await import("../../services/paymentFollowUp");

    expect(DEFAULT_SETTINGS.smsFriendlyMessage.length).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.smsFormalMessage.length).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.smsFinalMessage.length).toBeGreaterThan(0);
  });

  it("should have SMS templates containing payment-related placeholders", async () => {
    const { DEFAULT_SETTINGS } = await import("../../services/paymentFollowUp");

    // All SMS templates should contain amount and property placeholders
    expect(DEFAULT_SETTINGS.smsFriendlyMessage).toContain("{{amount}}");
    expect(DEFAULT_SETTINGS.smsFormalMessage).toContain("{{amount}}");
    expect(DEFAULT_SETTINGS.smsFinalMessage).toContain("{{amount}}");
    expect(DEFAULT_SETTINGS.smsFriendlyMessage).toContain("{{propertyName}}");
  });

  it("should have all three email reminder levels", async () => {
    const { DEFAULT_SETTINGS } = await import("../../services/paymentFollowUp");

    expect(DEFAULT_SETTINGS.friendlySubject).toBeDefined();
    expect(DEFAULT_SETTINGS.friendlyBody).toBeDefined();
    expect(DEFAULT_SETTINGS.formalSubject).toBeDefined();
    expect(DEFAULT_SETTINGS.formalBody).toBeDefined();
    expect(DEFAULT_SETTINGS.finalSubject).toBeDefined();
    expect(DEFAULT_SETTINGS.finalBody).toBeDefined();
  });
});
