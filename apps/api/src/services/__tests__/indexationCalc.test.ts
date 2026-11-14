import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../healthIndex", () => ({
  getHealthIndexValue: vi.fn(),
  getLatestHealthIndex: vi.fn(),
}));

import { getHealthIndexValue, getLatestHealthIndex } from "../healthIndex";
import {
  firstDueOnOrAfter,
  computeEffectiveDateOptions,
  computeIndexationCore,
  getFlandersCorrectionFactor,
  getIndexationApplicability,
  brusselsAnniversaryPeriod,
  isBrusselsLabelBetterThanE,
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

  it("keeps the freeze-period rule (EPC D gets 50% of the increase)", async () => {
    vi.setSystemTime(new Date("2023-06-01T12:00:00Z"));
    mockIndices({ "2023-04": 128.5 });
    const r = await computeIndexationCore({ ...realLease, epcLabel: "D" });
    expect(r.newRent).toBe(round2(675 + (r.unrestrictedNewRent - 675) * 0.5));
    expect(r.correctionApplied).toBe(false);
  });
});

// Brussels correction factor (Housing Code art. 224/2). Expected rents are
// worked out by hand from the official table, never read from the constants.
// Every case uses base rent 1000 and base index 110.11, and a new index of
// 140.00, so the standard indexed rent is 1000 x 140.00 / 110.11 = 1271.4558,
// rounded 1271.46.
describe("computeIndexationCore: Brussels EPB correction factor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getHealthIndexValue).mockReset();
    vi.mocked(getLatestHealthIndex).mockReset();
  });

  const bxl = {
    baseRent: 1000,
    baseIndex: 110.11,
    region: "brussels",
    leaseType: "residential_long",
    leaseRegistered: true,
  };

  // November anniversary: indexation in November 2026 uses the October 2026 index.
  async function november(startDate: string, epcLabel: string | null, extra: Record<string, unknown> = {}) {
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    mockIndices({ "2026-10": 140.0 });
    return computeIndexationCore({ ...bxl, startDate, epcLabel, ...extra });
  }

  it("indexes EPB C in full, old or new lease", async () => {
    for (const start of ["2021-11-10", "2023-11-10"]) {
      const r = await november(start, "C");
      expect(r.unrestrictedNewRent).toBe(1271.46);
      expect(r.newRent).toBe(1271.46);
      expect(r.epcIndexationFactor).toBe(1);
      expect(r.epcRestricted).toBe(false);
      expect(r.indexationBlocked).toBeNull();
    }
  });

  it("indexes EPB D in full, old or new lease", async () => {
    for (const start of ["2021-11-10", "2023-11-10"]) {
      const r = await november(start, "D");
      expect(r.newRent).toBe(1271.46);
      expect(r.epcIndexationFactor).toBe(1);
      expect(r.epcRestricted).toBe(false);
    }
  });

  it("multiplies the whole indexed rent for an old E lease (November)", async () => {
    // 1271.46 x 0.945356473 = 1201.9829 -> 1201.98
    const r = await november("2021-11-10", "E");
    expect(r.newRent).toBe(1201.98);
    expect(r.epcIndexationFactor).toBe(0.945356473);
    expect(r.epcRestricted).toBe(true);
    expect(r.correctionApplied).toBe(true);
    expect(r.brussels?.anniversaryPeriod).toBe("11");
    expect(r.brussels?.factorFromLease).toBe(false);
  });

  it("does not floor below the base rent beyond the standard indexed rent", async () => {
    // Index 112.00: 1000 x 112 / 110.11 = 1017.16; x 0.890712946 (F, November)
    // = 906.00, below the base rent 1000, so the result is the base rent.
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    mockIndices({ "2026-10": 112.0 });
    const r = await computeIndexationCore({ ...bxl, startDate: "2021-11-10", epcLabel: "F" });
    expect(r.unrestrictedNewRent).toBe(1017.16);
    expect(r.newRent).toBe(1000);
  });

  it("applies the F/G factor for a February anniversary (not zero)", async () => {
    // 1271.46 x 0.923515625 = 1174.2132 -> 1174.21
    vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
    mockIndices({ "2026-01": 140.0 });
    for (const label of ["F", "G"]) {
      const r = await computeIndexationCore({ ...bxl, startDate: "2021-02-10", epcLabel: label });
      expect(r.unrestrictedNewRent).toBe(1271.46);
      expect(r.newRent).toBe(1174.21);
      expect(r.epcIndexationFactor).toBe(0.923515625);
    }
  });

  it("indexes a G lease that took effect on or after 14 October 2022 in full", async () => {
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    mockIndices({ "2026-09": 140.0, "2026-02": 140.0 });
    const a = await computeIndexationCore({ ...bxl, startDate: "2022-10-14", epcLabel: "G", today: new Date(2026, 9, 20) });
    expect(a.newRent).toBe(1271.46);
    expect(a.epcRestricted).toBe(false);
    const b = await computeIndexationCore({ ...bxl, startDate: "2023-03-01", epcLabel: "G", today: new Date(2026, 2, 20) });
    expect(b.newRent).toBe(1271.46);
    expect(b.epcRestricted).toBe(false);
  });

  it("splits at 14 October 2022: the 13th is corrected, the 14th is not", async () => {
    mockIndices({ "2026-09": 140.0 });
    const today = new Date(2026, 9, 20);
    // 2022-10-13, F, anniversary 1 to 13 October: 1271.46 x 0.979611041 = 1245.5363 -> 1245.54
    const before = await computeIndexationCore({ ...bxl, startDate: "2022-10-13", epcLabel: "F", today });
    expect(before.newRent).toBe(1245.54);
    expect(before.epcRestricted).toBe(true);
    expect(before.brussels?.anniversaryPeriod).toBe("10a");
    const on = await computeIndexationCore({ ...bxl, startDate: "2022-10-14", epcLabel: "F", today });
    expect(on.newRent).toBe(1271.46);
    expect(on.epcRestricted).toBe(false);
  });

  it("uses the 1 to 13 October row for an early October anniversary", async () => {
    mockIndices({ "2026-09": 140.0 });
    const today = new Date(2026, 9, 20);
    // E: 1271.46 x 0.989805521 = 1258.4981 -> 1258.50
    const e = await computeIndexationCore({ ...bxl, startDate: "2021-10-05", epcLabel: "E", today });
    expect(e.newRent).toBe(1258.5);
    expect(e.epcIndexationFactor).toBe(0.989805521);
    // G: 1271.46 x 0.979611041 = 1245.5363 -> 1245.54
    const g = await computeIndexationCore({ ...bxl, startDate: "2021-10-05", epcLabel: "G", today });
    expect(g.newRent).toBe(1245.54);
    expect(g.epcIndexationFactor).toBe(0.979611041);
  });

  it("uses the 14 to 31 October row for a late October anniversary", async () => {
    mockIndices({ "2026-09": 140.0 });
    const today = new Date(2026, 9, 25);
    // E: 1271.46 x 0.949447646 = 1207.1847 -> 1207.18
    const e = await computeIndexationCore({ ...bxl, startDate: "2021-10-20", epcLabel: "E", today });
    expect(e.newRent).toBe(1207.18);
    expect(e.epcIndexationFactor).toBe(0.949447646);
    expect(e.brussels?.anniversaryPeriod).toBe("10b");
    // F: 1271.46 x 0.898895293 = 1142.9094 -> 1142.91
    const f = await computeIndexationCore({ ...bxl, startDate: "2021-10-20", epcLabel: "F", today });
    expect(f.newRent).toBe(1142.91);
    expect(f.epcIndexationFactor).toBe(0.898895293);
  });

  it("blocks indexation without an EPB certificate", async () => {
    const r = await november("2021-11-10", null, { currentRent: 1100 });
    expect(r.indexationBlocked).toBe("brussels_no_epc");
    expect(r.newRent).toBe(1100);
    expect(r.epcRestricted).toBe(true);
  });

  it("blocks indexation of a lease that is not registered", async () => {
    const r = await november("2021-11-10", "B", { leaseRegistered: false, currentRent: 1100 });
    expect(r.indexationBlocked).toBe("brussels_not_registered");
    expect(r.newRent).toBe(1100);
    const unknown = await november("2023-11-10", "A", { leaseRegistered: undefined });
    expect(unknown.indexationBlocked).toBe("brussels_not_registered");
    expect(unknown.newRent).toBe(1000);
  });

  it("keeps using a stored factor after the label changed to D", async () => {
    // Factor stored at an earlier indexation while the label was E (November).
    // The property now shows D, but no better certificate cleared the factor.
    // 1271.46 x 0.945356473 -> 1201.98
    const r = await november("2021-11-10", "D", { brusselsEpcFactor: 0.945356473 });
    expect(r.newRent).toBe(1201.98);
    expect(r.brussels?.factorFromLease).toBe(true);
  });

  it("indexes in full once a better certificate cleared the stored factor", async () => {
    expect(isBrusselsLabelBetterThanE("C")).toBe(true);
    expect(isBrusselsLabelBetterThanE("D")).toBe(true);
    expect(isBrusselsLabelBetterThanE("E")).toBe(false);
    expect(isBrusselsLabelBetterThanE("G")).toBe(false);
    expect(isBrusselsLabelBetterThanE(null)).toBe(false);
    const r = await november("2021-11-10", "C", { brusselsEpcFactor: null });
    expect(r.newRent).toBe(1271.46);
    expect(r.epcRestricted).toBe(false);
  });

  it("never lets a stored factor raise the rent above the standard indexed rent", async () => {
    const r = await november("2021-11-10", "E", { brusselsEpcFactor: 1.5 });
    // An out-of-range stored value is ignored and the table value is used.
    expect(r.newRent).toBe(1201.98);
  });
});

describe("brusselsAnniversaryPeriod", () => {
  it("splits October at the 14th", () => {
    expect(brusselsAnniversaryPeriod("2021-10-13")).toBe("10a");
    expect(brusselsAnniversaryPeriod("2021-10-14")).toBe("10b");
    expect(brusselsAnniversaryPeriod("2021-10-01")).toBe("10a");
    expect(brusselsAnniversaryPeriod("2021-10-31")).toBe("10b");
    expect(brusselsAnniversaryPeriod("2021-01-01")).toBe("1");
    expect(brusselsAnniversaryPeriod("2021-12-31")).toBe("12");
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
