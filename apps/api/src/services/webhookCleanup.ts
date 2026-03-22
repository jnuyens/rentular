import { Worker, Queue } from "bullmq";
import { lt } from "drizzle-orm";
import { getDb, webhookEvents } from "@rentular/db";

const QUEUE_NAME = "webhook-cleanup";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const webhookCleanupQueue = new Queue(QUEUE_NAME, { connection });

// Runs weekly (Sunday at 03:00) to clean up old webhook events (D-11: 12-month retention)
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const db = getDb();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    console.log(
      `[WebhookCleanup] Cleaning events older than ${twelveMonthsAgo.toISOString()}`
    );

    const result = await db
      .delete(webhookEvents)
      .where(lt(webhookEvents.receivedAt, twelveMonthsAgo));

    const deletedCount = (result as unknown as [{ affectedRows: number }])[0]
      ?.affectedRows ?? 0;
    console.log(
      `[WebhookCleanup] Deleted ${deletedCount} webhook events older than 12 months`
    );
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[WebhookCleanup] Job ${job?.id} failed:`, err);
});

export async function setupWebhookCleanupSchedule(): Promise<void> {
  // Remove any existing repeatable jobs to avoid duplicates
  const existing = await webhookCleanupQueue.getRepeatableJobs();
  for (const job of existing) {
    await webhookCleanupQueue.removeRepeatableByKey(job.key);
  }

  await webhookCleanupQueue.add(
    "cleanup-old-events",
    {},
    {
      repeat: { pattern: "0 3 * * 0" }, // Sunday 03:00
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 5 },
    }
  );

  console.log("[WebhookCleanup] Scheduled weekly cleanup at Sunday 03:00");
}

export { webhookCleanupQueue, worker };
