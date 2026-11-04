import type { SupportedLanguage } from "@rentular/shared";
import { formatEur, formatLongDate, formatShortDate, letterLanguage } from "../lib/belgianFormat";

/**
 * What a reminder for part of a month's rent needs to explain itself: what
 * was due, what came in, and, when the tenant still paid the rent from before
 * an indexation, that old amount and the indexation date.
 */
export type RemainderContext = {
  expected: number;
  received: number;
  oldRent: number | null;
  indexationDate: string | null;
};

/**
 * Euro amount the way a Belgian reader in that language writes it:
 * "€ 70,00" in Dutch and English, "70,00 €" in French and German.
 */
export function formatReminderAmount(amount: number, lang: string): string {
  const l = letterLanguage(lang);
  if (l === "fr" || l === "de") return `${formatEur(amount).slice(2)} €`;
  return formatEur(amount);
}

/** Due date as dd/mm/yyyy. */
export function formatReminderDate(iso: string): string {
  return formatShortDate(String(iso));
}

type ContextCopy = { partial: string; indexation: string };

// Full sentences for emails.
const LONG_COPY: Record<SupportedLanguage, ContextCopy> = {
  en: {
    partial: "This is the remaining amount: we received {{received}} of the {{expected}} due for this month.",
    indexation:
      "Since the indexation of {{indexationDate}} the rent is {{expected}}. You still paid the previous amount of {{received}}, so this is the difference.",
  },
  nl: {
    partial: "Dit is het resterende bedrag: we ontvingen {{received}} van de {{expected}} voor deze maand.",
    indexation:
      "Sinds de indexering van {{indexationDate}} bedraagt de huur {{expected}}. U betaalde nog het vorige bedrag van {{received}}, dit is dus het verschil.",
  },
  fr: {
    partial: "Il s'agit du montant restant : nous avons reçu {{received}} sur les {{expected}} dus pour ce mois.",
    indexation:
      "Depuis l'indexation du {{indexationDate}}, le loyer s'élève à {{expected}}. Vous avez encore payé l'ancien montant de {{received}}, il s'agit donc de la différence.",
  },
  de: {
    partial: "Dies ist der Restbetrag: Wir haben {{received}} von den {{expected}} für diesen Monat erhalten.",
    indexation:
      "Seit der Indexierung vom {{indexationDate}} beträgt die Miete {{expected}}. Sie haben noch den bisherigen Betrag von {{received}} gezahlt, es geht also um die Differenz.",
  },
};

// Short versions for SMS and WhatsApp.
const SHORT_COPY: Record<SupportedLanguage, ContextCopy> = {
  en: {
    partial: "This is the remaining amount (received {{received}} of {{expected}}).",
    indexation: "This is the difference after the indexation: the rent is now {{expected}}, you paid {{received}}.",
  },
  nl: {
    partial: "Dit is het resterende bedrag (ontvangen: {{received}} van {{expected}}).",
    indexation: "Dit is het verschil na de indexering: de huur is nu {{expected}}, u betaalde {{received}}.",
  },
  fr: {
    partial: "Il s'agit du montant restant (reçu {{received}} sur {{expected}}).",
    indexation:
      "Il s'agit de la différence après l'indexation : le loyer est maintenant de {{expected}}, vous avez payé {{received}}.",
  },
  de: {
    partial: "Dies ist der Restbetrag (erhalten: {{received}} von {{expected}}).",
    indexation:
      "Dies ist die Differenz nach der Indexierung: Die Miete beträgt jetzt {{expected}}, Sie haben {{received}} gezahlt.",
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/**
 * The sentence that tells the tenant the amount is only what is still
 * missing for the month. Empty for a normal, fully unpaid rent.
 */
export function amountContextText(
  context: RemainderContext | null | undefined,
  lang: string,
  form: "long" | "short",
): string {
  if (!context || !(context.received > 0) || !(context.expected > context.received)) return "";
  const l = letterLanguage(lang);
  const copy = (form === "long" ? LONG_COPY : SHORT_COPY)[l];
  const vars = {
    expected: formatReminderAmount(context.expected, l),
    received: formatReminderAmount(context.received, l),
    indexationDate: context.indexationDate ? formatLongDate(context.indexationDate, l) : "",
  };
  const useIndexation = context.oldRent != null && !!context.indexationDate;
  return fill(useIndexation ? copy.indexation : copy.partial, vars);
}

/**
 * Make sure a template shows the amount context. A template with an
 * {{amountContext}} placeholder is left as it is. Otherwise, for an email, the
 * context goes in its own paragraph right after the paragraph that names
 * {{amount}} (or after the first paragraph of the letter body); for a short
 * message it goes before a trailing " - {{ownerName}}" signature, or at the end.
 */
export function withAmountContext(template: string, form: "long" | "short"): string {
  if (template.includes("{{amountContext}}")) return template;
  if (form === "short") {
    const sig = " - {{ownerName}}";
    if (template.endsWith(sig)) return `${template.slice(0, -sig.length)} {{amountContext}}${sig}`;
    return `${template} {{amountContext}}`;
  }
  const paragraphs = template.split(/\n{2,}/);
  let at = paragraphs.findIndex((p) => p.includes("{{amount}}"));
  if (at < 0) at = Math.min(1, paragraphs.length - 1);
  paragraphs.splice(at + 1, 0, "{{amountContext}}");
  return paragraphs.join("\n\n");
}

/**
 * Render a reminder template. With an amount context the sentence is added
 * (see withAmountContext); without one an {{amountContext}} placeholder just
 * disappears, together with the blank line it would leave.
 */
export function renderReminderTemplate(
  template: string,
  vars: Record<string, string>,
  form: "long" | "short",
): string {
  const context = vars.amountContext ?? "";
  const source = context ? withAmountContext(template, form) : template;
  if (context || !template.includes("{{amountContext}}")) {
    return fill(source, { ...vars, amountContext: context });
  }
  const emptied = template
    .replace(/\n{2,}\{\{amountContext\}\}(?=\n|$)/g, "")
    .replace(/ \{\{amountContext\}\}/g, "")
    .replace(/\{\{amountContext\}\}/g, "");
  return fill(emptied, vars);
}
