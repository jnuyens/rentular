import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, webhookEvents, payments, leases, tenants } from "@rentular/db";
import {
  verifyWebhookSignature,
  type GoCardlessEvent,
  type GoCardlessWebhookPayload,
} from "../lib/gocardless";
import {
  transitionPayment,
  cascadeMandateCancellation,
  GC_PAYMENT_STATUS_MAP,
  GC_MANDATE_STATUS_MAP,
  MANDATE_TERMINAL_STATUSES,
  type PaymentStatus,
} from "../services/paymentStateMachine";

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

  const db = getDb();

  // Idempotency check: skip duplicate events (D-10)
  const existing = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.eventId, event.id),
  });
  if (existing) {
    console.log(`[Webhook] Skipping duplicate event ${event.id}`);
    return;
  }

  // Record the event before processing
  const eventRecord = {
    id: crypto.randomUUID(),
    eventId: event.id,
    resourceType: event.resource_type,
    action: event.action,
    resourceId:
      event.links[event.resource_type] ||
      event.links.payment ||
      event.links.mandate ||
      "",
    payload: event,
    status: "processing" as const,
    receivedAt: new Date(),
  };

  await db.insert(webhookEvents).values(eventRecord);

  try {
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

    // Mark event as processed
    await db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookEvents.id, eventRecord.id));
  } catch (err) {
    // Mark event as failed
    await db
      .update(webhookEvents)
      .set({ status: "failed", errorMessage: String(err) })
      .where(eq(webhookEvents.id, eventRecord.id));
    throw err;
  }
}

// ----- Payment events -----
async function handlePaymentEvent(event: GoCardlessEvent): Promise<void> {
  const gcPaymentId = event.links.payment;
  const db = getDb();

  // Map GoCardless action to internal status
  const internalStatus: PaymentStatus | undefined =
    GC_PAYMENT_STATUS_MAP[event.action];

  if (!internalStatus) {
    console.log(
      `[Webhook] No status mapping for payment action: ${event.action}, skipping`
    );
    return;
  }

  // Look up existing payment by GoCardless payment ID
  const payment = await db.query.payments.findFirst({
    where: eq(payments.gocardlessPaymentId, gcPaymentId),
  });

  if (payment) {
    // Transition the payment via state machine
    const transitioned = await transitionPayment(payment.id, internalStatus, {
      paidDate:
        internalStatus === "paid"
          ? new Date().toISOString().split("T")[0]
          : undefined,
    });

    if (transitioned) {
      console.log(
        `[Webhook] Payment ${gcPaymentId} transitioned to ${internalStatus}`
      );
    } else {
      console.log(
        `[Webhook] Payment ${gcPaymentId} transition to ${internalStatus} skipped (invalid from current state)`
      );
    }
  } else {
    // Auto-create unknown payment for review (D-12)
    // Try to find the lease via mandate links
    const mandateId = event.links.mandate;
    let lease = null;

    if (mandateId) {
      lease = await db.query.leases.findFirst({
        where: eq(leases.gocardlessMandateId, mandateId),
      });
    }

    if (lease) {
      await db.insert(payments).values({
        id: crypto.randomUUID(),
        leaseId: lease.id,
        status: internalStatus,
        amount: "0.00",
        dueDate: new Date().toISOString().split("T")[0],
        method: "gocardless",
        gocardlessPaymentId: gcPaymentId,
        notes:
          "Auto-created from webhook - amount unknown, needs review",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(
        `[Webhook] Auto-created payment for ${gcPaymentId} on lease ${lease.id} (needs review)`
      );
    } else {
      console.log(
        `[Webhook] Cannot resolve payment ${gcPaymentId} - no lease found for mandate ${mandateId || "unknown"}`
      );
    }
  }
}

// ----- Mandate events -----
async function handleMandateEvent(event: GoCardlessEvent): Promise<void> {
  const mandateId = event.links.mandate;
  const db = getDb();

  // Map GoCardless action to internal mandate status
  const mandateStatus = GC_MANDATE_STATUS_MAP[event.action];

  if (!mandateStatus) {
    console.log(
      `[Webhook] No status mapping for mandate action: ${event.action}, skipping`
    );
    return;
  }

  if (MANDATE_TERMINAL_STATUSES.includes(mandateStatus)) {
    // Cascade-cancel pending payments (D-13)
    const cancelledCount = await cascadeMandateCancellation(mandateId);

    // Flag affected leases with a visible note before clearing the mandate ID (D-13)
    const affectedLeases = await db
      .select({ id: leases.id, notes: leases.notes })
      .from(leases)
      .where(eq(leases.gocardlessMandateId, mandateId));

    for (const lease of affectedLeases) {
      const flagNote = `Mandate ${mandateId} ${event.action} on ${new Date().toISOString().split("T")[0]} -- SEPA collection stopped, action required.`;
      const updatedNotes = lease.notes
        ? `${lease.notes}\n${flagNote}`
        : flagNote;
      await db
        .update(leases)
        .set({
          notes: updatedNotes,
          gocardlessMandateId: null,
          updatedAt: new Date(),
        })
        .where(eq(leases.id, lease.id));
    }

    // Clear mandate from tenants
    await db
      .update(tenants)
      .set({ gocardlessMandateId: null, updatedAt: new Date() })
      .where(eq(tenants.gocardlessMandateId, mandateId));

    console.log(
      `[Webhook] Mandate ${mandateId} ${event.action}: flagged ${affectedLeases.length} lease(s) with notes, cleared mandate, cancelled ${cancelledCount} pending payments`
    );
  } else if (mandateStatus === "active") {
    // Mandate is now active - no DB update needed (mandate ID is already stored from setup)
    console.log(`[Webhook] Mandate ${mandateId} is now active`);
  } else {
    // Informational mandate events (created, submitted, pending)
    console.log(`[Webhook] Mandate ${mandateId} ${event.action}`);
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
