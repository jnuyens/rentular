import { Worker, Queue } from "bullmq";
import { deleteExpiredBankStatements } from "../services/bankStatementRetention";

// Phase 9 (BANK-RETENTION): weekly BullMQ cron that hard-deletes bank_statements
// rows past the retention threshold. Mirrors the webhookCleanup cron convention
// (Sunday 03:00). Connection shape matches the other workers in this app.
const QUEUE_NAME = "bank-statement-retention";
const CRON_PATTERN = "0 3 * * 0"; // Sunday 03:00

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const retentionQueue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async () => {
    console.log("[BankStatementRetention] Running scheduled cleanup");
    await deleteExpiredBankStatements();
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[BankStatementRetention] Job ${job?.id} failed:`, err);
});

export async function setupBankStatementRetentionSchedule(): Promise<void> {
  // Remove any existing repeatable jobs to avoid duplicates (idempotent setup).
  const existing = await retentionQueue.getRepeatableJobs();
  for (const job of existing) {
    await retentionQueue.removeRepeatableByKey(job.key);
  }

  await retentionQueue.add(
    "cleanup-bank-statements",
    {},
    {
      repeat: { pattern: CRON_PATTERN },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    }
  );

  console.log("[BankStatementRetention] Scheduled weekly cleanup at Sunday 03:00");
}

export { retentionQueue, worker };
