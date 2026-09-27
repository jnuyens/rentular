import { sendEmail } from "../lib/email";
import { signLandlordActionToken } from "../lib/landlordActionToken";

interface LateEmailInput {
  paymentId: string;
  ownerEmail: string;
  ownerLocale: string;
  tenantName: string;
  propertyName: string;
  amount: number;
  dueDate: string;
  daysPastDue: number;
}

interface Links {
  paid: string;
  wait: string;
  remind: string;
  off: string;
}

type RenderVars = LateEmailInput & Links & { period: string; dueDateFmt: string; amountFmt: string };

type Template = {
  subject: (v: RenderVars) => string;
  body: (v: RenderVars) => string;
};

const TEMPLATES: Record<string, Template> = {
  en: {
    subject: (v) => `Late rent: ${v.propertyName} -- ${v.period}`,
    body: (v) =>
      `Hello,\n\nThis is about the rent for the period ${v.period}.\n\n${v.propertyName} (tenant ${v.tenantName})\nPeriod: ${v.period}\nAmount: ${v.amountFmt}\nDue date: ${v.dueDateFmt}\nOverdue by: ${v.daysPastDue} day(s)\n\nWhat would you like to do? Click one of the links below:\n\n1) The tenant has paid (mark as paid):\n${v.paid}\n\n2) Not paid yet, just wait:\n${v.wait}\n\n3) Send a reminder to the tenant:\n${v.remind}\n\n4) Turn off these emails for this property:\n${v.off}\n\nRentular\n`,
  },
  nl: {
    subject: (v) => `Late huur: ${v.propertyName} -- ${v.period}`,
    body: (v) =>
      `Hallo,\n\nDit gaat over de huur voor de periode ${v.period}.\n\n${v.propertyName} (huurder ${v.tenantName})\nHuurperiode: ${v.period}\nBedrag: ${v.amountFmt}\nVervaldag: ${v.dueDateFmt}\nAantal dagen te laat: ${v.daysPastDue}\n\nWat wil je doen? Klik een van onderstaande links:\n\n1) De huurder heeft betaald (markeer als betaald):\n${v.paid}\n\n2) Nog niet betaald, gewoon wachten:\n${v.wait}\n\n3) Stuur een herinnering naar de huurder:\n${v.remind}\n\n4) Schakel deze e-mails uit voor dit pand:\n${v.off}\n\nRentular\n`,
  },
  fr: {
    subject: (v) => `Loyer en retard: ${v.propertyName} -- ${v.period}`,
    body: (v) =>
      `Bonjour,\n\nCeci concerne le loyer pour la periode ${v.period}.\n\n${v.propertyName} (locataire ${v.tenantName})\nPeriode: ${v.period}\nMontant: ${v.amountFmt}\nEcheance: ${v.dueDateFmt}\nRetard: ${v.daysPastDue} jour(s)\n\nQue souhaitez-vous faire ? Cliquez sur l'un des liens ci-dessous :\n\n1) Le locataire a paye (marquer comme paye) :\n${v.paid}\n\n2) Pas encore paye, attendre :\n${v.wait}\n\n3) Envoyer un rappel au locataire :\n${v.remind}\n\n4) Desactiver ces e-mails pour ce bien :\n${v.off}\n\nRentular\n`,
  },
  de: {
    subject: (v) => `Miete ueberfaellig: ${v.propertyName} -- ${v.period}`,
    body: (v) =>
      `Hallo,\n\nDies betrifft die Miete fuer den Zeitraum ${v.period}.\n\n${v.propertyName} (Mieter ${v.tenantName})\nZeitraum: ${v.period}\nBetrag: ${v.amountFmt}\nFaelligkeit: ${v.dueDateFmt}\nUeberfaellig: ${v.daysPastDue} Tag(e)\n\nWas moechten Sie tun? Klicken Sie auf einen der Links unten:\n\n1) Der Mieter hat bezahlt (als bezahlt markieren):\n${v.paid}\n\n2) Noch nicht bezahlt, einfach warten:\n${v.wait}\n\n3) Eine Erinnerung an den Mieter senden:\n${v.remind}\n\n4) Diese E-Mails fuer diese Immobilie deaktivieren:\n${v.off}\n\nRentular\n`,
  },
};

const LOCALE_TAG: Record<string, string> = {
  nl: "nl-BE",
  fr: "fr-BE",
  de: "de-DE",
  en: "en-GB",
};

// The rent period (month + year) that the due date falls in, e.g. "september 2026".
function periodLabel(dueDate: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  if (!m) return dueDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString(LOCALE_TAG[lang] || "en-GB", {
    month: "long",
    year: "numeric",
  });
}

// dd/mm/yyyy without timezone drift.
function formatDueDate(dueDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dueDate;
}

/**
 * Email the landlord that a rent payment is late, with four one-click magic
 * links (mark paid / wait / remind tenant / turn off). Localized to the
 * owner's locale.
 */
export async function sendLandlordLateEmail(input: LateEmailInput): Promise<void> {
  const [paid, wait, remind, off] = await Promise.all([
    signLandlordActionToken("paid", input.paymentId),
    signLandlordActionToken("wait", input.paymentId),
    signLandlordActionToken("remind", input.paymentId),
    signLandlordActionToken("off", input.paymentId),
  ]);
  const base = (process.env.WEB_URL || "https://www.rentular.com").replace(
    /\/$/,
    "",
  );
  const link = (tok: string) => `${base}/api/v1/landlord-action/${tok}`;
  const lang = (input.ownerLocale || "en").slice(0, 2);
  const tpl = TEMPLATES[lang] || TEMPLATES.en!;

  const vars = {
    ...input,
    paid: link(paid),
    wait: link(wait),
    remind: link(remind),
    off: link(off),
    period: periodLabel(input.dueDate, lang),
    dueDateFmt: formatDueDate(input.dueDate),
    amountFmt: `EUR ${input.amount.toFixed(2)}`,
  };

  await sendEmail({
    to: input.ownerEmail,
    subject: tpl.subject(vars),
    body: tpl.body(vars),
  });
}
