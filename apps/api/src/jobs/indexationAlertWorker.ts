import { getScheduleTimezone } from "../lib/timezone";
import { Worker, Queue } from "bullmq";
import { runIndexationAlerts } from "../services/indexationAlerts";

const QUEUE_NAME = "indexation-alerts";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const indexationAlertQueue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async (_job) => {
    console.log("[IndexationAlert] Running daily indexation digest...");
    const summary = await runIndexationAlerts();
    console.log("[IndexationAlert] Daily digest complete:", JSON.stringify(summary));
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(
    `[IndexationAlert] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
    err.message
  );
});

worker.on("completed", (job) => {
  console.log(`[IndexationAlert] Job ${job.id} completed`);
});

/**
 * Schedule the daily "indexation due" digest at 09:00 in the schedule
 * timezone, after the 06:00 health index refresh has picked up new values.
 */
export async function setupIndexationAlertSchedule(): Promise<void> {
  const existing = await indexationAlertQueue.getRepeatableJobs();
  for (const job of existing) {
    await indexationAlertQueue.removeRepeatableByKey(job.key);
  }

  const tz = getScheduleTimezone();
  await indexationAlertQueue.add(
    "send-indexation-alerts",
    {},
    {
      repeat: { pattern: "0 9 * * *", tz },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  console.log(`[IndexationAlert] Daily digest scheduled at 09:00 ${tz}`);
}

export { indexationAlertQueue, worker };
