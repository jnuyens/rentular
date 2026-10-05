import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, leases } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import { getAccessiblePropertyIds, getUserPropertyRole, hasMinimumRole } from "../lib/propertyAccess";
import {
  computeLedger,
  autoReconcile,
  createAllocation,
  deleteAllocation,
  recordPeriodPayment,
} from "../services/ledger";

export const ledgerRouter = new Hono();

/** Resolve the lease and confirm the user can access its property. */
async function authorizeLease(
  userId: string,
  leaseId: string,
): Promise<{ ok: true; propertyId: string } | { ok: false; status: 403 | 404 }> {
  const db = getDb();
  const rows = await db
    .select({ propertyId: leases.propertyId })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  if (!rows[0]) return { ok: false, status: 404 };
  const accessible = await getAccessiblePropertyIds(userId);
  if (!accessible.includes(rows[0].propertyId)) return { ok: false, status: 403 };
  return { ok: true, propertyId: rows[0].propertyId };
}

// The rent ledger for a lease: periods, payments, and allocations.
ledgerRouter.get("/:leaseId", async (c) => {
  const userId = getRequiredUserId(c);
  const leaseId = c.req.param("leaseId");
  const auth = await authorizeLease(userId, leaseId);
  if (!auth.ok) return c.json({ error: auth.status === 404 ? "Lease not found" : "Forbidden" }, auth.status);

  const monthsRaw = c.req.query("months");
  const months = monthsRaw !== undefined ? Math.max(0, Number(monthsRaw) || 0) : undefined;
  const ledger = await computeLedger(leaseId, months !== undefined ? { months } : {});
  if (!ledger) return c.json({ error: "Lease not found" }, 404);
  return c.json({ data: ledger });
});

// Auto-assign unallocated payments to the oldest open periods.
ledgerRouter.post("/:leaseId/auto", async (c) => {
  const userId = getRequiredUserId(c);
  const leaseId = c.req.param("leaseId");
  const auth = await authorizeLease(userId, leaseId);
  if (!auth.ok) return c.json({ error: auth.status === 404 ? "Lease not found" : "Forbidden" }, auth.status);

  const created = await autoReconcile(leaseId, userId);
  const ledger = await computeLedger(leaseId, { months: 0 });
  return c.json({ data: { created, ledger } });
});

// Record a payment received for a period (cash / another account) and assign it
// to that period in one step -- for rent paid outside the app.
ledgerRouter.post(
  "/:leaseId/record-payment",
  zValidator(
    "json",
    z.object({
      periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().positive(),
      method: z.enum(["cash", "bank_transfer", "other"]).optional().default("cash"),
      date: z.string().date().optional(),
    }),
  ),
  async (c) => {
    const userId = getRequiredUserId(c);
    const leaseId = c.req.param("leaseId");
    const auth = await authorizeLease(userId, leaseId);
    if (!auth.ok) return c.json({ error: auth.status === 404 ? "Lease not found" : "Forbidden" }, auth.status);

    // T-11-04 / CONTEXT: writes require manager+. A viewer or accountant may
    // read the ledger but may not record a payment against it.
    const role = await getUserPropertyRole(userId, auth.propertyId);
    if (!role || !hasMinimumRole(role, "manager")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const body = c.req.valid("json");
    const result = await recordPeriodPayment({
      leaseId,
      periodMonth: body.periodMonth,
      amount: body.amount,
      method: body.method,
      date: body.date,
      userId,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ data: result }, 201);
  },
);

// Assign (part of) a payment to a rent period.
ledgerRouter.post(
  "/:leaseId/allocations",
  zValidator(
    "json",
    z.object({
      paymentId: z.string().min(1),
      periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().positive(),
      note: z.string().optional(),
    }),
  ),
  async (c) => {
    const userId = getRequiredUserId(c);
    const leaseId = c.req.param("leaseId");
    const auth = await authorizeLease(userId, leaseId);
    if (!auth.ok) return c.json({ error: auth.status === 404 ? "Lease not found" : "Forbidden" }, auth.status);

    const body = c.req.valid("json");
    const result = await createAllocation({
      leaseId,
      paymentId: body.paymentId,
      periodMonth: body.periodMonth,
      amount: body.amount,
      note: body.note ?? null,
      userId,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ data: { id: result.id } }, 201);
  },
);

// Remove an allocation.
ledgerRouter.delete("/:leaseId/allocations/:allocationId", async (c) => {
  const userId = getRequiredUserId(c);
  const leaseId = c.req.param("leaseId");
  const allocationId = c.req.param("allocationId");
  const auth = await authorizeLease(userId, leaseId);
  if (!auth.ok) return c.json({ error: auth.status === 404 ? "Lease not found" : "Forbidden" }, auth.status);

  const ok = await deleteAllocation(leaseId, allocationId);
  if (!ok) return c.json({ error: "Allocation not found" }, 404);
  return c.json({ data: { deleted: true } });
});
