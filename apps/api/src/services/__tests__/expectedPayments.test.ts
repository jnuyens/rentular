import { describe, it, expect } from "vitest";
import { computeExpectedDueDates } from "../expectedPayments";

describe("computeExpectedDueDates", () => {
  it("returns only the next upcoming due date by default", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // payment day 1 -> Sept 1 already passed, so the next upcoming is Oct 1 (only).
    const dates = computeExpectedDueDates(1, undefined, today);
    expect(dates).toEqual(["2026-10-01"]);
  });

  it("never returns a past-due date", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    const dates = computeExpectedDueDates(1, undefined, today, 3);
    for (const d of dates) {
      expect(d >= "2026-09-27").toBe(true);
    }
    // Next 3 upcoming after Sept 27, payment day 1.
    expect(dates).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });

  it("includes the current month when its due date is today or later", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // payment day 28 -> Sept 28 is >= today, so it is the next upcoming.
    const dates = computeExpectedDueDates(28, undefined, today);
    expect(dates).toEqual(["2026-09-28"]);
  });

  it("includes the current month when the due date is exactly today", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    const dates = computeExpectedDueDates(27, undefined, today);
    expect(dates).toEqual(["2026-09-27"]);
  });

  it("clamps the day to the last day of the month (e.g. February)", () => {
    const today = new Date(2027, 0, 15); // 15 Jan 2027
    // payment day 31 -> Jan 31, then Feb 28 (2027 not a leap year).
    const dates = computeExpectedDueDates(31, undefined, today, 2);
    expect(dates).toEqual(["2027-01-31", "2027-02-28"]);
  });

  it("clamps the day to 29 for February in a leap year", () => {
    const today = new Date(2028, 1, 1); // 1 Feb 2028 (leap year)
    const dates = computeExpectedDueDates(31, undefined, today);
    expect(dates).toEqual(["2028-02-29"]);
  });

  it("excludes months before the lease start date", () => {
    const today = new Date(2026, 8, 27); // 27 Sept 2026
    // Lease starts 1 Nov 2026 -> Sept and Oct excluded, next upcoming is Nov 1.
    const dates = computeExpectedDueDates(1, "2026-11-01", today, 2);
    expect(dates).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("defaults an invalid payment day to 1", () => {
    const today = new Date(2026, 8, 1); // 1 Sept 2026
    const dates = computeExpectedDueDates(0, undefined, today);
    expect(dates).toEqual(["2026-09-01"]);
  });

  it("rolls the year over into the next January", () => {
    const today = new Date(2026, 10, 20); // 20 Nov 2026
    // Nov 10 already passed -> next upcoming is Dec 10 2026, then Jan 10 2027.
    const dates = computeExpectedDueDates(10, undefined, today, 2);
    expect(dates).toEqual(["2026-12-10", "2027-01-10"]);
  });
});
