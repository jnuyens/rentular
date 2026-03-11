import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  isGoCardlessConfigured,
  createPayment,
  retryPayment,
  cancelPayment,
} from "../lib/gocardless";

export const paymentsRouter = new Hono();

// List all payments with filtering
paymentsRouter.get("/", async (c) => {
  const status = c.req.query("status"); // overdue | pending | paid | failed
  const leaseId = c.req.query("leaseId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const showIgnored = c.req.query("showIgnored") === "true";

  // TODO: Query payments, optionally filtering out ignored ones
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

// Get payment details
paymentsRouter.get("/:id", async (c) => {
  return c.json({ data: null });
});

// Manually record a payment (bank transfer, cash, etc.)
paymentsRouter.post(
  "/record",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      amount: z.number().positive(),
      date: z.string().date(),
      method: z.enum(["bank_transfer", "cash", "gocardless", "other"]),
      reference: z.string().optional(), // Belgian structured communication
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    return c.json({ data, message: "Payment recorded" }, 201);
  }
);

// Trigger GoCardless payment for a lease
paymentsRouter.post(
  "/collect",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      amount: z.number().positive().optional(), // Defaults to lease rent + charges
      chargeDate: z.string().date().optional(), // YYYY-MM-DD, defaults to earliest
      description: z.string().optional(),
    })
  ),
  async (c) => {
    if (!isGoCardlessConfigured()) {
      return c.json(
        { error: "GoCardless is not configured. Set GOCARDLESS_ACCESS_TOKEN." },
        503
      );
    }

    const data = c.req.valid("json");

    // TODO: Look up lease from DB to get mandateId and rent amount
    // const lease = await db.select().from(leases).where(eq(leases.id, data.leaseId)).limit(1);
    // if (!lease[0]) return c.json({ error: "Lease not found" }, 404);
    // if (lease[0].paymentMethod !== "gocardless") return c.json({ error: "Lease is not set up for GoCardless" }, 400);
    // if (!lease[0].gocardlessMandateId) return c.json({ error: "No active mandate for this lease" }, 400);
    // const mandateId = lease[0].gocardlessMandateId;
    // const amount = data.amount || parseFloat(lease[0].monthlyRent) + parseFloat(lease[0].monthlyCharges);

    // Placeholder until DB is wired up
    const mandateId = ""; // Will come from lease record
    const amount = data.amount || 0;

    if (!mandateId) {
      return c.json(
        { error: "No GoCardless mandate found for this lease. Set up a mandate first." },
        400
      );
    }

    try {
      const result = await createPayment({
        mandateId,
        amount,
        description:
          data.description || `Rent payment for lease ${data.leaseId}`,
        chargeDate: data.chargeDate,
        metadata: {
          lease_id: data.leaseId,
        },
        // Use leaseId + date as idempotency key to prevent duplicate charges
        idempotencyKey: `rent-${data.leaseId}-${data.chargeDate || new Date().toISOString().slice(0, 10)}`,
      });

      // TODO: Create payment record in DB
      // await db.insert(payments).values({
      //   id: crypto.randomUUID(),
      //   leaseId: data.leaseId,
      //   status: "processing",
      //   amount: amount.toString(),
      //   dueDate: data.chargeDate || new Date().toISOString().slice(0, 10),
      //   method: "gocardless",
      //   gocardlessPaymentId: result.paymentId,
      //   rentAmount: lease[0].monthlyRent,
      //   chargesAmount: lease[0].monthlyCharges,
      // });

      return c.json(
        {
          data: {
            gocardlessPaymentId: result.paymentId,
            status: result.status,
            chargeDate: result.chargeDate,
            amount,
            leaseId: data.leaseId,
          },
          message: "Payment collection initiated via GoCardless.",
        },
        201
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Payment collection failed";
      console.error("[GoCardless] Payment collection error:", err);
      return c.json({ error: message }, 500);
    }
  }
);

// Retry a failed GoCardless payment
paymentsRouter.post("/:id/retry", async (c) => {
  if (!isGoCardlessConfigured()) {
    return c.json({ error: "GoCardless is not configured." }, 503);
  }

  const id = c.req.param("id");

  // TODO: Look up payment from DB to get gocardlessPaymentId
  // const payment = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  // if (!payment[0]?.gocardlessPaymentId) return c.json({ error: "Not a GoCardless payment" }, 400);

  try {
    // const result = await retryPayment(payment[0].gocardlessPaymentId);
    // await db.update(payments).set({ status: "processing" }).where(eq(payments.id, id));
    return c.json({ message: "Payment retry initiated." });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Payment retry failed";
    return c.json({ error: message }, 500);
  }
});

// Cancel a pending GoCardless payment
paymentsRouter.post("/:id/cancel", async (c) => {
  if (!isGoCardlessConfigured()) {
    return c.json({ error: "GoCardless is not configured." }, 503);
  }

  const id = c.req.param("id");

  // TODO: Look up payment from DB to get gocardlessPaymentId
  // const payment = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  // if (!payment[0]?.gocardlessPaymentId) return c.json({ error: "Not a GoCardless payment" }, 400);

  try {
    // const result = await cancelPayment(payment[0].gocardlessPaymentId);
    // await db.update(payments).set({ status: "cancelled" }).where(eq(payments.id, id));
    return c.json({ message: "Payment cancelled." });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Payment cancellation failed";
    return c.json({ error: message }, 500);
  }
});

// Get overdue payments summary
paymentsRouter.get("/summary/overdue", async (c) => {
  return c.json({
    totalOverdue: 0,
    count: 0,
    payments: [],
  });
});

// Send payment reminder
paymentsRouter.post(
  "/:id/remind",
  zValidator(
    "json",
    z.object({
      type: z.enum(["friendly", "formal", "final"]),
      channel: z.enum(["email", "sms", "letter"]).default("email"),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    // TODO: Queue reminder via BullMQ
    return c.json({ message: "Reminder queued" });
  }
);

// Mark a payment as ignored (not rent-related)
paymentsRouter.post(
  "/:id/ignore",
  zValidator(
    "json",
    z.object({
      reason: z.string().min(1, "Please provide a reason"),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { reason } = c.req.valid("json");
    // TODO: Update payment set isIgnored=true, ignoreReason=reason
    return c.json({ message: "Payment marked as non-rent-related" });
  }
);

// Unmark a payment as ignored (restore it to normal tracking)
paymentsRouter.post("/:id/unignore", async (c) => {
  const id = c.req.param("id");
  // TODO: Update payment set isIgnored=false, ignoreReason=null
  return c.json({ message: "Payment restored to rent tracking" });
});
