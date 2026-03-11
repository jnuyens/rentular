import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

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
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Create GoCardless payment via mandate
    return c.json({ data, message: "Payment collection initiated" }, 201);
  }
);

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
