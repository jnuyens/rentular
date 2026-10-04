import { Worker, Queue } from "bullmq";
import { readFileSync } from "fs";
import { join } from "path";
import { eq, and, lt, lte, gte, inArray, or, isNull, ne } from "drizzle-orm";
import {
  getDb,
  payments,
  paymentAllocations,
  leases,
  leaseTenants,
  tenants,
  paymentFollowUpSettings,
  paymentReminders,
  bankConnections,
  properties,
  users,
} from "@rentular/db";
import { BALANCE_CHECK_CRON } from "@rentular/shared";
import {
  determineReminderLevel,
  sendReminder,
  DEFAULT_SETTINGS,
} from "../services/paymentFollowUp";
import { sendLandlordLateEmail } from "../services/landlordLateEmail";
import { getLandlordNotificationRecipients } from "../lib/notificationRecipients";
import { getBankAccountDataProvider } from "../lib/bankAccountData";
import { syncBankConnection } from "../services/bankConnectionSync";
import { queueEmail, type CommunicationMeta } from "./emailQueueWorker";
import { queueSms } from "./smsQueueWorker";
import { isSmsConfigured, normalizePhoneNumber } from "../lib/sms";
import { isWhatsAppConfigured, sendWhatsApp } from "../lib/whatsapp";
import { getScheduleTimezone } from "../lib/timezone";
import { renderTemplate } from "../lib/email";
import { ensureExpectedPaymentsForAllActive, coversMonthRent, DEPOSIT_NOTE } from "../services/expectedPayments";
import { DEFAULT_SMS_TEMPLATES, type SupportedLanguage } from "@rentular/shared";

const QUEUE_NAME = "payment-check";

/**
 * Is a rent period already settled -- by a payment that covers it, or by manual
 * allocations summing to the rent? Used so the worker never duns or sends a
 * due/overdue notice for rent recorded paid, including via the ledger (which can
 * leave the auto-generated pending record behind).
 */
async function isPeriodSettled(
  db: ReturnType<typeof getDb>,
  leaseId: string,
  dueDate: string,
  monthlyRent: number,
): Promise<boolean> {
  if (!(monthlyRent > 0)) return false;
  const month = String(dueDate).slice(0, 7);
  const allocs = await db
    .select({ amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .where(
      and(eq(paymentAllocations.leaseId, leaseId), eq(paymentAllocations.periodMonth, month)),
    );
  const allocated = allocs.reduce((s, a) => s + Number(a.amount), 0);
  if (allocated >= monthlyRent - 0.01) return true;
  const paid = await db
    .select({
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      notes: payments.notes,
    })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "paid")));
  return paid.some((p) => coversMonthRent(p, dueDate, monthlyRent));
}

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const paymentCheckQueue = new Queue(QUEUE_NAME, { connection });

const SUPPORTED_EMAIL_LOCALES = ["en", "nl", "fr", "de"] as const;

interface RenewalEmailTemplate {
  subject7Day: string;
  subject1Day: string;
  greeting: string;
  body7Day: string;
  body1Day: string;
  ctaLabel: string;
  ctaUrl: string;
  consequence: string;
  signature: string;
  defaultName: string;
  defaultInstitution: string;
}

// Loads the locale-aware bank-connection renewal-warning email template from the
// web app's i18n messages (bankConnections.email.renewalWarning). Falls back to
// English when the recipient locale is unsupported or missing.
function loadRenewalEmailTemplate(locale: string): RenewalEmailTemplate {
  const lc = (SUPPORTED_EMAIL_LOCALES as readonly string[]).includes(locale)
    ? locale
    : "en";
  // process.cwd() is apps/api at runtime (dev via tsx, prod via bundled ESM);
  // the web messages live one level up under apps/web/messages.
  const path = join(process.cwd(), "..", "web", "messages", lc, "common.json");
  const messages = JSON.parse(readFileSync(path, "utf8"));
  const t = messages?.bankConnections?.email?.renewalWarning;
  if (!t) {
    throw new Error(
      `[PaymentCheck] Missing bankConnections.email.renewalWarning in ${lc} locale`
    );
  }
  return t as RenewalEmailTemplate;
}

// Composes the localized renewal-warning email. days controls 7-day vs 1-day copy.
// No tokens or secrets are interpolated — only the recipient name, institution
// label, days, connection id (deep link), and web origin (T-09-05-02).
function buildRenewalEmail(
  locale: string,
  params: {
    days: number;
    name: string | null;
    institution: string | null;
    connectionId: string;
    webUrl: string;
  }
): { subject: string; body: string } {
  const t = loadRenewalEmailTemplate(locale);
  const name = params.name || t.defaultName;
  const institution = params.institution || t.defaultInstitution;
  const isSevenDay = params.days >= 7;

  const subject = isSevenDay ? t.subject7Day : t.subject1Day;
  const bodyLine = (isSevenDay ? t.body7Day : t.body1Day).replace(
    "{institution}",
    institution
  );
  const greeting = t.greeting.replace("{name}", name);
  const ctaUrl = t.ctaUrl
    .replace("{webUrl}", params.webUrl)
    .replace("{connectionId}", params.connectionId);

  const body = `${greeting}\n\n${bodyLine}\n\n${t.ctaLabel}: ${ctaUrl}\n\n${t.consequence}\n\n${t.signature}`;
  return { subject, body };
}

// Process payment checks
/** dd/mm/yyyy without timezone drift. */
function fmtDueDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function isReminderTestPhase(): boolean {
  const v = (process.env.PAYMENT_EMAIL_TEST_PHASE || "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Short reminder text (SMS/WhatsApp) for a level, in the tenant's language. */
function shortReminderBody(
  lang: SupportedLanguage,
  level: "friendly" | "formal" | "final",
  vars: Record<string, string>,
): string {
  const set = DEFAULT_SMS_TEMPLATES[lang] || DEFAULT_SMS_TEMPLATES.en;
  return renderTemplate(set[level], vars);
}

/**
 * Send a friendly SMS to tenants whose rent is due today and still unpaid, if
 * their landlord enabled it. Runs in the evening after the payment sync, once
 * per payment, in the tenant's language. Skipped entirely in test phase.
 */
async function sendDueDateTenantSms(
  db: ReturnType<typeof getDb>,
  today: string,
): Promise<void> {
  if ((!isSmsConfigured() && !isWhatsAppConfigured()) || isReminderTestPhase()) return;
  try {
    await ensureExpectedPaymentsForAllActive();
  } catch (err) {
    console.error("[PaymentCheck] due-sms generation failed:", err);
  }

  const dueToday = await db
    .select({
      paymentId: payments.id,
      amount: payments.amount,
      dueDate: payments.dueDate,
      leaseId: payments.leaseId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.dueDate, today),
        eq(payments.status, "pending"),
        eq(payments.isIgnored, false),
        or(isNull(payments.notes), ne(payments.notes, DEPOSIT_NOTE)),
      ),
    );

  let sent = 0;
  for (const p of dueToday) {
    try {
      const lease = (
        await db
          .select({
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
          })
          .from(leases)
          .where(eq(leases.id, p.leaseId))
          .limit(1)
      )[0];
      if (!lease) continue;
      if (await isPeriodSettled(db, p.leaseId, p.dueDate, Number(lease.monthlyRent || 0))) continue;

      const settings = (
        await db
          .select({ enabled: paymentFollowUpSettings.smsDueReminderEnabled })
          .from(paymentFollowUpSettings)
          .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
          .limit(1)
      )[0];
      if (!settings?.enabled) continue;

      const tenant = (
        await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            phone: tenants.phone,
            language: tenants.language,
            preferredChannel: tenants.preferredChannel,
          })
          .from(leaseTenants)
          .innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
          .where(and(eq(leaseTenants.leaseId, p.leaseId), eq(leaseTenants.isPrimary, true)))
          .limit(1)
      )[0];
      if (!tenant?.phone) continue;
      // The due-date nudge goes over SMS or WhatsApp (short message). Tenants who
      // prefer email get the normal overdue escalation instead, not a due-day ping.
      const dueChannel = tenant.preferredChannel === "whatsapp" ? "whatsapp" : "sms";
      if (dueChannel === "whatsapp" && !isWhatsAppConfigured()) continue;

      // Once per payment.
      const already = await db
        .select({ id: paymentReminders.id })
        .from(paymentReminders)
        .where(and(eq(paymentReminders.paymentId, p.paymentId), inArray(paymentReminders.channel, ["sms", "whatsapp"])));
      if (already.length > 0) continue;

      const prop = (
        await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1)
      )[0];

      const lang = (tenant.language || "nl") as SupportedLanguage;
      const tpl = (DEFAULT_SMS_TEMPLATES[lang] || DEFAULT_SMS_TEMPLATES.en)!.friendly;
      const tenantName = `${tenant.firstName} ${tenant.lastName}`.trim();
      const body = renderTemplate(tpl, {
        tenantName,
        amount: `€${Number(p.amount).toFixed(2)}`,
        dueDate: fmtDueDate(p.dueDate),
        propertyName: prop?.name || "",
        daysPastDue: "0",
        ownerName: "",
      });

      if (dueChannel === "whatsapp") {
        await sendWhatsApp({ to: normalizePhoneNumber(tenant.phone), body });
      } else {
        await queueSms(
          { to: normalizePhoneNumber(tenant.phone), body },
          undefined,
          {
            ownerId: lease.ownerId,
            leaseId: p.leaseId,
            type: "payment_reminder_friendly",
            recipientName: tenantName,
          },
        );
      }
      await db.insert(paymentReminders).values({
        id: crypto.randomUUID(),
        paymentId: p.paymentId,
        type: "friendly",
        channel: dueChannel,
        sentAt: new Date(),
      });
      sent++;
    } catch (err) {
      console.error(`[PaymentCheck] due-date SMS failed for ${p.paymentId}:`, err);
    }
  }
  console.log(`[PaymentCheck] due-date tenant SMS: sent ${sent}`);
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const db = getDb();
    const today = new Date().toISOString().split("T")[0]!;

    // Dedicated evening job (~19:15 local): a friendly due-date SMS to tenants,
    // run after the 19:00 payment sync so people who already paid aren't nudged.
    if (job.name === "due-reminder-sms") {
      await sendDueDateTenantSms(db, today);
      return { ok: true };
    }

    console.log(
      `[PaymentCheck] Running balance check at ${new Date().toISOString()}`
    );

    // Overdue tenant reminders run ONLY in the dedicated evening job (19:15),
    // after the 19:00 bank sync, so tenants who paid today are excluded and
    // nobody is texted at 02:00/12:00. Balance-check runs skip this block.
    if (job.name === "overdue-reminders") {
    // =======================================================
    // Phase A: Overdue payment reminders
    // =======================================================
    console.log("[PaymentCheck] Phase A: Checking overdue payments...");

    const overduePayments = await db
      .select({
        paymentId: payments.id,
        amount: payments.amount,
        dueDate: payments.dueDate,
        status: payments.status,
        leaseId: payments.leaseId,
        isIgnored: payments.isIgnored,
        landlordNotifiedAt: payments.landlordNotifiedAt,
      })
      .from(payments)
      .where(
        and(
          lt(payments.dueDate, today),
          inArray(payments.status, ["pending"]),
          eq(payments.isIgnored, false),
          // Deposits (waarborg) are not dunned like rent.
          or(isNull(payments.notes), ne(payments.notes, DEPOSIT_NOTE))
        )
      );

    let sentCount = 0;

    for (const payment of overduePayments) {
      try {
        // Get the lease (for ownerId, propertyId, late fee settings)
        const leaseData = await db
          .select({
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
            latePaymentFeeEnabled: leases.latePaymentFeeEnabled,
            latePaymentFeeAmount: leases.latePaymentFeeAmount,
            latePaymentFeeEnforcement: leases.latePaymentFeeEnforcement,
            landlordLateNotify: leases.landlordLateNotify,
          })
          .from(leases)
          .where(eq(leases.id, payment.leaseId))
          .limit(1);

        if (leaseData.length === 0) continue;
        const lease = leaseData[0]!;

        // Skip rent that has been recorded paid (a payment or ledger allocation
        // covers it), even if this pending record was left behind.
        if (await isPeriodSettled(db, payment.leaseId, payment.dueDate, Number(lease.monthlyRent || 0))) {
          continue;
        }

        // Get the primary tenant
        const tenantData = await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            email: tenants.email,
            phone: tenants.phone,
            language: tenants.language,
            preferredChannel: tenants.preferredChannel,
          })
          .from(leaseTenants)
          .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
          .where(
            and(
              eq(leaseTenants.leaseId, payment.leaseId),
              eq(leaseTenants.isPrimary, true)
            )
          )
          .limit(1);

        if (tenantData.length === 0 || !tenantData[0]!.email) continue;
        const tenant = tenantData[0]!;

        // Get property name
        const propertyData = await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1);

        const propertyName = propertyData[0]?.name || "Unknown property";

        // Get owner name
        const ownerData = await db
          .select({ name: users.name, email: users.email, locale: users.locale })
          .from(users)
          .where(eq(users.id, lease.ownerId))
          .limit(1);

        const ownerName =
          ownerData[0]?.name || ownerData[0]?.email || "Your landlord";

        // Email the landlord (with one-click action links) the first time this
        // payment is seen late, if enabled for the contract. Once per payment.
        if (lease.landlordLateNotify && !payment.landlordNotifiedAt) {
          const recipients = await getLandlordNotificationRecipients(
            lease.propertyId,
            ownerData[0]?.email,
          );
          if (recipients.to) {
            const dueMs = new Date(payment.dueDate).getTime();
            const daysLate = Math.max(
              0,
              Math.floor((Date.now() - dueMs) / 86_400_000),
            );
            try {
              await sendLandlordLateEmail({
                paymentId: payment.paymentId,
                to: recipients.to,
                cc: recipients.cc,
                ownerLocale: ownerData[0]?.locale || "en",
                tenantName: `${tenant.firstName} ${tenant.lastName}`.trim(),
                propertyName,
                amount: Number(payment.amount),
                dueDate: payment.dueDate,
                daysPastDue: daysLate,
                kind: "late",
              });
              await db
                .update(payments)
                .set({ landlordNotifiedAt: new Date() })
                .where(eq(payments.id, payment.paymentId));
            } catch (err) {
              console.error("[PaymentCheck] landlord late email failed:", err);
            }
          }
        }

        // Get owner's follow-up settings, fall back to DEFAULT_SETTINGS
        const settingsData = await db
          .select()
          .from(paymentFollowUpSettings)
          .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
          .limit(1);

        const settings = settingsData[0] || null;

        // If settings exist but disabled, skip
        if (settings && !settings.enabled) continue;

        // Build the FollowUpSettings object
        const followUpSettings = settings
          ? {
              enabled: settings.enabled,
              friendlyReminderDays: settings.friendlyReminderDays,
              formalReminderDays: settings.formalReminderDays,
              finalReminderDays: settings.finalReminderDays,
              interestEnabled: settings.interestEnabled,
              annualInterestRate: Number(settings.annualInterestRate || "3.75"),
              friendlySubject:
                settings.friendlySubject ||
                DEFAULT_SETTINGS.friendlySubject,
              friendlyBody:
                settings.friendlyBody || DEFAULT_SETTINGS.friendlyBody,
              formalSubject:
                settings.formalSubject || DEFAULT_SETTINGS.formalSubject,
              formalBody:
                settings.formalBody || DEFAULT_SETTINGS.formalBody,
              finalSubject:
                settings.finalSubject || DEFAULT_SETTINGS.finalSubject,
              finalBody:
                settings.finalBody || DEFAULT_SETTINGS.finalBody,
              smsEnabled: settings.smsEnabled,
              smsFriendlyMessage:
                settings.smsFriendlyMessage ||
                DEFAULT_SETTINGS.smsFriendlyMessage,
              smsFormalMessage:
                settings.smsFormalMessage ||
                DEFAULT_SETTINGS.smsFormalMessage,
              smsFinalMessage:
                settings.smsFinalMessage ||
                DEFAULT_SETTINGS.smsFinalMessage,
            }
          : DEFAULT_SETTINGS;

        // Get existing reminders for this payment
        const existingReminders = await db
          .select({ type: paymentReminders.type })
          .from(paymentReminders)
          .where(eq(paymentReminders.paymentId, payment.paymentId));

        const remindersSent = existingReminders.map(
          (r) => r.type as "friendly" | "formal" | "final"
        );

        // Calculate days past due
        const dueMs = new Date(payment.dueDate).getTime();
        const todayMs = new Date(today).getTime();
        const daysPastDue = Math.floor(
          (todayMs - dueMs) / (1000 * 60 * 60 * 24)
        );

        // Build the OverduePayment info object
        const paymentInfo = {
          paymentId: payment.paymentId,
          leaseId: payment.leaseId,
          amount: Number(payment.amount),
          dueDate: payment.dueDate,
          daysPastDue,
          tenantName: `${tenant.firstName} ${tenant.lastName}`,
          tenantEmail: tenant.email!,
          tenantPhone: tenant.phone,
          tenantLanguage: (tenant.language || "en") as SupportedLanguage,
          propertyName,
          ownerName,
          isIgnored: payment.isIgnored,
          remindersSent,
          latePaymentFeeEnabled: lease.latePaymentFeeEnabled,
          latePaymentFeeAmount: Number(
            lease.latePaymentFeeAmount || "15.00"
          ),
          latePaymentFeeEnforcement: lease.latePaymentFeeEnforcement,
        };

        const level = determineReminderLevel(paymentInfo, followUpSettings);

        if (level) {
          // Route to the tenant's preferred channel. SMS/WhatsApp use the short
          // template in the tenant's language; otherwise (or on fallback) email.
          const pref = tenant.preferredChannel || "email";
          const phone = paymentInfo.tenantPhone;
          const shortVars = {
            tenantName: paymentInfo.tenantName,
            amount: `€${paymentInfo.amount.toFixed(2)}`,
            dueDate: fmtDueDate(paymentInfo.dueDate),
            propertyName,
            daysPastDue: String(paymentInfo.daysPastDue),
            ownerName,
          };
          let usedChannel: "email" | "sms" | "whatsapp" = "email";
          if (pref === "whatsapp" && isWhatsAppConfigured() && phone && !isReminderTestPhase()) {
            await sendWhatsApp({ to: normalizePhoneNumber(phone), body: shortReminderBody(paymentInfo.tenantLanguage, level, shortVars) });
            usedChannel = "whatsapp";
          } else if (pref === "sms" && isSmsConfigured() && phone && !isReminderTestPhase()) {
            await queueSms(
              { to: normalizePhoneNumber(phone), body: shortReminderBody(paymentInfo.tenantLanguage, level, shortVars) },
              undefined,
              { ownerId: lease.ownerId, leaseId: payment.leaseId, type: `payment_reminder_${level}` as CommunicationMeta["type"], recipientName: paymentInfo.tenantName },
            );
            usedChannel = "sms";
          } else {
            await sendReminder(paymentInfo, level, followUpSettings, lease.ownerId, ownerData[0]?.email);
            usedChannel = "email";
          }

          // Record the reminder in paymentReminders table
          await db.insert(paymentReminders).values({
            id: crypto.randomUUID(),
            paymentId: payment.paymentId,
            type: level,
            channel: usedChannel,
            sentAt: new Date(),
          });

          sentCount++;
          console.log(
            `[PaymentCheck] Sent ${level} reminder for payment ${payment.paymentId} via ${usedChannel}`
          );
        }
      } catch (err) {
        console.error(
          `[PaymentCheck] Error processing payment ${payment.paymentId}:`,
          err
        );
      }
    }

    console.log(
      `[PaymentCheck] Processed ${overduePayments.length} overdue payments, sent ${sentCount} reminders`
    );
    return { ok: true };
    }

    // =======================================================
    // Phase A2: Due-today heads-up to the landlord / managers
    // A notice on the due date itself (before it is late), so the person who
    // manages the property knows rent is expected today. Owner is CC'd.
    // =======================================================
    console.log("[PaymentCheck] Phase A2: Checking rent due today...");
    try {
      // Make sure the current month's expected records exist so due-today rent
      // has a record to notify about and act on.
      await ensureExpectedPaymentsForAllActive();
    } catch (err) {
      console.error("[PaymentCheck] expected-payment generation failed:", err);
    }

    const dueToday = await db
      .select({
        paymentId: payments.id,
        amount: payments.amount,
        dueDate: payments.dueDate,
        leaseId: payments.leaseId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.dueDate, today),
          eq(payments.status, "pending"),
          eq(payments.isIgnored, false),
          isNull(payments.landlordDueNotifiedAt),
          or(isNull(payments.notes), ne(payments.notes, DEPOSIT_NOTE))
        )
      );

    let dueSent = 0;
    for (const payment of dueToday) {
      try {
        const leaseData = await db
          .select({
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
            landlordLateNotify: leases.landlordLateNotify,
          })
          .from(leases)
          .where(eq(leases.id, payment.leaseId))
          .limit(1);
        if (leaseData.length === 0) continue;
        const lease = leaseData[0]!;
        if (!lease.landlordLateNotify) continue;

        // Already recorded paid (payment or ledger allocation)? Do not notify.
        if (await isPeriodSettled(db, payment.leaseId, payment.dueDate, Number(lease.monthlyRent || 0))) {
          continue;
        }

        const tenantData = await db
          .select({ firstName: tenants.firstName, lastName: tenants.lastName })
          .from(leaseTenants)
          .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
          .where(eq(leaseTenants.leaseId, payment.leaseId))
          .limit(1);
        const tenantName = tenantData[0]
          ? `${tenantData[0].firstName} ${tenantData[0].lastName}`.trim()
          : "Tenant";

        const propertyData = await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1);
        const propertyName = propertyData[0]?.name || "Unknown property";

        const ownerData = await db
          .select({ email: users.email, locale: users.locale })
          .from(users)
          .where(eq(users.id, lease.ownerId))
          .limit(1);

        const recipients = await getLandlordNotificationRecipients(
          lease.propertyId,
          ownerData[0]?.email,
        );
        if (!recipients.to) continue;

        await sendLandlordLateEmail({
          paymentId: payment.paymentId,
          to: recipients.to,
          cc: recipients.cc,
          ownerLocale: ownerData[0]?.locale || "en",
          tenantName,
          propertyName,
          amount: Number(payment.amount),
          dueDate: payment.dueDate,
          daysPastDue: 0,
          kind: "due",
        });
        await db
          .update(payments)
          .set({ landlordDueNotifiedAt: new Date() })
          .where(eq(payments.id, payment.paymentId));
        dueSent++;
      } catch (err) {
        console.error(
          `[PaymentCheck] due-today heads-up failed for payment ${payment.paymentId}:`,
          err,
        );
      }
    }
    console.log(`[PaymentCheck] Phase A2: sent ${dueSent} due-today heads-up emails`);

    // =======================================================
    // Phase B: Bank account monitoring (D-07)
    // Poll active connections for incoming transactions
    // =======================================================
    console.log("[PaymentCheck] Phase B: Starting bank account monitoring poll...");

    const activeConnections = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.status, "active"));

    if (activeConnections.length > 0) {
      let totalMatched = 0;
      let totalMismatched = 0;

      for (const conn of activeConnections) {
        try {
          // Phase 09-03: Delegate to the shared syncBankConnection service
          // (single source of truth — also called by POST /:id/sync). The
          // 90-day first-sync backfill is computed inside the service per
          // RESEARCH Pitfall 8; the previous inline 3-day window is removed.
          const result = await syncBankConnection(conn.id);
          totalMatched += result.matched;
          totalMismatched += result.mismatched;
          console.log(
            `[PaymentCheck] Bank ${conn.iban || conn.id}: fetched=${result.fetched} matched=${result.matched} mismatched=${result.mismatched} unmatched=${result.unmatched} skippedDuplicates=${result.skippedDuplicates}`
          );
        } catch (err) {
          console.error(
            `[PaymentCheck] Failed to poll bank connection ${conn.id}:`,
            err
          );
          await db
            .update(bankConnections)
            .set({
              errorMessage: String(err),
              updatedAt: new Date(),
            })
            .where(eq(bankConnections.id, conn.id));
        }
      }

      console.log(
        `[PaymentCheck] Bank monitoring complete: ${totalMatched} matched, ${totalMismatched} mismatched across ${activeConnections.length} connections`
      );
    } else {
      console.log("[PaymentCheck] No active bank connections to poll");
    }

    // =======================================================
    // Phase C: Consent expiry check (D-09)
    // =======================================================
    console.log("[PaymentCheck] Phase C: Checking consent expiry...");

    const now = new Date();
    const sevenDaysFromNow = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    const expiringConnections = await db
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.status, "active"),
          lte(bankConnections.consentExpiresAt, sevenDaysFromNow),
          gte(bankConnections.consentExpiresAt, now) // not yet expired
        )
      );

    for (const conn of expiringConnections) {
      const daysUntilExpiry = Math.ceil(
        ((conn.consentExpiresAt?.getTime() || 0) - now.getTime()) /
          (24 * 60 * 60 * 1000)
      );

      // Only warn at 7 days and 1 day thresholds per D-09
      if (daysUntilExpiry !== 7 && daysUntilExpiry !== 1) continue;

      try {
        // Attempt silent renewal first per D-09
        const consentProvider = getBankAccountDataProvider();
        const newExpiry = await consentProvider.renewConsent(
          conn.externalRequisitionId!
        );

        if (newExpiry) {
          // Renewal succeeded -- update consent expiry
          await db
            .update(bankConnections)
            .set({
              consentExpiresAt: newExpiry,
              updatedAt: new Date(),
            })
            .where(eq(bankConnections.id, conn.id));
          console.log(
            `[PaymentCheck] Consent renewed for connection ${conn.id}, new expiry: ${newExpiry.toISOString()}`
          );
        } else {
          // Renewal failed -- send warning email to landlord per D-09
          const owner = await db
            .select({
              email: users.email,
              name: users.name,
              locale: users.locale,
            })
            .from(users)
            .where(eq(users.id, conn.ownerId))
            .limit(1);

          if (owner[0]?.email) {
            const recipientLocale = owner[0].locale || "en";
            const { subject, body } = buildRenewalEmail(recipientLocale, {
              days: daysUntilExpiry,
              name: owner[0].name,
              institution: conn.institutionName || conn.iban,
              connectionId: conn.id,
              webUrl: process.env.WEB_URL || "http://localhost:3000",
            });
            await queueEmail({
              to: owner[0].email,
              subject,
              body,
            }, undefined, {
              ownerId: conn.ownerId,
              type: "other",
              recipientName: owner[0].name || "Landlord",
            });
            console.log(
              `[PaymentCheck] Consent expiry warning sent to ${owner[0].email} for connection ${conn.id} (${daysUntilExpiry} days remaining)`
            );
          }
        }
      } catch (err) {
        console.error(
          `[PaymentCheck] Failed to check/renew consent for connection ${conn.id}:`,
          err
        );
      }
    }

    console.log("[PaymentCheck] Balance check completed");

    // Phase D: Roll the expected-payment schedule forward so each month's
    // expected (pending) rent payment appears. Forward-only, so this never
    // creates a past-due payment that would trigger reminders.
    try {
      console.log("[PaymentCheck] Phase D: Generating expected payments...");
      const gen = await ensureExpectedPaymentsForAllActive();
      console.log(
        `[PaymentCheck] Phase D: ${gen.created} expected payment(s) created across ${gen.leases} active lease(s)`
      );
    } catch (err) {
      console.error("[PaymentCheck] Phase D: expected-payment generation failed:", err);
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[PaymentCheck] Job ${job?.id} failed:`, err);
});

// Schedule balance checks 3x per day: 00:00, 10:00, 17:00
export async function setupPaymentCheckSchedule(): Promise<void> {
  // Remove any existing repeatable jobs
  const existing = await paymentCheckQueue.getRepeatableJobs();
  for (const job of existing) {
    await paymentCheckQueue.removeRepeatableByKey(job.key);
  }

  const tz = getScheduleTimezone();

  // Add the 3 daily checks (in the scheduling timezone, not UTC)
  for (const cron of BALANCE_CHECK_CRON) {
    await paymentCheckQueue.add(
      "check-overdue-payments",
      { scheduledAt: cron },
      {
        repeat: { pattern: cron, tz },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );
  }

  // Evening (19:15 local), after the 19:00 bank sync: the overdue tenant
  // reminders, and the friendly due-date nudge. Both land in the payment-action
  // sweet spot and exclude anyone whose payment synced at 19:00.
  for (const name of ["overdue-reminders", "due-reminder-sms"]) {
    await paymentCheckQueue.add(
      name,
      { scheduledAt: "15 19 * * *" },
      {
        repeat: { pattern: "15 19 * * *", tz },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  console.log(`[PaymentCheck] Scheduled balance checks at 00:00, 12:00, 19:00 + overdue-reminders & due-SMS at 19:15, timezone ${tz}`);
}

export { paymentCheckQueue, worker };
