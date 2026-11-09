import { describe, it, expect, vi, beforeEach } from "vitest";

const queueEmail = vi.fn(async () => "job-1");
vi.mock("../../jobs/emailQueueWorker", () => ({ queueEmail }));

let reads: unknown[][] = [];
const updates: Array<Record<string, unknown>> = [];

function chain(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        const r = Promise.resolve(reads.length ? reads.shift() : []);
        return r.then.bind(r);
      }
      if (prop === "set") {
        return (v: Record<string, unknown>) => {
          updates.push(v);
          return { where: async () => [] };
        };
      }
      return () => chain();
    },
  });
}

vi.mock("@rentular/db", () => ({
  getDb: () => ({ select: () => chain(), update: () => chain() }),
  bankConnections: { id: "id", ownerId: "owner_id", status: "status" },
  bankAccounts: { ownerId: "owner_id" },
  users: { id: "id", email: "email", name: "name", locale: "locale" },
}));

const { createMonitoringGuard, runReauthWarnings } = await import("../bankReauthWarnings");

function conn(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    ownerId: "o1",
    provider: "enable_banking",
    institutionId: "KBC",
    institutionName: "KBC",
    iban: "BE68539007547034",
    status: "active",
    consentExpiresAt: new Date("2026-11-16T10:00:00Z"),
    lastSyncAt: new Date("2026-11-09T18:00:00Z"),
    reauthWarnStage: null,
    ...over,
  };
}

beforeEach(() => {
  reads = [];
  updates.length = 0;
  queueEmail.mockClear();
});

describe("monitoring guard", () => {
  const now = new Date("2026-11-09T19:15:00Z");

  it("holds reminders for a lease whose account's connection expired", async () => {
    reads = [
      [conn({ status: "expired" })],
      [{ id: "acc1", iban: "BE68 5390 0754 7034", isDefault: true, isArchived: false }],
    ];
    const guard = createMonitoringGuard(undefined, now);
    const hit = await guard({ ownerId: "o1", bankAccountId: "acc1" });
    expect(hit).toEqual({ connectionId: "c1", bankName: "KBC", iban: "BE68539007547034" });
    // Cached per landlord: a second lease does not query again.
    expect(await guard({ ownerId: "o1", bankAccountId: null })).not.toBeNull();
  });

  it("lets reminders through when the connection is healthy", async () => {
    reads = [[conn()], [{ id: "acc1", iban: "BE68539007547034", isDefault: true, isArchived: false }]];
    const guard = createMonitoringGuard(undefined, now);
    expect(await guard({ ownerId: "o1", bankAccountId: "acc1" })).toBeNull();
  });

  it("lets reminders through for a lease paid into another account", async () => {
    reads = [
      [conn({ status: "error" })],
      [
        { id: "acc1", iban: "BE68539007547034", isDefault: true, isArchived: false },
        { id: "acc2", iban: "BE11111111111111", isDefault: false, isArchived: false },
      ],
    ];
    const guard = createMonitoringGuard(undefined, now);
    expect(await guard({ ownerId: "o1", bankAccountId: "acc2" })).toBeNull();
  });
});

describe("runReauthWarnings", () => {
  it("emails the owner once per stage and logs it as a landlord notification", async () => {
    const now = new Date("2026-11-09T08:00:00Z"); // 7 days before 16/11
    reads = [[conn()], [{ email: "jos@example.org", name: "Jos", locale: "nl" }]];
    const r = await runReauthWarnings(now);
    expect(r.sent).toBe(1);
    expect(queueEmail).toHaveBeenCalledTimes(1);
    const [email, , meta] = queueEmail.mock.calls[0] as unknown as [
      { to: string; subject: string; body: string },
      unknown,
      { type: string; metadata: Record<string, unknown> },
    ];
    expect(email.to).toBe("jos@example.org");
    expect(email.subject).toBe("Log binnen 7 dagen opnieuw in bij KBC, anders stopt de opvolging van je huur");
    expect(email.body).toContain("/bank-connections/c1?relogin=1");
    expect(meta.type).toBe("landlord_notification");
    expect(meta.metadata).toMatchObject({ kind: "bank_reauth_warning", stage: 7, connectionId: "c1" });
    expect(updates[0]).toMatchObject({ reauthWarnStage: 7 });

    // Same day again, with the stage stored: nothing new.
    reads = [[conn({ reauthWarnStage: 7 })]];
    const again = await runReauthWarnings(now);
    expect(again.sent).toBe(0);
    expect(queueEmail).toHaveBeenCalledTimes(1);
  });
});
