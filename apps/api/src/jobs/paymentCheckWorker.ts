import { Worker, Queue } from "bullmq";
import { eq, and, lt, lte, gte, inArray } from "drizzle-orm";
import {
  getDb,
  payments,
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
import { getBankAccountDataProvider } from "../lib/bankAccountData";
import { syncBankConnection } from "../services/bankConnectionSync";
import { queueEmail } from "./emailQueueWorker";
import type { SupportedLanguage } from "@rentular/shared";

const QUEUE_NAME = "payment-check";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const paymentCheckQueue = new Queue(QUEUE_NAME, { connection });

// Process payment checks
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(
      `[PaymentCheck] Running balance check at ${new Date().toISOString()}`
    );

    const db = getDb();
    const today = new Date().toISOString().split("T")[0]!;

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
      })
      .from(payments)
      .where(
        and(
          lt(payments.dueDate, today),
          inArray(payments.status, ["pending"]),
          eq(payments.isIgnored, false)
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
            latePaymentFeeEnabled: leases.latePaymentFeeEnabled,
            latePaymentFeeAmount: leases.latePaymentFeeAmount,
            latePaymentFeeEnforcement: leases.latePaymentFeeEnforcement,
          })
          .from(leases)
          .where(eq(leases.id, payment.leaseId))
          .limit(1);

        if (leaseData.length === 0) continue;
        const lease = leaseData[0]!;

        // Get the primary tenant
        const tenantData = await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            email: tenants.email,
            phone: tenants.phone,
            language: tenants.language,
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
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, lease.ownerId))
          .limit(1);

        const ownerName =
          ownerData[0]?.name || ownerData[0]?.email || "Your landlord";

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
          await sendReminder(paymentInfo, level, followUpSettings, lease.ownerId);

          // Record the reminder in paymentReminders table
          await db.insert(paymentReminders).values({
            id: crypto.randomUUID(),
            paymentId: payment.paymentId,
            type: level,
            channel: "email",
            sentAt: new Date(),
          });

          sentCount++;
          console.log(
            `[PaymentCheck] Sent ${level} reminder for payment ${payment.paymentId}`
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
            .select({ email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, conn.ownerId))
            .limit(1);

          if (owner[0]?.email) {
            await queueEmail({
              to: owner[0].email,
              subject: `Bank connection expiring in ${daysUntilExpiry} day(s) - action required`,
              body: `Dear ${owner[0].name || "Landlord"},\n\nYour bank connection for ${conn.institutionName || conn.iban || "your account"} will expire in ${daysUntilExpiry} day(s).\n\nAutomatic renewal was not possible. Please reconnect your bank account in the Rentular dashboard to continue receiving automatic payment matching.\n\nIf you do not reconnect before expiry, incoming bank transfers will no longer be automatically matched to expected payments.\n\nBest regards,\nRentular`,
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

  // Add the 3 daily checks
  for (const cron of BALANCE_CHECK_CRON) {
    await paymentCheckQueue.add(
      "check-overdue-payments",
      { scheduledAt: cron },
      {
        repeat: { pattern: cron },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );
  }

  console.log("[PaymentCheck] Scheduled balance checks at 00:00, 10:00, 17:00");
}

export { paymentCheckQueue, worker };
