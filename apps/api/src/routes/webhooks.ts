import { Hono } from "hono";

export const webhooksRouter = new Hono();

// GoCardless webhook handler
// Receives payment status updates, mandate events, etc.
webhooksRouter.post("/gocardless", async (c) => {
  const signature = c.req.header("Webhook-Signature");
  const body = await c.req.text();

  // TODO: Verify webhook signature using GoCardless webhook secret
  // const isValid = verifyWebhookSignature(body, signature, process.env.GOCARDLESS_WEBHOOK_SECRET);
  // if (!isValid) return c.json({ error: "Invalid signature" }, 401);

  // TODO: Parse events and process them
  // Event types to handle:
  // - payments.confirmed -> Mark payment as paid
  // - payments.failed -> Mark payment as failed, queue retry/notification
  // - payments.late_failure_settled -> Handle late failures
  // - mandates.cancelled -> Disable auto-collection for lease
  // - mandates.active -> Enable auto-collection for lease

  return c.json({ status: "received" });
});
