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

type Template = {
  subject: (property: string) => string;
  body: (v: LateEmailInput & Links) => string;
};

const TEMPLATES: Record<string, Template> = {
  en: {
    subject: (p) => `Late rent: ${p}`,
    body: (v) =>
      `Hello,\n\nThe rent for ${v.propertyName} (tenant ${v.tenantName}) of ${v.amount} EUR, due ${v.dueDate}, is ${v.daysPastDue} day(s) late.\n\nWhat would you like to do? Click one of the links below:\n\n1) The tenant has paid (mark as paid):\n${v.paid}\n\n2) Not paid yet, just wait:\n${v.wait}\n\n3) Send a reminder to the tenant:\n${v.remind}\n\n4) Turn off these emails for this property:\n${v.off}\n\nRentular\n`,
  },
  nl: {
    subject: (p) => `Late huur: ${p}`,
    body: (v) =>
      `Hallo,\n\nDe huur voor ${v.propertyName} (huurder ${v.tenantName}) van ${v.amount} EUR, vervaldag ${v.dueDate}, is ${v.daysPastDue} dag(en) te laat.\n\nWat wil je doen? Klik een van onderstaande links:\n\n1) De huurder heeft betaald (markeer als betaald):\n${v.paid}\n\n2) Nog niet betaald, gewoon wachten:\n${v.wait}\n\n3) Stuur een herinnering naar de huurder:\n${v.remind}\n\n4) Schakel deze e-mails uit voor dit pand:\n${v.off}\n\nRentular\n`,
  },
  fr: {
    subject: (p) => `Loyer en retard: ${p}`,
    body: (v) =>
      `Bonjour,\n\nLe loyer pour ${v.propertyName} (locataire ${v.tenantName}) de ${v.amount} EUR, échéance ${v.dueDate}, a ${v.daysPastDue} jour(s) de retard.\n\nQue souhaitez-vous faire ? Cliquez sur l'un des liens ci-dessous :\n\n1) Le locataire a payé (marquer comme payé) :\n${v.paid}\n\n2) Pas encore payé, attendre :\n${v.wait}\n\n3) Envoyer un rappel au locataire :\n${v.remind}\n\n4) Désactiver ces e-mails pour ce bien :\n${v.off}\n\nRentular\n`,
  },
  de: {
    subject: (p) => `Miete überfällig: ${p}`,
    body: (v) =>
      `Hallo,\n\nDie Miete für ${v.propertyName} (Mieter ${v.tenantName}) von ${v.amount} EUR, fällig am ${v.dueDate}, ist ${v.daysPastDue} Tag(e) überfällig.\n\nWas möchten Sie tun? Klicken Sie auf einen der Links unten:\n\n1) Der Mieter hat bezahlt (als bezahlt markieren):\n${v.paid}\n\n2) Noch nicht bezahlt, einfach warten:\n${v.wait}\n\n3) Eine Erinnerung an den Mieter senden:\n${v.remind}\n\n4) Diese E-Mails für diese Immobilie deaktivieren:\n${v.off}\n\nRentular\n`,
  },
};

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

  await sendEmail({
    to: input.ownerEmail,
    subject: tpl.subject(input.propertyName),
    body: tpl.body({
      ...input,
      paid: link(paid),
      wait: link(wait),
      remind: link(remind),
      off: link(off),
    }),
  });
}
