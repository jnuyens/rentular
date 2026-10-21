import { describe, it, expect } from "vitest";
import { computeIndexReferenceMonth } from "@rentular/shared/validation";

describe("computeIndexReferenceMonth", () => {
  it("uses the month before the start date in Flanders for contracts signed from 2019", () => {
    expect(computeIndexReferenceMonth("flanders", "2019-04-05", "2019-05-01")).toBe("2019-04");
  });

  it("uses the month before the start date in Brussels for contracts signed from 2019", () => {
    expect(computeIndexReferenceMonth("brussels", "2019-04-05", "2019-05-01")).toBe("2019-04");
  });

  it("always uses the month before signing in Wallonia", () => {
    expect(computeIndexReferenceMonth("wallonia", "2019-04-05", "2019-05-01")).toBe("2019-03");
  });

  it("uses the month before signing for contracts signed before 2019", () => {
    expect(computeIndexReferenceMonth("flanders", "2018-12-20", "2019-02-01")).toBe("2018-11");
  });

  it("falls back to the start date when the signing date is missing", () => {
    expect(computeIndexReferenceMonth("wallonia", null, "2019-05-01")).toBe("2019-04");
  });

  it("returns null when both dates are missing or invalid", () => {
    expect(computeIndexReferenceMonth("flanders", null, null)).toBeNull();
    expect(computeIndexReferenceMonth("flanders", "not-a-date", "")).toBeNull();
    expect(computeIndexReferenceMonth(undefined, undefined, undefined)).toBeNull();
  });

  it("wraps January to December of the previous year", () => {
    expect(computeIndexReferenceMonth("flanders", "2019-01-15", "2019-01-01")).toBe("2018-12");
  });
});
