import { Hono } from "hono";
import {
  verifyWebhookSignature,
  type GoCardlessEvent,
  type GoCardlessWebhookPayload,
} from "../lib/gocardless";
import { queueEmail } from "../jobs/emailQueueWorker";

export const webhooksRouter = new Hono();

// GoCardless webhook handler
// Receives payment status updates, mandate events, etc.
// Docs: https://developer.gocardless.com/api-reference/#appendix-webhooks
webhooksRouter.post("/gocardless", async (c) => {
  const signature = c.req.header("Webhook-Signature");
  const body = await c.req.text();

  const webhookSecret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Webhook] GOCARDLESS_WEBHOOK_SECRET is not set");
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  // Verify signature
  if (!verifyWebhookSignature(body, signature, webhookSecret)) {
    console.warn("[Webhook] Invalid GoCardless webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse the events
  let payload: GoCardlessWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Process each event
  for (const event of payload.events) {
    try {
      await processEvent(event);
    } catch (err) {
      // Log but don't fail the webhook - GoCardless will retry if we return non-200
      console.error(`[Webhook] Error processing event ${event.id}:`, err);
    }
  }

  // Always return 200 to acknowledge receipt
  return c.json({ status: "received" });
});

async function processEvent(event: GoCardlessEvent): Promise<void> {
  console.log(
    `[Webhook] Processing ${event.resource_type}.${event.action} (${event.id})`
  );

  switch (event.resource_type) {
    case "payments":
      await handlePaymentEvent(event);
      break;
    case "mandates":
      await handleMandateEvent(event);
      break;
    case "payouts":
      await handlePayoutEvent(event);
      break;
    default:
      console.log(
        `[Webhook] Unhandled resource type: ${event.resource_type}.${event.action}`
      );
  }
}

// ----- Payment events -----
async function handlePaymentEvent(event: GoCardlessEvent): Promise<void> {
  const gcPaymentId = event.links.payment;

  switch (event.action) {
    case "confirmed": {
      // Payment successfully collected from the tenant's bank account
      console.log(`[Webhook] Payment ${gcPaymentId} confirmed`);

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "failed": {
      // Payment failed (e.g. insufficient funds, mandate cancelled)
      console.log(
        `[Webhook] Payment ${gcPaymentId} failed: ${event.details.cause} - ${event.details.description}`
      );

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "late_failure_settled": {
      // A payment that was initially confirmed has been reversed (chargeback)
      console.log(`[Webhook] Payment ${gcPaymentId} late failure settled`);

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "charged_back": {
      // Tenant's bank has reversed the payment
      console.log(`[Webhook] Payment ${gcPaymentId} charged back`);

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "paid_out": {
      // Funds have been paid out to the landlord's bank account
      console.log(`[Webhook] Payment ${gcPaymentId} paid out to landlord`);
      // Informational - the payment was already confirmed earlier
      break;
    }

    case "submitted":
    case "created": {
      // Payment created/submitted to the bank - no action needed
      console.log(`[Webhook] Payment ${gcPaymentId} ${event.action}`);
      break;
    }

    case "cancelled": {
      console.log(`[Webhook] Payment ${gcPaymentId} cancelled`);
      // Phase 2: implement payment/mandate state persistence
      break;
    }

    default:
      console.log(
        `[Webhook] Unhandled payment action: ${event.action} for ${gcPaymentId}`
      );
  }
}

// ----- Mandate events -----
async function handleMandateEvent(event: GoCardlessEvent): Promise<void> {
  const mandateId = event.links.mandate;

  switch (event.action) {
    case "active": {
      // Mandate is now active - direct debits can be collected
      console.log(`[Webhook] Mandate ${mandateId} is now active`);

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "cancelled":
    case "failed":
    case "expired": {
      // Mandate is no longer usable
      console.log(
        `[Webhook] Mandate ${mandateId} ${event.action}: ${event.details.cause}`
      );

      // Phase 2: implement payment/mandate state persistence
      break;
    }

    case "created":
    case "submitted":
    case "reinstated": {
      console.log(`[Webhook] Mandate ${mandateId} ${event.action}`);
      break;
    }

    default:
      console.log(
        `[Webhook] Unhandled mandate action: ${event.action} for ${mandateId}`
      );
  }
}

// ----- Payout events -----
async function handlePayoutEvent(event: GoCardlessEvent): Promise<void> {
  const payoutId = event.links.payout;

  switch (event.action) {
    case "paid": {
      // Funds have arrived in the landlord's bank account
      console.log(`[Webhook] Payout ${payoutId} paid to landlord bank`);
      // Informational - could be used for reconciliation
      break;
    }

    default:
      console.log(
        `[Webhook] Unhandled payout action: ${event.action} for ${payoutId}`
      );
  }
}
