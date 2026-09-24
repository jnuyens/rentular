/**
 * Public one-click endpoints for the late-payment landlord email. Each link in
 * that email carries a signed token (see lib/landlordActionToken). No login is
 * required — the token is the authentication. Actions are idempotent.
 *
 *   paid   -> mark the payment paid
 *   wait   -> acknowledge, do nothing (no reminder)
 *   remind -> send a reminder to the tenant (reuses the follow-up sender)
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
import type { SupportedLanguage } from "@rentular/shared";

export const landlordActionsRouter = new Hono();

type MsgKey = "paid" | "wait" | "remind" | "off" | "invalid" | "notfound";

const MESSAGES: Record<string, Record<MsgKey, string>> = {
  en: {
    paid: "Marked as paid. Thank you.",
    wait: "Okay, we'll keep waiting. No reminder was sent.",
    remind: "A reminder has been sent to the tenant.",
    off: "Late-payment emails are now turned off for this property. You can turn them back on from the contract page.",
    invalid: "This link is invalid or has expired.",
    notfound: "This payment could not be found.",
  },
  nl: {
    paid: "Gemarkeerd als betaald. Bedankt.",
    wait: "Oké, we wachten nog even. Er is geen herinnering verstuurd.",
    remind: "Er is een herinnering naar de huurder gestuurd.",
    off: "E-mails over late betalingen zijn nu uitgeschakeld voor dit pand. Je kunt ze weer inschakelen via de contractpagina.",
    invalid: "Deze link is ongeldig of verlopen.",
    notfound: "Deze betaling kon niet worden gevonden.",
  },
  fr: {
    paid: "Marqué comme payé. Merci.",
    wait: "D'accord, nous attendons encore. Aucun rappel n'a été envoyé.",
    remind: "Un rappel a été envoyé au locataire.",
    off: "Les e-mails de retard de paiement sont désactivés pour ce bien. Vous pouvez les réactiver depuis la page du contrat.",
    invalid: "Ce lien est invalide ou a expiré.",
    notfound: "Ce paiement est introuvable.",
  },
  de: {
    paid: "Als bezahlt markiert. Danke.",
    wait: "In Ordnung, wir warten noch. Es wurde keine Erinnerung gesendet.",
    remind: "Eine Erinnerung wurde an den Mieter gesendet.",
    off: "E-Mails zu Zahlungsverzug sind für diese Immobilie jetzt deaktiviert. Sie können sie auf der Vertragsseite wieder aktivieren.",
    invalid: "Dieser Link ist ungültig oder abgelaufen.",
    notfound: "Diese Zahlung wurde nicht gefunden.",
  },
};

function render(c: Context, lang: string, key: MsgKey) {
  const table = MESSAGES[lang] || MESSAGES.en!;
  const msg = table[key] || MESSAGES.en![key];
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rentular</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem}.card{background:#fff;padding:2rem 2.5rem;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:440px;text-align:center}h1{font-size:1.25rem;margin:0 0 .75rem;color:#111}p{color:#444;line-height:1.55;margin:0}</style></head><body><div class="card"><h1>Rentular</h1><p>${msg}</p></div></body></html>`;
  return c.html(html);
}

/** Rebuild the follow-up payload for one payment and send a tenant reminder. */
async function sendReminderForPayment(
  db: ReturnType<typeof getDb>,
  paymentId: string,
  leaseId: string,
  ownerId: string,
): Promise<void> {
  const p = await db
    .select({ amount: payments.amount, dueDate: payments.dueDate, isIgnored: payments.isIgnored })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  const lease = await db
    .select({
      propertyId: leases.propertyId,
      latePaymentFeeEnabled: leases.latePaymentFeeEnabled,
      latePaymentFeeAmount: leases.latePaymentFeeAmount,
      latePaymentFeeEnforcement: leases.latePaymentFeeEnforcement,
    })
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
  if (!p[0] || !lease[0] || !tenant[0]?.email) return;

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

  await sendReminder(
    {
      paymentId,
      leaseId,
      amount: Number(p[0].amount),
      dueDate: p[0].dueDate,
      daysPastDue,
      tenantName: `${tenant[0].firstName} ${tenant[0].lastName}`.trim(),
      tenantEmail: tenant[0].email,
      tenantPhone: tenant[0].phone,
      tenantLanguage: (tenant[0].language || "nl") as SupportedLanguage,
      propertyName: prop[0]?.name || "",
      ownerName: owner[0]?.name || owner[0]?.email || "Your landlord",
      isIgnored: p[0].isIgnored,
      remindersSent: [],
      latePaymentFeeEnabled: lease[0].latePaymentFeeEnabled,
      latePaymentFeeAmount: Number(lease[0].latePaymentFeeAmount || "15.00"),
      latePaymentFeeEnforcement: lease[0].latePaymentFeeEnforcement,
    },
    "friendly",
    DEFAULT_SETTINGS,
    ownerId,
  );
}

landlordActionsRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  let action: string;
  let paymentId: string;
  try {
    const decoded = await verifyLandlordActionToken(token);
    action = decoded.action;
    paymentId = decoded.paymentId;
  } catch {
    return render(c, "en", "invalid");
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

  if (!rows[0]) return render(c, "en", "notfound");
  const lang = (rows[0].ownerLocale || "en").slice(0, 2);

  try {
    if (action === "paid") {
      await db
        .update(payments)
        .set({
          status: "paid",
          paidDate: new Date().toISOString().slice(0, 10),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId));
    } else if (action === "off") {
      await db
        .update(leases)
        .set({ landlordLateNotify: false, updatedAt: new Date() })
        .where(eq(leases.id, rows[0].leaseId));
    } else if (action === "remind") {
      await sendReminderForPayment(db, paymentId, rows[0].leaseId, rows[0].ownerId);
    }
    // "wait" is a no-op acknowledgment.
  } catch (err) {
    console.error("[LandlordActions] action failed:", err);
  }

  return render(c, lang, action as MsgKey);
});
