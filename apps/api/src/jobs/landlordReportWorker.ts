import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import {
  shouldSendReport,
  generateReportEmail,
  shouldRunOnDay,
} from "../services/landlordReport";
import { sendEmail } from "../lib/email";

const QUEUE_NAME = "landlord-report";

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

const landlordReportQueue = new Queue(QUEUE_NAME, { connection });

// Runs daily at 08:00 - checks if today is a report day for each landlord
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const today = new Date();
    const currentDay = today.getDate();
    const reportDate = today.toISOString().split("T")[0];

    console.log(`[LandlordReport] Checking reports for day ${currentDay} (${reportDate})`);

    // TODO: Query all owners with landlord report settings
    // For each owner:
    //   1. Parse their reportDays (e.g. "3,7,15,28" -> [3,7,15,28])
    //   2. Check if today is a report day for them
    //   3. If so, gather all payment statuses for the current month
    //   4. Check shouldSendReport (respects skipIfAllPaid)
    //   5. Generate and send the report email

    // Example flow:
    // const owners = await getOwnersWithReportSettings();
    // for (const owner of owners) {
    //   if (!owner.landlordReportEnabled) continue;
    //   const reportDays = owner.landlordReportDays.split(",").map(Number);
    //   if (!shouldRunOnDay(reportDays, currentDay)) continue;
    //
    //   const payments = await getMonthlyPayments(owner.id);
    //   const reportData = {
    //     ownerName: owner.name,
    //     ownerEmail: owner.email,
    //     reportDate,
    //     payments,
    //     skipIfAllPaid: owner.landlordReportSkipIfAllPaid,
    //   };
    //
    //   if (shouldSendReport(reportData)) {
    //     const email = generateReportEmail(reportData);
    //     await sendEmail(email);
    //     console.log(`[LandlordReport] Sent report to ${owner.email}`);
    //   } else {
    //     console.log(`[LandlordReport] Skipped report for ${owner.email} (all paid)`);
    //   }
    // }

    console.log(`[LandlordReport] Report check completed`);
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[LandlordReport] Job ${job?.id} failed:`, err);
});

// Schedule daily at 08:00
export async function setupLandlordReportSchedule(): Promise<void> {
  const existing = await landlordReportQueue.getRepeatableJobs();
  for (const job of existing) {
    await landlordReportQueue.removeRepeatableByKey(job.key);
  }

  await landlordReportQueue.add(
    "daily-landlord-report",
    {},
    {
      repeat: { pattern: "0 8 * * *" },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    }
  );

  console.log("[LandlordReport] Scheduled daily report check at 08:00");
}

export { landlordReportQueue, worker };
