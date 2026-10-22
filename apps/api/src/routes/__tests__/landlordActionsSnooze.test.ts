/**
 * Route tests for the indexation digest snooze links
 * (GET /landlord-action/indexation/:token).
 *
 * Tokens are signed and verified for real; the database is a fake that
 * records every update. Expected dates are computed from the local today with
 * the same pure helpers the route uses.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue: unknown[][] = [];
const updateSets: Array<Record<string, unknown>> = [];

vi.mock("@rentular/db", () => {
  const table = (name: string) =>
    new Proxy(
      { __table: name },
      {
        get: (t, k) =>
          k in t ? (t as Record<string | symbol, unknown>)[k] : `${name}.${String(k)}`,
      },
    );
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updateSets.push(s);
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
  };
  return {
    getDb: vi.fn(() => fakeDb),
    payments: table("payments"),
    leases: table("leases"),
    properties: table("properties"),
    users: table("users"),
    communications: table("communications"),
    propertyManagers: table("property_managers"),
    healthIndexValues: table("health_index_values"),
    smtpSettings: table("smtp_settings"),
  };
});

vi.mock("drizzle-orm", () => {
  const passThrough = (...args: unknown[]) => ({ args });
  return {
    eq: vi.fn(passThrough),
    and: vi.fn(passThrough),
    desc: vi.fn(passThrough),
    gte: vi.fn(passThrough),
    lte: vi.fn(passThrough),
    inArray: vi.fn(passThrough),
    isNotNull: vi.fn(passThrough),
  };
});

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

vi.mock("../../services/paymentFollowUp", () => ({ sendReminder: vi.fn(), DEFAULT_SETTINGS: {} }));
vi.mock("../../lib/notificationRecipients", () => ({
  getLandlordNotificationRecipients: vi.fn(),
}));
vi.mock("../../lib/leaseRecipients", () => ({
  getLeaseEmailRecipients: vi.fn(),
  mergeCc: vi.fn(),
}));
vi.mock("../../lib/sms", () => ({
  isSmsConfigured: () => false,
  normalizePhoneNumber: (s: string) => s,
}));
vi.mock("../../lib/whatsapp", () => ({
  isWhatsAppConfigured: () => false,
  sendWhatsApp: vi.fn(),
}));
vi.mock("../../jobs/smsQueueWorker", () => ({ queueSms: vi.fn() }));
vi.mock("../../jobs/emailQueueWorker", () => ({ queueEmail: vi.fn() }));
vi.mock("../../lib/email", () => ({
  renderTemplate: (t: string) => t,
  sendEmail: vi.fn(),
}));

const START = "2019-05-01";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-change-0123456789";
});

beforeEach(() => {
  selectQueue.length = 0;
  updateSets.length = 0;
});

async function setup() {
  const { landlordActionsRouter } = await import("../landlordActions");
  const { signIndexationSnoozeToken } = await import("../../lib/indexationSnoozeToken");
  const { signLandlordActionToken } = await import("../../lib/landlordActionToken");
  const { snoozeUntil, nextAnniversaryAfter } = await import("../../services/indexationAlerts");
  const { localYmd } = await import("../../services/indexationCalc");
  const { formatLongDate } = await import("../../lib/belgianFormat");
  const app = new Hono();
  app.route("/landlord-action", landlordActionsRouter);
  const get = (token: string) => app.request(`/landlord-action/indexation/${token}`);
  return {
    get,
    signIndexationSnoozeToken,
    signLandlordActionToken,
    snoozeUntil,
    nextAnniversaryAfter,
    formatLongDate,
    todayYmd: localYmd(new Date()),
  };
}

function queueLease() {
  selectQueue.push([{ id: "lease-1", startDate: START }]);
}

describe("GET /landlord-action/indexation/:token", () => {
  it("snoozes one month and names the date in the token's language", async () => {
    const t = await setup();
    queueLease();
    const token = await t.signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "1m", lang: "nl" });
    const res = await t.get(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const until = t.snoozeUntil(t.todayYmd, "1m")!;
    expect(updateSets).toEqual([{ indexationSnoozedUntil: until, updatedAt: expect.any(Date) }]);
    const html = await res.text();
    expect(html).toContain(t.formatLongDate(until, "nl"));
    expect(html).toContain("herinneren");
  });

  it("snoozes three months", async () => {
    const t = await setup();
    queueLease();
    const token = await t.signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "3m", lang: "en" });
    const res = await t.get(token);
    expect(res.status).toBe(200);
    expect(updateSets[0]).toMatchObject({ indexationSnoozedUntil: t.snoozeUntil(t.todayYmd, "3m") });
  });

  it("clears the snooze for the yearly option and names the next anniversary", async () => {
    const t = await setup();
    queueLease();
    const token = await t.signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "yearly", lang: "fr" });
    const res = await t.get(token);
    expect(res.status).toBe(200);
    expect(updateSets).toEqual([{ indexationSnoozedUntil: null, updatedAt: expect.any(Date) }]);
    const html = await res.text();
    expect(html).toContain(t.formatLongDate(t.nextAnniversaryAfter(START, t.todayYmd), "fr"));
    expect(html).toContain("indexation annuelle");
  });

  it("is harmless when the same link is clicked twice", async () => {
    const t = await setup();
    const token = await t.signIndexationSnoozeToken({ leaseId: "lease-1", snooze: "1m", lang: "de" });
    queueLease();
    const first = await t.get(token);
    queueLease();
    const second = await t.get(token);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(updateSets).toHaveLength(2);
    expect(updateSets[0]!.indexationSnoozedUntil).toBe(updateSets[1]!.indexationSnoozedUntil);
  });

  it("shows the invalid message for a garbage token without writing", async () => {
    const t = await setup();
    const res = await t.get("not-a-jwt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("This link is invalid or has expired.");
    expect(updateSets).toHaveLength(0);
  });

  it("does not accept a payment action token", async () => {
    const t = await setup();
    queueLease();
    const token = await t.signLandlordActionToken("paid", "p");
    const res = await t.get(token);
    expect(await res.text()).toContain("This link is invalid or has expired.");
    expect(updateSets).toHaveLength(0);
  });

  it("says so when the lease no longer exists", async () => {
    const t = await setup();
    selectQueue.push([]);
    const token = await t.signIndexationSnoozeToken({ leaseId: "gone", snooze: "1m", lang: "nl" });
    const res = await t.get(token);
    expect(await res.text()).toContain("Dit huurcontract kon niet worden gevonden.");
    expect(updateSets).toHaveLength(0);
  });

  it("has no em or en dashes on any confirmation page", async () => {
    const t = await setup();
    for (const lang of ["en", "nl", "fr", "de"]) {
      for (const snooze of ["1m", "3m", "yearly"] as const) {
        queueLease();
        const token = await t.signIndexationSnoozeToken({ leaseId: "lease-1", snooze, lang });
        const html = await (await t.get(token)).text();
        expect(html).not.toMatch(/[\u2013\u2014]/);
      }
      selectQueue.push([]);
      const token = await t.signIndexationSnoozeToken({ leaseId: "gone", snooze: "1m", lang });
      expect(await (await t.get(token)).text()).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
