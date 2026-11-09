import { describe, it, expect } from "vitest";
import {
  buildReauthEmail,
  daysUntilExpiry,
  dueReauthStage,
  isConnectionStale,
  leaseReceivingIban,
  maskIban,
  shouldSendReauthWarning,
  staleMonitoredIbans,
  type ReauthStage,
} from "../bankReauth";

const TZ = "Europe/Brussels";

describe("daysUntilExpiry", () => {
  it("counts calendar days in the timezone", () => {
    // 23:30 UTC on 9 Nov is already 10 Nov in Brussels.
    const now = new Date("2026-11-09T23:30:00Z");
    const expires = new Date("2026-11-17T08:00:00Z");
    expect(daysUntilExpiry(expires, now, TZ)).toBe(7);
    expect(daysUntilExpiry(expires, now, "UTC")).toBe(8);
  });
});

describe("warning stages", () => {
  it("sends 14, 7, 3, 1 and 0 exactly once each over the run-up", () => {
    const expires = new Date("2026-12-01T10:00:00Z");
    let last: number | null = null;
    const sent: ReauthStage[] = [];
    for (let d = 20; d >= -3; d--) {
      const now = new Date(expires.getTime() - d * 86_400_000);
      const conn = {
        status: d < 0 ? "expired" : "active",
        consentExpiresAt: expires,
        lastSyncAt: null,
      };
      const due = dueReauthStage(conn, now, TZ);
      if (shouldSendReauthWarning(due, last)) {
        sent.push(due!);
        last = due;
      }
    }
    expect(sent).toEqual([14, 7, 3, 1, 0]);
  });

  it("catches up with the tightest stage after a missed day", () => {
    const now = new Date("2026-11-09T09:00:00Z");
    const conn = { status: "active", consentExpiresAt: new Date("2026-11-15T09:00:00Z") };
    expect(dueReauthStage(conn, now, TZ)).toBe(7);
    expect(shouldSendReauthWarning(7, 14)).toBe(true);
    expect(shouldSendReauthWarning(7, 7)).toBe(false);
    expect(shouldSendReauthWarning(14, 7)).toBe(false);
  });

  it("is nothing far from expiry, and nothing for revoked or pending rows", () => {
    const now = new Date("2026-11-09T09:00:00Z");
    const later = new Date("2027-03-01T09:00:00Z");
    expect(dueReauthStage({ status: "active", consentExpiresAt: later }, now, TZ)).toBeNull();
    expect(dueReauthStage({ status: "revoked", consentExpiresAt: now }, now, TZ)).toBeNull();
    expect(dueReauthStage({ status: "pending", consentExpiresAt: now }, now, TZ)).toBeNull();
  });

  it("puts a failing connection at stage 0 right away", () => {
    const now = new Date("2026-11-09T09:00:00Z");
    expect(dueReauthStage({ status: "expired", consentExpiresAt: new Date("2027-01-01") }, now, TZ)).toBe(0);
    expect(dueReauthStage({ status: "error", consentExpiresAt: null }, now, TZ)).toBe(0);
  });
});

describe("stale bank data", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("is stale when expired, failing, or past consent without a sync since", () => {
    expect(isConnectionStale({ status: "expired", consentExpiresAt: null }, now)).toBe(true);
    expect(isConnectionStale({ status: "error", consentExpiresAt: null }, now)).toBe(true);
    const past = new Date("2026-11-08T12:00:00Z");
    expect(isConnectionStale({ status: "active", consentExpiresAt: past, lastSyncAt: null }, now)).toBe(true);
    expect(
      isConnectionStale({ status: "active", consentExpiresAt: past, lastSyncAt: new Date("2026-11-09T00:00:00Z") }, now),
    ).toBe(false);
    expect(isConnectionStale({ status: "active", consentExpiresAt: new Date("2027-01-01") }, now)).toBe(false);
  });

  it("an IBAN covered by another healthy connection is not stale", () => {
    const conns = [
      { status: "expired", consentExpiresAt: null, iban: "BE68 5390 0754 7034" },
      { status: "active", consentExpiresAt: new Date("2027-01-01"), iban: "BE68539007547034" },
      { status: "error", consentExpiresAt: null, iban: "BE11111111111111" },
    ];
    expect([...staleMonitoredIbans(conns, now)]).toEqual(["BE11111111111111"]);
  });

  it("resolves the lease's receiving account: own, default, or only one", () => {
    const accounts = [
      { id: "a1", iban: "BE11 1111 1111 1111", isDefault: false },
      { id: "a2", iban: "BE22222222222222", isDefault: true },
    ];
    expect(leaseReceivingIban({ bankAccountId: "a1" }, accounts)).toBe("BE11111111111111");
    expect(leaseReceivingIban({ bankAccountId: null }, accounts)).toBe("BE22222222222222");
    expect(leaseReceivingIban({ bankAccountId: null }, [{ id: "x", iban: "BE33", isDefault: false }])).toBe("BE33");
    expect(
      leaseReceivingIban({ bankAccountId: null }, [
        { id: "x", iban: "BE33", isDefault: false },
        { id: "y", iban: "BE44", isDefault: false },
      ]),
    ).toBeNull();
  });
});

describe("re-login email", () => {
  const base = {
    name: "Jos",
    bankName: "KBC",
    ibanMasked: maskIban("BE68539007547034"),
    expiryDate: "16/11/2026",
    url: "https://www.rentular.com/bank-connections/c1?relogin=1",
  };

  it("has the Dutch subject and explains that reminders stop", () => {
    const { subject, body } = buildReauthEmail("nl", { ...base, stage: 7 });
    expect(subject).toBe("Log binnen 7 dagen opnieuw in bij KBC, anders stopt de opvolging van je huur");
    expect(body).toContain("BE68 •••• 7034");
    expect(body).toContain("16/11/2026");
    expect(body).toContain(base.url);
    expect(body).toContain("geen automatische herinneringen");
  });

  it("exists in all four languages without dashes", () => {
    for (const lang of ["en", "nl", "fr", "de"]) {
      for (const stage of [14, 7, 3, 1, 0] as ReauthStage[]) {
        const { subject, body } = buildReauthEmail(lang, { ...base, stage });
        expect(subject.length).toBeGreaterThan(10);
        expect(`${subject}${body}`).not.toMatch(/[\u2013\u2014]/);
      }
    }
    expect(buildReauthEmail("fr", { ...base, stage: 0 }).subject).toContain("a expiré");
    expect(buildReauthEmail("de", { ...base, stage: 1 }).subject).toContain("morgen");
    expect(buildReauthEmail("xx", { ...base, stage: 3 }).subject).toContain("within 3 days");
  });
});
