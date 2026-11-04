/**
 * Wave 0 RED test (MCP-03, T-11-22) for sendManualReminder honouring the
 * tenant's preferred channel and recording the channel actually used.
 *
 * Pins the contract (Plan 03 rewires manualReminder onto reminderChannel):
 *  - sendManualReminder calls sendReminderViaPreferredChannel with the tenant's
 *    preferred channel and the lease owner's details.
 *  - The channel the dispatch returns is the channel written to
 *    payment_reminders, and is surfaced on the ok result alongside sentTo.
 *  - Email stays required as the fallback guarantee (no-email tenant -> error).
 *
 * Currently RED: manualReminder still inserts the literal "email" and returns
 * no channel field. The email worker modules are mocked so the current direct
 * sendReminder path neither reaches a real queue nor slows the test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendReminderViaPreferredChannel = vi.fn(async () => "email");
vi.mock("../reminderChannel", () => ({ sendReminderViaPreferredChannel }));

// Neutralise the pre-Plan-03 direct-send path (manualReminder still calls the
// real sendReminder, which queues email/SMS) so the test stays fast + isolated.
vi.mock("../../jobs/emailQueueWorker", () => ({ queueEmail: vi.fn(async () => "e-1") }));
vi.mock("../../jobs/smsQueueWorker", () => ({ queueSms: vi.fn(async () => "s-1") }));

const getLeaseEmailRecipients = vi.fn();
vi.mock("../../lib/leaseRecipients", () => ({ getLeaseEmailRecipients }));

let reads: unknown[][] = [];
const inserted: Array<Record<string, unknown>> = [];

function selectChain(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        const r = Promise.resolve(reads.length ? reads.shift() : []);
        return r.then.bind(r);
      }
      if (prop === "catch" || prop === "finally") {
        const r = Promise.resolve(reads.length ? reads.shift() : []);
        return (r as any)[prop].bind(r);
      }
      return () => selectChain();
    },
  });
}

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    select: () => selectChain(),
    update: () => selectChain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
  })),
  leases: {}, properties: {}, users: {}, tenants: {}, leaseTenants: {},
  payments: {}, paymentFollowUpSettings: {}, paymentReminders: {},
  paymentAllocations: {}, indexationRecords: {}, rentDeductions: {}, rentFreePeriods: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ eq: a })),
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  like: vi.fn((...a: unknown[]) => ({ like: a })),
  desc: vi.fn((c: unknown) => c),
  inArray: vi.fn((...a: unknown[]) => ({ inArray: a })),
  gte: vi.fn((...a: unknown[]) => ({ gte: a })),
}));

const LEASE = {
  id: "lease-1",
  propertyId: "prop-1",
  ownerId: "owner-A",
  paymentDay: 1,
  monthlyRent: "850.00",
  monthlyCharges: "0",
  paymentMethod: "bank_transfer",
  latePaymentFeeEnabled: false,
  latePaymentFeeAmount: "15.00",
  latePaymentFeeEnforcement: "soft",
};
const TENANT = {
  firstName: "Jan",
  lastName: "Janssens",
  email: "jan@example.com",
  phone: "0471000000",
  language: "nl",
  preferredChannel: "sms",
};
const CO_TENANT_CC = "co@example.com";
function recipientsFor(t: typeof TENANT | (Omit<typeof TENANT, "email"> & { email: string | null })) {
  return {
    primary: { tenantId: "t-1", isPrimary: true, ...t },
    to: t.email,
    ccEmails: t.email ? [CO_TENANT_CC] : [],
    cc: t.email ? CO_TENANT_CC : undefined,
  };
}
const PROPERTY = { name: "Apartment 2B" };
const OWNER = { name: "Owner A", email: "owner@example.com" };
const PAYMENT = { id: "pay-1", amount: "850.00", dueDate: "2026-03-01", isIgnored: false };

/**
 * Sequential reads: lease, property, owner, the month's payments, then the
 * month status (paid rows, allocations, indexations, deductions), then settings.
 * Tenants come from the recipient helper.
 */
function fullReads() {
  return [[LEASE], [PROPERTY], [OWNER], [PAYMENT], [], [], [], [], []];
}

async function run(periodMonth = "2026-03") {
  const { sendManualReminder }: any = await import("../manualReminder");
  return sendManualReminder({ leaseId: "lease-1", periodMonth, level: "friendly", ownerId: "owner-A" });
}

beforeEach(() => {
  vi.resetModules();
  sendReminderViaPreferredChannel.mockReset().mockResolvedValue("email");
  getLeaseEmailRecipients.mockReset().mockResolvedValue(recipientsFor(TENANT));
  inserted.length = 0;
  reads = [];
  delete process.env.PAYMENT_EMAIL_TEST_PHASE;
});

describe("sendManualReminder preferred-channel routing (MCP-03, T-11-22)", () => {
  it("routes on tenants.preferredChannel and records the sms channel used", async () => {
    sendReminderViaPreferredChannel.mockResolvedValue("sms");
    reads = fullReads();
    const result = await run();

    expect(sendReminderViaPreferredChannel).toHaveBeenCalledTimes(1);
    expect(sendReminderViaPreferredChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredChannel: "sms",
        level: "friendly",
        ownerId: "owner-A",
        ownerEmail: "owner@example.com",
        cc: CO_TENANT_CC,
        payment: expect.objectContaining({ tenantPhone: "0471000000", tenantEmail: "jan@example.com" }),
      }),
    );

    const reminderRow = inserted.find((r) => "channel" in r && "type" in r);
    expect(reminderRow?.channel).toBe("sms");
    expect(reminderRow?.type).toBe("friendly");

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("sms");
    expect(result.level).toBe("friendly");
    expect(result.sentTo).toBe("0471000000");
  });

  it("falls back to email: records email and reports the tenant email", async () => {
    sendReminderViaPreferredChannel.mockResolvedValue("email");
    reads = fullReads();
    const result = await run();

    const reminderRow = inserted.find((r) => "channel" in r && "type" in r);
    expect(reminderRow?.channel).toBe("email");
    expect(result.channel).toBe("email");
    expect(result.sentTo).toBe("jan@example.com");
  });

  it("refuses a tenant with no email (email is the fallback guarantee)", async () => {
    const noEmail = { ...TENANT, email: null };
    getLeaseEmailRecipients.mockResolvedValue(recipientsFor(noEmail));
    reads = [[LEASE]];
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("This tenant has no email address");
    expect(sendReminderViaPreferredChannel).not.toHaveBeenCalled();
  });

  it("rejects an invalid period before any db read", async () => {
    reads = fullReads();
    const result = await run("2026-3");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid period");
  });
});

describe("sendManualReminder on a partly paid month", () => {
  it("asks for the shortfall when the tenant paid the rent from before the indexation", async () => {
    const lease = { ...LEASE, monthlyRent: "925.00", paymentDay: 4 };
    const paidRow = { id: "pay-900", amount: "900.00", dueDate: "2026-11-04", isIgnored: false };
    reads = [
      [lease], [PROPERTY], [OWNER],
      [paidRow],
      [{ id: "pay-900", status: "paid", amount: "900.00", dueDate: "2026-11-04", paidDate: "2026-11-02", notes: null, isIgnored: false }],
      [],
      [{ leaseId: "lease-1", effectiveDate: "2026-11-01", previousRent: "900.00", newRent: "925.00" }],
      [],
      [],
    ];
    const result = await run("2026-11");
    expect(result.ok).toBe(true);
    expect(sendReminderViaPreferredChannel).toHaveBeenCalledWith(
      expect.objectContaining({ payment: expect.objectContaining({ amount: 25, paymentId: "pay-900" }) }),
    );
    expect(inserted.some((r) => "status" in r)).toBe(false);
  });

  it("asks for the rest on the pending row when an early transfer covered part of it", async () => {
    const lease = { ...LEASE, monthlyRent: "810.00", paymentDay: 2 };
    const pendingRow = { id: "pay-810", amount: "810.00", dueDate: "2026-11-02", isIgnored: false };
    reads = [
      [lease], [PROPERTY], [OWNER],
      [pendingRow],
      [
        { id: "pay-740", status: "paid", amount: "740.00", dueDate: "2026-10-29", paidDate: "2026-10-29", notes: null, isIgnored: false },
        { id: "pay-780", status: "paid", amount: "780.00", dueDate: "2026-10-02", paidDate: "2026-09-29", notes: null, isIgnored: false },
      ],
      [],
      [{ leaseId: "lease-1", effectiveDate: "2026-11-01", previousRent: "780.00", newRent: "810.00" }],
      [],
      [],
    ];
    const result = await run("2026-11");
    expect(result.ok).toBe(true);
    expect(sendReminderViaPreferredChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({ amount: 70, paymentId: "pay-810", dueDate: "2026-11-02" }),
      }),
    );
    expect(inserted.some((r) => "status" in r)).toBe(false);
  });
});
