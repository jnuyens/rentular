import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../healthIndex", () => ({
  getHealthIndexValue: vi.fn(),
  getLatestHealthIndex: vi.fn(),
}));

import { BRUSSELS_EPC_INDEXATION_FACTOR } from "@rentular/shared/constants";
import { getHealthIndexValue, getLatestHealthIndex } from "../healthIndex";
import {
  firstDueOnOrAfter,
  computeEffectiveDateOptions,
  computeIndexationCore,
  getFlandersCorrectionFactor,
  getIndexationApplicability,
} from "../indexationCalc";
import { alertCycleDate } from "../indexationAlerts";

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

describe("computeEffectiveDateOptions", () => {
  const today = new Date(2026, 9, 21);

  it("limits residential back-indexation to 3 months before today", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-05-01",
      paymentDay: 1,
      leaseType: "residential_long",
      today,
      applicable: true,
    });
    expect(r.effectiveDate).toBe("2026-11-01");
    expect(r.options).toEqual(["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"]);
    expect(r.options[0]).toBe(r.effectiveDate);
  });

  it("never goes back past the due date on or after the anniversary", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-09-01",
      paymentDay: 1,
      leaseType: "residential_long",
      today,
      applicable: true,
    });
    expect(r.options).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
  });

  it("lets a commercial lease go back to the anniversary", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-01-01",
      paymentDay: 1,
      leaseType: "commercial",
      today,
      applicable: true,
    });
    expect(r.options).toHaveLength(11);
    expect(r.options[0]).toBe("2026-11-01");
    expect(r.options[10]).toBe("2026-01-01");
    const sorted = [...r.options].sort().reverse();
    expect(r.options).toEqual(sorted);
  });

  it("follows a payment day other than the 1st", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-05-15",
      paymentDay: 15,
      leaseType: "residential_long",
      today,
      applicable: true,
    });
    expect(r.options).toEqual(["2026-11-15", "2026-10-15", "2026-09-15", "2026-08-15"]);
  });

  it("caps the payment day in short months", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-01-31",
      paymentDay: 31,
      leaseType: "residential_long",
      today: new Date(2026, 3, 15),
      applicable: true,
    });
    expect(r.options).toEqual(["2026-04-30", "2026-03-31", "2026-02-28", "2026-01-31"]);
  });

  it("offers only the default date when the anniversary is still ahead", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-12-01",
      paymentDay: 1,
      leaseType: "residential_long",
      today,
      applicable: true,
    });
    expect(r.effectiveDate).toBe("2026-12-01");
    expect(r.options).toEqual(["2026-12-01"]);
  });

  it("offers only the default date when indexation cannot be applied", () => {
    const r = computeEffectiveDateOptions({
      indexationDate: "2026-05-01",
      paymentDay: 1,
      leaseType: "residential_long",
      today,
      applicable: false,
    });
    expect(r.options).toEqual([r.effectiveDate]);
    expect(r.effectiveDate).toBe("2026-11-01");
  });
});

describe("computeIndexationCore: effective date options", () => {
  beforeEach(() => {
    mockIndices({ "2026-04": 139.33 });
  });
  afterEach(() => {
    vi.mocked(getHealthIndexValue).mockReset();
    vi.mocked(getLatestHealthIndex).mockReset();
  });

  const today = new Date(2026, 9, 21);

  it("gives a residential lease up to 3 months of back-indexation", async () => {
    const r = await computeIndexationCore({ ...realLease, today });
    expect(r.indexationDate).toBe("2026-05-01");
    expect(r.effectiveDate).toBe("2026-11-01");
    expect(r.effectiveDateOptions[0]).toBe(r.effectiveDate);
    expect(r.effectiveDateOptions).toHaveLength(4);
    expect(r.effectiveDateOptions[3]).toBe("2026-08-01");
  });

  it("gives a commercial lease every due date back to the anniversary", async () => {
    const r = await computeIndexationCore({
      ...realLease,
      leaseType: "commercial",
      today,
    });
    expect(r.effectiveDateOptions).toHaveLength(7);
    expect(r.effectiveDateOptions[0]).toBe("2026-11-01");
    expect(r.effectiveDateOptions[6]).toBe("2026-05-01");
  });

  it("starts on the 1st of the month whatever day the lease started", async () => {
    const r = await computeIndexationCore({ ...realLease, startDate: "2019-10-15", today });
    expect(r.indexationDate).toBe("2026-10-15");
    expect(r.effectiveDate).toBe("2026-11-01");
    expect(r.effectiveDateOptions).toEqual(["2026-11-01"]);
  });

  it("offers only the first anniversary for a first-year lease", async () => {
    const r = await computeIndexationCore({
      ...realLease,
      startDate: "2026-03-01",
      today,
    });
    expect(r.effectiveDate).toBe("2027-03-01");
    expect(r.indexationDate).toBe(r.effectiveDate);
    expect(r.effectiveDateOptions).toEqual([r.effectiveDate]);
  });
});

describe("applicability after an anniversary-based last indexation", () => {
  it("waits a full year from the anniversary, not from the chosen start", () => {
    const before = getIndexationApplicability({
      startDate: "2019-05-01",
      lastIndexationDate: "2026-05-01",
      today: new Date(2026, 10, 15),
    });
    expect(before).toEqual({ canApply: false, applicableFrom: "2027-05-01" });

    const on = getIndexationApplicability({
      startDate: "2019-05-01",
      lastIndexationDate: "2026-05-01",
      today: new Date(2027, 4, 1),
    });
    expect(on.canApply).toBe(true);
  });

  it("keys the alert cycle on the anniversary", () => {
    expect(alertCycleDate("2019-05-01", "2027-05-01", new Date(2027, 5, 1))).toBe("2027-05-01");
  });
});
