import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, lt, gte, lte, inArray, sql } from "drizzle-orm";
import { getDb, payments, leases, properties, leaseTenants, tenants } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  createPayment as gcCreatePayment,
  retryPayment as gcRetryPayment,
  cancelPayment as gcCancelPayment,
  isGoCardlessConfigured,
} from "../lib/gocardless";
import { transitionPayment } from "../services/paymentStateMachine";
import { ensureExpectedPaymentsForAllActive, ensureCurrentMonthPayment, coversMonthRent, currentMonthDueDate, DEPOSIT_NOTE } from "../services/expectedPayments";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  hasMinimumRole,
} from "../lib/propertyAccess";

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
    const userId = getRequiredUserId(c);
    const accessibleIds = await getAccessiblePropertyIds(userId);
    if (accessibleIds.length === 0) return c.json({ data: { summary: { period: { from: "", to: "" }, totalExpected: 0, totalCollected: 0, totalOverdue: 0, totalProcessing: 0, totalFees: 0, totalInterest: 0, countByStatus: { paid: 0, pending: 0, processing: 0, failed: 0, cancelled: 0, refunded: 0 }, totalPayments: 0, currentMonthOverdue: 0 } } });

    const query = c.req.valid("query");
    const { fromDate, toDate } = resolveDateRange(
      query.period,
      query.from,
      query.to
    );

    // Build conditions
    const conditions = [
      inArray(leases.propertyId, accessibleIds),
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
            inArray(leases.propertyId, accessibleIds),
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
    const userId = getRequiredUserId(c);
    const accessibleIds = await getAccessiblePropertyIds(userId);
    if (accessibleIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 50 } });

    const { status, leaseId, page = 1, perPage = 50 } = c.req.valid("query");

    const conditions = [inArray(leases.propertyId, accessibleIds)];
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
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: { totalOverdue: 0, count: 0, payments: [] } });

  const today = new Date().toISOString().split("T")[0];

  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(
      and(
        inArray(leases.propertyId, accessibleIds),
        sql`${payments.status} IN ('pending', 'failed')`,
        lt(payments.dueDate, today)
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

// Financial dashboard: current-calendar-month cash flow + total overdue + deposits.
// NOTE: mounted at /dashboard because /overview is already the (date-ranged)
// payments summary endpoint.
paymentsRouter.get("/dashboard", async (c) => {
  const userId = getRequiredUserId(c);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const empty = {
    month,
    expectedThisMonth: 0,
    paidThisMonth: 0,
    toComeThisMonth: 0,
    overdueTotal: 0,
    overdueThisMonth: 0,
    totalWarranty: 0,
    currency: "EUR",
  };

  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: empty });

  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = `${y}-${pad(m + 1)}-01`;
  const monthEnd = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  const todayStr = `${y}-${pad(m + 1)}-${pad(now.getDate())}`;

  // Monthly income = the rent roll: what all active leases should bring in per
  // month (rent + charges), regardless of whether a payment row exists yet.
  const activeLeaseRows = await db
    .select()
    .from(leases)
    .where(and(inArray(leases.propertyId, accessibleIds), eq(leases.status, "active")));

  // Ensure a rent record exists for the current month for each active lease, so
  // the figures reconcile. Best-effort: never fail the dashboard if this errors.
  for (const l of activeLeaseRows) {
    try {
      await ensureCurrentMonthPayment(l);
    } catch (err) {
      console.error("[Payments] dashboard current-month generation failed:", err);
    }
  }

  // Total deposits/warranty held across active leases.
  const totalWarranty = activeLeaseRows.reduce(
    (sum, l) => sum + Number(l.deposit || 0),
    0
  );

  const rows = await db
    .select({
      leaseId: payments.leaseId,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      isIgnored: payments.isIgnored,
      notes: payments.notes,
    })
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(inArray(leases.propertyId, accessibleIds));

  const byLease = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.isIgnored) continue;
    const arr = byLease.get(r.leaseId) ?? [];
    arr.push(r);
    byLease.set(r.leaseId, arr);
  }

  // Names for the overdue breakdown.
  const propRows = await db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(inArray(properties.id, accessibleIds));
  const propName = new Map(propRows.map((p) => [p.id, p.name]));
  const leaseIds = activeLeaseRows.map((l) => l.id);
  const tenantName = new Map<string, string[]>();
  if (leaseIds.length > 0) {
    const ltRows = await db
      .select({ leaseId: leaseTenants.leaseId, first: tenants.firstName, last: tenants.lastName })
      .from(leaseTenants)
      .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
      .where(inArray(leaseTenants.leaseId, leaseIds));
    for (const r of ltRows) {
      const arr = tenantName.get(r.leaseId) ?? [];
      arr.push(`${r.first} ${r.last}`.trim());
      tenantName.set(r.leaseId, arr);
    }
  }

  // Per-lease this-month status. Rent counts as paid if a (possibly early)
  // payment covers it, so early payers are not shown overdue.
  let paidThisMonth = 0;
  let toComeThisMonth = 0;
  let overdueThisMonth = 0;
  const overdueItems: Array<{
    leaseId: string;
    propertyName: string;
    tenantName: string;
    rentDue: number;
    dueDate: string;
    recentPayments: Array<{ amount: number; date: string; status: string }>;
  }> = [];
  for (const l of activeLeaseRows) {
    const rent = Number(l.monthlyRent || 0) + Number(l.monthlyCharges || 0);
    if (!(rent > 0)) continue;
    const due = currentMonthDueDate(l, now);
    const startStr = l.startDate ? String(l.startDate).slice(0, 10) : undefined;
    if (startStr && due < startStr) continue; // lease not active for this month yet
    const lps = byLease.get(l.id) ?? [];
    const covered = lps.some((p) => coversMonthRent(p, due, Number(l.monthlyRent || 0)));
    if (covered) {
      paidThisMonth += rent;
    } else if (due < todayStr) {
      overdueThisMonth += rent;
      const recentPayments = lps
        .filter((p) => p.status === "paid")
        .sort((a, b) =>
          String(b.paidDate || b.dueDate).localeCompare(String(a.paidDate || a.dueDate)),
        )
        .slice(0, 3)
        .map((p) => ({
          amount: Number(p.amount),
          date: String(p.paidDate || p.dueDate).slice(0, 10),
          status: p.status,
        }));
      overdueItems.push({
        leaseId: l.id,
        propertyName: propName.get(l.propertyId) || l.propertyId,
        tenantName: (tenantName.get(l.id) || []).join(", ") || "-",
        rentDue: Math.round(rent * 100) / 100,
        dueDate: due,
        recentPayments,
      });
    } else {
      toComeThisMonth += rent;
    }
  }

  // Expected this month reconciles exactly with the three buckets (only counts
  // contracts whose rent is actually due this month).
  const expectedThisMonth = paidThisMonth + toComeThisMonth + overdueThisMonth;

  // Total overdue = this month's overdue (same lease-centric basis) plus unpaid,
  // past-due records from previous months. A past-due pending record whose period
  // is actually covered by a (possibly late) paid payment does not count -- this
  // prevents stale auto-generated rows from inflating the overdue figure.
  let priorOverdue = 0;
  for (const p of rows) {
    if (p.isIgnored) continue;
    if (p.notes === DEPOSIT_NOTE) continue; // deposits are not rent overdue
    const unpaid = p.status === "pending" || p.status === "failed";
    if (!unpaid || String(p.dueDate) >= monthStart) continue;
    const lps = byLease.get(p.leaseId) ?? [];
    const covered = lps.some((q) =>
      coversMonthRent(q, String(p.dueDate), Number(p.amount)),
    );
    if (!covered) priorOverdue += Number(p.amount);
  }
  const overdueTotal = overdueThisMonth + priorOverdue;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return c.json({
    data: {
      month,
      expectedThisMonth: r2(expectedThisMonth),
      paidThisMonth: r2(paidThisMonth),
      toComeThisMonth: r2(toComeThisMonth),
      overdueThisMonth: r2(overdueThisMonth),
      overdueTotal: r2(overdueTotal),
      totalWarranty: r2(totalWarranty),
      overdueItems: overdueItems.sort((a, b) => b.rentDue - a.rentDue),
      currency: "EUR",
    },
  });
});

// Get payment details (PAY-02)
paymentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);

  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(eq(payments.id, id));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  // Verify user has access to the lease's property
  const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
  if (!role) {
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
    const userId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Verify lease access with accountant+ role (recording payments)
    const lease = await db
      .select()
      .from(leases)
      .where(eq(leases.id, data.leaseId));

    if (!lease[0]) {
      return c.json({ error: "Lease not found" }, 404);
    }

    const role = await getUserPropertyRole(userId, lease[0].propertyId);
    if (!role || !hasMinimumRole(role, "accountant")) {
      return c.json({ error: "Insufficient permissions" }, 403);
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

// Mark an existing pending/processing payment as paid (cash, transfer to another
// account, etc.) -- e.g. a deposit or rent paid outside the app.
paymentsRouter.post(
  "/:id/mark-paid",
  zValidator(
    "json",
    z.object({
      method: z.enum(["cash", "bank_transfer", "other"]).optional().default("cash"),
      date: z.string().date().optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const userId = getRequiredUserId(c);

    const result = await db
      .select()
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(eq(payments.id, id));
    if (!result[0]) return c.json({ error: "Payment not found" }, 404);

    const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
    if (!role || !hasMinimumRole(role, "manager")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const payment = result[0].payments;
    if (payment.status === "paid") {
      return c.json({ data: { id: payment.id, status: "paid" } });
    }
    if (payment.status !== "pending" && payment.status !== "processing") {
      return c.json(
        { error: "Only pending or processing payments can be marked paid" },
        400
      );
    }

    const data = c.req.valid("json");
    const paidDate = data.date || new Date().toISOString().split("T")[0]!;
    await transitionPayment(payment.id, "paid", { paidDate });
    await db
      .update(payments)
      .set({
        method: data.method,
        ...(data.notes ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    return c.json({
      data: { id: payment.id, status: "paid", method: data.method, paidDate },
    });
  }
);

// Generate the expected (pending) rent payments for all active leases.
// Forward-only: never creates a past-due payment. Safe to run repeatedly.
paymentsRouter.post("/generate-expected", async (c) => {
  getRequiredUserId(c);
  const result = await ensureExpectedPaymentsForAllActive();
  console.log(
    `[Payments] generate-expected: ${result.created} payment(s) created across ${result.leases} active lease(s)`
  );
  return c.json({ data: result });
});

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
    const userId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Verify lease access with manager+ role (GoCardless collection)
    const leaseResult = await db
      .select()
      .from(leases)
      .where(eq(leases.id, data.leaseId));

    if (!leaseResult[0]) {
      return c.json({ error: "Lease not found" }, 404);
    }

    const role = await getUserPropertyRole(userId, leaseResult[0].propertyId);
    if (!role || !hasMinimumRole(role, "manager")) {
      return c.json({ error: "Insufficient permissions" }, 403);
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
  const userId = getRequiredUserId(c);

  // Find payment with lease join
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(eq(payments.id, id));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  // Check manager+ role on the lease's property
  const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
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
  const userId = getRequiredUserId(c);

  // Find payment with lease join
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(eq(payments.id, id));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  // Check manager+ role on the lease's property
  const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
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
    const userId = getRequiredUserId(c);
    const data = c.req.valid("json");

    // Find payment with lease join
    const result = await db
      .select()
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(eq(payments.id, id));

    if (!result[0]) {
      return c.json({ error: "Payment not found" }, 404);
    }

    // Check accountant+ role
    const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
    if (!role || !hasMinimumRole(role, "accountant")) {
      return c.json({ error: "Insufficient permissions" }, 403);
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
  const userId = getRequiredUserId(c);

  // Find payment with lease join
  const result = await db
    .select()
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(eq(payments.id, id));

  if (!result[0]) {
    return c.json({ error: "Payment not found" }, 404);
  }

  // Check accountant+ role
  const role = await getUserPropertyRole(userId, result[0].leases.propertyId);
  if (!role || !hasMinimumRole(role, "accountant")) {
    return c.json({ error: "Insufficient permissions" }, 403);
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
