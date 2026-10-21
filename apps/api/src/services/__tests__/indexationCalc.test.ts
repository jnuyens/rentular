import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../healthIndex", () => ({
  getHealthIndexValue: vi.fn(),
  getLatestHealthIndex: vi.fn(),
}));

import { BRUSSELS_EPC_INDEXATION_FACTOR } from "@rentular/shared/constants";
import { getHealthIndexValue, getLatestHealthIndex } from "../healthIndex";
import {
  firstDueOnOrAfter,
  computeIndexationCore,
  getFlandersCorrectionFactor,
  getIndexationApplicability,
} from "../indexationCalc";

describe("getIndexationApplicability", () => {
  it("is applicable on the first anniversary of the contract start", () => {
    expect(
      getIndexationApplicability({
        startDate: "2025-03-15",
        lastIndexationDate: null,
        today: new Date("2026-03-15"),
      })
    ).toEqual({ canApply: true, applicableFrom: "2026-03-15" });
  });

  it("is not applicable the day before the anniversary", () => {
    const r = getIndexationApplicability({
      startDate: "2025-03-15",
      lastIndexationDate: null,
      today: new Date("2026-03-14"),
    });
    expect(r.canApply).toBe(false);
    expect(r.applicableFrom).toBe("2026-03-15");
  });

  it("counts a year from the last indexation when there is one", () => {
    expect(
      getIndexationApplicability({
        startDate: "2025-03-15",
        lastIndexationDate: "2026-03-20",
        today: new Date("2026-06-01"),
      })
    ).toEqual({ canApply: false, applicableFrom: "2027-03-20" });
  });
});

const round2 = (x: number): number => Math.round(x * 100) / 100;

function mockIndices(values: Record<string, number>): void {
  vi.mocked(getHealthIndexValue).mockImplementation(async (year: string, month: string) => {
    const v = values[`${year}-${month}`];
    return (v === undefined ? null : String(v)) as Awaited<ReturnType<typeof getHealthIndexValue>>;
  });
  vi.mocked(getLatestHealthIndex).mockResolvedValue({
    year: "2026",
    month: "09",
    value: "140.00",
  } as Awaited<ReturnType<typeof getLatestHealthIndex>>);
}

const realLease = {
  baseRent: 675,
  baseIndex: 108.98,
  region: "flanders",
  startDate: "2019-05-01",
  epcLabel: "E" as string | null,
  leaseType: "residential_long",
};

describe("getFlandersCorrectionFactor", () => {
  it("uses the official anniversary-month table", () => {
    expect(getFlandersCorrectionFactor("D", 11)).toBe(0.945356473);
    expect(getFlandersCorrectionFactor("E", 5)).toBe(0.943883189);
    expect(getFlandersCorrectionFactor(null, 5)).toBe(0.943883189);
    expect(getFlandersCorrectionFactor("F", 10)).toBe(0.898895293);
    expect(getFlandersCorrectionFactor("C", 5)).toBe(1);
    expect(getFlandersCorrectionFactor("A++", 1)).toBe(1);
  });
});

describe("computeIndexationCore: Flemish EPC correction after the freeze", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getHealthIndexValue).mockReset();
    vi.mocked(getLatestHealthIndex).mockReset();
  });

  it("reproduces the official example (EPC D, November anniversary)", async () => {
    vi.setSystemTime(new Date("2023-12-15T12:00:00Z"));
    mockIndices({ "2023-10": 132.96 });
    const r = await computeIndexationCore({
      baseRent: 600,
      baseIndex: 108.98,
      region: "flanders",
      startDate: "2021-11-01",
      epcLabel: "D",
      leaseType: "residential_long",
    });
    expect(r.unrestrictedNewRent).toBe(732.02);
    expect(r.newRent).toBe(692.02);
    expect(r.correctionApplied).toBe(true);
    expect(r.epcIndexationFactor).toBe(0.945356473);
    expect(r.correctionMonth).toBe(11);
  });

  it("applies the E column for a May anniversary", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore(realLease);
    expect(r.unrestrictedNewRent).toBe(862.98);
    expect(r.newRent).toBe(814.55);
    expect(r.correctionApplied).toBe(true);
    expect(r.correctionMonth).toBe(5);
  });

  it("treats a missing EPC like E", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore({ ...realLease, epcLabel: null });
    expect(r.newRent).toBe(814.55);
    expect(r.correctionApplied).toBe(true);
  });

  it("gives full indexation for EPC C", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore({ ...realLease, epcLabel: "C" });
    expect(r.newRent).toBe(862.98);
    expect(r.correctionApplied).toBe(false);
    expect(r.epcIndexationFactor).toBe(1);
    expect(r.correctionMonth).toBeNull();
  });

  it("does not correct leases started on 2022-10-01", async () => {
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    mockIndices({ "2026-09": 139.33 });
    const r = await computeIndexationCore({ ...realLease, startDate: "2022-10-01" });
    expect(r.newRent).toBe(r.unrestrictedNewRent);
    expect(r.newRent).toBe(862.98);
    expect(r.correctionApplied).toBe(false);
  });

  it("does not correct leases started after 2022-10-01", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore({ ...realLease, startDate: "2023-05-01" });
    expect(r.newRent).toBe(r.unrestrictedNewRent);
    expect(r.newRent).toBe(862.98);
    expect(r.correctionApplied).toBe(false);
  });

  it("leaves Wallonia unchanged", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore({ ...realLease, region: "wallonia" });
    expect(r.newRent).toBe(862.98);
    expect(r.correctionApplied).toBe(false);
    expect(r.correctionMonth).toBeNull();
  });

  it("leaves the Brussels rule unchanged", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    mockIndices({ "2026-04": 139.33 });
    const r = await computeIndexationCore({ ...realLease, region: "brussels" });
    const factor = BRUSSELS_EPC_INDEXATION_FACTOR["E"]!;
    const expected = factor >= 1 ? 862.98 : round2(675 + (862.98 - 675) * factor);
    expect(r.newRent).toBe(expected);
    expect(r.correctionApplied).toBe(false);
    expect(r.correctionMonth).toBeNull();
    expect(r.formulaNote ?? "").not.toContain("anniversary");
  });

  it("keeps the freeze-period rule (EPC D gets 50% of the increase)", async () => {
    vi.setSystemTime(new Date("2023-06-01T12:00:00Z"));
    mockIndices({ "2023-04": 128.5 });
    const r = await computeIndexationCore({ ...realLease, epcLabel: "D" });
    expect(r.newRent).toBe(round2(675 + (r.unrestrictedNewRent - 675) * 0.5));
    expect(r.correctionApplied).toBe(false);
  });
});

describe("firstDueOnOrAfter", () => {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  it("moves a late indexation to the first of next month", () => {
    expect(ymd(firstDueOnOrAfter(new Date(2026, 9, 22), 1))).toBe("2026-11-01");
  });

  it("keeps a due date that falls on the start day", () => {
    expect(ymd(firstDueOnOrAfter(new Date(2026, 4, 1), 1))).toBe("2026-05-01");
  });

  it("uses a later payment day in the same month when it is still ahead", () => {
    expect(ymd(firstDueOnOrAfter(new Date(2026, 9, 22), 25))).toBe("2026-10-25");
  });

  it("caps the payment day in short months", () => {
    expect(ymd(firstDueOnOrAfter(new Date(2027, 1, 2), 31))).toBe("2027-02-28");
  });

  it("rolls over the year end", () => {
    expect(ymd(firstDueOnOrAfter(new Date(2026, 11, 15), 1))).toBe("2027-01-01");
  });
});
