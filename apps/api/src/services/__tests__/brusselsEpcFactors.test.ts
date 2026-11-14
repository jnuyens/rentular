import { describe, it, expect } from "vitest";
import {
  BRUSSELS_EPC_CORRECTION_FACTORS,
  type BrusselsAnniversaryPeriod,
} from "@rentular/shared/constants";

// Guards the Brussels correction factor table two ways, so it can never drift.
//
// 1. The official table, copied digit for digit from
//    https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor
//    (and the NL page) on 2026-11-14.
// 2. A recomputation from the Belgian health index (base 2013) published by
//    Statbel (open data "CPI All base years", column MS_HLTH_IDX), using the
//    formulas of the ordinance of 13 October 2023. The factors are fixed by
//    that ordinance (2021 to 2023 indices) and do not change with new months.

const OFFICIAL: Record<BrusselsAnniversaryPeriod, { e: number; fg: number }> = {
  "10b": { e: 0.949447646, fg: 0.898895293 },
  "11": { e: 0.945356473, fg: 0.890712946 },
  "12": { e: 0.951977401, fg: 0.903954802 },
  "1": { e: 0.951950895, fg: 0.903901791 },
  "2": { e: 0.961757813, fg: 0.923515625 },
  "3": { e: 0.967996216, fg: 0.935992433 },
  "4": { e: 0.965766823, fg: 0.931533646 },
  "5": { e: 0.971941594, fg: 0.943883189 },
  "6": { e: 0.972124068, fg: 0.944248135 },
  "7": { e: 0.976119286, fg: 0.952238571 },
  "8": { e: 0.977109655, fg: 0.954219311 },
  "9": { e: 0.980049682, fg: 0.960099363 },
  "10a": { e: 0.989805521, fg: 0.979611041 },
};

// Statbel health index, base 2013, as published (two decimals).
const HEALTH_INDEX: Record<string, number> = {
  "2021-09": 112.29, "2021-10": 113.94, "2021-11": 115.2, "2021-12": 115.6,
  "2022-01": 118.21, "2022-02": 118.74, "2022-03": 119.05, "2022-04": 119.59,
  "2022-05": 120.25, "2022-06": 121.02, "2022-07": 122.35, "2022-08": 123.68,
  "2022-09": 124.92, "2022-10": 127.92, "2022-11": 127.44, "2022-12": 127.89,
  "2023-01": 128.0, "2023-02": 126.86, "2023-03": 127.8, "2023-04": 126.7,
  "2023-05": 127.35, "2023-06": 127.09, "2023-07": 128.22, "2023-08": 128.82,
  "2023-09": 127.52,
};

/**
 * The two health index months a period's factor is built from: the month
 * before the anniversary month, in the two reference years. Anniversaries from
 * 14 October to 31 December use 2021 and 2022, the others 2022 and 2023.
 */
function referenceMonths(period: BrusselsAnniversaryPeriod): [string, string] {
  const month = period === "10a" || period === "10b" ? 10 : Number(period);
  const late = period === "10b" || month === 11 || month === 12;
  const [y1, y2] = late ? [2021, 2022] : [2022, 2023];
  const prevMonth = month === 1 ? 12 : month - 1;
  const shift = month === 1 ? 1 : 0;
  const mm = String(prevMonth).padStart(2, "0");
  return [`${y1 - shift}-${mm}`, `${y2 - shift}-${mm}`];
}

const periods = Object.keys(OFFICIAL) as BrusselsAnniversaryPeriod[];

describe("Brussels EPB correction factors", () => {
  it("cover all thirteen anniversary periods", () => {
    expect(Object.keys(BRUSSELS_EPC_CORRECTION_FACTORS).sort()).toEqual([...periods].sort());
  });

  it.each(periods)("period %s matches the official table digit for digit", (p) => {
    expect(BRUSSELS_EPC_CORRECTION_FACTORS[p]).toEqual(OFFICIAL[p]);
  });

  it.each(periods)("period %s matches a recomputation from the Statbel health index", (p) => {
    const [m1, m2] = referenceMonths(p);
    const older = HEALTH_INDEX[m1];
    const newer = HEALTH_INDEX[m2];
    expect(older, `missing health index ${m1}`).toBeDefined();
    expect(newer, `missing health index ${m2}`).toBeDefined();
    const e = (0.5 * (older! + newer!)) / newer!;
    const fg = older! / newer!;
    expect(Math.abs(BRUSSELS_EPC_CORRECTION_FACTORS[p].e - e)).toBeLessThan(1e-6);
    expect(Math.abs(BRUSSELS_EPC_CORRECTION_FACTORS[p].fg - fg)).toBeLessThan(1e-6);
  });

  it("reproduces the worked example on the official page (E, November)", () => {
    // 50% x (113.94 + 127.92) / 127.92 = 0.945356473
    expect(BRUSSELS_EPC_CORRECTION_FACTORS["11"].e).toBe(0.945356473);
    // 1000 x 128.30 / 110.11 = 1165.19; x 0.945356473 = 1101.52
    expect(Math.round(1165.19 * BRUSSELS_EPC_CORRECTION_FACTORS["11"].e * 100) / 100).toBe(1101.52);
  });
});
