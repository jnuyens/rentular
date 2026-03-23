import { Worker, Queue } from "bullmq";
import { sendSms, type SmsOptions } from "../lib/sms";
import { getDb, communications } from "@rentular/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import type { CommunicationMeta } from "./emailQueueWorker";

const QUEUE_NAME = "sms-queue";

// SMS rate limiting: typically stricter than email
const MAX_SMS_PER_MINUTE = Number(process.env.SMS_RATE_LIMIT) || 10;

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

export const smsQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { to, body, from, communicationId } = job.data as SmsOptions & { communicationId?: string };
    console.log(`[SmsQueue] Sending SMS to ${to}`);
    try {
      const result = await sendSms({ to, body, from });
      console.log(`[SmsQueue] Sent successfully, messageId: ${result.messageId}`);

      // Update communications record on success
      if (communicationId) {
        try {
          const db = getDb();
          await db
            .update(communications)
            .set({ status: "sent", sentAt: new Date(), externalId: result.messageId })
            .where(eq(communications.id, communicationId));
        } catch (dbErr) {
          console.error(`[SmsQueue] Failed to update communications record ${communicationId}:`, dbErr);
        }
      }

      return result;
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
          console.error(`[SmsQueue] Failed to update communications record ${communicationId}:`, dbErr);
        }
      }
      throw err; // Re-throw for BullMQ retry
    }
  },
  {
    connection,
    concurrency: 1,
    limiter: {
      max: MAX_SMS_PER_MINUTE,
      duration: 60000,
    },
  }
);

worker.on("failed", (job, err) => {
  console.error(`[SmsQueue] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});

/**
 * Queue an SMS for delivery with rate limiting.
 *
 * If `meta` is provided, a communications record is inserted for logging.
 * Backward compatible: calls without meta still work without logging.
 */
export async function queueSms(
  options: SmsOptions,
  opts?: {
    priority?: number;
    delay?: number;
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
        channel: "sms",
        type: meta.type,
        recipientName: meta.recipientName,
        recipientPhone: options.to,
        subject: null,
        body: options.body,
        status: "queued",
      });
    } catch (dbErr) {
      console.error(`[SmsQueue] Failed to insert communications record:`, dbErr);
    }
  }

  const jobData = communicationId
    ? { ...options, communicationId }
    : options;

  const job = await smsQueue.add("send-sms", jobData, {
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
      console.error(`[SmsQueue] Failed to update externalId for ${communicationId}:`, dbErr);
    }
  }

  return job.id!;
}

export { worker as smsWorker };
