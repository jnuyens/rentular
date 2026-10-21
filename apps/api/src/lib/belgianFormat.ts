/**
 * Belgian number and date formatting for letters and notices: euro amounts as
 * "€ 1.150,00", index values with a comma decimal, and dates with the month
 * written out in the reader's language.
 */

export type LetterLanguage = "nl" | "fr" | "de" | "en";

export const MONTH_NAMES: Record<LetterLanguage, string[]> = {
  nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const COUNTRY_NAMES: Record<string, Record<LetterLanguage, string>> = {
  BE: { nl: "België", fr: "Belgique", de: "Belgien", en: "Belgium" },
  NL: { nl: "Nederland", fr: "Pays-Bas", de: "Niederlande", en: "Netherlands" },
  FR: { nl: "Frankrijk", fr: "France", de: "Frankreich", en: "France" },
  DE: { nl: "Duitsland", fr: "Allemagne", de: "Deutschland", en: "Germany" },
  LU: { nl: "Luxemburg", fr: "Luxembourg", de: "Luxemburg", en: "Luxembourg" },
};

/** Normalise a language code to one we have copy for (English otherwise). */
export function letterLanguage(lang: string | null | undefined): LetterLanguage {
  const l = (lang || "").toLowerCase();
  return l === "nl" || l === "fr" || l === "de" || l === "en" ? l : "en";
}

/** "€ 1.150,00": dot for thousands, comma for cents. */
export function formatEur(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  return `€ ${sign}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
}

/** Health index value with two decimals and a comma: 126.7 -> "126,70". */
export function formatIndexValue(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/** dd/mm/yyyy from an ISO date, without timezone drift. */
export function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Month name (1..12) in the given language. */
export function formatMonthName(month: number, lang: string): string {
  return MONTH_NAMES[letterLanguage(lang)][month - 1] ?? String(month);
}

/**
 * Day, written month and year: "5 april 2019", "5 April 2019",
 * "5 avril 2019" ("1er" on the first in French), "5. April 2019".
 */
export function formatLongDate(iso: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const l = letterLanguage(lang);
  const day = Number(m[3]);
  const month = MONTH_NAMES[l][Number(m[2]) - 1];
  if (l === "de") return `${day}. ${month} ${m[1]}`;
  if (l === "fr" && day === 1) return `1er ${month} ${m[1]}`;
  return `${day} ${month} ${m[1]}`;
}

/** "april 2019" from "2019-04". */
export function formatMonthYear(yyyyMm: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyyMm);
  if (!m) return yyyyMm;
  return `${formatMonthName(Number(m[2]), lang)} ${m[1]}`;
}

/** Country name for an ISO code in the given language; unknown codes pass through. */
export function formatCountry(code: string, lang: string): string {
  const names = COUNTRY_NAMES[(code || "").trim().toUpperCase()];
  return names ? names[letterLanguage(lang)] : code;
}
