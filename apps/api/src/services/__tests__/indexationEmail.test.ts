import { describe, it, expect } from "vitest";
import { FLANDERS_EPC_CORRECTION_FACTORS } from "@rentular/shared/constants";
import {
  generateDefaultIndexationEmail,
  buildIndexationTemplateVars,
  DEFAULT_INDEXATION_TEMPLATES,
  LEGAL_REFERENCES,
  type IndexationEmailParams,
} from "../indexationEmail";

const FACTOR = FLANDERS_EPC_CORRECTION_FACTORS[5]!.efNone;
const round2 = (n: number) => Math.round(n * 100) / 100;
const CALCULATED = round2(834.74 * FACTOR);

/** The Akpinar lease on Tervuursestraat, as in the landlord's reference letter. */
function reference(overrides: Partial<IndexationEmailParams> = {}): IndexationEmailParams {
  return {
    tenantLanguage: "nl",
    region: "flanders",
    tenantName: "Akpinar",
    propertyName: "Tervuursestraat",
    propertyAddress: "Tervuursestraat 97, 3000 Leuven, België",
    signingDate: "2019-04-05",
    startDate: "2019-05-01",
    baseRent: 675,
    baseIndex: 108.98,
    baseIndexMonth: "2019-04",
    currentIndex: 134.77,
    currentIndexMonth: "2025-04",
    unrestrictedNewRent: 834.74,
    calculatedNewRent: CALCULATED,
    appliedNewRent: 780,
    effectiveDate: "2025-06-01",
    epcLabel: "F",
    epcRestricted: true,
    correctionApplied: true,
    correctionMonth: 5,
    epcIndexationFactor: FACTOR,
    paymentMethod: "bank_transfer",
    ownerName: "Jasper Nuyens",
    ownerEmail: "jnuyens@linuxbe.com",
    ownerPhone: "+32 478 97 89 67",
    ...overrides,
  };
}

function expectInOrder(text: string, parts: string[]) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    expect(at, `expected "${part}" after position ${from}`).toBeGreaterThanOrEqual(0);
    from = at + part.length;
  }
}

const eurNl = (n: number) => {
  const [whole, cents] = n.toFixed(2).split(".");
  return `€ ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
};

describe("generateDefaultIndexationEmail (NL reference letter)", () => {
  it("follows the structure of the landlord's letter", () => {
    const { subject, body } = generateDefaultIndexationEmail(reference());
    expect(subject).toBe("Huurindexatie Tervuursestraat 97, 3000 Leuven, België");
    expect(body).not.toContain("{{");
    expectInOrder(body, [
      "Geachte Akpinar,",
      "ondertekend op 5 april 2019",
      "in werking getreden op 1 mei 2019",
      "Tervuursestraat 97, 3000 Leuven, België",
      "( Basisbedrag × Nieuwe index ) / Basisindex",
      "Koninklijk Besluit van 24/12/93",
      "Belgisch Staatsblad van 31/12/93",
      "april 2019 en bedraagt 108,98",
      "april 2025 en bedraagt 134,77",
      "€ 675,00",
      "EPC-label F",
      "correctiefactor",
      String(FACTOR).replace(".", ","),
      "€ 834,74",
      `De nieuwe huur is dus ${eurNl(CALCULATED)}`,
      "af naar beneden",
      "€ 780,00",
      "doorlopende opdracht",
      "van kracht vanaf 1 juni 2025",
      "Jasper Nuyens",
      "jnuyens@linuxbe.com",
      "+32 478 97 89 67",
    ]);
  });

  it("shows the correction computation on its own lines", () => {
    const { body } = generateDefaultIndexationEmail(reference());
    const f = String(FACTOR).replace(".", ",");
    expect(body).toContain("€ 675,00 × 134,77 / 108,98 = € 834,74\n");
    expect(body).toContain(`€ 834,74 × ${f} = ${eurNl(CALCULATED)}`);
    expect(body).toContain("mei");
  });

  it("leaves out the standing-order sentence for SEPA direct debit", () => {
    const { body } = generateDefaultIndexationEmail(reference({ paymentMethod: "gocardless" }));
    expect(body).not.toContain("doorlopende opdracht");
    expect(body).toContain("af naar beneden");
  });

  it("leaves out the round-down sentence when the applied rent equals the calculation", () => {
    const { body } = generateDefaultIndexationEmail(reference({ appliedNewRent: CALCULATED }));
    expect(body).not.toContain("af naar beneden");
    expect(body).toContain("doorlopende opdracht");
  });

  it("has no EPC paragraph when no restriction applies", () => {
    const { body } = generateDefaultIndexationEmail(
      reference({
        correctionApplied: false,
        epcRestricted: false,
        epcIndexationFactor: 1,
        correctionMonth: null,
        epcLabel: "B",
        calculatedNewRent: 834.74,
        appliedNewRent: 834.74,
      }),
    );
    expect(body).not.toContain("EPC");
    expect(body).not.toContain("correctiefactor");
    expect(body).toContain("De nieuwe huur is dus € 834,74");
    expect(body).not.toMatch(/\n{3,}/);
  });

  it("explains the Brussels rule with base + increase × factor", () => {
    const { body } = generateDefaultIndexationEmail(
      reference({
        region: "brussels",
        epcLabel: "F",
        epcRestricted: true,
        correctionApplied: false,
        correctionMonth: null,
        epcIndexationFactor: 0.5,
        calculatedNewRent: 754.87,
        appliedNewRent: 754.87,
      }),
    );
    expect(body).toContain("Brussels");
    expect(body).toContain("50%");
    expect(body).toContain("€ 675,00 + (€ 834,74 - € 675,00) × 0,5 = € 754,87");
    expect(body).toContain("Brusselse Huisvestingscode");
  });

  it("says no increase is allowed when the factor is zero", () => {
    const { body } = generateDefaultIndexationEmail(
      reference({
        region: "brussels",
        epcLabel: "G",
        correctionApplied: false,
        correctionMonth: null,
        epcIndexationFactor: 0,
        calculatedNewRent: 675,
        appliedNewRent: 675,
      }),
    );
    expect(body).toContain("geen");
    expect(body).not.toContain("0%");
  });

  it("drops the signing date clause when the signing date is unknown", () => {
    const { body } = generateDefaultIndexationEmail(reference({ signingDate: null }));
    expect(body).not.toContain("ondertekend op");
    expect(body).toContain("in werking getreden op 1 mei 2019");
  });

  it("drops the phone line when the owner has no phone", () => {
    const { body } = generateDefaultIndexationEmail(reference({ ownerPhone: null }));
    expect(body).not.toContain("+32");
    expect(body.trimEnd().endsWith("Jasper Nuyens\njnuyens@linuxbe.com")).toBe(true);
  });

  it("speaks of a home without EPC when the label is missing", () => {
    const { body } = generateDefaultIndexationEmail(reference({ epcLabel: null }));
    expect(body).toContain("zonder EPC");
  });
});

describe("generateDefaultIndexationEmail (EN, FR, DE)", () => {
  const cases: Array<[string, string, string]> = [
    ["en", "Royal Decree of 24/12/93", "Kind regards,"],
    ["fr", "arrêté royal du 24/12/93", "Cordialement,"],
    ["de", "Königlichen Erlass vom 24/12/93", "Mit freundlichen Grüßen,"],
  ];
  for (const [lang, decree, closing] of cases) {
    it(`renders the reference case in ${lang}`, () => {
      const { subject, body } = generateDefaultIndexationEmail(reference({ tenantLanguage: lang }));
      expect(subject).not.toContain("{{");
      expect(body).not.toContain("{{");
      expect(body).toContain(decree);
      expect(body).toContain("€ 675,00");
      expect(body).toContain("€ 780,00");
      expectInOrder(body, [closing, "Jasper Nuyens", "jnuyens@linuxbe.com", "+32 478 97 89 67"]);
    });
  }

  it("falls back to English for an unknown language", () => {
    const { body } = generateDefaultIndexationEmail(reference({ tenantLanguage: "es" }));
    expect(body).toContain("Royal Decree of 24/12/93");
  });
});

describe("no dash characters", () => {
  const dash = /[–—]/;
  it("templates, legal references and rendered letters are dash-free", () => {
    for (const t of Object.values(DEFAULT_INDEXATION_TEMPLATES)) {
      expect(t.subject).not.toMatch(dash);
      expect(t.body).not.toMatch(dash);
    }
    for (const region of Object.values(LEGAL_REFERENCES)) {
      for (const text of Object.values(region)) expect(text).not.toMatch(dash);
    }
    for (const lang of ["nl", "en", "fr", "de"]) {
      for (const region of ["flanders", "brussels", "wallonia"]) {
        const { subject, body } = generateDefaultIndexationEmail(
          reference({ tenantLanguage: lang, region, correctionApplied: region === "flanders" }),
        );
        expect(subject).not.toMatch(dash);
        expect(body).not.toMatch(dash);
      }
    }
  });
});

describe("buildIndexationTemplateVars", () => {
  it("keeps the legacy placeholders for hand-written templates", () => {
    const vars = buildIndexationTemplateVars(reference());
    for (const key of [
      "tenantName",
      "propertyName",
      "currentRent",
      "newRent",
      "calculatedNewRent",
      "baseIndex",
      "currentIndex",
      "effectiveDate",
      "ownerName",
      "legalReference",
      "overrideNote",
    ]) {
      expect(vars, key).toHaveProperty(key);
    }
    expect(vars.currentRent).toBe("€ 675,00");
    expect(vars.newRent).toBe("€ 780,00");
    expect(vars.overrideNote).toContain("€ 780,00");
    expect(vars.legalReference).toContain("Vlaams Woninghuurdecreet");
  });
});
