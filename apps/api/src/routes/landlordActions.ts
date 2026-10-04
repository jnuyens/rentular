/**
 * Public one-click endpoints for the late-payment landlord email. Each link in
 * that email carries a signed token (see lib/landlordActionToken). No login is
 * required — the token is the authentication. Actions are idempotent.
 *
 *   paid   -> mark the payment paid
 *   wait   -> acknowledge, do nothing (no reminder)
 *   remind -> send a reminder to the tenant (reuses the follow-up sender)
 *             ?channel=sms sends it as an SMS instead of email
 *   off    -> turn off late-payment emails for this contract
 *
 * Mounted at /api/v1/landlord-action (public: not behind requireAuth; GET, so
 * the CSRF middleware does not apply).
 */

import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import {
  getDb,
  payments,
  leases,
  tenants,
  leaseTenants,
  properties,
  users,
} from "@rentular/db";
import { verifyLandlordActionToken } from "../lib/landlordActionToken";
import { sendReminder, DEFAULT_SETTINGS } from "../services/paymentFollowUp";
import { getLandlordNotificationRecipients } from "../lib/notificationRecipients";
import { isSmsConfigured, normalizePhoneNumber } from "../lib/sms";
import { queueSms } from "../jobs/smsQueueWorker";
import { renderTemplate } from "../lib/email";
import { DEFAULT_SMS_TEMPLATES, type SupportedLanguage } from "@rentular/shared";

export const landlordActionsRouter = new Hono();

type MsgKey = "paid" | "wait" | "off" | "invalid" | "notfound";

const MESSAGES: Record<string, Record<MsgKey, string>> = {
  en: {
    paid: "Marked as paid. Thank you.",
    wait: "Okay, we'll keep waiting. No reminder was sent.",
    off: "Late-payment emails are now turned off for this property. You can turn them back on from the contract page.",
    invalid: "This link is invalid or has expired.",
    notfound: "This payment could not be found.",
  },
  nl: {
    paid: "Gemarkeerd als betaald. Bedankt.",
    wait: "Oké, we wachten nog even. Er is geen herinnering verstuurd.",
    off: "E-mails over late betalingen zijn nu uitgeschakeld voor dit pand. Je kunt ze weer inschakelen via de contractpagina.",
    invalid: "Deze link is ongeldig of verlopen.",
    notfound: "Deze betaling kon niet worden gevonden.",
  },
  fr: {
    paid: "Marqué comme payé. Merci.",
    wait: "D'accord, nous attendons encore. Aucun rappel n'a été envoyé.",
    off: "Les e-mails de retard de paiement sont désactivés pour ce bien. Vous pouvez les réactiver depuis la page du contrat.",
    invalid: "Ce lien est invalide ou a expiré.",
    notfound: "Ce paiement est introuvable.",
  },
  de: {
    paid: "Als bezahlt markiert. Danke.",
    wait: "In Ordnung, wir warten noch. Es wurde keine Erinnerung gesendet.",
    off: "E-Mails zu Zahlungsverzug sind für diese Immobilie jetzt deaktiviert. Sie können sie auf der Vertragsseite wieder aktivieren.",
    invalid: "Dieser Link ist ungültig oder abgelaufen.",
    notfound: "Diese Zahlung wurde nicht gefunden.",
  },
};

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function fmtDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function renderHtml(c: Context, lang: string, bodyHtml: string) {
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rentular</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem}.card{background:#fff;padding:2rem 2.5rem;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:480px;text-align:center}h1{font-size:1.25rem;margin:0 0 .75rem;color:#111}p{color:#444;line-height:1.55;margin:0 0 .6rem}.detail{background:#f5f5f7;border-radius:10px;padding:.75rem 1rem;margin:.75rem 0;text-align:left;font-size:.95rem;color:#333}.muted{color:#777;font-size:.85rem}</style></head><body><div class="card"><h1>Rentular</h1>${bodyHtml}</div></body></html>`;
  return c.html(html);
}

function renderKey(c: Context, lang: string, key: MsgKey) {
  const table = MESSAGES[lang] || MESSAGES.en!;
  const msg = table[key] || MESSAGES.en![key];
  return renderHtml(c, lang, `<p>${esc(msg)}</p>`);
}

interface ReminderContext {
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string | null;
  tenantLanguage: SupportedLanguage;
  propertyName: string;
  amount: number;
  dueDate: string;
  daysPastDue: number;
  ownerId: string;
  ownerName: string;
  ownerEmail: string | null;
  cc: string; // landlord recipients to copy
}

/** Gather everything needed to send a reminder for a payment. */
async function loadReminderContext(
  db: ReturnType<typeof getDb>,
  paymentId: string,
  leaseId: string,
  ownerId: string,
): Promise<ReminderContext | null> {
  const p = await db
    .select({ amount: payments.amount, dueDate: payments.dueDate })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  const lease = await db
    .select({ propertyId: leases.propertyId })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  const tenant = await db
    .select({
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      email: tenants.email,
      phone: tenants.phone,
      language: tenants.language,
    })
    .from(leaseTenants)
    .innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
    .where(and(eq(leaseTenants.leaseId, leaseId), eq(leaseTenants.isPrimary, true)))
    .limit(1);
  if (!p[0] || !lease[0] || !tenant[0]?.email) return null;

  const prop = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.id, lease[0].propertyId))
    .limit(1);
  const owner = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);

  const dueMs = new Date(p[0].dueDate).getTime();
  const daysPastDue = Math.max(0, Math.floor((Date.now() - dueMs) / 86_400_000));

  // CC the landlord people (managers + owner) on the reminder.
  const rec = await getLandlordNotificationRecipients(lease[0].propertyId, owner[0]?.email);
  const ccParts = [rec.to, rec.cc].filter(Boolean) as string[];
  const cc = Array.from(new Set(ccParts.join(", ").split(",").map((s) => s.trim()).filter(Boolean))).join(", ");

  return {
    tenantName: `${tenant[0].firstName} ${tenant[0].lastName}`.trim(),
    tenantEmail: tenant[0].email,
    tenantPhone: tenant[0].phone,
    tenantLanguage: (tenant[0].language || "nl") as SupportedLanguage,
    propertyName: prop[0]?.name || "",
    amount: Number(p[0].amount),
    dueDate: p[0].dueDate,
    daysPastDue,
    ownerId,
    ownerName: owner[0]?.name || owner[0]?.email || "Your landlord",
    ownerEmail: owner[0]?.email || null,
    cc,
  };
}

function isTestPhase(): boolean {
  const v = (process.env.PAYMENT_EMAIL_TEST_PHASE || "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Build the detailed confirmation page for an email reminder. */
function remindDetailHtml(lang: string, ctx: ReminderContext, token: string, testPhase: boolean): string {
  const base = (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");
  const amount = `EUR ${ctx.amount.toFixed(2)}`;
  const due = fmtDate(ctx.dueDate);
  const L: Record<string, Record<string, string>> = {
    en: {
      titleReal: "A friendly reminder was emailed to the tenant.",
      titleTest: "Test mode is on: the reminder was sent to you, not the tenant.",
      tenant: "Tenant", property: "Property", amount: "Amount", due: "Due date",
      copy: "A copy was sent to", testNote: "with \"TEST PHASE MAIL\" in the subject so you can preview it. It was not sent to the tenant. Turn off the test phase to send real reminders.",
      sms: "Send an SMS too",
    },
    nl: {
      titleReal: "Er is een vriendelijke herinnering naar de huurder gemaild.",
      titleTest: "Testmodus staat aan: de herinnering is naar jou gestuurd, niet naar de huurder.",
      tenant: "Huurder", property: "Pand", amount: "Bedrag", due: "Vervaldag",
      copy: "Een kopie is gestuurd naar", testNote: "met \"TEST PHASE MAIL\" in het onderwerp zodat je ze kan nakijken. Ze is niet naar de huurder gestuurd. Schakel de testfase uit om echte herinneringen te sturen.",
      sms: "Stuur ook een SMS",
    },
    fr: {
      titleReal: "Un rappel amical a été envoyé par e-mail au locataire.",
      titleTest: "Mode test activé : le rappel vous a été envoyé, pas au locataire.",
      tenant: "Locataire", property: "Bien", amount: "Montant", due: "Échéance",
      copy: "Une copie a été envoyée à", testNote: "avec \"TEST PHASE MAIL\" dans l'objet pour que vous puissiez le vérifier. Il n'a pas été envoyé au locataire. Désactivez la phase de test pour envoyer de vrais rappels.",
      sms: "Envoyer aussi un SMS",
    },
    de: {
      titleReal: "Eine freundliche Erinnerung wurde an den Mieter gemailt.",
      titleTest: "Testmodus ist an: die Erinnerung ging an Sie, nicht an den Mieter.",
      tenant: "Mieter", property: "Immobilie", amount: "Betrag", due: "Fälligkeit",
      copy: "Eine Kopie ging an", testNote: "mit \"TEST PHASE MAIL\" im Betreff, damit Sie sie prüfen können. Sie wurde nicht an den Mieter gesendet. Schalten Sie die Testphase aus, um echte Erinnerungen zu senden.",
      sms: "Auch eine SMS senden",
    },
  };
  const t = L[lang] || L.en!;
  const detail = `<div class="detail"><b>${esc(t.tenant)}:</b> ${esc(ctx.tenantName)} (${esc(ctx.tenantEmail)})<br><b>${esc(t.property)}:</b> ${esc(ctx.propertyName)}<br><b>${esc(t.amount)}:</b> ${esc(amount)}<br><b>${esc(t.due)}:</b> ${esc(due)}</div>`;

  let html: string;
  if (testPhase) {
    html = `<p>${esc(t.titleTest)}</p>${detail}<p class="muted">${esc(ctx.ownerEmail || "")} ${esc(t.testNote)}</p>`;
  } else {
    const copyLine = ctx.cc ? `<p class="muted">${esc(t.copy)} ${esc(ctx.cc)}.</p>` : "";
    html = `<p>${esc(t.titleReal)}</p>${detail}${copyLine}`;
  }

  // SMS option: only when a provider is configured, the tenant has a phone, and
  // we are not in test phase (SMS is skipped in test phase).
  if (!testPhase && ctx.tenantPhone && isSmsConfigured()) {
    const url = `${base}/api/v1/landlord-action/${token}?channel=sms`;
    html += `<p style="margin-top:1rem"><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:.6rem 1.1rem;border-radius:8px;text-decoration:none">${esc(t.sms)}</a></p>`;
  }
  return html;
}

function smsResultHtml(lang: string, result: "sent" | "nophone" | "notconfigured", phone?: string): string {
  const L: Record<string, Record<string, string>> = {
    en: { sent: `An SMS reminder was sent to the tenant (${phone}).`, nophone: "The tenant has no phone number, so no SMS was sent.", notconfigured: "SMS is not set up yet. Configure an SMS provider first." },
    nl: { sent: `Er is een SMS-herinnering naar de huurder gestuurd (${phone}).`, nophone: "De huurder heeft geen telefoonnummer, dus er is geen SMS verstuurd.", notconfigured: "SMS is nog niet ingesteld. Configureer eerst een SMS-provider." },
    fr: { sent: `Un rappel SMS a été envoyé au locataire (${phone}).`, nophone: "Le locataire n'a pas de numéro de téléphone, aucun SMS envoyé.", notconfigured: "Le SMS n'est pas encore configuré." },
    de: { sent: `Eine SMS-Erinnerung wurde an den Mieter gesendet (${phone}).`, nophone: "Der Mieter hat keine Telefonnummer, es wurde keine SMS gesendet.", notconfigured: "SMS ist noch nicht eingerichtet." },
  };
  const t = L[lang] || L.en!;
  return `<p>${esc(t[result])}</p>`;
}

async function sendSmsReminder(ctx: ReminderContext, leaseId: string): Promise<"sent" | "nophone" | "notconfigured"> {
  if (!isSmsConfigured()) return "notconfigured";
  if (!ctx.tenantPhone) return "nophone";
  const lang = ctx.tenantLanguage || "nl";
  const tpl = (DEFAULT_SMS_TEMPLATES[lang] || DEFAULT_SMS_TEMPLATES.en)!.friendly;
  const body = renderTemplate(tpl, {
    tenantName: ctx.tenantName,
    amount: `€${ctx.amount.toFixed(2)}`,
    dueDate: fmtDate(ctx.dueDate),
    propertyName: ctx.propertyName,
    daysPastDue: String(ctx.daysPastDue),
    ownerName: ctx.ownerName,
  });
  await queueSms(
    { to: normalizePhoneNumber(ctx.tenantPhone), body },
    undefined,
    { ownerId: ctx.ownerId, leaseId, type: "payment_reminder_friendly", recipientName: ctx.tenantName },
  );
  return "sent";
}

landlordActionsRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  const channel = c.req.query("channel");
  let action: string;
  let paymentId: string;
  try {
    const decoded = await verifyLandlordActionToken(token);
    action = decoded.action;
    paymentId = decoded.paymentId;
  } catch {
    return renderKey(c, "en", "invalid");
  }

  const db = getDb();
  const rows = await db
    .select({
      leaseId: payments.leaseId,
      ownerId: leases.ownerId,
      ownerLocale: users.locale,
    })
    .from(payments)
    .innerJoin(leases, eq(leases.id, payments.leaseId))
    .innerJoin(users, eq(users.id, leases.ownerId))
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!rows[0]) return renderKey(c, "en", "notfound");
  const lang = (rows[0].ownerLocale || "en").slice(0, 2);

  try {
    if (action === "paid") {
      await db
        .update(payments)
        .set({ status: "paid", paidDate: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
        .where(eq(payments.id, paymentId));
    } else if (action === "off") {
      await db
        .update(leases)
        .set({ landlordLateNotify: false, updatedAt: new Date() })
        .where(eq(leases.id, rows[0].leaseId));
    } else if (action === "remind") {
      const ctx = await loadReminderContext(db, paymentId, rows[0].leaseId, rows[0].ownerId);
      if (!ctx) return renderKey(c, lang, "notfound");

      if (channel === "sms") {
        const result = await sendSmsReminder(ctx, rows[0].leaseId);
        return renderHtml(c, lang, smsResultHtml(lang, result, ctx.tenantPhone || undefined));
      }

      const testPhase = isTestPhase();
      await sendReminder(
        {
          paymentId,
          leaseId: rows[0].leaseId,
          amount: ctx.amount,
          dueDate: ctx.dueDate,
          daysPastDue: ctx.daysPastDue,
          tenantName: ctx.tenantName,
          tenantEmail: ctx.tenantEmail,
          tenantPhone: ctx.tenantPhone,
          tenantLanguage: ctx.tenantLanguage,
          propertyName: ctx.propertyName,
          ownerName: ctx.ownerName,
          isIgnored: false,
          remindersSent: [],
          latePaymentFeeEnabled: false,
          latePaymentFeeAmount: 15,
          latePaymentFeeEnforcement: "soft",
        },
        "friendly",
        DEFAULT_SETTINGS,
        rows[0].ownerId,
        ctx.ownerEmail || undefined,
        testPhase ? undefined : ctx.cc || undefined,
      );
      return renderHtml(c, lang, remindDetailHtml(lang, ctx, token, testPhase));
    }
    // "wait" is a no-op acknowledgment.
  } catch (err) {
    console.error("[LandlordActions] action failed:", err);
  }

  return renderKey(c, lang, action as MsgKey);
});
