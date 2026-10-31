import { describe, it, expect } from "vitest";
import {
  formatEur,
  formatIndexValue,
  formatShortDate,
  formatLongDate,
  formatMonthYear,
  formatCountry,
  formatHouseNumber,
  MONTH_NAMES,
} from "../belgianFormat";

describe("formatEur", () => {
  it("uses a dot for thousands and a comma for cents", () => {
    expect(formatEur(1150)).toBe("€ 1.150,00");
    expect(formatEur(787.9)).toBe("€ 787,90");
    expect(formatEur(675)).toBe("€ 675,00");
    expect(formatEur(1234567.891)).toBe("€ 1.234.567,89");
  });
});

describe("formatIndexValue", () => {
  it("prints two decimals with a comma", () => {
    expect(formatIndexValue(108.98)).toBe("108,98");
    expect(formatIndexValue(126.7)).toBe("126,70");
  });
});

describe("formatShortDate", () => {
  it("prints dd/mm/yyyy", () => {
    expect(formatShortDate("2019-04-05")).toBe("05/04/2019");
  });
});

describe("formatLongDate", () => {
  it("writes the month out in the tenant language", () => {
    expect(formatLongDate("2019-04-05", "nl")).toBe("5 april 2019");
    expect(formatLongDate("2019-04-05", "en")).toBe("5 April 2019");
    expect(formatLongDate("2019-04-05", "fr")).toBe("5 avril 2019");
    expect(formatLongDate("2019-04-05", "de")).toBe("5. April 2019");
  });

  it("uses 1er for the first of the month in French", () => {
    expect(formatLongDate("2025-06-01", "fr")).toBe("1er juin 2025");
    expect(formatLongDate("2025-06-01", "nl")).toBe("1 juni 2025");
  });

  it("falls back to English for an unknown language", () => {
    expect(formatLongDate("2019-04-05", "xx")).toBe("5 April 2019");
  });
});

describe("formatMonthYear", () => {
  it("writes month and year", () => {
    expect(formatMonthYear("2019-04", "nl")).toBe("april 2019");
    expect(formatMonthYear("2019-04", "fr")).toBe("avril 2019");
    expect(formatMonthYear("2019-04", "de")).toBe("April 2019");
    expect(formatMonthYear("2019-04", "en")).toBe("April 2019");
  });
});

describe("MONTH_NAMES", () => {
  it("has twelve months per language", () => {
    for (const lang of ["nl", "fr", "de", "en"] as const) {
      expect(MONTH_NAMES[lang]).toHaveLength(12);
    }
    expect(MONTH_NAMES.nl[4]).toBe("mei");
  });
});

describe("formatCountry", () => {
  it("names Belgium in each language", () => {
    expect(formatCountry("BE", "nl")).toBe("België");
    expect(formatCountry("BE", "fr")).toBe("Belgique");
    expect(formatCountry("BE", "de")).toBe("Belgien");
    expect(formatCountry("BE", "en")).toBe("Belgium");
  });

  it("knows the neighbouring countries", () => {
    expect(formatCountry("NL", "nl")).toBe("Nederland");
    expect(formatCountry("LU", "fr")).toBe("Luxembourg");
    expect(formatCountry("de", "de")).toBe("Deutschland");
    expect(formatCountry("FR", "en")).toBe("France");
  });

  it("passes unknown codes through", () => {
    expect(formatCountry("ES", "nl")).toBe("ES");
  });
});

describe("formatHouseNumber", () => {
  it("adds the box word in the reader's language", () => {
    expect(formatHouseNumber("65", "102", "nl")).toBe("65 bus 102");
    expect(formatHouseNumber("65", "102", "fr")).toBe("65 boîte 102");
    expect(formatHouseNumber("65", "102", "de")).toBe("65 Bus 102");
    expect(formatHouseNumber("65", "102", "en")).toBe("65 box 102");
  });
  it("leaves the number alone without a box", () => {
    expect(formatHouseNumber("97", null, "nl")).toBe("97");
    expect(formatHouseNumber("97", "  ", "fr")).toBe("97");
  });
  it("does not double a prefix the landlord already typed", () => {
    expect(formatHouseNumber("65", "b102", "fr")).toBe("65 boîte 102");
    expect(formatHouseNumber("65", "bus 3", "nl")).toBe("65 bus 3");
    expect(formatHouseNumber("65", "bte. 4", "fr")).toBe("65 boîte 4");
  });
  it("keeps boxes that only look like a prefix", () => {
    expect(formatHouseNumber("12", "A0.1", "nl")).toBe("12 bus A0.1");
    expect(formatHouseNumber("12", "B", "nl")).toBe("12 bus B");
  });
});
