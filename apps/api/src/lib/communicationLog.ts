import { eq } from "drizzle-orm";
import crypto from "crypto";
import { getDb, communications } from "@rentular/db";
import { sendWhatsApp, type WhatsAppOptions } from "./whatsapp";
import { sendEmail, type EmailOptions } from "./email";

/** Every channel a message can go out on. */
export type CommunicationChannel = "email" | "sms" | "letter" | "whatsapp" | "signal" | "internal";

/** Every kind of logged message. */
export type CommunicationType =
  | "payment_reminder_friendly"
  | "payment_reminder_formal"
  | "payment_reminder_final"
  | "indexation_notification"
  | "landlord_report"
  | "custom"
  | "welcome"
  | "lease_renewal"
  | "lease_termination"
  | "other"
  | "indexation_alert"
  | "landlord_notification"
  | "due_date_sms"
  | "tenant_reply"
  | "internal_note";

/** Who set a message off. */
export type CommunicationTrigger = "schedule" | "manual" | "magic_link" | "api";

/**
 * Kinds sent to the landlord or the managers, not to the tenant. They are kept
 * apart from the tenant history on the contract page.
 */
export const LANDLORD_TYPES: readonly CommunicationType[] = [
  "landlord_notification",
  "landlord_report",
  "indexation_alert",
];

/** How a message was triggered, stored in communications.metadata. */
export interface TriggerMeta {
  trigger: CommunicationTrigger;
  /** User id of the person who sent it, when a person did. */
  triggeredBy?: string | null;
}

export interface LogInput {
  ownerId: string;
  leaseId?: string | null;
  channel: CommunicationChannel;
  type: CommunicationType;
  recipientName: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  subject?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
}

/** Insert one queued communications row and return its id, or null when logging failed. */
export async function logCommunication(input: LogInput): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    const metadata = input.metadata && Object.keys(input.metadata).length > 0 ? input.metadata : undefined;
    await getDb().insert(communications).values({
      id,
      ownerId: input.ownerId,
      leaseId: input.leaseId || null,
      channel: input.channel,
      type: input.type,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail ?? null,
      recipientPhone: input.recipientPhone ?? null,
      subject: input.subject ?? null,
      body: input.body,
      status: "queued",
      metadata,
    });
    return id;
  } catch (err) {
    console.error("[Communications] failed to log message:", err);
    return null;
  }
}

/** Record the outcome of a logged message. */
export async function markCommunication(
  id: string | null,
  outcome: { status: "sent" | "failed"; error?: unknown; externalId?: string | null },
): Promise<void> {
  if (!id) return;
  try {
    await getDb()
      .update(communications)
      .set(
        outcome.status === "sent"
          ? { status: "sent", sentAt: new Date(), errorMessage: null, ...(outcome.externalId ? { externalId: outcome.externalId } : {}) }
          : { status: "failed", errorMessage: String(outcome.error ?? "failed") },
      )
      .where(eq(communications.id, id));
  } catch (err) {
    console.error(`[Communications] failed to update ${id}:`, err);
  }
}

/** Split a comma-separated address list, or undefined when empty. */
export function ccList(cc: string | undefined | null): string[] | undefined {
  if (!cc) return undefined;
  const list = cc.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * Send a WhatsApp message and log it: one row, queued before the send, then
 * sent or failed. A failed send is rethrown after it is recorded.
 */
export async function sendWhatsAppLogged(
  options: WhatsAppOptions,
  log: Omit<LogInput, "channel" | "body" | "recipientPhone">,
): Promise<{ id: string }> {
  const rowId = await logCommunication({
    ...log,
    channel: "whatsapp",
    recipientPhone: options.to,
    body: options.body,
  });
  try {
    const res = await sendWhatsApp(options);
    await markCommunication(rowId, { status: "sent", externalId: res.id });
    return res;
  } catch (err) {
    await markCommunication(rowId, { status: "failed", error: err });
    throw err;
  }
}

/**
 * Send an email right away (no queue) and log it the same way. For messages
 * whose caller needs to know at once whether the send worked.
 */
export async function sendEmailLogged(
  options: EmailOptions,
  log: Omit<LogInput, "channel" | "body" | "recipientEmail" | "subject">,
): Promise<void> {
  const cc = ccList(options.cc);
  const rowId = await logCommunication({
    ...log,
    channel: "email",
    recipientEmail: options.to,
    subject: options.subject,
    body: options.body,
    metadata: { ...(log.metadata ?? {}), ...(cc ? { cc } : {}) },
  });
  try {
    await sendEmail(options);
    await markCommunication(rowId, { status: "sent" });
  } catch (err) {
    await markCommunication(rowId, { status: "failed", error: err });
    throw err;
  }
}
