import { and, eq, like, desc } from "drizzle-orm";
import {
  getDb,
  leases,
  properties,
  users,
  payments,
  paymentFollowUpSettings,
  paymentReminders,
} from "@rentular/db";
import type { SupportedLanguage } from "@rentular/shared";
import { DEFAULT_SETTINGS, type ReminderLevel } from "./paymentFollowUp";
import { sendReminderViaPreferredChannel, type ReminderChannel } from "./reminderChannel";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import type { TriggerMeta } from "../lib/communicationLog";
import { indexationDateFor, loadIndexRecords, loadMonthStatus } from "./monthReceived";
import type { RemainderContext } from "./reminderText";
import { loadWaitingTransfer } from "./transferReview";
import { beforeTrackingWindow, cappedReminderAmount, loadContractBalance } from "./contractBalance";
import { wallClock } from "./communicationSchedule";
import { getScheduleTimezone } from "../lib/timezone";

/** Returned when the contract is even or in credit, so there is nothing to remind about. */
export const NOTHING_OWED_ERROR = "Nothing is owed on this contract, so no reminder was sent";

/** An unbooked incoming transfer that may already pay the reminded rent. */
export type WaitingTransferWarning = { amount: number; bookingDate: string; statementId: string };

export type ManualReminderResult =
  | {
      ok: true;
      sentTo: string;
      testPhase: boolean;
      level: ReminderLevel;
      channel: ReminderChannel;
      /** Set when a transfer that may pay this rent waits for review. The reminder was still sent. */
      waitingTransfer?: WaitingTransferWarning;
    }
  | { ok: false; error: string };

/**
 * Send a single rent reminder for a lease's rent in a given month, at a level
 * the landlord picks (friendly / formal / final). Works even when the rent is
 * not yet due: a pending expected record for that month is found or created so
 * the reminder has a payment to attach to, then the shared
 * sendReminderViaPreferredChannel() path routes the reminder over the tenant's
 * preferred channel (whatsapp / sms / email) with email as the fallback, the
 * same dispatch the automated 19:15 worker uses.
 */
export async function sendManualReminder(input: {
  leaseId: string;
  periodMonth: string; // YYYY-MM
  level: ReminderLevel;
  ownerId: string;
  /** Who sent it: a person in the app (manual) or an API token (api). */
  trigger?: TriggerMeta;
}): Promise<ManualReminderResult> {
  const db = getDb();
  const m = /^(\d{4})-(\d{2})$/.exec(input.periodMonth);
  if (!m) return { ok: false, error: "Invalid period" };

  const leaseRows = await db.select().from(leases).where(eq(leases.id, input.leaseId)).limit(1);
  const lease = leaseRows[0];
  if (!lease) return { ok: false, error: "Lease not found" };

  // Primary tenant addressed, co-tenants copied (any tenant email as fallback "to").
  const rec = await getLeaseEmailRecipients(input.leaseId);
  const tenant = rec.primary;
  const tenantEmail = rec.to;
  if (!tenant || !tenantEmail) return { ok: false, error: "This tenant has no email address" };

  const propRow = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.id, lease.propertyId))
    .limit(1);
  const propertyName = propRow[0]?.name || "Unknown property";

  const ownerRow = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, lease.ownerId))
    .limit(1);
  const ownerName = ownerRow[0]?.name || ownerRow[0]?.email || "Your landlord";

  // Find or create the payment record for this month (reminders attach to one).
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(lease.paymentDay ?? 1) || 1), lastDay);
  const dueDate = `${m[1]}-${m[2]}-${pad(day)}`;

  const existing = await db
    .select({ id: payments.id, amount: payments.amount, dueDate: payments.dueDate, isIgnored: payments.isIgnored })
    .from(payments)
    .where(and(eq(payments.leaseId, input.leaseId), like(payments.dueDate, `${input.periodMonth}-%`)))
    .orderBy(desc(payments.isIgnored));
  // Prefer a non-ignored record.
  const usable = existing.find((p) => !p.isIgnored) || existing[0];

  // Part of the month's rent already came in: ask only for what is missing,
  // attached to the month's existing record, and never add a full-rent row.
  const status = await loadMonthStatus(db, lease, input.periodMonth);
  const partlyPaid = status.received > 0.01 && status.shortfall > 0;

  // The contract balance decides whether there is anything to remind about:
  // an even contract, or one in credit, gets no reminder, and the amount never
  // exceeds what the contract owes. Rent not due yet is judged on its due date.
  const today = wallClock(new Date(), getScheduleTimezone()).ymd;
  const balance = await loadContractBalance(db, lease, status.dueDate > today ? status.dueDate : today);
  // A month before the tracking window was paid before the bank data came in.
  if (balance && (!(balance.owed > 0) || beforeTrackingWindow(balance, input.periodMonth))) {
    return { ok: false, error: NOTHING_OWED_ERROR };
  }
  const partialPaymentId = usable?.id ?? status.paidRowId;

  const rent = Number(lease.monthlyRent || 0);
  const charges = Number(lease.monthlyCharges || 0);
  let paymentId: string;
  let amount: number;
  let dueForTemplate: string;
  let remainder: RemainderContext | null = null;
  if (partlyPaid && partialPaymentId) {
    paymentId = partialPaymentId;
    amount = status.shortfall;
    dueForTemplate = usable ? String(usable.dueDate) : status.dueDate;
    const records =
      status.oldRent != null ? ((await loadIndexRecords(db, [lease.id])).get(lease.id) ?? []) : [];
    remainder = {
      expected: status.expected,
      received: status.received,
      oldRent: status.oldRent,
      indexationDate: status.oldRent != null ? indexationDateFor(records, status.dueDate) : null,
    };
  } else if (usable) {
    paymentId = usable.id;
    amount = Number(usable.amount);
    dueForTemplate = String(usable.dueDate);
  } else {
    paymentId = crypto.randomUUID();
    amount = rent + charges;
    dueForTemplate = dueDate;
    const method = lease.paymentMethod === "gocardless" ? "gocardless" : "bank_transfer";
    await db.insert(payments).values({
      id: paymentId,
      leaseId: input.leaseId,
      status: "pending",
      amount: String(amount),
      dueDate,
      method,
      rentAmount: String(rent),
      chargesAmount: String(charges),
      notes: "auto-generated expected payment",
    });
  }

  if (balance) {
    const capped = cappedReminderAmount(amount, balance.owed);
    if (capped != null && capped < amount) {
      amount = capped;
      // The month's own explanation would no longer match the amount asked.
      remainder = null;
    }
  }

  // Owner follow-up settings (fall back to defaults).
  const settingsData = await db
    .select()
    .from(paymentFollowUpSettings)
    .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
    .limit(1);
  const s = settingsData[0] || null;
  const followUpSettings = s
    ? {
        enabled: s.enabled,
        friendlyReminderDays: s.friendlyReminderDays,
        formalReminderDays: s.formalReminderDays,
        finalReminderDays: s.finalReminderDays,
        interestEnabled: s.interestEnabled,
        annualInterestRate: Number(s.annualInterestRate || "3.75"),
        friendlySubject: s.friendlySubject || DEFAULT_SETTINGS.friendlySubject,
        friendlyBody: s.friendlyBody || DEFAULT_SETTINGS.friendlyBody,
        formalSubject: s.formalSubject || DEFAULT_SETTINGS.formalSubject,
        formalBody: s.formalBody || DEFAULT_SETTINGS.formalBody,
        finalSubject: s.finalSubject || DEFAULT_SETTINGS.finalSubject,
        finalBody: s.finalBody || DEFAULT_SETTINGS.finalBody,
        smsEnabled: s.smsEnabled,
        smsFriendlyMessage: s.smsFriendlyMessage || DEFAULT_SETTINGS.smsFriendlyMessage,
        smsFormalMessage: s.smsFormalMessage || DEFAULT_SETTINGS.smsFormalMessage,
        smsFinalMessage: s.smsFinalMessage || DEFAULT_SETTINGS.smsFinalMessage,
      }
    : DEFAULT_SETTINGS;

  const dueMs = new Date(`${dueForTemplate}T00:00:00`).getTime();
  const daysPastDue = Math.max(0, Math.floor((Date.now() - dueMs) / 86_400_000));

  const paymentInfo = {
    paymentId,
    leaseId: input.leaseId,
    amount,
    dueDate: dueForTemplate,
    daysPastDue,
    tenantName: `${tenant.firstName} ${tenant.lastName}`.trim(),
    tenantEmail,
    tenantPhone: tenant.phone,
    tenantLanguage: (tenant.language || "en") as SupportedLanguage,
    propertyName,
    ownerName,
    isIgnored: false,
    remindersSent: [] as ReminderLevel[],
    latePaymentFeeEnabled: lease.latePaymentFeeEnabled,
    latePaymentFeeAmount: Number(lease.latePaymentFeeAmount || "15.00"),
    latePaymentFeeEnforcement: lease.latePaymentFeeEnforcement,
    remainder,
  };

  // T-11-22 / CONTEXT: send_reminder (channel-aware). Route over the tenant's
  // preferred channel through the same dispatch the 19:15 worker uses; email
  // stays the guaranteed fallback.
  const usedChannel = await sendReminderViaPreferredChannel({
    payment: paymentInfo,
    level: input.level,
    settings: followUpSettings,
    ownerId: lease.ownerId,
    ownerEmail: ownerRow[0]?.email,
    preferredChannel: tenant.preferredChannel,
    cc: rec.cc,
    trigger: input.trigger ?? { trigger: "manual", triggeredBy: input.ownerId },
  });

  await db.insert(paymentReminders).values({
    id: crypto.randomUUID(),
    paymentId,
    type: input.level,
    channel: usedChannel,
    sentAt: new Date(),
  });

  const testPhase = (process.env.PAYMENT_EMAIL_TEST_PHASE || "").toLowerCase();
  const isTest = testPhase === "true" || testPhase === "1" || testPhase === "yes";
  // SMS/WhatsApp only run outside the test phase and only with a phone present,
  // so report the phone there; email (and test-phase) report the email address.
  const sentTo =
    usedChannel === "sms" || usedChannel === "whatsapp"
      ? tenant.phone || tenantEmail
      : isTest
        ? ownerRow[0]?.email || ""
        : tenantEmail;
  // A person chose to send this, so it is never blocked; the landlord is
  // warned instead when a transfer that may pay it waits for review.
  let waitingTransfer: WaitingTransferWarning | undefined;
  try {
    const hit = await loadWaitingTransfer(db, {
      leaseId: input.leaseId,
      ownerId: lease.ownerId,
      dueDate: dueForTemplate,
      amount,
    });
    if (hit) waitingTransfer = { amount: hit.amount, bookingDate: hit.bookingDate, statementId: hit.id };
  } catch (err) {
    console.warn("[ManualReminder] waiting transfer check failed:", err);
  }

  return {
    ok: true,
    sentTo,
    testPhase: isTest,
    level: input.level,
    channel: usedChannel,
    ...(waitingTransfer ? { waitingTransfer } : {}),
  };
}
