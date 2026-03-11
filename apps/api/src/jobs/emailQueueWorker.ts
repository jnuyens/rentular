import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { sendEmail, type EmailOptions } from "../lib/email";

const QUEUE_NAME = "email-queue";

// Rate limiting: max emails per minute and delay between sends
const MAX_EMAILS_PER_MINUTE = Number(process.env.EMAIL_RATE_LIMIT) || 30;
const DELAY_BETWEEN_MS = Math.ceil(60000 / MAX_EMAILS_PER_MINUTE); // e.g. 2000ms for 30/min

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// Process emails one at a time with a limiter to avoid overwhelming the mail server
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { to, subject, body, attachments } = job.data as EmailOptions;
    console.log(`[EmailQueue] Sending email to ${to}: "${subject}"`);
    await sendEmail({ to, subject, body, attachments });
    console.log(`[EmailQueue] Sent successfully to ${to}`);
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
 */
export async function queueEmail(options: EmailOptions, opts?: {
  priority?: number;  // Lower number = higher priority (1 = highest)
  delay?: number;     // Delay in ms before processing
}): Promise<string> {
  const job = await emailQueue.add("send-email", options, {
    priority: opts?.priority,
    delay: opts?.delay,
  });
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
