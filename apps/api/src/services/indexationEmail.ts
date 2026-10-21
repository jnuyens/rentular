/**
 * Default rent indexation letter in NL, FR, DE and EN.
 *
 * The letter follows the structure Belgian landlords actually send: lease
 * dates and address, the indexation formula, the Royal Decree sentence on the
 * health index, base and new index with their months, the base rent, the EPC
 * restriction with its computation when one applies, the new rent, an optional
 * round-down and standing-order sentence, the effective date and a signature.
 *
 * The region decides the legal reference; the tenant's language decides the
 * translation. Amounts, index values and dates use Belgian notation.
 */

import {
  formatEur,
  formatIndexValue,
  formatLongDate,
  formatMonthName,
  formatMonthYear,
  letterLanguage,
  type LetterLanguage,
} from "../lib/belgianFormat";

export interface IndexationEmailParams {
  tenantLanguage: string; // "en" | "nl" | "fr" | "de"
  region: string; // "flanders" | "wallonia" | "brussels"
  tenantName: string;
  propertyName: string;
  /** Full address, already formatted, e.g. "Tervuursestraat 97, 3000 Leuven, België". */
  propertyAddress: string;
  signingDate: string | null; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
  baseRent: number;
  baseIndex: number;
  baseIndexMonth: string; // YYYY-MM
  currentIndex: number;
  currentIndexMonth: string; // YYYY-MM
  unrestrictedNewRent: number;
  calculatedNewRent: number;
  appliedNewRent: number;
  effectiveDate: string; // YYYY-MM-DD
  epcLabel: string | null;
  epcRestricted: boolean;
  correctionApplied: boolean;
  correctionMonth: number | null; // 1..12
  epcIndexationFactor: number;
  paymentMethod: string | null;
  ownerName: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
}

// Region-specific legal citations. The region determines the law, the tenant
// language determines the translation.
export const LEGAL_REFERENCES: Record<string, Record<string, string>> = {
  flanders: {
    en: "in accordance with the Flemish Housing Rental Decree (Vlaams Woninghuurdecreet)",
    nl: "conform het Vlaams Woninghuurdecreet",
    fr: "conformément au Décret flamand sur la location d'habitations (Vlaams Woninghuurdecreet)",
    de: "gemäß dem Flämischen Wohnungsmietdekret (Vlaams Woninghuurdecreet)",
  },
  wallonia: {
    en: "in accordance with the Belgian Civil Code (Code civil, art. 1728bis)",
    nl: "conform het Burgerlijk Wetboek (Code civil, art. 1728bis)",
    fr: "conformément au Code civil, art. 1728bis",
    de: "gemäß dem Bürgerlichen Gesetzbuch (Code civil, Art. 1728bis)",
  },
  brussels: {
    en: "in accordance with the Brussels Housing Code, Article 224 (Ordinance of 27 July 2017)",
    nl: "conform de Brusselse Huisvestingscode, artikel 224 (ordonnantie van 27 juli 2017)",
    fr: "conformément au Code bruxellois du Logement, article 224 (ordonnance du 27 juillet 2017)",
    de: "gemäß dem Brüsseler Wohngesetzbuch, Artikel 224 (Ordonnanz vom 27. Juli 2017)",
  },
};

interface LetterCopy {
  leaseReference(signing: string | null, start: string): string;
  healthIndexSentence: string;
  epcLabelPhrase(label: string | null): string;
  flandersCorrection(labelPhrase: string, month: string, factor: string): string;
  restrictedIncrease(region: string, labelPhrase: string, pct: string | null): string;
  rounding(applied: string): string;
  standingOrder: string;
}

const COPY: Record<LetterLanguage, LetterCopy> = {
  nl: {
    leaseReference: (signing, start) =>
      signing
        ? `de huurovereenkomst ondertekend op ${signing} en in werking getreden op ${start}`
        : `de huurovereenkomst in werking getreden op ${start}`,
    healthIndexSentence:
      "In overeenstemming met het Koninklijk Besluit van 24/12/93 (gepubliceerd in het Belgisch Staatsblad van 31/12/93) is alleen de gezondheidsindex van toepassing voor de indexering.",
    epcLabelPhrase: (label) => (label ? `met EPC-label ${label}` : "zonder EPC"),
    flandersCorrection: (labelPhrase, month, factor) =>
      `Voor woningen ${labelPhrase} beperkt de Vlaamse Regering de indexering sinds haar besluit van 3 oktober 2022. Voor huurovereenkomsten met verjaardagsmaand ${month} geldt daarom een correctiefactor van ${factor}:`,
    restrictedIncrease: (region, labelPhrase, pct) => {
      const where =
        region === "brussels"
          ? "In het Brussels Hoofdstedelijk Gewest"
          : region === "flanders"
            ? "Volgens de Vlaamse regelgeving"
            : region === "wallonia"
              ? "Volgens de Waalse regelgeving"
              : "Volgens de regelgeving";
      return pct === null
        ? `${where} mag de huur van een woning ${labelPhrase} niet geïndexeerd worden, er is geen stijging toegestaan:`
        : `${where} mag de huur van een woning ${labelPhrase} slechts voor ${pct}% van de stijging geïndexeerd worden:`;
    },
    rounding: (applied) => `We ronden dit bedrag af naar beneden zodat het komt op ${applied}.`,
    standingOrder: "Gelieve uw doorlopende opdracht aan te passen indien nodig.",
  },
  en: {
    leaseReference: (signing, start) =>
      signing
        ? `the lease signed on ${signing} and in force since ${start}`
        : `the lease in force since ${start}`,
    healthIndexSentence:
      "In accordance with the Royal Decree of 24/12/93 (published in the Belgian Official Gazette of 31/12/93), only the health index applies to the indexation.",
    epcLabelPhrase: (label) => (label ? `with EPC label ${label}` : "without an EPC"),
    flandersCorrection: (labelPhrase, month, factor) =>
      `For homes ${labelPhrase}, the Flemish Government has limited indexation since its decision of 3 October 2022. For leases with ${month} as anniversary month, a correction factor of ${factor} therefore applies:`,
    restrictedIncrease: (region, labelPhrase, pct) => {
      const where =
        region === "brussels"
          ? "In the Brussels-Capital Region"
          : region === "flanders"
            ? "Under the Flemish rules"
            : region === "wallonia"
              ? "Under the Walloon rules"
              : "Under the regional rules";
      return pct === null
        ? `${where}, the rent of a home ${labelPhrase} may not be indexed, so no increase is allowed:`
        : `${where}, the rent of a home ${labelPhrase} may only be indexed by ${pct}% of the increase:`;
    },
    rounding: (applied) => `We round this amount down to ${applied}.`,
    standingOrder: "Please adjust your standing order if needed.",
  },
  fr: {
    leaseReference: (signing, start) =>
      signing
        ? `au bail signé le ${signing} et entré en vigueur le ${start}`
        : `au bail entré en vigueur le ${start}`,
    healthIndexSentence:
      "Conformément à l'arrêté royal du 24/12/93 (publié au Moniteur belge du 31/12/93), seul l'indice santé est applicable pour l'indexation.",
    epcLabelPhrase: (label) => (label ? `avec un certificat PEB ${label}` : "sans certificat PEB"),
    flandersCorrection: (labelPhrase, month, factor) =>
      `Pour les logements ${labelPhrase}, le Gouvernement flamand limite l'indexation depuis sa décision du 3 octobre 2022. Pour les baux dont le mois anniversaire est ${month}, un facteur de correction de ${factor} s'applique donc :`,
    restrictedIncrease: (region, labelPhrase, pct) => {
      const where =
        region === "brussels"
          ? "En Région de Bruxelles-Capitale"
          : region === "flanders"
            ? "Selon la réglementation flamande"
            : region === "wallonia"
              ? "Selon la réglementation wallonne"
              : "Selon la réglementation régionale";
      return pct === null
        ? `${where}, le loyer d'un logement ${labelPhrase} ne peut pas être indexé, aucune hausse n'est autorisée :`
        : `${where}, le loyer d'un logement ${labelPhrase} ne peut être indexé qu'à hauteur de ${pct} % de la hausse :`;
    },
    rounding: (applied) => `Nous arrondissons ce montant vers le bas, à ${applied}.`,
    standingOrder: "Merci d'adapter votre ordre permanent si nécessaire.",
  },
  de: {
    leaseReference: (signing, start) =>
      signing
        ? `dem am ${signing} unterzeichneten und am ${start} in Kraft getretenen Mietvertrag`
        : `dem am ${start} in Kraft getretenen Mietvertrag`,
    healthIndexSentence:
      "Gemäß dem Königlichen Erlass vom 24/12/93 (veröffentlicht im Belgischen Staatsblatt vom 31/12/93) ist für die Indexierung ausschließlich der Gesundheitsindex maßgeblich.",
    epcLabelPhrase: (label) => (label ? `mit EPC-Label ${label}` : "ohne EPC"),
    flandersCorrection: (labelPhrase, month, factor) =>
      `Für Wohnungen ${labelPhrase} begrenzt die Flämische Regierung die Indexierung seit ihrem Beschluss vom 3. Oktober 2022. Für Mietverträge mit dem Jahrestag im ${month} gilt deshalb ein Korrekturfaktor von ${factor}:`,
    restrictedIncrease: (region, labelPhrase, pct) => {
      const where =
        region === "brussels"
          ? "In der Region Brüssel-Hauptstadt"
          : region === "flanders"
            ? "Nach den flämischen Vorschriften"
            : region === "wallonia"
              ? "Nach den wallonischen Vorschriften"
              : "Nach den regionalen Vorschriften";
      return pct === null
        ? `${where} darf die Miete einer Wohnung ${labelPhrase} nicht indexiert werden, eine Erhöhung ist nicht zulässig:`
        : `${where} darf die Miete einer Wohnung ${labelPhrase} nur um ${pct} % der Steigerung indexiert werden:`;
    },
    rounding: (applied) => `Wir runden diesen Betrag auf ${applied} ab.`,
    standingOrder: "Bitte passen Sie Ihren Dauerauftrag bei Bedarf an.",
  },
};

// Default letters per language with {{placeholder}} syntax. Placeholders that
// resolve to an empty value on a line of their own are dropped with the line.
export const DEFAULT_INDEXATION_TEMPLATES: Record<string, { subject: string; body: string }> = {
  nl: {
    subject: "Huurindexatie {{propertyAddress}}",
    body: `Geachte {{tenantName}},

Overeenkomstig {{leaseReference}}, voor het pand gelegen op {{propertyAddress}}, wordt de huur geïndexeerd op de variatie van de basisindex volgens de volgende formule:

( Basisbedrag × Nieuwe index ) / Basisindex

{{healthIndexSentence}}

De basisindex van ons huurcontract is deze van {{baseIndexMonth}} en bedraagt {{baseIndexValue}}.

De nieuwe index van ons huurcontract is deze van {{currentIndexMonth}} en bedraagt {{currentIndexValue}}.

De basishuur bedraagt {{baseRent}}.

{{epcParagraph}}

De nieuwe huur is dus {{calculatedNewRent}}.

{{roundingSentence}} {{standingOrderSentence}}

Deze indexatie is van kracht vanaf {{effectiveDate}}. Deze aanpassing gebeurt {{legalReference}}.

Met vriendelijke groeten,

{{ownerName}}
{{ownerEmailLine}}
{{ownerPhoneLine}}`,
  },
  en: {
    subject: "Rent indexation {{propertyAddress}}",
    body: `Dear {{tenantName}},

In accordance with {{leaseReference}}, for the property at {{propertyAddress}}, the rent is indexed on the change in the base index using the following formula:

( Base rent × New index ) / Base index

{{healthIndexSentence}}

The base index of our lease is the index of {{baseIndexMonth}}, which is {{baseIndexValue}}.

The new index of our lease is the index of {{currentIndexMonth}}, which is {{currentIndexValue}}.

The base rent is {{baseRent}}.

{{epcParagraph}}

The new rent is therefore {{calculatedNewRent}}.

{{roundingSentence}} {{standingOrderSentence}}

This indexation takes effect on {{effectiveDate}}. This adjustment is made {{legalReference}}.

Kind regards,

{{ownerName}}
{{ownerEmailLine}}
{{ownerPhoneLine}}`,
  },
  fr: {
    subject: "Indexation du loyer {{propertyAddress}}",
    body: `Madame, Monsieur {{tenantName}},

Conformément {{leaseReference}}, pour le bien sis {{propertyAddress}}, le loyer est indexé selon l'évolution de l'indice de base, d'après la formule suivante :

( Loyer de base × Nouvel indice ) / Indice de base

{{healthIndexSentence}}

L'indice de base de notre bail (mois de référence : {{baseIndexMonth}}) s'élève à {{baseIndexValue}}.

Le nouvel indice de notre bail (mois de référence : {{currentIndexMonth}}) s'élève à {{currentIndexValue}}.

Le loyer de base s'élève à {{baseRent}}.

{{epcParagraph}}

Le nouveau loyer s'élève donc à {{calculatedNewRent}}.

{{roundingSentence}} {{standingOrderSentence}}

Cette indexation prend effet le {{effectiveDate}}. Cette adaptation est effectuée {{legalReference}}.

Cordialement,

{{ownerName}}
{{ownerEmailLine}}
{{ownerPhoneLine}}`,
  },
  de: {
    subject: "Mietindexierung {{propertyAddress}}",
    body: `Sehr geehrte(r) {{tenantName}},

gemäß {{leaseReference}} für das Mietobjekt {{propertyAddress}} wird die Miete nach der Entwicklung des Basisindex mit folgender Formel indexiert:

( Basismiete × Neuer Index ) / Basisindex

{{healthIndexSentence}}

Der Basisindex unseres Mietvertrags ist der Index von {{baseIndexMonth}} und beträgt {{baseIndexValue}}.

Der neue Index unseres Mietvertrags ist der Index von {{currentIndexMonth}} und beträgt {{currentIndexValue}}.

Die Basismiete beträgt {{baseRent}}.

{{epcParagraph}}

Die neue Miete beträgt somit {{calculatedNewRent}}.

{{roundingSentence}} {{standingOrderSentence}}

Diese Indexierung gilt ab dem {{effectiveDate}}. Diese Anpassung erfolgt {{legalReference}}.

Mit freundlichen Grüßen,

{{ownerName}}
{{ownerEmailLine}}
{{ownerPhoneLine}}`,
  },
};

/** Factor as given, with a comma decimal: 0.943883189 -> "0,943883189". */
function formatFactor(factor: number): string {
  return String(factor).replace(".", ",");
}

/** Share of the increase as a percentage, or null when nothing is allowed. */
function formatPercent(factor: number): string | null {
  const pct = Number((factor * 100).toFixed(2));
  return pct <= 0 ? null : String(pct).replace(".", ",");
}

function epcParagraph(p: IndexationEmailParams, copy: LetterCopy, lang: LetterLanguage): string {
  if (!p.correctionApplied && !p.epcRestricted) return "";
  const label = p.epcLabel && p.epcLabel.toLowerCase() !== "none" ? p.epcLabel : null;
  const labelPhrase = copy.epcLabelPhrase(label);
  const factor = formatFactor(p.epcIndexationFactor);
  const base = formatEur(p.baseRent);
  const unrestricted = formatEur(p.unrestrictedNewRent);
  const calculated = formatEur(p.calculatedNewRent);

  if (p.correctionApplied && p.correctionMonth) {
    const intro = copy.flandersCorrection(labelPhrase, formatMonthName(p.correctionMonth, lang), factor);
    return [
      intro,
      "",
      `${base} × ${formatIndexValue(p.currentIndex)} / ${formatIndexValue(p.baseIndex)} = ${unrestricted}`,
      `${unrestricted} × ${factor} = ${calculated}`,
    ].join("\n");
  }

  const intro = copy.restrictedIncrease(p.region, labelPhrase, formatPercent(p.epcIndexationFactor));
  return [intro, "", `${base} + (${unrestricted} - ${base}) × ${factor} = ${calculated}`].join("\n");
}

/**
 * Every placeholder the default letters use, plus the legacy keys older
 * hand-written templates rely on (currentRent, newRent, baseIndex,
 * currentIndex, overrideNote, ...).
 */
export function buildIndexationTemplateVars(params: IndexationEmailParams): Record<string, string> {
  const lang = letterLanguage(params.tenantLanguage);
  const copy = COPY[lang];
  const legalReference =
    LEGAL_REFERENCES[params.region]?.[lang] || LEGAL_REFERENCES[params.region]?.en || "";
  const applied = formatEur(params.appliedNewRent);
  const roundingSentence =
    params.appliedNewRent < params.calculatedNewRent ? copy.rounding(applied) : "";
  const signing = params.signingDate ? formatLongDate(params.signingDate, lang) : null;
  const start = formatLongDate(params.startDate, lang);

  return {
    tenantName: params.tenantName,
    propertyName: params.propertyName,
    propertyAddress: params.propertyAddress,
    signingDate: signing || "",
    startDate: start,
    leaseReference: copy.leaseReference(signing, start),
    healthIndexSentence: copy.healthIndexSentence,
    baseIndexMonth: formatMonthYear(params.baseIndexMonth, lang),
    baseIndexValue: formatIndexValue(params.baseIndex),
    currentIndexMonth: formatMonthYear(params.currentIndexMonth, lang),
    currentIndexValue: formatIndexValue(params.currentIndex),
    baseRent: formatEur(params.baseRent),
    unrestrictedNewRent: formatEur(params.unrestrictedNewRent),
    epcParagraph: epcParagraph(params, copy, lang),
    calculatedNewRent: formatEur(params.calculatedNewRent),
    appliedNewRent: applied,
    roundingSentence,
    standingOrderSentence: params.paymentMethod === "gocardless" ? "" : copy.standingOrder,
    effectiveDate: formatLongDate(params.effectiveDate, lang),
    legalReference,
    ownerName: params.ownerName,
    ownerEmailLine: params.ownerEmail || "",
    ownerPhoneLine: params.ownerPhone || "",
    // Legacy keys
    currentRent: formatEur(params.baseRent),
    newRent: applied,
    baseIndex: formatIndexValue(params.baseIndex),
    currentIndex: formatIndexValue(params.currentIndex),
    overrideNote: roundingSentence,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fill {{placeholders}}, drop lines left empty, and tidy blank lines. */
function renderLetter(template: string, vars: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    if (value === "") {
      // A placeholder alone on its line disappears together with the line.
      text = text.replace(new RegExp(`^[ \\t]*\\{\\{${escapeRegExp(key)}\\}\\}[ \\t]*(\\n|$)`, "gm"), "");
    }
    text = text.split(`{{${key}}}`).join(value);
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The fully rendered default indexation letter (subject and body) in the
 * tenant's language, English when the language is unknown.
 */
export function generateDefaultIndexationEmail(
  params: IndexationEmailParams,
): { subject: string; body: string } {
  const lang = letterLanguage(params.tenantLanguage);
  const template = DEFAULT_INDEXATION_TEMPLATES[lang] || DEFAULT_INDEXATION_TEMPLATES.en!;
  const vars = buildIndexationTemplateVars(params);
  return {
    subject: renderLetter(template.subject, vars),
    body: renderLetter(template.body, vars),
  };
}
