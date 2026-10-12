import { describe, it, expect } from "vitest";
import {
  deductionsForDueDate,
  deductedAmount,
  periodRentDue,
  periodEndFor,
  type DeductionRow,
  type FreePeriodRow,
} from "../rentDeductions";

function ded(
  id: string,
  type: "temporary" | "permanent",
  amount: number,
  startDate: string,
  endDate: string | null,
): DeductionRow {
  return { id, type, amount: amount.toFixed(2), startDate, endDate, reason: `reason ${id}` };
}

function free(waiveCharges: boolean): FreePeriodRow {
  return { id: "f1", startDate: "2026-10-01", endDate: "2026-10-31", waiveCharges, reason: "works" };
}

describe("deductionsForDueDate", () => {
  it("applies a temporary deduction only inside its range", () => {
    const rows = [ded("t", "temporary", 10, "2026-10-08", "2026-11-07")];
    expect(deductionsForDueDate(rows, "2026-10-07")).toEqual([]);
    expect(deductionsForDueDate(rows, "2026-10-08")).toHaveLength(1);
    expect(deductionsForDueDate(rows, "2026-11-07")).toHaveLength(1);
    expect(deductionsForDueDate(rows, "2026-11-08")).toEqual([]);
  });

  it("applies a permanent deduction from its start date onward", () => {
    const rows = [ded("p", "permanent", 10, "2026-01-01", null)];
    expect(deductionsForDueDate(rows, "2025-12-31")).toEqual([]);
    expect(deductionsForDueDate(rows, "2026-01-01")).toHaveLength(1);
    expect(deductionsForDueDate(rows, "2030-06-01")).toHaveLength(1);
  });

  it("returns both when a temporary and a permanent deduction apply", () => {
    const rows = [
      ded("t", "temporary", 10.1, "2026-10-01", "2026-10-31"),
      ded("p", "permanent", 20.2, "2026-01-01", null),
    ];
    expect(deductionsForDueDate(rows, "2026-10-15")).toHaveLength(2);
    expect(deductedAmount(rows, "2026-10-15")).toBe(30.3);
  });

  it("handles datetime-shaped strings by comparing the date part", () => {
    const rows = [ded("t", "temporary", 10, "2026-10-08T00:00:00", "2026-11-07T00:00:00")];
    expect(deductionsForDueDate(rows, "2026-10-08T00:00:00.000Z")).toHaveLength(1);
  });
});

describe("periodRentDue", () => {
  const base = { monthlyRent: 1050, charges: 0, dueDate: "2026-10-08" };

  it("subtracts an applicable deduction", () => {
    const r = periodRentDue({
      ...base,
      deductions: [ded("d", "temporary", 513.92, "2026-10-08", "2026-11-07")],
      freePeriods: [],
    });
    expect(r.rentDue).toBe(536.08);
    expect(r.grossRentDue).toBe(1050);
    expect(r.deductions).toEqual([{ id: "d", amount: 513.92, reason: "reason d" }]);
    expect(r.rentFree).toBe(false);
  });

  it("never goes negative", () => {
    const r = periodRentDue({
      ...base,
      deductions: [ded("d", "permanent", 2000, "2026-01-01", null)],
      freePeriods: [],
    });
    expect(r.rentDue).toBe(0);
  });

  it("keeps charges during a rent-free period that does not waive them", () => {
    const r = periodRentDue({
      monthlyRent: 1000,
      charges: 75,
      dueDate: "2026-10-01",
      deductions: [],
      freePeriods: [free(false)],
    });
    expect(r.rentDue).toBe(75);
    expect(r.rentFree).toBe(true);
  });

  it("is zero during a rent-free period that waives charges", () => {
    const r = periodRentDue({
      monthlyRent: 1000,
      charges: 75,
      dueDate: "2026-10-01",
      deductions: [],
      freePeriods: [free(true)],
    });
    expect(r.rentDue).toBe(0);
  });

  it("is rent plus charges without adjustments", () => {
    const r = periodRentDue({
      monthlyRent: 1000,
      charges: 75,
      dueDate: "2026-10-01",
      deductions: [],
      freePeriods: [],
    });
    expect(r.rentDue).toBe(1075);
    expect(r.grossRentDue).toBe(1075);
    expect(r.deductions).toEqual([]);
  });
});

describe("periodEndFor", () => {
  it("ends the day before the next due date", () => {
    expect(periodEndFor("2026-10-08", 8)).toBe("2026-11-07");
  });

  it("clamps the next due date to the month length", () => {
    // Next due is Feb 28 2026, so the period ends Feb 27.
    expect(periodEndFor("2026-01-31", 31)).toBe("2026-02-27");
  });

  it("crosses the year end", () => {
    expect(periodEndFor("2026-12-01", 1)).toBe("2026-12-31");
  });
});
