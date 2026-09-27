import { describe, it, expect } from "vitest";
import { computeExpectedDueDates } from "../expectedPayments";

describe("computeExpectedDueDates", () => {
  it("never returns a past-due date", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // payment day 1 -> this month's due (Sept 1) is in the past, must be skipped
    const dates = computeExpectedDueDates(1, undefined, today, 2);
    for (const d of dates) {
      expect(d >= "2026-09-27").toBe(true);
    }
    // Sept is skipped (1st already passed); Oct 1 and Nov 1 remain
    expect(dates).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("includes the current month when its due date is today or later", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // payment day 28 -> Sept 28 is >= today, so it is included
    const dates = computeExpectedDueDates(28, undefined, today, 2);
    expect(dates[0]).toBe("2026-09-28");
    expect(dates).toEqual(["2026-09-28", "2026-10-28", "2026-11-28"]);
  });

  it("includes the current month when the due date is exactly today", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    const dates = computeExpectedDueDates(27, undefined, today, 0);
    expect(dates).toEqual(["2026-09-27"]);
  });

  it("clamps the day to the last day of the month (e.g. February)", () => {
    const today = new Date(2027, 0, 15); // 15 Jan 2027
    // payment day 31 -> Jan 31, Feb 28 (2027 not a leap year), Mar 31
    const dates = computeExpectedDueDates(31, undefined, today, 2);
    expect(dates).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("clamps the day to 29 for February in a leap year", () => {
    const today = new Date(2028, 1, 1); // 1 Feb 2028 (leap year)
    const dates = computeExpectedDueDates(31, undefined, today, 0);
    expect(dates).toEqual(["2028-02-29"]);
  });

  it("excludes months before the lease start date", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // Lease starts 1 Nov 2026 -> Sept and Oct excluded, Nov included
    const dates = computeExpectedDueDates(1, "2026-11-01", today, 2);
    expect(dates).toEqual(["2026-11-01"]);
  });

  it("respects monthsAhead = 0 (current month only)", () => {
    const today = new Date(2026, 8, 1); // 1 Sept 2026
    const dates = computeExpectedDueDates(15, undefined, today, 0);
    expect(dates).toEqual(["2026-09-15"]);
  });

  it("defaults an invalid payment day to 1", () => {
    const today = new Date(2026, 8, 1); // 1 Sept 2026
    const dates = computeExpectedDueDates(0, undefined, today, 0);
    expect(dates).toEqual(["2026-09-01"]);
  });

  it("rolls the year over into the next January", () => {
    const today = new Date(2026, 10, 20); // 20 Nov 2026
    const dates = computeExpectedDueDates(10, undefined, today, 2);
    // Nov 10 already passed -> skipped; Dec 10 2026, Jan 10 2027
    expect(dates).toEqual(["2026-12-10", "2027-01-10"]);
  });
});
