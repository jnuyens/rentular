import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, gte, lte, or, isNull, inArray } from "drizzle-orm";
import { getDb, rentFreePeriods, rentDeductions, leases } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  hasMinimumRole,
} from "../lib/propertyAccess";

const db = getDb();

export const rentAdjustmentsRouter = new Hono();

// Helper: get lease IDs for accessible properties
async function getAccessibleLeaseIds(userId: string): Promise<string[]> {
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return [];
  const leaseRows = await db.select({ id: leases.id }).from(leases)
    .where(inArray(leases.propertyId, accessibleIds));
  return leaseRows.map(l => l.id);
}

// Helper: check role for a lease's property
async function checkLeasePropertyRole(userId: string, leaseId: string, minRole: string): Promise<{ ok: boolean; propertyId: string | null }> {
  const lease = await db.select({ propertyId: leases.propertyId }).from(leases).where(eq(leases.id, leaseId));
  if (!lease[0]) return { ok: false, propertyId: null };
  const role = await getUserPropertyRole(userId, lease[0].propertyId);
  if (!role || !hasMinimumRole(role, minRole as any)) return { ok: false, propertyId: lease[0].propertyId };
  return { ok: true, propertyId: lease[0].propertyId };
}

// === Rent-free periods ===

// List rent-free periods for a lease
rentAdjustmentsRouter.get("/free-periods", async (c) => {
  const leaseId = c.req.query("leaseId");
  const userId = getRequiredUserId(c);

  const accessibleLeaseIds = await getAccessibleLeaseIds(userId);
  if (accessibleLeaseIds.length === 0) return c.json({ data: [] });

  const conditions = [];
  if (leaseId) {
    // Check that the specific lease is accessible
    if (!accessibleLeaseIds.includes(leaseId)) return c.json({ data: [] });
    conditions.push(eq(rentFreePeriods.leaseId, leaseId));
  } else {
    // Filter to only accessible leases
    conditions.push(inArray(rentFreePeriods.leaseId, accessibleLeaseIds));
  }

  const result = await db.select().from(rentFreePeriods)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return c.json({ data: result });
});

// Add a rent-free period
rentAdjustmentsRouter.post(
  "/free-periods",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      startDate: z.string().date(),
      endDate: z.string().date(),
      reason: z.string().min(1).max(500),
      waiveCharges: z.boolean().default(false),
      notes: z.string().optional(),
    }).refine(
      (data) => new Date(data.endDate) >= new Date(data.startDate),
      { message: "End date must be on or after start date" }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    // Check manager+ role on the lease's property
    const { ok } = await checkLeasePropertyRole(userId, data.leaseId, "manager");
    if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

    const id = crypto.randomUUID();
    await db.insert(rentFreePeriods).values({
      id,
      leaseId: data.leaseId,
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason,
      waiveCharges: data.waiveCharges,
      notes: data.notes || null,
    });
    const [created] = await db.select().from(rentFreePeriods).where(eq(rentFreePeriods.id, id));
    return c.json({ data: created, message: "Rent-free period added" }, 201);
  }
);

// Update a rent-free period
rentAdjustmentsRouter.patch(
  "/free-periods/:id",
  zValidator(
    "json",
    z.object({
      startDate: z.string().date().optional(),
      endDate: z.string().date().optional(),
      reason: z.string().min(1).max(500).optional(),
      waiveCharges: z.boolean().optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    const existing = await db.select().from(rentFreePeriods).where(eq(rentFreePeriods.id, id));
    if (!existing[0]) return c.json({ error: "Rent-free period not found" }, 404);

    // Check manager+ role on the lease's property
    const { ok } = await checkLeasePropertyRole(userId, existing[0].leaseId, "manager");
    if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

    await db.update(rentFreePeriods).set(data).where(eq(rentFreePeriods.id, id));
    const [updated] = await db.select().from(rentFreePeriods).where(eq(rentFreePeriods.id, id));
    return c.json({ data: updated, message: "Rent-free period updated" });
  }
);

// Delete a rent-free period
rentAdjustmentsRouter.delete("/free-periods/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);

  const existing = await db.select().from(rentFreePeriods).where(eq(rentFreePeriods.id, id));
  if (!existing[0]) return c.json({ error: "Rent-free period not found" }, 404);

  // Check co_owner+ role for deletion
  const { ok } = await checkLeasePropertyRole(userId, existing[0].leaseId, "co_owner");
  if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

  await db.delete(rentFreePeriods).where(eq(rentFreePeriods.id, id));
  return c.json({ message: "Rent-free period deleted" });
});

// === Rent deductions ===

// List rent deductions for a lease
rentAdjustmentsRouter.get("/deductions", async (c) => {
  const leaseId = c.req.query("leaseId");
  const active = c.req.query("active");
  const userId = getRequiredUserId(c);

  const accessibleLeaseIds = await getAccessibleLeaseIds(userId);
  if (accessibleLeaseIds.length === 0) return c.json({ data: [] });

  const conditions = [];
  if (leaseId) {
    if (!accessibleLeaseIds.includes(leaseId)) return c.json({ data: [] });
    conditions.push(eq(rentDeductions.leaseId, leaseId));
  } else {
    conditions.push(inArray(rentDeductions.leaseId, accessibleLeaseIds));
  }

  if (active === "true") {
    const today = new Date().toISOString().split("T")[0]!;
    // Active means: startDate <= today AND (endDate is null OR endDate >= today)
    conditions.push(lte(rentDeductions.startDate, today));
    conditions.push(or(isNull(rentDeductions.endDate), gte(rentDeductions.endDate, today))!);
  }
  const result = await db.select().from(rentDeductions)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return c.json({ data: result });
});

// Add a rent deduction
rentAdjustmentsRouter.post(
  "/deductions",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      type: z.enum(["temporary", "permanent"]),
      amount: z.number().positive(),
      startDate: z.string().date(),
      endDate: z.string().date().optional(),
      reason: z.string().min(1).max(500),
      notes: z.string().optional(),
    }).refine(
      (data) => {
        if (data.type === "temporary" && !data.endDate) {
          return false;
        }
        if (data.endDate && new Date(data.endDate) < new Date(data.startDate)) {
          return false;
        }
        return true;
      },
      { message: "Temporary deductions require an end date; end date must be on or after start date" }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    // Check manager+ role on the lease's property
    const { ok } = await checkLeasePropertyRole(userId, data.leaseId, "manager");
    if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

    const id = crypto.randomUUID();
    await db.insert(rentDeductions).values({
      id,
      leaseId: data.leaseId,
      type: data.type,
      amount: String(data.amount),
      startDate: data.startDate,
      endDate: data.endDate || null,
      reason: data.reason,
      notes: data.notes || null,
    });
    const [created] = await db.select().from(rentDeductions).where(eq(rentDeductions.id, id));
    return c.json({ data: created, message: "Rent deduction added" }, 201);
  }
);

// Update a rent deduction
rentAdjustmentsRouter.patch(
  "/deductions/:id",
  zValidator(
    "json",
    z.object({
      amount: z.number().positive().optional(),
      startDate: z.string().date().optional(),
      endDate: z.string().date().nullable().optional(),
      reason: z.string().min(1).max(500).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    const existing = await db.select().from(rentDeductions).where(eq(rentDeductions.id, id));
    if (!existing[0]) return c.json({ error: "Rent deduction not found" }, 404);

    // Check manager+ role on the lease's property
    const { ok } = await checkLeasePropertyRole(userId, existing[0].leaseId, "manager");
    if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

    const updateData: Record<string, any> = {};
    if (data.amount !== undefined) updateData.amount = String(data.amount);
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.endDate !== undefined) updateData.endDate = data.endDate;
    if (data.reason !== undefined) updateData.reason = data.reason;
    if (data.notes !== undefined) updateData.notes = data.notes;
    await db.update(rentDeductions).set(updateData).where(eq(rentDeductions.id, id));
    const [updated] = await db.select().from(rentDeductions).where(eq(rentDeductions.id, id));
    return c.json({ data: updated, message: "Rent deduction updated" });
  }
);

// Delete a rent deduction
rentAdjustmentsRouter.delete("/deductions/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);

  const existing = await db.select().from(rentDeductions).where(eq(rentDeductions.id, id));
  if (!existing[0]) return c.json({ error: "Rent deduction not found" }, 404);

  // Check co_owner+ role for deletion
  const { ok } = await checkLeasePropertyRole(userId, existing[0].leaseId, "co_owner");
  if (!ok) return c.json({ error: "Insufficient permissions" }, 403);

  await db.delete(rentDeductions).where(eq(rentDeductions.id, id));
  return c.json({ message: "Rent deduction deleted" });
});
