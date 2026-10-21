import { getScheduleTimezone } from "../lib/timezone";
import { Worker, Queue } from "bullmq";
import {
  fetchAndCacheHealthIndex,
  checkHealthIndexAndAlert,
  getHealthIndexValue,
  getLatestHealthIndex,
} from "../services/healthIndex";
import { queueEmail } from "./emailQueueWorker";

const QUEUE_NAME = "health-index-refresh";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const healthIndexQueue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async (_job) => {
    console.log("[HealthIndex] Running scheduled health index refresh...");
    const result = await fetchAndCacheHealthIndex();

    try {
      await checkHealthIndexAndAlert(result, {
        now: new Date(),
        tz: getScheduleTimezone(),
        adminEmail: process.env.ADMIN_EMAIL || undefined,
        hasMonth: async (year, month) => (await getHealthIndexValue(year, month)) !== null,
        latestMonth: async () => {
          const latest = await getLatestHealthIndex();
          return latest ? `${latest.year}-${latest.month}` : null;
        },
        // Reuse the queue's own Redis connection for the dedupe key.
        claimOnce: async (key, ttlSeconds) => {
          const redis = await healthIndexQueue.client;
          return (await redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK";
        },
        release: async (key) => {
          const redis = await healthIndexQueue.client;
          await redis.del(key);
        },
        sendEmail: async (to, subject, body) => {
          await queueEmail({ to, subject, body });
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[HealthIndex] Staleness check failed: ${message}`);
    }

    console.log("[HealthIndex] Scheduled refresh complete");
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(
    `[HealthIndex] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
    err.message
  );
});

worker.on("completed", (job) => {
  console.log(`[HealthIndex] Job ${job.id} completed`);
});

/**
 * Schedule daily health index refresh at 06:00 in the schedule timezone
 * (getScheduleTimezone(), Europe/Brussels by default).
 * Statbel publishes on the penultimate business day of the month.
 * Running daily ensures we pick up new values promptly. Each run also checks
 * that the previous month is cached from the 5th on and mails ADMIN_EMAIL if
 * the fetch failed or the index is overdue.
 */
export async function setupHealthIndexSchedule(): Promise<void> {
  const existing = await healthIndexQueue.getRepeatableJobs();
  for (const job of existing) {
    await healthIndexQueue.removeRepeatableByKey(job.key);
  }

  const tz = getScheduleTimezone();

  // Daily at 06:00 local time in the schedule timezone
  await healthIndexQueue.add(
    "refresh-health-index",
    {},
    {
      repeat: { pattern: "0 6 * * *", tz },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  console.log(`[HealthIndex] Daily refresh scheduled at 06:00 (${tz})`);
}

export { healthIndexQueue, worker };
