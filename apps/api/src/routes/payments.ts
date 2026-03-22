import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, lt, gte, lte, inArray, sql } from "drizzle-orm";
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

// Helper: resolve date range from period or custom from/to (D-16)
function resolveDateRange(
  period?: string,
  from?: string,
  to?: string
): { fromDate: string; toDate: string } {
  const today = new Date();
  if (period === "monthly") {
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return {
      fromDate: `${year}-${month}-01`,
      toDate: `${year}-${month}-${String(new Date(year, today.getMonth() + 1, 0).getDate()).padStart(2, "0")}`,
    };
  }
  if (period === "yearly") {
    const year = today.getFullYear();
    return { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
  }
  if (from && to) {
    // Normalize: if from is YYYY-MM, append -01. If to is YYYY-MM, append last day.
    const fromDate = from.length === 7 ? `${from}-01` : from;
    const toDate =
      to.length === 7
        ? `${to}-${String(new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0).getDate()).padStart(2, "0")}`
        : to;
    return { fromDate, toDate };
  }
  // Default: current month
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return {
    fromDate: `${year}-${month}-01`,
    toDate: `${year}-${month}-${String(new Date(year, today.getMonth() + 1, 0).getDate()).padStart(2, "0")}`,
  };
}

const overviewQuerySchema = z.object({
  period: z.enum(["monthly", "yearly"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  propertyId: z.string().uuid().optional(),
  leaseId: z.string().uuid().optional(),
  detail: z.coerce.boolean().optional().default(false),
});

// Payment overview with summary stats (PAY-10, D-14 through D-17)
// Must be registered BEFORE /:id to avoid route collision
paymentsRouter.get(
  "/overview",
  zValidator("query", overviewQuerySchema),
  async (c) => {
    const ownerId = getRequiredUserId(c);
    const query = c.req.valid("query");
    const { fromDate, toDate } = resolveDateRange(
      query.period,
      query.from,
      query.to
    );

    // Build conditions
    const conditions = [
      eq(leases.ownerId, ownerId),
      gte(payments.dueDate, fromDate),
      lte(payments.dueDate, toDate),
    ];
    if (query.propertyId) conditions.push(eq(leases.propertyId, query.propertyId));
    if (query.leaseId) conditions.push(eq(payments.leaseId, query.leaseId));

    const result = await db
      .select({
        id: payments.id,
        leaseId: payments.leaseId,
        status: payments.status,
        amount: payments.amount,
        dueDate: payments.dueDate,
        paidDate: payments.paidDate,
        method: payments.method,
        latePaymentFee: payments.latePaymentFee,
        interestCharged: payments.interestCharged,
        isIgnored: payments.isIgnored,
      })
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(and(...conditions));

    // Filter out ignored payments from stats
    const activePayments = result.filter((p) => !p.isIgnored);

    const summary = {
      period: { from: fromDate, to: toDate },
      totalExpected: activePayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      ),
      totalCollected: activePayments
        .filter((p) => p.status === "paid")
        .reduce((sum, p) => sum + Number(p.amount), 0),
      totalOverdue: activePayments
        .filter((p) => p.status === "pending" || p.status === "failed")
        .reduce((sum, p) => sum + Number(p.amount), 0),
      totalProcessing: activePayments
        .filter((p) => p.status === "processing")
        .reduce((sum, p) => sum + Number(p.amount), 0),
      totalFees: activePayments.reduce(
        (sum, p) => sum + Number(p.latePaymentFee || 0),
        0
      ),
      totalInterest: activePayments.reduce(
        (sum, p) => sum + Number(p.interestCharged || 0),
        0
      ),
      countByStatus: {
        paid: activePayments.filter((p) => p.status === "paid").length,
        pending: activePayments.filter((p) => p.status === "pending").length,
        processing: activePayments.filter((p) => p.status === "processing")
          .length,
        failed: activePayments.filter((p) => p.status === "failed").length,
        cancelled: activePayments.filter((p) => p.status === "cancelled")
          .length,
        refunded: activePayments.filter((p) => p.status === "refunded").length,
      },
      totalPayments: activePayments.length,
    };

    // D-17: Always include current month overdue as a top-level field
    const now = new Date();
    const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const currentMonthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;

    // If the query period already covers current month, compute from existing data
    // Otherwise, run a separate query
    let currentMonthOverdue = 0;
    if (fromDate <= currentMonthStart && toDate >= currentMonthEnd) {
      currentMonthOverdue = activePayments
        .filter(
          (p) =>
            p.dueDate >= currentMonthStart &&
            p.dueDate <= currentMonthEnd &&
            (p.status === "pending" || p.status === "failed")
        )
        .reduce((sum, p) => sum + Number(p.amount), 0);
    } else {
      const currentMonthResult = await db
        .select({ amount: payments.amount, status: payments.status })
        .from(payments)
        .innerJoin(leases, eq(payments.leaseId, leases.id))
        .where(
          and(
            eq(leases.ownerId, ownerId),
            gte(payments.dueDate, currentMonthStart),
            lte(payments.dueDate, currentMonthEnd),
            inArray(payments.status, ["pending", "failed"]),
            eq(payments.isIgnored, false)
          )
        );
      currentMonthOverdue = currentMonthResult.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
    }

    // D-14: summary by default, detail when ?detail=true
    const response: Record<string, unknown> = {
      summary: { ...summary, currentMonthOverdue },
    };

    if (query.detail) {
      response.payments = result;
    }

    return c.json({ data: response });
  }
);

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
  const ownerId = getRequiredUserId(c);
  const today = new Date().toISOString().split("T")[0];

  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(
      and(
        eq(leases.ownerId, ownerId),
        sql`${payments.status} IN ('pending', 'failed')`,
        lt(payments.dueDate, new Date(today))
      )
    );

  const overduePayments = result.map((r) => ({
    id: r.payments.id,
    leaseId: r.payments.leaseId,
    amount: r.payments.amount,
    dueDate: r.payments.dueDate,
    status: r.payments.status,
  }));

  const totalOverdue = overduePayments.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  return c.json({
    data: {
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      count: overduePayments.length,
      payments: overduePayments,
    },
  });
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
    const ownerId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Verify lease ownership and get lease details
    const leaseResult = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, data.leaseId), eq(leases.ownerId, ownerId)));

    if (!leaseResult[0]) {
      return c.json({ error: "Lease not found" }, 404);
    }

    const lease = leaseResult[0];

    if (!lease.gocardlessMandateId) {
      return c.json(
        { error: "No active GoCardless mandate for this lease. Set up a mandate first." },
        400
      );
    }

    if (!isGoCardlessConfigured()) {
      return c.json({ error: "GoCardless is not configured." }, 503);
    }

    const amount =
      data.amount || Number(lease.monthlyRent) + Number(lease.monthlyCharges);
    const idempotencyKey = crypto.randomUUID();

    try {
      const gcResult = await gcCreatePayment({
        mandateId: lease.gocardlessMandateId,
        amount,
        description: data.description || "Rent payment",
        chargeDate: data.chargeDate,
        metadata: { lease_id: data.leaseId },
        idempotencyKey,
      });

      const id = crypto.randomUUID();

      await db.insert(payments).values({
        id,
        leaseId: data.leaseId,
        amount: String(amount),
        dueDate: gcResult.chargeDate,
        status: "processing",
        method: "gocardless",
        gocardlessPaymentId: gcResult.paymentId,
        structuredCommunication: lease.structuredCommunication || null,
        rentAmount: String(lease.monthlyRent),
        chargesAmount: String(lease.monthlyCharges),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return c.json(
        {
          data: {
            id,
            gocardlessPaymentId: gcResult.paymentId,
            status: "processing",
            chargeDate: gcResult.chargeDate,
            amount,
          },
        },
        201
      );
    } catch (err) {
      console.error("[Payments] GoCardless createPayment failed:", err);
      const message =
        err instanceof Error ? err.message : "GoCardless payment creation failed";
      return c.json({ error: message }, 500);
    }
  }
);

// Retry a failed GoCardless payment (PAY-05)
paymentsRouter.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  // Find payment with ownership check
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(and(eq(payments.id, id), eq(leases.ownerId, ownerId)));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  const payment = result[0].payments;

  if (payment.status !== "failed") {
    return c.json({ error: "Only failed payments can be retried" }, 400);
  }

  if (!payment.gocardlessPaymentId) {
    return c.json({ error: "Only GoCardless payments can be retried" }, 400);
  }

  try {
    await gcRetryPayment(payment.gocardlessPaymentId);
    await transitionPayment(payment.id, "processing");

    return c.json({ data: { id: payment.id, status: "processing" } });
  } catch (err) {
    console.error("[Payments] GoCardless retryPayment failed:", err);
    const message =
      err instanceof Error ? err.message : "GoCardless payment retry failed";
    return c.json({ error: message }, 500);
  }
});

// Cancel a pending GoCardless payment (PAY-06)
paymentsRouter.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  // Find payment with ownership check
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(and(eq(payments.id, id), eq(leases.ownerId, ownerId)));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  const payment = result[0].payments;

  if (payment.status !== "pending" && payment.status !== "processing") {
    return c.json(
      { error: "Only pending or processing payments can be cancelled" },
      400
    );
  }

  try {
    if (payment.gocardlessPaymentId) {
      await gcCancelPayment(payment.gocardlessPaymentId);
    }

    await transitionPayment(payment.id, "cancelled");

    return c.json({ data: { id: payment.id, status: "cancelled" } });
  } catch (err) {
    console.error("[Payments] GoCardless cancelPayment failed:", err);
    const message =
      err instanceof Error ? err.message : "GoCardless payment cancellation failed";
    return c.json({ error: message }, 500);
  }
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
    const id = c.req.param("id");
    const ownerId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Find payment with ownership check
    const result = await db
      .select()
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(and(eq(payments.id, id), eq(leases.ownerId, ownerId)));

    if (!result[0]) {
      return c.json({ error: "Payment not found" }, 404);
    }

    await db
      .update(payments)
      .set({
        isIgnored: true,
        ignoreReason: data.reason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, id));

    return c.json({ data: { id, isIgnored: true, ignoreReason: data.reason } });
  }
);

// Unmark a payment as ignored (restore it to normal tracking)
paymentsRouter.post("/:id/unignore", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  // Find payment with ownership check
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(and(eq(payments.id, id), eq(leases.ownerId, ownerId)));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  await db
    .update(payments)
    .set({
      isIgnored: false,
      ignoreReason: null,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, id));

  return c.json({ data: { id, isIgnored: false, ignoreReason: null } });
});
