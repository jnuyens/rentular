import { describe, it, expect } from "vitest";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_SMS_TEMPLATES } from "@rentular/shared";
import {
  amountContextText,
  formatReminderAmount,
  renderReminderTemplate,
  withAmountContext,
} from "../reminderText";
import { getTemplateVariables, DEFAULT_SETTINGS } from "../paymentFollowUp";

function payment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "p",
    leaseId: "l",
    amount: 70,
    dueDate: "2026-11-02",
    daysPastDue: 2,
    tenantName: "Tenant",
    tenantEmail: "t@example.com",
    tenantPhone: null,
    tenantLanguage: "nl" as const,
    propertyName: "Tervuursestraat 97 leuven",
    ownerName: "Owner",
    isIgnored: false,
    remindersSent: [] as Array<"friendly" | "formal" | "final">,
    latePaymentFeeEnabled: false,
    latePaymentFeeAmount: 15,
    latePaymentFeeEnforcement: "soft" as const,
    remainder: null as null | { expected: number; received: number; oldRent: number | null; indexationDate: string | null },
    ...overrides,
  };
}

// Prod, 2026-11-04: Tervuursestraat 97 received 740 of 810 (not the old rent).
const terv = payment({ remainder: { expected: 810, received: 740, oldRent: null, indexationDate: null } });

// Prod, 2026-11-04: Carnotstraat 65 b102 still paid the 900 from before the
// indexation of 1 November 2026 (new rent 925).
const carnot = payment({
  amount: 25,
  dueDate: "2026-11-04",
  tenantLanguage: "fr" as const,
  propertyName: "Carnotstraat 65 b102 Antwerpen",
  remainder: { expected: 925, received: 900, oldRent: 900, indexationDate: "2026-11-01" },
});

describe("formatReminderAmount", () => {
  it("writes euros the Belgian way per language", () => {
    expect(formatReminderAmount(70, "nl")).toBe("€ 70,00");
    expect(formatReminderAmount(25, "fr")).toBe("25,00 €");
    expect(formatReminderAmount(1150, "de")).toBe("1.150,00 €");
    expect(formatReminderAmount(1150, "en")).toBe("€ 1.150,00");
  });
});

describe("reminder email rendering", () => {
  it("NL Tervuursestraat: Belgian amount and date, and says it is the rest of the rent", () => {
    const vars = getTemplateVariables(terv, DEFAULT_SETTINGS);
    const body = renderReminderTemplate(DEFAULT_EMAIL_TEMPLATES.nl.friendly.body, vars, "long");
    expect(body).toContain(
      "uw huurbetaling van € 70,00 voor Tervuursestraat 97 leuven verschuldigd was op 02/11/2026.\n\n" +
        "Dit is het resterende bedrag: we ontvingen € 740,00 van de € 810,00 voor deze maand.\n\n" +
        "Als u deze betaling al heeft gedaan",
    );
    expect(body).not.toContain("2026-11-02");
  });

  it("FR Carnotstraat: accents, French amounts, and the indexation explained", () => {
    const vars = getTemplateVariables(carnot, DEFAULT_SETTINGS);
    const body = renderReminderTemplate(DEFAULT_EMAIL_TEMPLATES.fr.friendly.body, vars, "long");
    expect(body).toContain("Cher/Chère Tenant,");
    expect(body).toContain(
      "votre paiement de loyer de 25,00 € pour Carnotstraat 65 b102 Antwerpen était dû le 04/11/2026.\n\n" +
        "Depuis l'indexation du 1er novembre 2026, le loyer s'élève à 925,00 €. " +
        "Vous avez encore payé l'ancien montant de 900,00 €, il s'agit donc de la différence.",
    );
    expect(body).toContain("Si vous avez déjà effectué ce paiement");
  });

  it("a normal unpaid rent gets no extra sentence", () => {
    const vars = getTemplateVariables(payment({ amount: 810 }), DEFAULT_SETTINGS);
    const body = renderReminderTemplate(DEFAULT_EMAIL_TEMPLATES.nl.friendly.body, vars, "long");
    expect(body).toContain("van € 810,00 voor Tervuursestraat 97 leuven verschuldigd was op 02/11/2026.\n\nAls u");
    expect(body).not.toContain("resterende");
  });

  it("final reminder: the context follows the amount block", () => {
    const vars = getTemplateVariables(terv, DEFAULT_SETTINGS);
    const body = renderReminderTemplate(DEFAULT_EMAIL_TEMPLATES.nl.final.body, vars, "long");
    expect(body).toContain("Totaal verschuldigd: € 70,00\n\nDit is het resterende bedrag");
  });

  it("an owner template with {{amountContext}} keeps its own placement", () => {
    const tpl = "Hallo {{tenantName}}, nog {{amount}} open. {{amountContext}}\n\nGroeten";
    const vars = getTemplateVariables(terv, DEFAULT_SETTINGS);
    expect(renderReminderTemplate(tpl, vars, "long")).toBe(
      "Hallo Tenant, nog € 70,00 open. Dit is het resterende bedrag: we ontvingen € 740,00 van de € 810,00 voor deze maand.\n\nGroeten",
    );
    const plain = getTemplateVariables(payment(), DEFAULT_SETTINGS);
    expect(renderReminderTemplate(tpl, plain, "long")).toBe("Hallo Tenant, nog € 70,00 open.\n\nGroeten");
  });

  it("an owner template without the placeholder gets the sentence after the amount paragraph", () => {
    const tpl = "Dear {{tenantName}},\n\nPlease pay {{amount}}.\n\nThanks";
    expect(withAmountContext(tpl, "long")).toBe(
      "Dear {{tenantName}},\n\nPlease pay {{amount}}.\n\n{{amountContext}}\n\nThanks",
    );
    expect(withAmountContext("Dear {{tenantName}},\n\nPlease pay.\n\nThanks", "long")).toBe(
      "Dear {{tenantName}},\n\nPlease pay.\n\n{{amountContext}}\n\nThanks",
    );
  });
});

describe("short reminder rendering (SMS and WhatsApp)", () => {
  it("NL: context before the signature", () => {
    const vars = getTemplateVariables(terv, DEFAULT_SETTINGS, "short");
    expect(renderReminderTemplate(DEFAULT_SMS_TEMPLATES.nl.friendly, vars, "short")).toBe(
      "Herinnering: huur van € 70,00 voor Tervuursestraat 97 leuven was verschuldigd op 02/11/2026. Gelieve te betalen. " +
        "Dit is het resterende bedrag (ontvangen: € 740,00 van € 810,00). - Owner",
    );
  });

  it("FR: accents and the indexation difference", () => {
    const vars = getTemplateVariables(carnot, DEFAULT_SETTINGS, "short");
    expect(renderReminderTemplate(DEFAULT_SMS_TEMPLATES.fr.friendly, vars, "short")).toBe(
      "Rappel : loyer de 25,00 € pour Carnotstraat 65 b102 Antwerpen dû le 04/11/2026. Veuillez payer. " +
        "Il s'agit de la différence après l'indexation : le loyer est maintenant de 925,00 €, vous avez payé 900,00 €. - Owner",
    );
  });

  it("no context leaves the message unchanged", () => {
    const vars = getTemplateVariables(payment({ amount: 810 }), DEFAULT_SETTINGS, "short");
    expect(renderReminderTemplate(DEFAULT_SMS_TEMPLATES.nl.final, vars, "short")).toBe(
      "Derde herinnering: € 810,00 voor Tervuursestraat 97 leuven (vervaldag 02/11/2026) staat nog open. Al betaald of klopt er iets niet? Neem dan contact op met Owner.",
    );
  });
});

describe("amountContextText", () => {
  it("has copy in all four languages", () => {
    const ctx = { expected: 810, received: 740, oldRent: null, indexationDate: null };
    expect(amountContextText(ctx, "en", "long")).toBe(
      "This is the remaining amount: we received € 740,00 of the € 810,00 due for this month.",
    );
    expect(amountContextText(ctx, "de", "long")).toBe(
      "Dies ist der Restbetrag: Wir haben 740,00 € von den 810,00 € für diesen Monat erhalten.",
    );
    expect(amountContextText(null, "nl", "long")).toBe("");
  });

  it("never uses dashes", () => {
    const ctx = { expected: 925, received: 900, oldRent: 900, indexationDate: "2026-11-01" };
    for (const lang of ["en", "nl", "fr", "de"]) {
      for (const form of ["long", "short"] as const) {
        const text = amountContextText(ctx, lang, form);
        expect(text.includes(String.fromCharCode(0x2013))).toBe(false);
        expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
      }
    }
  });
});
