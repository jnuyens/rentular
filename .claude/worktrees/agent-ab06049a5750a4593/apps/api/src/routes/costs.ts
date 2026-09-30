import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, gte, lte, inArray, or } from "drizzle-orm";
import { getDb, costs } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  hasMinimumRole,
} from "../lib/propertyAccess";

const db = getDb();

export const costsRouter = new Hono();

// Cost summary must be registered before /:id to avoid route conflicts
costsRouter.get("/summary/totals", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");

  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);

  // Build conditions: costs on accessible properties OR general costs owned by user (no propertyId)
  const conditions: any[] = [];
  if (accessibleIds.length > 0) {
    conditions.push(
      or(
        inArray(costs.propertyId, accessibleIds),
        and(eq(costs.ownerId, userId), eq(costs.propertyId, ""))
      )
    );
  } else {
    // No accessible properties -- only show user's own general costs (if any)
    conditions.push(and(eq(costs.ownerId, userId), eq(costs.propertyId, "")));
  }
  if (from) conditions.push(gte(costs.date, from));
  if (to) conditions.push(lte(costs.date, to));
  const allCosts = await db.select().from(costs).where(and(...conditions));
  const totalCosts = allCosts.reduce((sum, cost) => sum + Number(cost.amount), 0);
  const byCategory: Record<string, number> = {};
  const byProperty: Record<string, number> = {};
  for (const cost of allCosts) {
    byCategory[cost.category] = (byCategory[cost.category] || 0) + Number(cost.amount);
    if (cost.propertyId) {
      byProperty[cost.propertyId] = (byProperty[cost.propertyId] || 0) + Number(cost.amount);
    }
  }
  return c.json({ totalCosts, byCategory, byProperty });
});

// List costs with filtering
costsRouter.get("/", async (c) => {
  const propertyId = c.req.query("propertyId");
  const leaseId = c.req.query("leaseId");
  const category = c.req.query("category");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);

  // Build conditions: costs on accessible properties OR general costs owned by user
  const conditions: any[] = [];
  if (accessibleIds.length > 0) {
    conditions.push(
      or(
        inArray(costs.propertyId, accessibleIds),
        and(eq(costs.ownerId, userId), eq(costs.propertyId, ""))
      )
    );
  } else {
    conditions.push(and(eq(costs.ownerId, userId), eq(costs.propertyId, "")));
  }
  if (propertyId) conditions.push(eq(costs.propertyId, propertyId));
  if (leaseId) conditions.push(eq(costs.leaseId, leaseId));
  if (category) conditions.push(eq(costs.category, category as any));
  if (from) conditions.push(gte(costs.date, from));
  if (to) conditions.push(lte(costs.date, to));
  const result = await db.select().from(costs).where(and(...conditions));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 20 } });
});

// Get cost details
costsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const result = await db.select().from(costs)
    .where(eq(costs.id, id));
  if (!result[0]) return c.json({ error: "Cost not found" }, 404);

  // Verify access: if cost has a propertyId, check property access; otherwise check ownership
  if (result[0].propertyId) {
    const role = await getUserPropertyRole(userId, result[0].propertyId);
    if (!role) return c.json({ error: "Cost not found" }, 404);
  } else if (result[0].ownerId !== userId) {
    return c.json({ error: "Cost not found" }, 404);
  }

  return c.json({ data: result[0] });
});

// Add a cost
costsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      propertyId: z.string().uuid().optional(),
      leaseId: z.string().uuid().optional(),
      category: z.enum([
        "maintenance",
        "repair",
        "insurance",
        "tax",
        "management_fee",
        "utility",
        "legal",
        "renovation",
        "other",
      ]),
      description: z.string().min(1).max(500),
      amount: z.number().positive(),
      date: z.string().date(),
      rechargedToTenant: z.boolean().default(false),
      reference: z.string().max(255).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    // If cost is linked to a property, check accountant+ role
    if (data.propertyId) {
      const role = await getUserPropertyRole(userId, data.propertyId);
      if (!role || !hasMinimumRole(role, "accountant")) {
        return c.json({ error: "Insufficient permissions" }, 403);
      }
    }

    const id = crypto.randomUUID();
    await db.insert(costs).values({
      id,
      ownerId: userId,
      propertyId: data.propertyId || null,
      leaseId: data.leaseId || null,
      category: data.category,
      description: data.description,
      amount: String(data.amount),
      date: data.date,
      rechargedToTenant: data.rechargedToTenant,
      reference: data.reference || null,
      notes: data.notes || null,
    });
    const [created] = await db.select().from(costs).where(eq(costs.id, id));
    return c.json({ data: created, message: "Cost recorded" }, 201);
  }
);

// Update a cost
costsRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      category: z.enum([
        "maintenance", "repair", "insurance", "tax",
        "management_fee", "utility", "legal", "renovation", "other",
      ]).optional(),
      description: z.string().min(1).max(500).optional(),
      amount: z.number().positive().optional(),
      date: z.string().date().optional(),
      rechargedToTenant: z.boolean().optional(),
      reference: z.string().max(255).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const existing = await db.select().from(costs)
      .where(eq(costs.id, id));
    if (!existing[0]) return c.json({ error: "Cost not found" }, 404);

    // Check accountant+ role on the cost's property
    if (existing[0].propertyId) {
      const role = await getUserPropertyRole(userId, existing[0].propertyId);
      if (!role || !hasMinimumRole(role, "accountant")) {
        return c.json({ error: "Insufficient permissions" }, 403);
      }
    } else if (existing[0].ownerId !== userId) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const updateData: Record<string, any> = {};
    if (data.category !== undefined) updateData.category = data.category;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.amount !== undefined) updateData.amount = String(data.amount);
    if (data.date !== undefined) updateData.date = data.date;
    if (data.rechargedToTenant !== undefined) updateData.rechargedToTenant = data.rechargedToTenant;
    if (data.reference !== undefined) updateData.reference = data.reference;
    if (data.notes !== undefined) updateData.notes = data.notes;
    await db.update(costs).set(updateData)
      .where(eq(costs.id, id));
    const [updated] = await db.select().from(costs).where(eq(costs.id, id));
    return c.json({ data: updated, message: "Cost updated" });
  }
);

// Delete a cost
costsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(costs)
    .where(eq(costs.id, id));
  if (!existing[0]) return c.json({ error: "Cost not found" }, 404);

  // Check co_owner+ role on the cost's property
  if (existing[0].propertyId) {
    const role = await getUserPropertyRole(userId, existing[0].propertyId);
    if (!role || !hasMinimumRole(role, "co_owner")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }
  } else if (existing[0].ownerId !== userId) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  await db.delete(costs).where(eq(costs.id, id));
  return c.json({ message: "Cost deleted" });
});
