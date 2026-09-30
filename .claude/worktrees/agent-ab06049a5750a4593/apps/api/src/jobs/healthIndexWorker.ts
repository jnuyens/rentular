import { Worker, Queue } from "bullmq";
import { fetchAndCacheHealthIndex } from "../services/healthIndex";

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
    await fetchAndCacheHealthIndex();
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
 * Schedule daily health index refresh at 06:00 UTC.
 * Statbel publishes on the penultimate business day of the month.
 * Running daily ensures we pick up new values promptly.
 */
export async function setupHealthIndexSchedule(): Promise<void> {
  const existing = await healthIndexQueue.getRepeatableJobs();
  for (const job of existing) {
    await healthIndexQueue.removeRepeatableByKey(job.key);
  }

  // Daily at 06:00 UTC
  await healthIndexQueue.add(
    "refresh-health-index",
    {},
    {
      repeat: { pattern: "0 6 * * *" },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  console.log("[HealthIndex] Daily refresh scheduled at 06:00 UTC");
}

export { healthIndexQueue, worker };
