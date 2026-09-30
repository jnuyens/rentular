/**
 * Indexation email service with region-specific legal references in all 4 languages.
 * Generates default email templates for rent indexation notifications.
 *
 * D-10: Include numbers, formula, and region-specific legal reference
 * D-11: Legal reference from property region, template from tenant language
 * D-12: When override applied, show both calculated and applied amounts
 */

export interface IndexationEmailParams {
  tenantLanguage: string; // "en" | "nl" | "fr" | "de"
  region: string; // "flanders" | "wallonia" | "brussels"
  tenantName: string;
  propertyName: string;
  currentRent: string;
  calculatedNewRent: string;
  appliedNewRent: string;
  baseIndex: string;
  currentIndex: string;
  effectiveDate: string;
  ownerName: string;
}

// Region-specific legal citations in all 4 languages
// Per D-11: region determines the law, tenant language determines the translation
export const LEGAL_REFERENCES: Record<string, Record<string, string>> = {
  flanders: {
    en: "in accordance with the Flemish Housing Rental Decree (Vlaams Woninghuurdecreet)",
    nl: "conform het Vlaams Woninghuurdecreet",
    fr: "conformement au Decret flamand sur la location de logements (Vlaams Woninghuurdecreet)",
    de: "gemaess dem Flaemischen Wohnungsmietdekret (Vlaams Woninghuurdecreet)",
  },
  wallonia: {
    en: "in accordance with Belgian Civil Code (Code civil, art. 1728bis)",
    nl: "conform het Burgerlijk Wetboek (Code civil, art. 1728bis)",
    fr: "conformement au Code civil, art. 1728bis",
    de: "gemaess dem Buergerlichen Gesetzbuch (Code civil, art. 1728bis)",
  },
  brussels: {
    en: "in accordance with the Brussels Housing Code, Article 224 (Ordonnance du 27 juillet 2017)",
    nl: "conform de Brusselse Huisvestingscode, Artikel 224 (Ordonnantie van 27 juli 2017)",
    fr: "conformement au Code bruxellois du Logement, Article 224 (Ordonnance du 27 juillet 2017)",
    de: "gemaess dem Bruesseler Wohnungsbaugesetzbuch, Artikel 224 (Verordnung vom 27. Juli 2017)",
  },
};

// Override note templates per language (D-12)
const OVERRIDE_NOTE_TEMPLATES: Record<string, string> = {
  en: "The indexed rent would be {{calculatedNewRent}}, but your landlord has set it to {{appliedNewRent}}.",
  nl: "De geindexeerde huur zou {{calculatedNewRent}} bedragen, maar uw verhuurder heeft deze vastgesteld op {{appliedNewRent}}.",
  fr: "Le loyer indexe serait de {{calculatedNewRent}}, mais votre proprietaire l'a fixe a {{appliedNewRent}}.",
  de: "Die indexierte Miete wuerde {{calculatedNewRent}} betragen, aber Ihr Vermieter hat sie auf {{appliedNewRent}} festgelegt.",
};

// Default email templates per language with {{placeholder}} syntax
export const DEFAULT_INDEXATION_TEMPLATES: Record<
  string,
  { subject: string; body: string }
> = {
  en: {
    subject: "Rent indexation for {{propertyName}}",
    body: `Dear {{tenantName}},

We would like to inform you about the annual rent indexation for your property at {{propertyName}}.

Based on the Belgian health index, the following adjustment applies:

- Current rent: {{currentRent}}
- Base index: {{baseIndex}}
- Current index: {{currentIndex}}
- New indexed rent: {{newRent}}
- Effective date: {{effectiveDate}}

Formula: new rent = base rent x (current index / base index)

{{overrideNote}}

This adjustment is {{legalReference}}.

Kind regards,
{{ownerName}}`,
  },
  nl: {
    subject: "Huurindexatie voor {{propertyName}}",
    body: `Beste {{tenantName}},

Wij informeren u over de jaarlijkse huurindexatie voor uw woning aan {{propertyName}}.

Op basis van de Belgische gezondheidsindex is de volgende aanpassing van toepassing:

- Huidige huur: {{currentRent}}
- Basisindex: {{baseIndex}}
- Huidige index: {{currentIndex}}
- Nieuwe geindexeerde huur: {{newRent}}
- Ingangsdatum: {{effectiveDate}}

Formule: nieuwe huur = basishuur x (huidige index / basisindex)

{{overrideNote}}

Deze aanpassing is {{legalReference}}.

Met vriendelijke groeten,
{{ownerName}}`,
  },
  fr: {
    subject: "Indexation du loyer pour {{propertyName}}",
    body: `Cher/Chere {{tenantName}},

Nous souhaitons vous informer de l'indexation annuelle du loyer pour votre logement au {{propertyName}}.

Sur base de l'indice sante belge, l'ajustement suivant s'applique:

- Loyer actuel: {{currentRent}}
- Indice de base: {{baseIndex}}
- Indice actuel: {{currentIndex}}
- Nouveau loyer indexe: {{newRent}}
- Date d'effet: {{effectiveDate}}

Formule: nouveau loyer = loyer de base x (indice actuel / indice de base)

{{overrideNote}}

Cet ajustement est {{legalReference}}.

Cordialement,
{{ownerName}}`,
  },
  de: {
    subject: "Mietindexierung fuer {{propertyName}}",
    body: `Sehr geehrte(r) {{tenantName}},

wir moechten Sie ueber die jaehrliche Mietindexierung fuer Ihre Wohnung an {{propertyName}} informieren.

Auf Grundlage des belgischen Gesundheitsindex gilt folgende Anpassung:

- Aktuelle Miete: {{currentRent}}
- Basisindex: {{baseIndex}}
- Aktueller Index: {{currentIndex}}
- Neue indexierte Miete: {{newRent}}
- Wirksamkeitsdatum: {{effectiveDate}}

Formel: neue Miete = Basismiete x (aktueller Index / Basisindex)

{{overrideNote}}

Diese Anpassung erfolgt {{legalReference}}.

Mit freundlichen Gruessen,
{{ownerName}}`,
  },
};

/**
 * Generate default indexation email subject and body with region-specific legal references.
 *
 * Returns raw templates with {{placeholder}} syntax -- caller uses renderTemplate() to substitute.
 *
 * Per D-10: includes numbers + formula + region-specific legal reference
 * Per D-11: legal reference from property region, template from tenant language
 * Per D-12: when calculatedNewRent !== appliedNewRent, include override note
 */
export function generateDefaultIndexationEmail(
  params: IndexationEmailParams
): { subject: string; body: string } {
  const lang = params.tenantLanguage;

  // Look up legal reference: region determines law, tenant language determines translation
  const legalReference =
    LEGAL_REFERENCES[params.region]?.[lang] ||
    LEGAL_REFERENCES[params.region]?.en ||
    "";

  // Get template for tenant language (fallback to English)
  const template =
    DEFAULT_INDEXATION_TEMPLATES[lang] || DEFAULT_INDEXATION_TEMPLATES.en;

  // Compute override note (D-12): when landlord chose a lower amount
  let overrideNote = "";
  if (params.calculatedNewRent !== params.appliedNewRent) {
    const noteTemplate =
      OVERRIDE_NOTE_TEMPLATES[lang] || OVERRIDE_NOTE_TEMPLATES.en;
    overrideNote = noteTemplate
      .replace("{{calculatedNewRent}}", params.calculatedNewRent)
      .replace("{{appliedNewRent}}", params.appliedNewRent);
  }

  // Replace legalReference and overrideNote in the template body
  // These are computed values, not user-editable placeholders
  const body = template.body
    .replace("{{legalReference}}", legalReference)
    .replace("{{overrideNote}}", overrideNote);

  return {
    subject: template.subject,
    body,
  };
}
