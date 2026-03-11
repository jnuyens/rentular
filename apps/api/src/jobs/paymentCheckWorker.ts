import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { BALANCE_CHECK_CRON } from "@rentular/shared";
import {
  determineReminderLevel,
  sendReminder,
  DEFAULT_SETTINGS,
} from "../services/paymentFollowUp";

const QUEUE_NAME = "payment-check";

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

const paymentCheckQueue = new Queue(QUEUE_NAME, { connection });

// Process payment checks
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[PaymentCheck] Running balance check at ${new Date().toISOString()}`);

    // TODO: Query database for:
    // 1. All overdue payments (dueDate < today, status = 'pending', isIgnored = false)
    // 2. Each payment's associated tenant, lease, and property
    // 3. Owner's follow-up settings (or use defaults)
    // 4. Previously sent reminders for each payment

    // Example of how the processing works:
    // const overduePayments = await getOverduePayments();
    // for (const payment of overduePayments) {
    //   const settings = await getOwnerSettings(payment.ownerId) ?? DEFAULT_SETTINGS;
    //   if (!settings.enabled) continue;
    //
    //   const level = determineReminderLevel(payment, settings);
    //   if (level) {
    //     await sendReminder(payment, level, settings);
    //     await recordReminderSent(payment.paymentId, level);
    //     console.log(`[PaymentCheck] Sent ${level} reminder for payment ${payment.paymentId}`);
    //   }
    // }

    console.log(`[PaymentCheck] Balance check completed`);
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
