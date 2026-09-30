import { Worker, Queue } from "bullmq";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  getDb,
  payments,
  leases,
  leaseTenants,
  tenants,
  paymentFollowUpSettings,
  properties,
  users,
} from "@rentular/db";
import {
  shouldSendReport,
  generateReportEmail,
  shouldRunOnDay,
} from "../services/landlordReport";
import { queueEmail } from "./emailQueueWorker";

const QUEUE_NAME = "landlord-report";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const landlordReportQueue = new Queue(QUEUE_NAME, { connection });

// Runs daily at 08:00 - checks if today is a report day for each landlord
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const db = getDb();
    const today = new Date();
    const currentDay = today.getDate();
    const reportDate = today.toISOString().split("T")[0]!;

    console.log(
      `[LandlordReport] Checking reports for day ${currentDay} (${reportDate})`
    );

    // Get month boundaries
    const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = reportDate;

    // Query all owners with report settings
    const owners = await db
      .select()
      .from(paymentFollowUpSettings)
      .innerJoin(users, eq(paymentFollowUpSettings.ownerId, users.id));

    let sentCount = 0;

    for (const owner of owners) {
      try {
        if (!owner.payment_follow_up_settings.landlordReportEnabled) continue;

        // Parse report days
        const reportDays = (
          owner.payment_follow_up_settings.landlordReportDays || "3,7,15,28"
        )
          .split(",")
          .map(Number);

        if (!shouldRunOnDay(reportDays, currentDay)) continue;

        const ownerId = owner.payment_follow_up_settings.ownerId;

        // Get monthly payments for this owner
        const monthlyPayments = await db
          .select({
            paymentId: payments.id,
            amount: payments.amount,
            dueDate: payments.dueDate,
            status: payments.status,
            paidDate: payments.paidDate,
            latePaymentFee: payments.latePaymentFee,
            interestCharged: payments.interestCharged,
            leaseId: payments.leaseId,
            propertyId: leases.propertyId,
          })
          .from(payments)
          .innerJoin(leases, eq(payments.leaseId, leases.id))
          .where(
            and(
              eq(leases.ownerId, ownerId),
              gte(payments.dueDate, monthStart),
              lte(payments.dueDate, monthEnd)
            )
          );

        // Enrich with property and tenant names
        const enrichedPayments = [];
        for (const p of monthlyPayments) {
          // Get property name
          const propData = await db
            .select({ name: properties.name })
            .from(properties)
            .where(eq(properties.id, p.propertyId))
            .limit(1);

          // Get primary tenant name
          const tenantData = await db
            .select({
              firstName: tenants.firstName,
              lastName: tenants.lastName,
            })
            .from(leaseTenants)
            .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
            .where(
              and(
                eq(leaseTenants.leaseId, p.leaseId),
                eq(leaseTenants.isPrimary, true)
              )
            )
            .limit(1);

          // Calculate days past due for overdue/failed payments
          const dueMs = new Date(p.dueDate).getTime();
          const todayMs = new Date(reportDate).getTime();
          const daysPastDue =
            p.status === "pending" || p.status === "failed"
              ? Math.max(
                  0,
                  Math.floor((todayMs - dueMs) / (1000 * 60 * 60 * 24))
                )
              : 0;

          // Determine display status
          let displayStatus: "paid" | "pending" | "overdue" | "failed" =
            p.status as "paid" | "pending" | "failed";
          if (p.status === "pending" && daysPastDue > 0) {
            displayStatus = "overdue";
          }

          enrichedPayments.push({
            tenantName: tenantData[0]
              ? `${tenantData[0].firstName} ${tenantData[0].lastName}`
              : "Unknown tenant",
            propertyName: propData[0]?.name || "Unknown property",
            amount: Number(p.amount),
            dueDate: p.dueDate,
            status: displayStatus,
            paidDate: p.paidDate,
            daysPastDue,
            latePaymentFee: Number(p.latePaymentFee || "0"),
            interestCharged: Number(p.interestCharged || "0"),
          });
        }

        // Build report data
        const ownerName = owner.users.name || owner.users.email;
        const ownerEmail = owner.users.email;

        const reportData = {
          ownerName,
          ownerEmail,
          reportDate,
          payments: enrichedPayments,
          skipIfAllPaid:
            owner.payment_follow_up_settings.landlordReportSkipIfAllPaid,
        };

        if (shouldSendReport(reportData)) {
          const email = generateReportEmail(reportData);
          await queueEmail(email, undefined, {
            ownerId,
            type: "landlord_report",
            recipientName: ownerName,
          });
          sentCount++;
          console.log(`[LandlordReport] Sent report to ${ownerEmail}`);
        } else {
          console.log(
            `[LandlordReport] Skipped report for ${ownerEmail} (all paid or no data)`
          );
        }
      } catch (err) {
        console.error(
          `[LandlordReport] Error processing owner ${owner.payment_follow_up_settings.ownerId}:`,
          err
        );
      }
    }

    console.log(
      `[LandlordReport] Report check completed: ${sentCount}/${owners.length} reports sent`
    );
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
