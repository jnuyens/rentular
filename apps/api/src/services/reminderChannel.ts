import { renderTemplate } from "../lib/email";
import { DEFAULT_SMS_TEMPLATES, type SupportedLanguage } from "@rentular/shared";
import { isSmsConfigured, normalizePhoneNumber } from "../lib/sms";
import { isWhatsAppConfigured, sendWhatsApp } from "../lib/whatsapp";
import { queueSms } from "../jobs/smsQueueWorker";
import type { CommunicationMeta } from "../jobs/emailQueueWorker";
import { sendReminder, type ReminderLevel } from "./paymentFollowUp";

export type ReminderChannel = "email" | "sms" | "whatsapp";

// Derive the service's own shapes from sendReminder so this module stays in
// lockstep with paymentFollowUp without re-declaring the interfaces.
type OverduePayment = Parameters<typeof sendReminder>[0];
type FollowUpSettings = Parameters<typeof sendReminder>[2];

/** dd/mm/yyyy without timezone drift. */
export function fmtDueDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

export function isReminderTestPhase(): boolean {
  const v = (process.env.PAYMENT_EMAIL_TEST_PHASE || "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Short reminder text (SMS/WhatsApp) for a level, in the tenant's language. */
export function shortReminderBody(
  lang: SupportedLanguage,
  level: ReminderLevel,
  vars: Record<string, string>,
): string {
  const set = DEFAULT_SMS_TEMPLATES[lang] || DEFAULT_SMS_TEMPLATES.en;
  return renderTemplate(set[level], vars);
}

/**
 * The channel a tenant reminder will actually use: the preferred phone channel
 * when it is configured, the tenant has a phone and the test phase is off,
 * otherwise email.
 */
export function resolveReminderChannel(
  preferredChannel: ReminderChannel | null | undefined,
  phone: string | null | undefined,
): ReminderChannel {
  const pref = preferredChannel || "email";
  if (pref === "whatsapp" && isWhatsAppConfigured() && phone && !isReminderTestPhase()) {
    return "whatsapp";
  }
  if (pref === "sms" && isSmsConfigured() && phone && !isReminderTestPhase()) {
    return "sms";
  }
  return "email";
}

/**
 * Route one reminder to the tenant's preferred channel and return the channel
 * actually used. WhatsApp and SMS send the short template in the tenant's
 * language; email is the fallback whenever the preferred channel is
 * unconfigured, the tenant has no phone, or the test phase is active. Shared by
 * the 19:15 payment-check worker and the manual send-reminder path so both
 * dispatch identically.
 */
export async function sendReminderViaPreferredChannel(input: {
  payment: OverduePayment;
  level: ReminderLevel;
  settings: FollowUpSettings;
  ownerId: string;
  ownerEmail?: string;
  preferredChannel: ReminderChannel | null | undefined;
  /** Co-tenant addresses to copy on the email; SMS and WhatsApp ignore it. */
  cc?: string;
}): Promise<ReminderChannel> {
  const { payment, level, settings, ownerId, ownerEmail } = input;
  const phone = payment.tenantPhone;
  const channel = resolveReminderChannel(input.preferredChannel, phone);
  const shortVars = {
    tenantName: payment.tenantName,
    amount: `€${payment.amount.toFixed(2)}`,
    dueDate: fmtDueDate(payment.dueDate),
    propertyName: payment.propertyName,
    daysPastDue: String(payment.daysPastDue),
    ownerName: payment.ownerName,
  };

  if (channel === "whatsapp" && phone) {
    await sendWhatsApp({
      to: normalizePhoneNumber(phone),
      body: shortReminderBody(payment.tenantLanguage, level, shortVars),
    });
    return "whatsapp";
  }

  if (channel === "sms" && phone) {
    await queueSms(
      { to: normalizePhoneNumber(phone), body: shortReminderBody(payment.tenantLanguage, level, shortVars) },
      undefined,
      {
        ownerId,
        leaseId: payment.leaseId,
        type: `payment_reminder_${level}` as CommunicationMeta["type"],
        recipientName: payment.tenantName,
      },
    );
    return "sms";
  }

  await sendReminder(payment, level, settings, ownerId, ownerEmail, input.cc);
  return "email";
}
