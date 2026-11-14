import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  communications: {},
  leases: {},
  users: {},
}));

import { brusselsFactorClearedNote, newCertificateClearsBrusselsFactor } from "../brusselsEpcFactor";

describe("Brussels stored correction factor: new certificate", () => {
  it("is cleared by a certificate A++ to D", () => {
    for (const label of ["A++", "A+", "A", "B", "C", "D"]) {
      expect(newCertificateClearsBrusselsFactor(label)).toBe(true);
    }
  });

  it("is kept when the new certificate is still E, F or G, or missing", () => {
    for (const label of ["E", "F", "G", "", null, undefined]) {
      expect(newCertificateClearsBrusselsFactor(label)).toBe(false);
    }
  });

  it("writes the history note in the landlord's language", () => {
    expect(brusselsFactorClearedNote("nl", "0.945356473", "E", "C")).toBe(
      "Correctiefactor vervalt: nieuw EPB-certificaat (label C, was E). De correctiefactor 0,945356473 wordt niet meer toegepast; volgende indexaties zijn volledig."
    );
    expect(brusselsFactorClearedNote("en", "0.945356473", "E", "C")).toContain("Correction factor no longer applies");
    expect(brusselsFactorClearedNote("fr-BE", "0.945356473", "E", "C")).toContain("certificat PEB");
    expect(brusselsFactorClearedNote("de", "0.945356473", "E", "C")).toContain("Korrekturfaktor entfällt");
  });
});
