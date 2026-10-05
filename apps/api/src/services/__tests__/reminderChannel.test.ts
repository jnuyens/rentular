/**
 * Wave 0 RED test (MCP-03, T-11-22) for preferred-channel reminder dispatch.
 *
 * Pins the contract for apps/api/src/services/reminderChannel.ts (extracted
 * from paymentCheckWorker in Plan 03): sendReminderViaPreferredChannel routes a
 * reminder to the tenant's preferred channel and returns the channel actually
 * used. WhatsApp and SMS use the short template in the tenant's language;
 * email is always the fallback when a channel is unconfigured, the phone is
 * missing, or the test phase is active.
 *
 * Expected RED until Plan 03 adds ../reminderChannel. Loaded via a non-literal
 * specifier so tsc stays green before the module exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const isWhatsAppConfigured = vi.fn(() => false);
const sendWhatsApp = vi.fn(async () => ({ id: "wa-1" }));
vi.mock("../../lib/whatsapp", () => ({ isWhatsAppConfigured, sendWhatsApp }));

const isSmsConfigured = vi.fn(() => false);
const normalizePhoneNumber = vi.fn((p: string) => (p.startsWith("0") ? `+32${p.slice(1)}` : p));
vi.mock("../../lib/sms", () => ({ isSmsConfigured, normalizePhoneNumber }));

const queueSms = vi.fn(async () => "job-1");
vi.mock("../../jobs/smsQueueWorker", () => ({ queueSms }));

const sendReminder = vi.fn(async () => {});
vi.mock("../paymentFollowUp", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendReminder };
});

const reminderChannelSpec: string = "../reminderChannel";

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    leaseId: "lease-1",
    amount: 850,
    dueDate: "2026-03-01",
    daysPastDue: 5,
    tenantName: "Jan Janssens",
    tenantEmail: "jan@example.com",
    tenantPhone: "0471000000",
    tenantLanguage: "nl" as const,
    propertyName: "Apartment 2B",
    ownerName: "Owner A",
    isIgnored: false,
    remindersSent: [] as string[],
    latePaymentFeeEnabled: false,
    latePaymentFeeAmount: 15,
    latePaymentFeeEnforcement: "soft" as const,
    ...overrides,
  };
}

async function dispatch(input: {
  payment?: Record<string, unknown>;
  level?: "friendly" | "formal" | "final";
  preferredChannel: "email" | "sms" | "whatsapp" | null | undefined;
}) {
  const mod: any = await import(reminderChannelSpec);
  const { DEFAULT_SETTINGS }: any = await import("../paymentFollowUp");
  return mod.sendReminderViaPreferredChannel({
    payment: input.payment ?? makePayment(),
    level: input.level ?? "friendly",
    settings: DEFAULT_SETTINGS,
    ownerId: "owner-A",
    ownerEmail: "owner@example.com",
    preferredChannel: input.preferredChannel,
  });
}

beforeEach(() => {
  vi.resetModules();
  isWhatsAppConfigured.mockClear().mockReturnValue(false);
  isSmsConfigured.mockClear().mockReturnValue(false);
  sendWhatsApp.mockClear();
  queueSms.mockClear();
  normalizePhoneNumber.mockClear();
  sendReminder.mockClear();
  delete process.env.PAYMENT_EMAIL_TEST_PHASE;
});

describe("sendReminderViaPreferredChannel (MCP-03, T-11-22)", () => {
  it("whatsapp + configured -> sends WhatsApp, returns 'whatsapp'", async () => {
    isWhatsAppConfigured.mockReturnValue(true);
    const channel = await dispatch({ preferredChannel: "whatsapp" });
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    const arg = (sendWhatsApp.mock.calls[0] as any[])[0] as { to: string; body: string };
    expect(arg.to).toBe("+32471000000");
    expect(arg.body.length).toBeGreaterThan(0);
    expect(sendReminder).not.toHaveBeenCalled();
    expect(queueSms).not.toHaveBeenCalled();
    expect(channel).toBe("whatsapp");
  });

  it("sms + configured -> queues SMS with meta, returns 'sms'", async () => {
    isSmsConfigured.mockReturnValue(true);
    const channel = await dispatch({ preferredChannel: "sms" });
    expect(queueSms).toHaveBeenCalledTimes(1);
    const [opts, , meta] = (queueSms.mock.calls[0] as any[]) as [
      { to: string; body: string },
      unknown,
      { ownerId: string; leaseId: string; type: string; recipientName: string },
    ];
    expect(opts.to).toBe("+32471000000");
    expect(opts.body.length).toBeGreaterThan(0);
    expect(meta.ownerId).toBe("owner-A");
    expect(meta.leaseId).toBe("lease-1");
    expect(meta.type).toBe("payment_reminder_friendly");
    expect(meta.recipientName).toBeTruthy();
    expect(channel).toBe("sms");
  });

  it("sms + not configured -> falls back to email", async () => {
    isSmsConfigured.mockReturnValue(false);
    const channel = await dispatch({ preferredChannel: "sms" });
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(sendReminder).toHaveBeenCalledWith(
      expect.anything(),
      "friendly",
      expect.anything(),
      "owner-A",
      "owner@example.com",
    );
    expect(queueSms).not.toHaveBeenCalled();
    expect(channel).toBe("email");
  });

  it("whatsapp + not configured -> falls back to email", async () => {
    isWhatsAppConfigured.mockReturnValue(false);
    const channel = await dispatch({ preferredChannel: "whatsapp" });
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(channel).toBe("email");
  });

  it("whatsapp + configured but no tenant phone -> falls back to email", async () => {
    isWhatsAppConfigured.mockReturnValue(true);
    const channel = await dispatch({
      preferredChannel: "whatsapp",
      payment: makePayment({ tenantPhone: null }),
    });
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(channel).toBe("email");
  });

  it("sms + configured but test phase active -> falls back to email", async () => {
    isSmsConfigured.mockReturnValue(true);
    process.env.PAYMENT_EMAIL_TEST_PHASE = "true";
    const channel = await dispatch({ preferredChannel: "sms" });
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(queueSms).not.toHaveBeenCalled();
    expect(channel).toBe("email");
  });

  it("email / null / undefined preferred channel -> email", async () => {
    expect(await dispatch({ preferredChannel: "email" })).toBe("email");
    expect(await dispatch({ preferredChannel: null })).toBe("email");
    expect(await dispatch({ preferredChannel: undefined })).toBe("email");
    expect(sendReminder).toHaveBeenCalledTimes(3);
  });

  it("the short body carries the amount and dd/mm/yyyy due date", async () => {
    isSmsConfigured.mockReturnValue(true);
    const mod: any = await import(reminderChannelSpec);
    expect(mod.fmtDueDate("2026-03-01")).toBe("01/03/2026");
    await dispatch({ preferredChannel: "sms", level: "formal" });
    const opts = (queueSms.mock.calls[0] as any[])[0] as { body: string };
    expect(opts.body).toContain("850.00");
    expect(opts.body).toContain("01/03/2026");
  });
});
