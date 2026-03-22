import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const paymentsRouter = new Hono();

function notImplemented(c: { json: (body: unknown, status?: number) => Response }, message: string) {
  return c.json({ error: message }, 501);
}

// List all payments with filtering
paymentsRouter.get("/", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Payments listing is not implemented yet.");
});

// Get payment details
paymentsRouter.get("/:id", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Payment details are not implemented yet.");
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
    // Phase 2: implement payment CRUD
    return notImplemented(c, "Manual payment recording is not implemented yet.");
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
    // Phase 2: implement payment CRUD
    return notImplemented(c, "Payment collection is disabled until payment persistence is implemented.");
  }
);

// Retry a failed GoCardless payment
paymentsRouter.post("/:id/retry", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Payment retry is disabled until payment persistence is implemented.");
});

// Cancel a pending GoCardless payment
paymentsRouter.post("/:id/cancel", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Payment cancellation is disabled until payment persistence is implemented.");
});

// Get overdue payments summary
paymentsRouter.get("/summary/overdue", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Overdue payment summaries are not implemented yet.");
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
    // Phase 2: implement payment CRUD
    return notImplemented(c, "Payment reminders are disabled until payment persistence is implemented.");
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
    // Phase 2: implement payment CRUD
    return notImplemented(c, "Ignoring payments is disabled until payment persistence is implemented.");
  }
);

// Unmark a payment as ignored (restore it to normal tracking)
paymentsRouter.post("/:id/unignore", async (c) => {
  // Phase 2: implement payment CRUD
  return notImplemented(c, "Ignoring payments is disabled until payment persistence is implemented.");
});
