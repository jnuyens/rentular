/**
 * Regression tests for the Smovin import mapper, covering the fixes from the
 * smovin-import-write-failure debug session:
 *   - tenant language is derived from the Smovin UI locale hint, with an explicit
 *     and visible "nl" fallback instead of a silent hardcode
 *   - lease startDate falls back to today when Smovin gave nothing, and status is
 *     never marked expired on a fallback date
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapTenantLanguage, mapSmovinTenant, mapSmovinLease } from "../smovinMapper";

describe("mapTenantLanguage", () => {
  it("maps supported Smovin locales to Rentular languages", () => {
    expect(mapTenantLanguage("nl")).toBe("nl");
    expect(mapTenantLanguage("fr")).toBe("fr");
    expect(mapTenantLanguage("de")).toBe("de");
    expect(mapTenantLanguage("en")).toBe("en");
  });

  it("normalises case and whitespace", () => {
    expect(mapTenantLanguage(" FR ")).toBe("fr");
  });

  it("falls back to nl when there is no hint or the hint is unsupported", () => {
    expect(mapTenantLanguage(undefined)).toBe("nl");
    expect(mapTenantLanguage("")).toBe("nl");
    expect(mapTenantLanguage("es")).toBe("nl");
  });
});

describe("mapSmovinTenant language handling", () => {
  const base = { firstName: "Jan", lastName: "Peeters", email: "jan@example.com" };

  it("uses the Smovin UI locale hint and says so in the notes", () => {
    const tenant = mapSmovinTenant({ ...base, language: "fr" }, "owner-1");
    expect(tenant.language).toBe("fr");
    expect(tenant.notes).toContain("Imported from Smovin");
    expect(tenant.notes).toContain('language "fr" taken from your Smovin UI locale');
  });

  it("defaults to nl without a hint and makes the default visible in the notes", () => {
    const tenant = mapSmovinTenant(base, "owner-1");
    expect(tenant.language).toBe("nl");
    expect(tenant.notes).toContain('language defaulted to "nl"');
  });

  it("still produces the usual tenant shape", () => {
    const tenant = mapSmovinTenant({ ...base, phone: "+32470000000" }, "owner-1");
    expect(tenant.ownerId).toBe("owner-1");
    expect(tenant.firstName).toBe("Jan");
    expect(tenant.lastName).toBe("Peeters");
    expect(tenant.email).toBe("jan@example.com");
    expect(tenant.phone).toBe("+32470000000");
    expect(tenant.isArchived).toBe(false);
    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("mapSmovinLease startDate handling", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a DD/MM/YYYY startDate to ISO", () => {
    const lease = mapSmovinLease(
      { startDate: "01/03/2024", monthlyRent: "850,00 €" },
      "owner-1",
      "prop-1",
      "9000",
      "Gent",
    );
    expect(lease.startDate).toBe("2024-03-01");
    expect(lease.monthlyRent).toBe("850.00");
  });

  it("falls back to today when Smovin gave no startDate", () => {
    const today = new Date().toISOString().split("T")[0];
    const lease = mapSmovinLease(
      { startDate: "", monthlyRent: "850,00 €" },
      "owner-1",
      "prop-1",
      "9000",
      "Gent",
    );
    expect(lease.startDate).toBe(today);
    expect(lease.signingDate).toBe(today);
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not mark a lease expired when the startDate was a fallback", () => {
    const lease = mapSmovinLease(
      { startDate: "", endDate: "01/01/2020", monthlyRent: "850,00 €" },
      "owner-1",
      "prop-1",
      "9000",
      "Gent",
    );
    expect(lease.status).toBe("active");
  });

  it("marks a lease expired when both dates are real and the end is in the past", () => {
    const lease = mapSmovinLease(
      { startDate: "01/01/2019", endDate: "01/01/2020", monthlyRent: "850,00 €" },
      "owner-1",
      "prop-1",
      "9000",
      "Gent",
    );
    expect(lease.status).toBe("expired");
    expect(lease.endDate).toBe("2020-01-01");
  });
});
