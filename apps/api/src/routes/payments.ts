import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { getDb, payments, leases } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  createPayment as gcCreatePayment,
  retryPayment as gcRetryPayment,
  cancelPayment as gcCancelPayment,
  isGoCardlessConfigured,
} from "../lib/gocardless";
import { transitionPayment } from "../services/paymentStateMachine";

const db = getDb();

export const paymentsRouter = new Hono();

// List all payments with filtering (PAY-01)
paymentsRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      status: z
        .enum([
          "pending",
          "processing",
          "paid",
          "failed",
          "cancelled",
          "refunded",
        ])
        .optional(),
      leaseId: z.string().uuid().optional(),
      page: z.coerce.number().int().positive().default(1).optional(),
      perPage: z.coerce.number().int().positive().max(100).default(50).optional(),
    })
  ),
  async (c) => {
    const ownerId = getRequiredUserId(c);
    const { status, leaseId, page = 1, perPage = 50 } = c.req.valid("query");

    const conditions = [eq(leases.ownerId, ownerId)];
    if (status) {
      conditions.push(eq(payments.status, status));
    }
    if (leaseId) {
      conditions.push(eq(payments.leaseId, leaseId));
    }

    const result = await db
      .select()
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(and(...conditions))
      .orderBy(desc(payments.dueDate))
      .limit(perPage)
      .offset((page - 1) * perPage);

    return c.json({
      data: result.map((r) => r.payments),
      meta: { total: result.length, page, perPage },
    });
  }
);

// Get overdue payments summary (must be before /:id to avoid route conflict)
paymentsRouter.get("/summary/overdue", async (c) => {
  // Phase 2: implement overdue summary (Task 2)
  return c.json({ error: "Overdue payment summaries are not implemented yet." }, 501);
});

// Get payment details (PAY-02)
paymentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(and(eq(payments.id, id), eq(leases.ownerId, ownerId)));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  return c.json({ data: result[0].payments });
});

// Manually record a payment (bank transfer, cash, etc.) (PAY-03)
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
    const ownerId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Verify lease ownership
    const lease = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, data.leaseId), eq(leases.ownerId, ownerId)));

    if (!lease[0]) {
      return c.json({ error: "Lease not found" }, 404);
    }

    const id = crypto.randomUUID();

    await db.insert(payments).values({
      id,
      leaseId: data.leaseId,
      amount: String(data.amount),
      dueDate: data.date,
      paidDate: data.date,
      status: "paid",
      method: data.method,
      structuredCommunication: data.reference || null,
      notes: data.notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return c.json(
      { data: { id, ...data, status: "paid" } },
      201
    );
  }
);

// Trigger GoCardless payment for a lease (PAY-04)
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
    // Phase 2: implement SEPA collection (Task 2)
    return c.json(
      { error: "Payment collection is disabled until payment persistence is implemented." },
      501
    );
  }
);

// Retry a failed GoCardless payment (PAY-05)
paymentsRouter.post("/:id/retry", async (c) => {
  // Phase 2: implement payment retry (Task 2)
  return c.json(
    { error: "Payment retry is disabled until payment persistence is implemented." },
    501
  );
});

// Cancel a pending GoCardless payment (PAY-06)
paymentsRouter.post("/:id/cancel", async (c) => {
  // Phase 2: implement payment cancel (Task 2)
  return c.json(
    { error: "Payment cancellation is disabled until payment persistence is implemented." },
    501
  );
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
    // Phase 4: implement payment reminders
    return c.json(
      { error: "Payment reminders are not implemented yet." },
      501
    );
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
    // Phase 2: implement ignore (Task 2)
    return c.json(
      { error: "Ignoring payments is disabled until payment persistence is implemented." },
      501
    );
  }
);

// Unmark a payment as ignored (restore it to normal tracking)
paymentsRouter.post("/:id/unignore", async (c) => {
  // Phase 2: implement unignore (Task 2)
  return c.json(
    { error: "Ignoring payments is disabled until payment persistence is implemented." },
    501
  );
});
