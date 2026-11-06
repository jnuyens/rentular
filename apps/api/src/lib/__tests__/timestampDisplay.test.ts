import { describe, expect, it } from "vitest";
import { dayOfMonthInZone, todayInZone, toUtcIso, ymdInZone } from "../timezone";

// The web formatter lives in apps/web (no test runner there). Load it by path at
// runtime so the API's tsc rootDir is not involved.
const webDateLocale = new URL("../../../../web/lib/dateLocale.ts", import.meta.url).href;

interface WebDateLocale {
  formatDate(v: string | Date | null | undefined, tz?: string): string;
  formatDateTime(v: string | Date | null | undefined, tz?: string): string;
  todayInZone(tz?: string, now?: Date): string;
  monthInZone(tz?: string, now?: Date): string;
  addDaysYmd(ymd: string, days: number): string;
  monthEndYmd(ymd: string): string;
  localeDateOrder(): "dmy" | "mdy";
}

async function web(): Promise<WebDateLocale> {
  return (await import(/* @vite-ignore */ webDateLocale)) as WebDateLocale;
}

/** "dd/mm/yyyy" in the runner's date order (dmy everywhere but US zones). */
function dmy(order: "dmy" | "mdy", d: string, m: string, y: string): string {
  return order === "dmy" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
}

describe("API timestamps are true UTC", () => {
  it("toUtcIso treats a zone-less DB wall clock as UTC and keeps Z instants", () => {
    expect(toUtcIso("2026-11-05 18:15:00")).toBe("2026-11-05T18:15:00.000Z");
    expect(toUtcIso("2026-11-05T18:15:00.000Z")).toBe("2026-11-05T18:15:00.000Z");
    expect(toUtcIso(new Date("2026-11-05T18:15:00Z"))).toBe("2026-11-05T18:15:00.000Z");
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso("not a date")).toBeNull();
  });
});

describe("today comes from the location's zone", () => {
  it("23:30 Brussels on the last day of a month is still that month (winter and summer)", () => {
    // 2026-10-31 23:30 CET = 22:30Z
    expect(todayInZone("Europe/Brussels", new Date("2026-10-31T22:30:00Z"))).toBe("2026-10-31");
    // 2026-07-31 23:30 CEST = 21:30Z
    expect(todayInZone("Europe/Brussels", new Date("2026-07-31T21:30:00Z"))).toBe("2026-07-31");
  });

  it("00:30 Brussels on the 1st is the new month although UTC is still the old one", () => {
    // 2026-11-01 00:30 CET = 2026-10-31 23:30Z
    const at = new Date("2026-10-31T23:30:00Z");
    expect(at.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(todayInZone("Europe/Brussels", at)).toBe("2026-11-01");
    expect(dayOfMonthInZone(at, "Europe/Brussels")).toBe(1);
    expect(ymdInZone(at, "America/New_York")).toBe("2026-10-31");
  });
});

describe("web formatter shows UTC instants in the data's zone", () => {
  it("the reference prod rows both show 05/11/2026 19:15 after the fix", async () => {
    const w = await web();
    const order = w.localeDateOrder();
    const expected = `${dmy(order, "05", "11", "2026")} 19:15`;
    // payment_reminders.sent_at (app-written, corrected) and
    // communications.created_at (DB default) both read 18:15 under UTC.
    expect(w.formatDateTime("2026-11-05T18:15:00.000Z")).toBe(expected);
    expect(w.formatDateTime("2026-11-05 18:15:00")).toBe(expected);
  });

  it("applies +2 h in summer and +1 h in winter", async () => {
    const w = await web();
    const order = w.localeDateOrder();
    expect(w.formatDateTime("2026-07-10T08:00:00.000Z")).toBe(`${dmy(order, "10", "07", "2026")} 10:00`);
    expect(w.formatDateTime("2026-01-10T08:00:00.000Z")).toBe(`${dmy(order, "10", "01", "2026")} 09:00`);
    // Across the October switch (2026-10-25 01:00Z).
    expect(w.formatDateTime("2026-10-25T00:30:00.000Z")).toBe(`${dmy(order, "25", "10", "2026")} 02:30`);
    expect(w.formatDateTime("2026-10-25T01:30:00.000Z")).toBe(`${dmy(order, "25", "10", "2026")} 02:30`);
  });

  it("never shifts calendar dates", async () => {
    const w = await web();
    const order = w.localeDateOrder();
    expect(w.formatDate("2026-11-30")).toBe(dmy(order, "30", "11", "2026"));
    expect(w.formatDate("2026-11-30T00:00:00.000Z")).toBe(dmy(order, "30", "11", "2026"));
    expect(w.formatDateTime("2026-11-30")).toBe(dmy(order, "30", "11", "2026"));
    // An instant late in the Brussels evening keeps its Brussels date.
    expect(w.formatDate("2026-11-30T23:30:00.000Z")).toBe(dmy(order, "01", "12", "2026"));
  });

  it("web today/month and payment windows use Brussels dates", async () => {
    const w = await web();
    const lateEvening = new Date("2026-10-31T22:30:00Z"); // 23:30 Brussels
    expect(w.todayInZone("Europe/Brussels", lateEvening)).toBe("2026-10-31");
    expect(w.monthInZone("Europe/Brussels", lateEvening)).toBe("2026-10");
    expect(w.monthInZone("Europe/Brussels", new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(w.monthEndYmd("2026-11-15")).toBe("2026-11-30");
    expect(w.monthEndYmd("2028-02-01")).toBe("2028-02-29");
    expect(w.addDaysYmd("2026-11-01", -25)).toBe("2026-10-07");
  });
});
