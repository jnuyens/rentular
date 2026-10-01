import { sendEmail } from "../lib/email";
import { signLandlordActionToken } from "../lib/landlordActionToken";

export type LandlordEmailKind = "late" | "due";

interface LateEmailInput {
  paymentId: string;
  to: string; // primary recipient(s), comma-joined
  cc?: string; // CC recipient(s), comma-joined
  ownerLocale: string;
  tenantName: string;
  propertyName: string;
  amount: number;
  dueDate: string;
  daysPastDue: number;
  kind?: LandlordEmailKind; // "late" (overdue) or "due" (heads-up on the due date)
}

interface Links {
  paid: string;
  wait: string;
  remind: string;
  off: string;
}

type RenderVars = LateEmailInput &
  Links & {
    period: string;
    periodFrom: string;
    periodTill: string;
    dueDateFmt: string;
    amountFmt: string;
    kind: LandlordEmailKind;
    lead: string;
    daysLine: string;
  };

type Template = {
  subject: (v: RenderVars) => string;
  body: (v: RenderVars) => string;
};

// Per-language, per-kind: the subject, the lead sentence, and the "days late"
// line (empty for a due-date heads-up).
const COPY: Record<
  string,
  {
    subjectLate: (v: RenderVars) => string;
    subjectDue: (v: RenderVars) => string;
    leadLate: (v: RenderVars) => string;
    leadDue: (v: RenderVars) => string;
    daysLabel: string;
  }
> = {
  en: {
    subjectLate: (v) => `Late rent: ${v.propertyName} -- ${v.period}`,
    subjectDue: (v) => `Rent due today: ${v.propertyName} -- ${v.period}`,
    leadLate: (v) => `This is about the rent for the period ${v.period}.`,
    leadDue: (v) => `This rent is due today. It is for the period ${v.period}.`,
    daysLabel: "Overdue by",
  },
  nl: {
    subjectLate: (v) => `Late huur: ${v.propertyName} -- ${v.period}`,
    subjectDue: (v) => `Huur vervalt vandaag: ${v.propertyName} -- ${v.period}`,
    leadLate: (v) => `Dit gaat over de huur voor de periode ${v.period}.`,
    leadDue: (v) => `Deze huur vervalt vandaag en gaat over de periode ${v.period}.`,
    daysLabel: "Aantal dagen te laat",
  },
  fr: {
    subjectLate: (v) => `Loyer en retard: ${v.propertyName} -- ${v.period}`,
    subjectDue: (v) => `Loyer du aujourd'hui: ${v.propertyName} -- ${v.period}`,
    leadLate: (v) => `Ceci concerne le loyer pour la periode ${v.period}.`,
    leadDue: (v) => `Ce loyer est du aujourd'hui. Il concerne la periode ${v.period}.`,
    daysLabel: "Retard",
  },
  de: {
    subjectLate: (v) => `Miete ueberfaellig: ${v.propertyName} -- ${v.period}`,
    subjectDue: (v) => `Miete heute faellig: ${v.propertyName} -- ${v.period}`,
    leadLate: (v) => `Dies betrifft die Miete fuer den Zeitraum ${v.period}.`,
    leadDue: (v) => `Diese Miete ist heute faellig. Sie betrifft den Zeitraum ${v.period}.`,
    daysLabel: "Ueberfaellig",
  },
};

const BODY: Record<string, (v: RenderVars) => string> = {
  en: (v) =>
    `Hello,\n\n${v.lead}\n\n${v.propertyName} (tenant ${v.tenantName})\nRent period: ${v.period}\nAmount: ${v.amountFmt}\nDue date: ${v.dueDateFmt}\n${v.daysLine}\nWhat would you like to do? Click one of the links below:\n\n1) The tenant has paid (mark as paid):\n${v.paid}\n\n2) Not paid yet, just wait:\n${v.wait}\n\n3) Send a reminder to the tenant:\n${v.remind}\n\n4) Turn off these emails for this property:\n${v.off}\n\nRentular\n`,
  nl: (v) =>
    `Hallo,\n\n${v.lead}\n\n${v.propertyName} (huurder ${v.tenantName})\nHuurperiode: ${v.period}\nBedrag: ${v.amountFmt}\nVervaldag: ${v.dueDateFmt}\n${v.daysLine}\nWat wil je doen? Klik een van onderstaande links:\n\n1) De huurder heeft betaald (markeer als betaald):\n${v.paid}\n\n2) Nog niet betaald, gewoon wachten:\n${v.wait}\n\n3) Stuur een herinnering naar de huurder:\n${v.remind}\n\n4) Schakel deze e-mails uit voor dit pand:\n${v.off}\n\nRentular\n`,
  fr: (v) =>
    `Bonjour,\n\n${v.lead}\n\n${v.propertyName} (locataire ${v.tenantName})\nPeriode de location: ${v.period}\nMontant: ${v.amountFmt}\nEcheance: ${v.dueDateFmt}\n${v.daysLine}\nQue souhaitez-vous faire ? Cliquez sur l'un des liens ci-dessous :\n\n1) Le locataire a paye (marquer comme paye) :\n${v.paid}\n\n2) Pas encore paye, attendre :\n${v.wait}\n\n3) Envoyer un rappel au locataire :\n${v.remind}\n\n4) Desactiver ces e-mails pour ce bien :\n${v.off}\n\nRentular\n`,
  de: (v) =>
    `Hallo,\n\n${v.lead}\n\n${v.propertyName} (Mieter ${v.tenantName})\nMietzeitraum: ${v.period}\nBetrag: ${v.amountFmt}\nFaelligkeit: ${v.dueDateFmt}\n${v.daysLine}\nWas moechten Sie tun? Klicken Sie auf einen der Links unten:\n\n1) Der Mieter hat bezahlt (als bezahlt markieren):\n${v.paid}\n\n2) Noch nicht bezahlt, einfach warten:\n${v.wait}\n\n3) Eine Erinnerung an den Mieter senden:\n${v.remind}\n\n4) Diese E-Mails fuer diese Immobilie deaktivieren:\n${v.off}\n\nRentular\n`,
};

function buildTemplate(lang: string): Template {
  const copy = COPY[lang] || COPY.en!;
  const body = BODY[lang] || BODY.en!;
  return {
    subject: (v) => (v.kind === "due" ? copy.subjectDue(v) : copy.subjectLate(v)),
    body: (v) => body(v),
  };
}

const RANGE_CONNECTOR: Record<string, (from: string, till: string) => string> = {
  nl: (f, t) => `${f} t/m ${t}`,
  en: (f, t) => `${f} to ${t}`,
  fr: (f, t) => `du ${f} au ${t}`,
  de: (f, t) => `${f} bis ${t}`,
};

// dd/mm/yyyy without timezone drift.
function fmt(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d)}/${p(m)}/${y}`;
}

// The exact rent period a payment covers: from its due date up to the day before
// the next due date (same day next month, clamped), so it is contract-specific.
function periodRange(dueDate: string): { from: string; till: string } {
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  if (!mm) return { from: dueDate, till: dueDate };
  const y = Number(mm[1]);
  const m = Number(mm[2]);
  const d = Number(mm[3]);
  let ny = y;
  let nmo = m + 1;
  if (nmo > 12) {
    nmo = 1;
    ny += 1;
  }
  const nextMonthLastDay = new Date(ny, nmo, 0).getDate();
  const nextDueDay = Math.min(d, nextMonthLastDay);
  const till = new Date(ny, nmo - 1, nextDueDay);
  till.setDate(till.getDate() - 1); // day before the next due date
  return {
    from: fmt(y, m, d),
    till: fmt(till.getFullYear(), till.getMonth() + 1, till.getDate()),
  };
}

function formatDueDate(dueDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dueDate;
}

/**
 * Email the landlord (the property's manager(s), with the owner in CC) about a
 * rent payment, with four one-click magic links (mark paid / wait / remind
 * tenant / turn off). `kind` is "late" for an overdue notice or "due" for a
 * heads-up on the due date itself. Localized to the owner's locale.
 */
export async function sendLandlordLateEmail(input: LateEmailInput): Promise<void> {
  if (!input.to) return; // nobody to send to
  const [paid, wait, remind, off] = await Promise.all([
    signLandlordActionToken("paid", input.paymentId),
    signLandlordActionToken("wait", input.paymentId),
    signLandlordActionToken("remind", input.paymentId),
    signLandlordActionToken("off", input.paymentId),
  ]);
  const base = (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");
  const link = (tok: string) => `${base}/api/v1/landlord-action/${tok}`;
  const lang = (input.ownerLocale || "en").slice(0, 2);
  const kind: LandlordEmailKind = input.kind || "late";
  const tpl = buildTemplate(lang);
  const copy = COPY[lang] || COPY.en!;

  const range = periodRange(input.dueDate);
  const connector = RANGE_CONNECTOR[lang] || RANGE_CONNECTOR.en!;
  const period = connector(range.from, range.till);

  const vars: RenderVars = {
    ...input,
    kind,
    paid: link(paid),
    wait: link(wait),
    remind: link(remind),
    off: link(off),
    period,
    periodFrom: range.from,
    periodTill: range.till,
    dueDateFmt: formatDueDate(input.dueDate),
    amountFmt: `EUR ${input.amount.toFixed(2)}`,
    lead: "",
    daysLine: "",
  };
  vars.lead = kind === "due" ? copy.leadDue(vars) : copy.leadLate(vars);
  vars.daysLine = kind === "due" ? "" : `${copy.daysLabel}: ${input.daysPastDue}\n`;

  await sendEmail({
    to: input.to,
    cc: input.cc,
    subject: tpl.subject(vars),
    body: tpl.body(vars),
  });
}
