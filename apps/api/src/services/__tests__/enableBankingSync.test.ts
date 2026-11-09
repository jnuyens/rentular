import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({ getDb: vi.fn(), bankConnections: {}, bankStatements: {} }));
vi.mock("../../lib/enableBankingApps", () => ({ loadEnableBankingCredentials: vi.fn() }));
vi.mock("../bankReauthWarnings", () => ({ warnConnectionNow: vi.fn() }));

const { enableBankingDateFrom, takeUnattendedFetch, readMetadata, MAX_UNATTENDED_FETCHES_PER_DAY } = await import(
  "../enableBankingSync"
);

describe("unattended fetch allowance", () => {
  it("allows 3 a day and starts again the next day", () => {
    expect(MAX_UNATTENDED_FETCHES_PER_DAY).toBe(3);
    let c = takeUnattendedFetch(undefined, "2026-11-09");
    expect(c).toEqual({ date: "2026-11-09", count: 1 });
    c = takeUnattendedFetch(c!, "2026-11-09");
    c = takeUnattendedFetch(c!, "2026-11-09");
    expect(c).toEqual({ date: "2026-11-09", count: 3 });
    expect(takeUnattendedFetch(c!, "2026-11-09")).toBeNull();
    expect(takeUnattendedFetch(c!, "2026-11-10")).toEqual({ date: "2026-11-10", count: 1 });
  });
});

describe("fetch window", () => {
  it("starts 5 days before the last booked transaction", () => {
    expect(enableBankingDateFrom("2026-11-08", "2026-11-09")).toBe("2026-11-03");
  });
  it("backfills 90 days on the first sync and never reaches further back", () => {
    expect(enableBankingDateFrom(null, "2026-11-09")).toBe("2026-08-11");
    expect(enableBankingDateFrom("2026-01-01", "2026-11-09")).toBe("2026-08-11");
  });
});

describe("metadata", () => {
  it("reads objects and JSON strings", () => {
    expect(readMetadata({ sessionId: "s" }).sessionId).toBe("s");
    expect(readMetadata('{"sessionId":"t"}').sessionId).toBe("t");
    expect(readMetadata("not json")).toEqual({});
    expect(readMetadata(null)).toEqual({});
  });
});
