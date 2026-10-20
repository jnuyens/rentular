import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  communications: {},
  leases: {},
  properties: {},
  propertyManagers: {},
  users: {},
  smtpSettings: {},
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

vi.mock("../../lib/whatsapp", () => ({
  isWhatsAppConfigured: vi.fn(() => true),
  sendWhatsApp: vi.fn(async () => ({ id: "wa-1" })),
}));

vi.mock("../../jobs/emailQueueWorker", () => ({ queueEmail: vi.fn() }));

vi.mock("../indexationCalc", () => ({ computeIndexationCore: vi.fn() }));

import {
  isAlertDue,
  resolveAlertRecipients,
  resolveAlertChannel,
  buildDigests,
  renderDigest,
  type AlertLease,
} from "../indexationAlerts";

const baseLease = {
  indexationEnabled: true,
  status: "active",
  type: "residential",
  indexationBaseIndex: "125.50",
  indexationAlertSentFor: null as string | null,
};
const dueCore = { canApply: true, applicableFrom: "2026-10-15", currentIndexPublished: true };

describe("isAlertDue", () => {
  it("is due for an active, set-up lease whose indexation just became applicable", () => {
    expect(isAlertDue(baseLease, dueCore)).toBe(true);
  });

  it("is not due again for the same applicableFrom", () => {
    expect(isAlertDue({ ...baseLease, indexationAlertSentFor: "2026-10-15" }, dueCore)).toBe(false);
  });

  it("is due again when the last alert was for last year's anniversary", () => {
    expect(isAlertDue({ ...baseLease, indexationAlertSentFor: "2025-10-15" }, dueCore)).toBe(true);
  });

  it("is not due when the indexation cannot be applied yet or the index is missing", () => {
    expect(isAlertDue(baseLease, { ...dueCore, canApply: false })).toBe(false);
    expect(isAlertDue(baseLease, { ...dueCore, currentIndexPublished: false })).toBe(false);
  });

  it("skips leases that are not eligible", () => {
    expect(isAlertDue({ ...baseLease, indexationEnabled: false }, dueCore)).toBe(false);
    expect(isAlertDue({ ...baseLease, status: "terminated" }, dueCore)).toBe(false);
    expect(isAlertDue({ ...baseLease, type: "student" }, dueCore)).toBe(false);
    expect(isAlertDue({ ...baseLease, indexationBaseIndex: null }, dueCore)).toBe(false);
  });
});

describe("resolveAlertRecipients", () => {
  it("returns the owner once plus managers and co-owners, never accountants or viewers", () => {
    expect(
      resolveAlertRecipients("owner-1", [
        { userId: "owner-1", role: "owner" },
        { userId: "m1", role: "manager" },
        { userId: "co", role: "co_owner" },
        { userId: "acc", role: "accountant" },
        { userId: "v", role: "viewer" },
      ])
    ).toEqual(["owner-1", "m1", "co"]);
  });
});

describe("resolveAlertChannel", () => {
  const user = { whatsappNumber: "+32470000000", indexationAlertsEnabled: true, email: "a@b.be" };

  it("uses WhatsApp when a number is set and the bridge is configured", () => {
    expect(resolveAlertChannel(user, true)).toBe("whatsapp");
  });

  it("falls back to email without a bridge or without a number", () => {
    expect(resolveAlertChannel(user, false)).toBe("email");
    expect(resolveAlertChannel({ ...user, whatsappNumber: null }, true)).toBe("email");
  });

  it("sends nothing when alerts are switched off", () => {
    expect(resolveAlertChannel({ ...user, indexationAlertsEnabled: false }, true)).toBeNull();
    expect(
      resolveAlertChannel({ ...user, whatsappNumber: null, indexationAlertsEnabled: false }, false)
    ).toBeNull();
  });
});

function lease(id: string, propertyId: string, label: string, currentRent: number, newRent: number | null): AlertLease {
  return {
    leaseId: id,
    propertyId,
    ownerId: "owner",
    propertyLabel: label,
    currentRent,
    newRent,
    applicableFrom: "2026-10-15",
  };
}

const A = lease("lease-a", "p1", "Residentie Zuid, Kerkstraat 12, 2000 Antwerpen", 850, 872.4);
const B = lease("lease-b", "p1", "Residentie Zuid, Kerkstraat 14, 2000 Antwerpen", 920, 944.15);
const C = lease("lease-c", "p2", "Studio Centrum, Veldstraat 3, 9000 Gent", 640, null);

describe("buildDigests", () => {
  it("groups due leases into one digest per recipient", () => {
    const recipients = new Map<string, string[]>([
      ["lease-a", ["owner", "m1"]],
      ["lease-b", ["owner", "m1"]],
      ["lease-c", ["owner"]],
    ]);
    const digests = buildDigests([A, B, C], recipients);
    expect([...digests.keys()].sort()).toEqual(["m1", "owner"]);
    expect(digests.get("owner")!.map((i) => i.leaseId)).toEqual(["lease-a", "lease-b", "lease-c"]);
    expect(digests.get("m1")!.map((i) => i.leaseId)).toEqual(["lease-a", "lease-b"]);
  });
});

describe("renderDigest", () => {
  const web = "https://www.rentular.com";

  it("renders a Dutch digest with a link, label and rent per lease", () => {
    const { subject, body } = renderDigest("nl", [A, B, C], web);
    for (const item of [A, B, C]) {
      const link = `${web}/indexation?lease=${item.leaseId}`;
      expect(body.split(link).length - 1).toBe(1);
      expect(body).toContain(item.propertyLabel);
    }
    expect(subject).toContain("3");
    expect(body).toContain("3");
    expect(body).toContain("€ 850,00");
    expect(body).toContain("€ 872,40");
    expect(body).toContain("Nieuwe huur kan nog niet berekend worden");
  });

  it("uses singular wording for one lease", () => {
    const { subject, body } = renderDigest("nl", [A], web);
    expect(subject).toBe("Huurindexering mogelijk voor 1 huurcontract");
    expect(body).toContain("Voor dit huurcontract");
  });

  it("renders en, fr and de, and falls back to en for unknown languages", () => {
    for (const lang of ["en", "fr", "de"]) {
      const { subject, body } = renderDigest(lang, [A, B], web);
      expect(subject.length).toBeGreaterThan(0);
      expect(body).toContain(`${web}/indexation?lease=lease-a`);
    }
    expect(renderDigest("xx", [A, B], web)).toEqual(renderDigest("en", [A, B], web));
  });

  it("contains no em or en dashes in any language", () => {
    for (const lang of ["en", "nl", "fr", "de"]) {
      for (const items of [[A], [A, B, C]]) {
        const { subject, body } = renderDigest(lang, items, web, "Jan");
        expect(subject + body).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});
