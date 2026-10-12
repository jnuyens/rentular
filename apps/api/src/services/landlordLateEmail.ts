import { sendEmail } from "../lib/email";
import { signLandlordActionToken, type LandlordAction } from "../lib/landlordActionToken";

// "late": overdue notice. "due": heads-up on the due date itself.
// "final_pending": the automatic third reminder is about to go to the tenant;
// the landlord can still mark paid, record the payment, or hold it.
export type LandlordEmailKind = "late" | "due" | "final_pending";

type TenantChannel = "email" | "sms" | "whatsapp";

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
  kind?: LandlordEmailKind; // defaults to "late"
  channel?: TenantChannel; // final_pending: channel the third reminder will use
  sendOn?: string; // final_pending: yyyy-mm-dd the third reminder goes out
}

// A link target: a signed one-click action, or "record" (the web app's
// payments page, behind normal login, so no token).
type LinkTarget = LandlordAction | "record";

interface EmailOption {
  label: string;
  link?: LinkTarget;
}

interface CopyVars {
  propertyName: string;
  period: string;
  sendOnFmt: string;
  channelName: string;
}

interface KindCopy {
  subject: (v: CopyVars) => string;
  lead: (v: CopyVars) => string;
  options: (v: CopyVars) => EmailOption[];
}

interface LangCopy {
  greeting: string;
  tenant: string;
  periodLabel: string;
  amount: string;
  dueDate: string;
  daysLabel: string;
  question: string;
  channels: Record<TenantChannel, string>;
  kinds: Record<LandlordEmailKind, KindCopy>;
}

// Whether the "days late" line is shown for a kind.
const SHOW_DAYS: Record<LandlordEmailKind, boolean> = {
  late: true,
  due: false,
  final_pending: true,
};

function standardOptions(labels: [string, string, string, string]): () => EmailOption[] {
  return () => [
    { label: labels[0], link: "paid" },
    { label: labels[1], link: "wait" },
    { label: labels[2], link: "remind" },
    { label: labels[3], link: "off" },
  ];
}

const EN_STANDARD = standardOptions([
  "The tenant has paid (mark as paid):",
  "Not paid yet, just wait:",
  "Send a reminder to the tenant:",
  "Turn off these emails for this property:",
]);
const NL_STANDARD = standardOptions([
  "De huurder heeft betaald (markeer als betaald):",
  "Nog niet betaald, gewoon wachten:",
  "Stuur een herinnering naar de huurder:",
  "Schakel deze e-mails uit voor dit pand:",
]);
const FR_STANDARD = standardOptions([
  "Le locataire a paye (marquer comme paye) :",
  "Pas encore paye, attendre :",
  "Envoyer un rappel au locataire :",
  "Desactiver ces e-mails pour ce bien :",
]);
const DE_STANDARD = standardOptions([
  "Der Mieter hat bezahlt (als bezahlt markieren):",
  "Noch nicht bezahlt, einfach warten:",
  "Eine Erinnerung an den Mieter senden:",
  "Diese E-Mails fuer diese Immobilie deaktivieren:",
]);

const COPY: Record<string, LangCopy> = {
  en: {
    greeting: "Hello,",
    tenant: "tenant",
    periodLabel: "Rent period",
    amount: "Amount",
    dueDate: "Due date",
    daysLabel: "Overdue by",
    question: "What would you like to do? Click one of the links below:",
    channels: { email: "e-mail", sms: "SMS", whatsapp: "WhatsApp" },
    kinds: {
      late: {
        subject: (v) => `Late rent: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `This is about the rent for the period ${v.period}.`,
        options: EN_STANDARD,
      },
      due: {
        subject: (v) => `Rent due today: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `This rent is due today. It is for the period ${v.period}.`,
        options: EN_STANDARD,
      },
      final_pending: {
        subject: (v) => `Third reminder pending: ${v.propertyName} -- ${v.period}`,
        lead: (v) =>
          `The tenant has not paid the rent for the period ${v.period} after two reminders. Unless you act, a third and last reminder goes to the tenant via ${v.channelName} on ${v.sendOnFmt}.`,
        options: (v) => [
          { label: "The tenant has already paid (mark as paid):", link: "paid" },
          { label: "Record the payment details (amount, date) in Rentular:", link: "record" },
          { label: "Hold the reminder, I will handle it myself:", link: "hold" },
          { label: `Do nothing: the third reminder is sent automatically on ${v.sendOnFmt}.` },
        ],
      },
    },
  },
  nl: {
    greeting: "Hallo,",
    tenant: "huurder",
    periodLabel: "Huurperiode",
    amount: "Bedrag",
    dueDate: "Vervaldag",
    daysLabel: "Aantal dagen te laat",
    question: "Wat wil je doen? Klik een van onderstaande links:",
    channels: { email: "e-mail", sms: "SMS", whatsapp: "WhatsApp" },
    kinds: {
      late: {
        subject: (v) => `Late huur: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Dit gaat over de huur voor de periode ${v.period}.`,
        options: NL_STANDARD,
      },
      due: {
        subject: (v) => `Huur vervalt vandaag: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Deze huur vervalt vandaag en gaat over de periode ${v.period}.`,
        options: NL_STANDARD,
      },
      final_pending: {
        subject: (v) => `Derde herinnering staat klaar: ${v.propertyName} -- ${v.period}`,
        lead: (v) =>
          `De huurder heeft de huur voor de periode ${v.period} na twee herinneringen nog niet betaald. Als je niets doet, krijgt de huurder op ${v.sendOnFmt} via ${v.channelName} een derde en laatste herinnering.`,
        options: (v) => [
          { label: "De huurder heeft al betaald (markeer als betaald):", link: "paid" },
          { label: "Noteer de betaalgegevens (bedrag, datum) in Rentular:", link: "record" },
          { label: "Hou de herinnering tegen, ik regel het zelf:", link: "hold" },
          { label: `Niets doen: de derde herinnering vertrekt automatisch op ${v.sendOnFmt}.` },
        ],
      },
    },
  },
  fr: {
    greeting: "Bonjour,",
    tenant: "locataire",
    periodLabel: "Periode de location",
    amount: "Montant",
    dueDate: "Echeance",
    daysLabel: "Retard",
    question: "Que souhaitez-vous faire ? Cliquez sur l'un des liens ci-dessous :",
    channels: { email: "e-mail", sms: "SMS", whatsapp: "WhatsApp" },
    kinds: {
      late: {
        subject: (v) => `Loyer en retard: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Ceci concerne le loyer pour la periode ${v.period}.`,
        options: FR_STANDARD,
      },
      due: {
        subject: (v) => `Loyer du aujourd'hui: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Ce loyer est du aujourd'hui. Il concerne la periode ${v.period}.`,
        options: FR_STANDARD,
      },
      final_pending: {
        subject: (v) => `Troisieme rappel en attente : ${v.propertyName} -- ${v.period}`,
        lead: (v) =>
          `Le locataire n'a pas paye le loyer pour la periode ${v.period} apres deux rappels. Sauf action de votre part, un troisieme et dernier rappel sera envoye au locataire par ${v.channelName} le ${v.sendOnFmt}.`,
        options: (v) => [
          { label: "Le locataire a deja paye (marquer comme paye) :", link: "paid" },
          { label: "Enregistrer les details du paiement (montant, date) dans Rentular :", link: "record" },
          { label: "Retenir le rappel, je m'en occupe :", link: "hold" },
          { label: `Ne rien faire : le troisieme rappel part automatiquement le ${v.sendOnFmt}.` },
        ],
      },
    },
  },
  de: {
    greeting: "Hallo,",
    tenant: "Mieter",
    periodLabel: "Mietzeitraum",
    amount: "Betrag",
    dueDate: "Faelligkeit",
    daysLabel: "Ueberfaellig",
    question: "Was moechten Sie tun? Klicken Sie auf einen der Links unten:",
    channels: { email: "E-Mail", sms: "SMS", whatsapp: "WhatsApp" },
    kinds: {
      late: {
        subject: (v) => `Miete ueberfaellig: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Dies betrifft die Miete fuer den Zeitraum ${v.period}.`,
        options: DE_STANDARD,
      },
      due: {
        subject: (v) => `Miete heute faellig: ${v.propertyName} -- ${v.period}`,
        lead: (v) => `Diese Miete ist heute faellig. Sie betrifft den Zeitraum ${v.period}.`,
        options: DE_STANDARD,
      },
      final_pending: {
        subject: (v) => `Dritte Erinnerung steht an: ${v.propertyName} -- ${v.period}`,
        lead: (v) =>
          `Der Mieter hat die Miete fuer den Zeitraum ${v.period} nach zwei Erinnerungen noch nicht bezahlt. Wenn Sie nichts tun, erhaelt der Mieter am ${v.sendOnFmt} per ${v.channelName} eine dritte und letzte Erinnerung.`,
        options: (v) => [
          { label: "Der Mieter hat bereits bezahlt (als bezahlt markieren):", link: "paid" },
          { label: "Zahlungsdetails (Betrag, Datum) in Rentular erfassen:", link: "record" },
          { label: "Erinnerung zurueckhalten, ich kuemmere mich selbst darum:", link: "hold" },
          { label: `Nichts tun: die dritte Erinnerung geht am ${v.sendOnFmt} automatisch raus.` },
        ],
      },
    },
  },
};

interface BodyVars {
  lead: string;
  propertyName: string;
  tenantName: string;
  period: string;
  amountFmt: string;
  dueDateFmt: string;
  daysPastDue: number;
  showDays: boolean;
  options: { label: string; url?: string }[];
}

// One body layout for every kind: details block, then numbered options with
// the link (if any) on the line below each option.
function renderBody(copy: LangCopy, v: BodyVars): string {
  const daysLine = v.showDays ? `${copy.daysLabel}: ${v.daysPastDue}\n` : "";
  const options = v.options
    .map((o, i) => `${i + 1}) ${o.label}\n${o.url ? `${o.url}\n` : ""}\n`)
    .join("");
  return (
    `${copy.greeting}\n\n${v.lead}\n\n` +
    `${v.propertyName} (${copy.tenant} ${v.tenantName})\n` +
    `${copy.periodLabel}: ${v.period}\n` +
    `${copy.amount}: ${v.amountFmt}\n` +
    `${copy.dueDate}: ${v.dueDateFmt}\n` +
    `${daysLine}\n` +
    `${copy.question}\n\n` +
    `${options}Rentular\n`
  );
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
 * rent payment, with one-click magic links. `kind` is "late" for an overdue
 * notice, "due" for a heads-up on the due date (both: mark paid / wait / remind
 * tenant / turn off), or "final_pending" before the automatic third reminder
 * (mark paid / record payment / hold / do nothing). Localized to the owner's
 * locale.
 */
export async function sendLandlordLateEmail(input: LateEmailInput): Promise<void> {
  if (!input.to) return; // nobody to send to
  const lang = (input.ownerLocale || "en").slice(0, 2);
  const kind: LandlordEmailKind = input.kind || "late";
  const copy = COPY[lang] || COPY.en!;
  const kindCopy = copy.kinds[kind];

  const range = periodRange(input.dueDate);
  const connector = RANGE_CONNECTOR[lang] || RANGE_CONNECTOR.en!;
  const period = connector(range.from, range.till);

  const copyVars: CopyVars = {
    propertyName: input.propertyName,
    period,
    sendOnFmt: input.sendOn ? formatDueDate(input.sendOn) : "",
    channelName: copy.channels[input.channel || "email"],
  };
  const options = kindCopy.options(copyVars);

  // Sign tokens only for the actions this kind actually offers.
  const base = (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");
  const urlFor = async (target: LinkTarget): Promise<string> =>
    target === "record"
      ? `${base}/payments`
      : `${base}/api/v1/landlord-action/${await signLandlordActionToken(target, input.paymentId)}`;
  const rendered = await Promise.all(
    options.map(async (o) => ({ label: o.label, url: o.link ? await urlFor(o.link) : undefined })),
  );

  await sendEmail({
    to: input.to,
    cc: input.cc,
    subject: kindCopy.subject(copyVars),
    body: renderBody(copy, {
      lead: kindCopy.lead(copyVars),
      propertyName: input.propertyName,
      tenantName: input.tenantName,
      period,
      amountFmt: `EUR ${input.amount.toFixed(2)}`,
      dueDateFmt: formatDueDate(input.dueDate),
      daysPastDue: input.daysPastDue,
      showDays: SHOW_DAYS[kind],
      options: rendered,
    }),
  });
}
