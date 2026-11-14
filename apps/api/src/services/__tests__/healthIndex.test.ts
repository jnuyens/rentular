import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  healthIndexValues: {},
}));

import {
  parseStatbelCpiFile,
  extractStatbelCpiText,
  expectedLatestMonth,
  decideHealthIndexAlert,
  checkHealthIndexAndAlert,
  healthIndexStatusFor,
  STATBEL_OPENDATA_URL,
  type HealthIndexCheckDeps,
  type HealthIndexFetchResult,
} from "../healthIndex";

const fixture = readFileSync(
  join(__dirname, "fixtures", "cpi-all-base-years-excerpt.txt"),
  "utf8"
);

const HEADER =
  "NM_YR|NM_MTH|MS_CPI_IDX|MS_CPI_INFL|MS_WT_CPI|MS_HLTH_IDX|_FREQ_|NM_BASE_YR|MS_WTHOUT_ENE_IDX|MS_WITHOUT_PTRL_IDX|MS_SMOOTH_IDX";

describe("parseStatbelCpiFile", () => {
  it("fixture really starts with a BOM and uses CRLF", () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff);
    expect(fixture).toContain("\r\n");
  });

  it("keeps only base 2013 rows with a published health index", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows).toEqual([
      { year: "2025", month: "12", value: "136.69" },
      { year: "2026", month: "08", value: "140.3" },
      { year: "2026", month: "09", value: "140.67" },
    ]);
  });

  it("strips the BOM so the first column is read as NM_YR", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows[0]!.year).toBe("2025");
  });

  it("skips rows whose health index is '.'", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows.find((r) => r.year === "1990")).toBeUndefined();
  });

  it("zero pads single digit months", () => {
    const rows = parseStatbelCpiFile(
      `${HEADER}\n2026|9|141.28|.|1000|140.67|.|2013|.|.|.\n`
    );
    expect(rows).toEqual([{ year: "2026", month: "09", value: "140.67" }]);
  });

  it("tolerates LF only line endings as well as CRLF", () => {
    const lf = fixture.replace(/\r\n/g, "\n");
    expect(parseStatbelCpiFile(lf)).toEqual(parseStatbelCpiFile(fixture));
  });

  it("locates columns by header name, not position", () => {
    const text =
      "NM_BASE_YR|MS_HLTH_IDX|NM_MTH|NM_YR\r\n2013|136.69|12|2025\r\n2025|100.82|12|2025\r\n";
    expect(parseStatbelCpiFile(text)).toEqual([
      { year: "2025", month: "12", value: "136.69" },
    ]);
  });

  it("throws on an unexpected header", () => {
    expect(() => parseStatbelCpiFile("foo|bar\n1|2\n")).toThrow();
  });
});

describe("extractStatbelCpiText", () => {
  it("reads the CPI text file out of a zip archive", () => {
    const zip = zipSync({
      "readme.md": strToU8("not this one"),
      "CPI All base years.txt": strToU8(fixture),
    });
    const text = extractStatbelCpiText(zip);
    expect(parseStatbelCpiFile(text)).toHaveLength(3);
  });

  it("falls back to the first .txt entry", () => {
    const zip = zipSync({ "other.txt": strToU8(fixture) });
    expect(parseStatbelCpiFile(extractStatbelCpiText(zip))).toHaveLength(3);
  });

  it("throws when the zip has no .txt file", () => {
    const zip = zipSync({ "data.csv": strToU8("x") });
    expect(() => extractStatbelCpiText(zip)).toThrow();
  });
});

const BXL = "Europe/Brussels";

describe("expectedLatestMonth", () => {
  it("requires nothing yet on the 2nd", () => {
    expect(expectedLatestMonth(new Date("2026-11-02T10:00:00Z"), BXL)).toBeNull();
  });

  it("requires the previous month from the 3rd", () => {
    expect(expectedLatestMonth(new Date("2026-11-03T10:00:00Z"), BXL)).toEqual({
      year: "2026",
      month: "10",
    });
  });

  it("asks for December of the previous year in January", () => {
    expect(expectedLatestMonth(new Date("2027-01-03T10:00:00Z"), BXL)).toEqual({
      year: "2026",
      month: "12",
    });
    expect(expectedLatestMonth(new Date("2027-01-31T10:00:00Z"), BXL)).toEqual({
      year: "2026",
      month: "12",
    });
  });

  it("judges the day in the schedule timezone, not UTC", () => {
    const lateOn2ndUtc = new Date("2026-11-02T23:30:00Z");
    expect(expectedLatestMonth(lateOn2ndUtc, "UTC")).toBeNull();
    expect(expectedLatestMonth(lateOn2ndUtc, BXL)).toEqual({ year: "2026", month: "10" });
  });
});

describe("decideHealthIndexAlert", () => {
  const ok: HealthIndexFetchResult = { ok: true, fetched: 393, inserted: 0 };
  const failed: HealthIndexFetchResult = { ok: false, error: "HTTP 503", fetched: 0, inserted: 0 };
  const oct = { year: "2026", month: "10" };

  it("alerts on a failed fetch, even before the due day", () => {
    expect(decideHealthIndexAlert(failed, oct, true)).toBe("fetch-failed");
    expect(decideHealthIndexAlert(failed, null, true)).toBe("fetch-failed");
  });

  it("alerts when the fetch worked but the expected month is missing", () => {
    expect(decideHealthIndexAlert(ok, oct, false)).toBe("stale");
  });

  it("stays quiet when the fetch worked and the month is present", () => {
    expect(decideHealthIndexAlert(ok, oct, true)).toBeNull();
  });

  it("stays quiet before the due day", () => {
    expect(decideHealthIndexAlert(ok, null, false)).toBeNull();
  });
});

describe("checkHealthIndexAndAlert", () => {
  function makeDeps(overrides: Partial<HealthIndexCheckDeps> = {}) {
    const claimed = new Set<string>();
    const deps: HealthIndexCheckDeps = {
      now: new Date("2026-11-03T05:00:00Z"),
      tz: BXL,
      adminEmail: "admin@example.com",
      hasMonth: vi.fn(async () => false),
      latestMonth: vi.fn(async () => "2026-09"),
      claimOnce: vi.fn(async (key: string) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      }),
      release: vi.fn(async (key: string) => {
        claimed.delete(key);
      }),
      sendEmail: vi.fn(async () => undefined),
      ...overrides,
    };
    return deps;
  }

  it("mails the admin once per missing month when the index is overdue", async () => {
    const deps = makeDeps();
    const ok: HealthIndexFetchResult = { ok: true, fetched: 393, inserted: 0 };

    const first = await checkHealthIndexAndAlert(ok, deps);
    expect(first).toEqual({ kind: "stale", sent: true });
    expect(deps.hasMonth).toHaveBeenCalledWith("2026", "10");
    expect(deps.claimOnce).toHaveBeenCalledWith("healthindex:alert:stale:2026-10", 40 * 86400);
    const [to, subject, body] = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(to).toBe("admin@example.com");
    expect(subject).toBe("[Rentular] Health index not updated");
    expect(body).toContain("Latest month in database: 2026-09");
    expect(body).toContain("Expected month: 2026-10");
    expect(body).toContain(STATBEL_OPENDATA_URL);

    const second = await checkHealthIndexAndAlert(ok, deps);
    expect(second).toEqual({ kind: "stale", sent: false });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("includes the error for a failed fetch", async () => {
    const deps = makeDeps({ hasMonth: vi.fn(async () => true) });
    const res = await checkHealthIndexAndAlert(
      { ok: false, error: "HTTP 503 Service Unavailable", fetched: 0, inserted: 0 },
      deps
    );
    expect(res).toEqual({ kind: "fetch-failed", sent: true });
    expect(deps.claimOnce).toHaveBeenCalledWith("healthindex:alert:fetch-failed:2026-10", 82800);
    const body = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain("Error: HTTP 503 Service Unavailable");
  });

  it("does nothing when the fetch worked and the month is present", async () => {
    const deps = makeDeps({ hasMonth: vi.fn(async () => true) });
    const res = await checkHealthIndexAndAlert({ ok: true, fetched: 393, inserted: 1 }, deps);
    expect(res).toEqual({ kind: null, sent: false });
    expect(deps.claimOnce).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("skips the mail when ADMIN_EMAIL is not set", async () => {
    const deps = makeDeps({ adminEmail: undefined });
    const res = await checkHealthIndexAndAlert({ ok: true, fetched: 393, inserted: 0 }, deps);
    expect(res).toEqual({ kind: "stale", sent: false });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("still sends when Redis is unavailable", async () => {
    const deps = makeDeps({
      claimOnce: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });
    const res = await checkHealthIndexAndAlert({ ok: true, fetched: 393, inserted: 0 }, deps);
    expect(res).toEqual({ kind: "stale", sent: true });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("frees the dedupe key when sending fails so the next run retries", async () => {
    const deps = makeDeps({
      sendEmail: vi.fn(async () => {
        throw new Error("queue down");
      }),
    });
    await expect(
      checkHealthIndexAndAlert({ ok: true, fetched: 393, inserted: 0 }, deps)
    ).rejects.toThrow("queue down");
    expect(deps.release).toHaveBeenCalledWith("healthindex:alert:stale:2026-10");
  });
});

describe("monthly health index check with a fixed clock", () => {
  const ok: HealthIndexFetchResult = { ok: true, fetched: 393, inserted: 0 };
  function deps(now: string, present: boolean) {
    const claimed = new Set<string>();
    return {
      now: new Date(now),
      tz: BXL,
      adminEmail: "admin@example.com",
      hasMonth: vi.fn(async () => present),
      latestMonth: vi.fn(async () => (present ? "2026-10" : "2026-09")),
      claimOnce: vi.fn(async (key: string) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      }),
      sendEmail: vi.fn(async (_to: string, _subject: string, _body: string) => undefined),
    } satisfies HealthIndexCheckDeps;
  }

  it("does not alert on the 2nd when last month is missing", async () => {
    const d = deps("2026-11-02T05:00:00Z", false);
    expect(await checkHealthIndexAndAlert(ok, d)).toEqual({ kind: null, sent: false });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it("alerts once on the 3rd, and not again on the following days", async () => {
    const d = deps("2026-11-03T05:00:00Z", false);
    expect(await checkHealthIndexAndAlert(ok, d)).toEqual({ kind: "stale", sent: true });
    d.now = new Date("2026-11-04T05:00:00Z");
    expect(await checkHealthIndexAndAlert(ok, d)).toEqual({ kind: "stale", sent: false });
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    const body = d.sendEmail.mock.calls[0]![2] as string;
    expect(body).toContain("Expected month: 2026-10");
    expect(body).toContain("Latest month in database: 2026-09");
  });

  it("does nothing when last month is present", async () => {
    const d = deps("2026-11-03T05:00:00Z", true);
    expect(await checkHealthIndexAndAlert(ok, d)).toEqual({ kind: null, sent: false });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});

describe("healthIndexStatusFor", () => {
  it("is not stale on the 2nd while last month is missing", () => {
    expect(healthIndexStatusFor({ year: "2026", month: "09" }, new Date("2026-11-02T10:00:00Z"), BXL)).toEqual({
      stale: false,
      expectedMonth: null,
      latestMonth: "2026-09",
    });
  });

  it("is stale from the 3rd while last month is missing", () => {
    expect(healthIndexStatusFor({ year: "2026", month: "09" }, new Date("2026-11-03T10:00:00Z"), BXL)).toEqual({
      stale: true,
      expectedMonth: "2026-10",
      latestMonth: "2026-09",
    });
  });

  it("is fresh when last month is cached, however long ago it was fetched", () => {
    expect(healthIndexStatusFor({ year: "2026", month: "10" }, new Date("2026-11-28T10:00:00Z"), BXL).stale).toBe(false);
  });

  it("is stale when nothing is cached", () => {
    expect(healthIndexStatusFor(null, new Date("2026-11-02T10:00:00Z"), BXL).stale).toBe(true);
  });
});
