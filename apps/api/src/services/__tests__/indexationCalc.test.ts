import { describe, it, expect, vi } from "vitest";

vi.mock("../healthIndex", () => ({
  getHealthIndexValue: vi.fn(),
  getLatestHealthIndex: vi.fn(),
}));

import { getIndexationApplicability } from "../indexationCalc";

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
