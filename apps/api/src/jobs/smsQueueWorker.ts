import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { sendSms, type SmsOptions } from "../lib/sms";

const QUEUE_NAME = "sms-queue";

// SMS rate limiting: typically stricter than email
const MAX_SMS_PER_MINUTE = Number(process.env.SMS_RATE_LIMIT) || 10;

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

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
    const { to, body, from } = job.data as SmsOptions;
    console.log(`[SmsQueue] Sending SMS to ${to}`);
    const result = await sendSms({ to, body, from });
    console.log(`[SmsQueue] Sent successfully, messageId: ${result.messageId}`);
    return result;
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
 */
export async function queueSms(options: SmsOptions, opts?: {
  priority?: number;
  delay?: number;
}): Promise<string> {
  const job = await smsQueue.add("send-sms", options, {
    priority: opts?.priority,
    delay: opts?.delay,
  });
  return job.id!;
}

export { worker as smsWorker };
