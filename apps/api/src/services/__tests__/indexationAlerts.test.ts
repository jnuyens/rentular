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

vi.mock("../indexationCalc", () => ({
  computeIndexationCore: vi.fn(),
  localYmd: (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
}));

import {
  alertCycleDate,
  isAlertDue,
  snoozeUntil,
  nextAnniversaryAfter,
  resolveAlertRecipients,
  resolveAlertChannel,
  buildDigests,
  renderDigest,
  formatPropertyLabel,
  type AlertLease,
} from "../indexationAlerts";

const baseLease = {
  startDate: "2025-10-15",
  indexationEnabled: true,
  status: "active",
  type: "residential",
  indexationBaseIndex: "125.50",
  indexationAlertSentFor: null as string | null,
  indexationSnoozedUntil: null as string | null,
};
const dueCore = { canApply: true, applicableFrom: "2026-10-15", currentIndexPublished: true };
const today = new Date("2026-10-20T08:00:00Z");

describe("alertCycleDate", () => {
  it("is applicableFrom for a lease indexed on time", () => {
    expect(alertCycleDate("2025-10-15", "2026-10-15", today)).toBe("2026-10-15");
  });

  it("moves to the latest anniversary for a lease that was never indexed", () => {
    expect(alertCycleDate("2015-10-15", "2016-10-15", today)).toBe("2026-10-15");
  });

  it("uses last year's anniversary when this year's has not come yet", () => {
    expect(alertCycleDate("2020-02-01", "2021-02-01", today)).toBe("2026-02-01");
    expect(alertCycleDate("2019-12-01", "2020-12-01", today)).toBe("2025-12-01");
  });
});

describe("isAlertDue for an unapplied lease", () => {
  const old = { ...baseLease, startDate: "2015-10-15" };
  const oldCore = { ...dueCore, applicableFrom: "2016-10-15" };

  it("is not due twice in the same anniversary year", () => {
    expect(isAlertDue({ ...old, indexationAlertSentFor: "2026-10-15" }, oldCore, today)).toBe(false);
  });

  it("is due again at the next anniversary when nothing was applied", () => {
    expect(isAlertDue({ ...old, indexationAlertSentFor: "2025-10-15" }, oldCore, today)).toBe(true);
    expect(
      isAlertDue({ ...old, indexationAlertSentFor: "2026-10-15" }, oldCore, new Date("2027-10-16T08:00:00Z"))
    ).toBe(true);
  });
});

describe("isAlertDue", () => {
  it("is due for an active, set-up lease whose indexation just became applicable", () => {
    expect(isAlertDue(baseLease, dueCore, today)).toBe(true);
  });

  it("is not due again for the same applicableFrom", () => {
    expect(isAlertDue({ ...baseLease, indexationAlertSentFor: "2026-10-15" }, dueCore, today)).toBe(false);
  });

  it("is due again when the last alert was for last year's anniversary", () => {
    expect(isAlertDue({ ...baseLease, indexationAlertSentFor: "2025-10-15" }, dueCore, today)).toBe(true);
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

function localYmdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours());
}

describe("snoozeUntil", () => {
  it("adds calendar months and clamps to the end of a shorter month", () => {
    expect(snoozeUntil("2026-01-31", "1m")).toBe("2026-02-28");
    expect(snoozeUntil("2024-01-31", "1m")).toBe("2024-02-29");
    expect(snoozeUntil("2026-11-30", "3m")).toBe("2027-02-28");
    expect(snoozeUntil("2026-10-22", "1m")).toBe("2026-11-22");
    expect(snoozeUntil("2026-10-22", "3m")).toBe("2027-01-22");
  });

  it("returns null for the yearly option", () => {
    expect(snoozeUntil("2026-10-22", "yearly")).toBeNull();
    expect(snoozeUntil("2024-02-29", "yearly")).toBeNull();
  });
});

describe("nextAnniversaryAfter", () => {
  it("returns the first anniversary strictly after today", () => {
    expect(nextAnniversaryAfter("2019-05-01", "2026-10-22")).toBe("2027-05-01");
    expect(nextAnniversaryAfter("2019-05-01", "2026-04-30")).toBe("2026-05-01");
    expect(nextAnniversaryAfter("2019-05-01", "2026-05-01")).toBe("2027-05-01");
  });

  it("moves a 29 February start to 28 February in a non-leap year", () => {
    expect(nextAnniversaryAfter("2020-02-29", "2026-01-10")).toBe("2026-02-28");
    expect(nextAnniversaryAfter("2020-02-29", "2027-03-01")).toBe("2028-02-29");
  });
});

describe("isAlertDue with a snooze", () => {
  const alerted = { ...baseLease, indexationAlertSentFor: "2026-10-15" };
  const tomorrow = localYmdOf(shiftDays(today, 1));
  const todayYmd = localYmdOf(today);
  const yesterday = localYmdOf(shiftDays(today, -1));

  it("is not due while the snooze runs", () => {
    expect(isAlertDue({ ...alerted, indexationSnoozedUntil: tomorrow }, dueCore, today)).toBe(false);
  });

  it("is due again on and after the snooze date, even if this anniversary was alerted", () => {
    expect(isAlertDue({ ...alerted, indexationSnoozedUntil: todayYmd }, dueCore, today)).toBe(true);
    expect(isAlertDue({ ...alerted, indexationSnoozedUntil: yesterday }, dueCore, today)).toBe(true);
  });

  it("still respects the other guards after the snooze ended", () => {
    expect(
      isAlertDue({ ...alerted, indexationSnoozedUntil: yesterday }, { ...dueCore, canApply: false }, today)
    ).toBe(false);
    expect(
      isAlertDue({ ...alerted, indexationSnoozedUntil: yesterday, indexationEnabled: false }, dueCore, today)
    ).toBe(false);
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

  const snoozeBase = `${web}/api/v1/landlord-action/indexation`;
  const D = lease("lease-d", "p3", "Flat <b>1</b> & co", 700, 720);
  function snoozeMap(items: AlertLease[]): Map<string, { m1: string; m3: string; yearly: string }> {
    return new Map(
      items.map((i) => [
        i.leaseId,
        {
          m1: `${snoozeBase}/tok-${i.leaseId}-1m`,
          m3: `${snoozeBase}/tok-${i.leaseId}-3m`,
          yearly: `${snoozeBase}/tok-${i.leaseId}-yearly`,
        },
      ])
    );
  }

  const BUTTONS: Record<string, string[]> = {
    en: ["Open indexation", "Remind me next month", "Remind me in 3 months", "Remind me at the next yearly indexation"],
    nl: [
      "Indexering openen",
      "Herinner me volgende maand",
      "Herinner me binnen 3 maanden",
      "Herinner me bij de volgende jaarlijkse indexering",
    ],
    fr: [
      "Ouvrir l&#39;indexation",
      "Me le rappeler le mois prochain",
      "Me le rappeler dans 3 mois",
      "Me le rappeler \u00e0 la prochaine indexation annuelle",
    ],
    de: [
      "Indexierung \u00f6ffnen",
      "N\u00e4chsten Monat erinnern",
      "In 3 Monaten erinnern",
      "Bei der n\u00e4chsten j\u00e4hrlichen Indexierung erinnern",
    ],
  };

  it("returns html with the open link even without snooze links", () => {
    const { html } = renderDigest("nl", [A, B, C], web);
    for (const item of [A, B, C]) {
      expect(html).toContain(`href="${web}/indexation?lease=${item.leaseId}"`);
    }
    expect(html).not.toContain("landlord-action/indexation");
  });

  it("lists the snooze links once per lease in the text and as buttons in the html", () => {
    const items = [A, B, D];
    const map = snoozeMap(items);
    const { body, html } = renderDigest("nl", items, web, "Jan", map);
    for (const item of items) {
      const urls = map.get(item.leaseId)!;
      expect(body.split(`${web}/indexation?lease=${item.leaseId}`).length - 1).toBe(1);
      for (const url of [urls.m1, urls.m3, urls.yearly]) {
        expect(body.split(url).length - 1).toBe(1);
        expect(html).toContain(`href="${url}"`);
      }
      const openAt = body.indexOf(`${web}/indexation?lease=${item.leaseId}`);
      expect(body.indexOf(urls.m1)).toBeGreaterThan(openAt);
      expect(html).toContain(`href="${web}/indexation?lease=${item.leaseId}"`);
    }
    expect(body).toContain(`Herinner me volgende maand: ${map.get("lease-a")!.m1}`);
  });

  it("escapes the property label in the html", () => {
    const { html } = renderDigest("en", [D], web, null, snoozeMap([D]));
    expect(html).toContain("Flat &lt;b&gt;1&lt;/b&gt; &amp; co");
    expect(html).not.toContain("<b>1</b>");
  });

  it("uses each language's button texts, falls back to en, and has no dashes", () => {
    for (const lang of ["en", "nl", "fr", "de"]) {
      const { subject, body, html } = renderDigest(lang, [A, C], web, "Jan", snoozeMap([A, C]));
      for (const text of BUTTONS[lang]!) expect(html).toContain(text);
      expect(subject + body + html).not.toMatch(/[\u2013\u2014]/);
    }
    expect(renderDigest("xx", [A], web, null, snoozeMap([A]))).toEqual(
      renderDigest("en", [A], web, null, snoozeMap([A]))
    );
  });

  it("builds an inline-styled table layout without scripts", () => {
    const { html } = renderDigest("en", [A], web, null, snoozeMap([A]));
    expect(html).toContain("<table");
    expect(html).toContain("style=");
    expect(html).not.toContain("<script");
  });
});

describe("formatPropertyLabel", () => {
  it("does not repeat the address when the name already holds it", () => {
    expect(
      formatPropertyLabel({
        name: "Tervuursestraat 97 leuven",
        street: "Tervuursestraat",
        streetNumber: "97",
        postalCode: "3000",
        city: "Leuven",
      })
    ).toBe("Tervuursestraat 97, 3000 Leuven");
  });

  it("keeps a box number from the name and drops the trailing city", () => {
    expect(
      formatPropertyLabel({
        name: "Carnotstraat 65 b102 Antwerpen",
        street: "Carnotstraat",
        streetNumber: "65",
        postalCode: "2018",
        city: "Antwerpen",
      })
    ).toBe("Carnotstraat 65 b102, 2018 Antwerpen");
  });

  it("appends postal code and city when the name has the street but no city", () => {
    expect(
      formatPropertyLabel({
        name: "Carnotstraat  65 b102",
        street: "carnotstraat",
        streetNumber: "65",
        postalCode: "2018",
        city: "Antwerpen",
      })
    ).toBe("Carnotstraat 65 b102, 2018 Antwerpen");
  });

  it("keeps name, street and city for a descriptive name", () => {
    expect(
      formatPropertyLabel({
        name: "Residentie Zuid",
        street: "Kerkstraat",
        streetNumber: "1",
        postalCode: "9000",
        city: "Gent",
      })
    ).toBe("Residentie Zuid, Kerkstraat 1, 9000 Gent");
  });

  it("falls back to the address when there is no name", () => {
    expect(
      formatPropertyLabel({
        name: null,
        street: "Kerkstraat",
        streetNumber: "1",
        postalCode: "9000",
        city: "Gent",
      })
    ).toBe("Kerkstraat 1, 9000 Gent");
  });
});
