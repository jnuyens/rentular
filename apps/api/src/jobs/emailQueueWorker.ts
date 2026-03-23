import { Worker, Queue } from "bullmq";
import { sendEmail, type EmailOptions } from "../lib/email";
import { getDb, communications } from "@rentular/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const QUEUE_NAME = "email-queue";

// Rate limiting: max emails per minute and delay between sends
const MAX_EMAILS_PER_MINUTE = Number(process.env.EMAIL_RATE_LIMIT) || 30;
const DELAY_BETWEEN_MS = Math.ceil(60000 / MAX_EMAILS_PER_MINUTE); // e.g. 2000ms for 30/min

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

export const emailQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

/**
 * Metadata for automatic communication logging.
 * When provided to queueEmail/queueSms, a record is inserted into the communications table.
 */
export interface CommunicationMeta {
  ownerId: string;
  leaseId?: string;
  type: "payment_reminder_friendly" | "payment_reminder_formal" | "payment_reminder_final" | "indexation_notification" | "landlord_report" | "custom" | "welcome" | "lease_renewal" | "lease_termination" | "other";
  recipientName: string;
}

// Process emails one at a time with a limiter to avoid overwhelming the mail server
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { to, subject, body, attachments, communicationId } = job.data as EmailOptions & { communicationId?: string };
    console.log(`[EmailQueue] Sending email to ${to}: "${subject}"`);
    try {
      await sendEmail({ to, subject, body, attachments });
      console.log(`[EmailQueue] Sent successfully to ${to}`);

      // Update communications record on success
      if (communicationId) {
        try {
          const db = getDb();
          await db
            .update(communications)
            .set({ status: "sent", sentAt: new Date() })
            .where(eq(communications.id, communicationId));
        } catch (dbErr) {
          console.error(`[EmailQueue] Failed to update communications record ${communicationId}:`, dbErr);
        }
      }
    } catch (err) {
      // Update communications record on failure
      if (communicationId) {
        try {
          const db = getDb();
          await db
            .update(communications)
            .set({ status: "failed", errorMessage: String(err) })
            .where(eq(communications.id, communicationId));
        } catch (dbErr) {
          console.error(`[EmailQueue] Failed to update communications record ${communicationId}:`, dbErr);
        }
      }
      throw err; // Re-throw for BullMQ retry
    }
  },
  {
    connection,
    concurrency: 1, // Process one email at a time
    limiter: {
      max: MAX_EMAILS_PER_MINUTE,
      duration: 60000, // per minute
    },
  }
);

worker.on("failed", (job, err) => {
  console.error(`[EmailQueue] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[EmailQueue] Job ${job.id} completed`);
});

/**
 * Queue an email for delivery. Emails are sent one at a time with rate limiting
 * to avoid overwhelming the mail server.
 *
 * If `meta` is provided, a communications record is inserted for logging.
 * Backward compatible: calls without meta still work without logging.
 */
export async function queueEmail(
  options: EmailOptions,
  opts?: {
    priority?: number;  // Lower number = higher priority (1 = highest)
    delay?: number;     // Delay in ms before processing
  },
  meta?: CommunicationMeta,
): Promise<string> {
  let communicationId: string | undefined;

  // Insert communications record if metadata is provided
  if (meta) {
    communicationId = crypto.randomUUID();
    try {
      const db = getDb();
      await db.insert(communications).values({
        id: communicationId,
        ownerId: meta.ownerId,
        leaseId: meta.leaseId || null,
        channel: "email",
        type: meta.type,
        recipientName: meta.recipientName,
        recipientEmail: options.to,
        subject: options.subject,
        body: options.body,
        status: "queued",
      });
    } catch (dbErr) {
      console.error(`[EmailQueue] Failed to insert communications record:`, dbErr);
      // Continue with queuing even if logging fails
    }
  }

  const jobData = communicationId
    ? { ...options, communicationId }
    : options;

  const job = await emailQueue.add("send-email", jobData, {
    priority: opts?.priority,
    delay: opts?.delay,
  });

  // Update the communications record with the job ID as externalId
  if (communicationId && job.id) {
    try {
      const db = getDb();
      await db
        .update(communications)
        .set({ externalId: job.id })
        .where(eq(communications.id, communicationId));
    } catch (dbErr) {
      console.error(`[EmailQueue] Failed to update externalId for ${communicationId}:`, dbErr);
    }
  }

  return job.id!;
}

/**
 * Queue multiple emails for batch delivery. Each email is added as a separate
 * job with a staggered delay to spread the load.
 */
export async function queueBatchEmails(
  emails: EmailOptions[],
  opts?: { priority?: number }
): Promise<string[]> {
  const jobIds: string[] = [];
  for (let i = 0; i < emails.length; i++) {
    const job = await emailQueue.add("send-email", emails[i], {
      priority: opts?.priority,
      delay: i * DELAY_BETWEEN_MS, // Stagger each email
    });
    jobIds.push(job.id!);
  }
  console.log(`[EmailQueue] Queued ${emails.length} emails for batch delivery`);
  return jobIds;
}

/**
 * Get queue statistics for monitoring.
 */
export async function getEmailQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    emailQueue.getWaitingCount(),
    emailQueue.getActiveCount(),
    emailQueue.getCompletedCount(),
    emailQueue.getFailedCount(),
    emailQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

export { worker as emailWorker };
