import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { getDb, maintenanceTasks, leases, properties, propertyManagers } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  canAccessDomain,
  hasMinimumRole,
} from "../lib/propertyAccess";
import type { PropertyManagerRole } from "@rentular/shared";

const db = getDb();

const createMaintenanceSchema = z.object({
  propertyId: z.string().min(1),
  leaseId: z.string().optional().default(""),
  type: z.string().min(1),
  name: z.string().min(1),
  intervalMonths: z.number().int().min(1).max(120).default(12),
  lastCompleted: z.string().optional().default(""),
  autoEmail: z.boolean().optional().default(false),
  notes: z.string().optional().default(""),
});

function computeNextDue(lastCompleted: string | undefined, intervalMonths: number): string {
  if (lastCompleted) {
    const d = new Date(lastCompleted);
    d.setMonth(d.getMonth() + intervalMonths);
    return d.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

function computeStatus(nextDue: string): "ok" | "due_soon" | "overdue" {
  const now = new Date();
  const due = new Date(nextDue);
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "overdue";
  if (diffDays < 30) return "due_soon";
  return "ok";
}

export const maintenanceRouter = new Hono();

// List all maintenance tasks for accessible properties (accountant blocked per D-05)
maintenanceRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: [], meta: { total: 0 } });

  // Filter out properties where user is accountant (accountant blocked from maintenance per D-05)
  const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
  const allowedIds = roles.filter(r => canAccessDomain(r.role as PropertyManagerRole, "maintenance")).map(r => r.propertyId);
  if (allowedIds.length === 0) return c.json({ data: [], meta: { total: 0 } });

  const result = await db.select().from(maintenanceTasks)
    .where(inArray(maintenanceTasks.propertyId, allowedIds));
  const data = result.map((t) => ({
    ...t,
    status: computeStatus(t.nextDue),
  }));
  return c.json({ data, meta: { total: data.length } });
});

// Create a maintenance task
maintenanceRouter.post(
  "/",
  zValidator("json", createMaintenanceSchema),
  async (c) => {
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    // Check manager+ role on the property
    const role = await getUserPropertyRole(userId, data.propertyId);
    if (!role || !hasMinimumRole(role, "manager")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    // Look up the property's actual owner
    const [property] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, data.propertyId));
    if (!property) return c.json({ error: "Property not found" }, 404);
    const ownerId = property.ownerId;

    const id = crypto.randomUUID();
    const nextDue = computeNextDue(data.lastCompleted || undefined, data.intervalMonths);
    await db.insert(maintenanceTasks).values({
      id,
      ownerId,
      propertyId: data.propertyId,
      leaseId: data.leaseId || null,
      type: data.type,
      name: data.name,
      intervalMonths: data.intervalMonths,
      lastCompleted: data.lastCompleted || null,
      nextDue,
      autoEmail: data.autoEmail,
      notes: data.notes || null,
    });
    const [created] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
    return c.json({ data: { ...created, status: computeStatus(nextDue) }, message: "Maintenance task created" }, 201);
  }
);

// Update a task (toggle autoEmail, set lastCompleted date, etc.)
maintenanceRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const task = await db.select().from(maintenanceTasks)
    .where(eq(maintenanceTasks.id, id));
  if (!task[0]) return c.json({ error: "Not found" }, 404);

  // Check manager+ role on the task's property
  const role = await getUserPropertyRole(userId, task[0].propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.autoEmail !== undefined) updates.autoEmail = body.autoEmail;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.lastCompleted !== undefined) {
    updates.lastCompleted = body.lastCompleted;
    updates.nextDue = computeNextDue(body.lastCompleted, task[0].intervalMonths);
  }

  if (Object.keys(updates).length > 0) {
    await db.update(maintenanceTasks).set(updates)
      .where(eq(maintenanceTasks.id, id));
  }

  const [updated] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ data: { ...updated, status: computeStatus(updated.nextDue) } });
});

// Mark task as completed (today)
maintenanceRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const task = await db.select().from(maintenanceTasks)
    .where(eq(maintenanceTasks.id, id));
  if (!task[0]) return c.json({ error: "Not found" }, 404);

  // Check manager+ role on the task's property
  const role = await getUserPropertyRole(userId, task[0].propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const today = new Date().toISOString().split("T")[0];
  const nextDue = computeNextDue(today, task[0].intervalMonths);

  await db.update(maintenanceTasks).set({ lastCompleted: today, nextDue })
    .where(eq(maintenanceTasks.id, id));
  const [updated] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ data: { ...updated, status: computeStatus(nextDue) } });
});

// Auto-generate maintenance tasks for all leases based on property heating type
maintenanceRouter.post("/auto-generate", async (c) => {
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: [], message: "Generated 0 tasks" });

  // Only generate for properties where user has manager+ role and can access maintenance domain
  const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
  const managerIds = roles
    .filter(r => hasMinimumRole(r.role as PropertyManagerRole, "manager") && canAccessDomain(r.role as PropertyManagerRole, "maintenance"))
    .map(r => r.propertyId);
  if (managerIds.length === 0) return c.json({ data: [], message: "Generated 0 tasks" });

  // Query active leases for accessible properties
  const activeLeases = await db.select().from(leases)
    .where(and(inArray(leases.propertyId, managerIds), eq(leases.status, "active")));
  // Query accessible properties (to get heatingType)
  const ownerProperties = await db.select().from(properties)
    .where(inArray(properties.id, managerIds));
  // Query existing maintenance tasks for accessible properties
  const existingTasks = await db.select().from(maintenanceTasks)
    .where(inArray(maintenanceTasks.propertyId, managerIds));

  const propMap = new Map(ownerProperties.map((p) => [p.id, p]));
  const created: any[] = [];

  for (const lease of activeLeases) {
    const prop = propMap.get(lease.propertyId);
    if (!prop) continue;

    const ownerId = prop.ownerId;
    const heatingType = prop.heatingType || "";

    // Fire alarm - always, every 12 months
    const hasFireAlarm = existingTasks.some(
      (t) => t.leaseId === lease.id && t.type === "fire_alarm"
    );
    if (!hasFireAlarm) {
      const id = crypto.randomUUID();
      const nextDue = computeNextDue(undefined, 12);
      await db.insert(maintenanceTasks).values({
        id, ownerId, propertyId: lease.propertyId, leaseId: lease.id,
        type: "fire_alarm", name: "Brandalarm controle",
        intervalMonths: 12, lastCompleted: null, nextDue, autoEmail: true, notes: null,
      });
      created.push({ id, type: "fire_alarm", name: "Brandalarm controle", nextDue, status: computeStatus(nextDue) });
    }

    // Heating maintenance - not for electric or none
    if (heatingType && heatingType !== "electric" && heatingType !== "none") {
      const hasHeating = existingTasks.some(
        (t) => t.leaseId === lease.id && t.type === "heating_maintenance"
      );
      if (!hasHeating) {
        const interval = heatingType === "heat_pump" ? 24 : 12;
        const id = crypto.randomUUID();
        const nextDue = computeNextDue(undefined, interval);
        const name = heatingType === "heat_pump" ? "Warmtepomp onderhoud" : "CV-ketel onderhoud";
        await db.insert(maintenanceTasks).values({
          id, ownerId, propertyId: lease.propertyId, leaseId: lease.id,
          type: "heating_maintenance", name,
          intervalMonths: interval, lastCompleted: null, nextDue, autoEmail: true, notes: null,
        });
        created.push({ id, type: "heating_maintenance", name, nextDue, status: computeStatus(nextDue) });
      }
    }

    // Chimney sweep - only for gas, oil, wood, pellet
    if (["gas", "oil", "wood", "pellet"].includes(heatingType)) {
      const hasChimney = existingTasks.some(
        (t) => t.leaseId === lease.id && t.type === "chimney_sweep"
      );
      if (!hasChimney) {
        const id = crypto.randomUUID();
        const nextDue = computeNextDue(undefined, 12);
        await db.insert(maintenanceTasks).values({
          id, ownerId, propertyId: lease.propertyId, leaseId: lease.id,
          type: "chimney_sweep", name: "Schouwveger",
          intervalMonths: 12, lastCompleted: null, nextDue, autoEmail: true, notes: null,
        });
        created.push({ id, type: "chimney_sweep", name: "Schouwveger", nextDue, status: computeStatus(nextDue) });
      }
    }
  }

  return c.json({ data: created, message: `Generated ${created.length} tasks` });
});

// Delete a maintenance task
maintenanceRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(maintenanceTasks)
    .where(eq(maintenanceTasks.id, id));
  if (!existing[0]) return c.json({ error: "Not found" }, 404);

  // Check co_owner+ role on the task's property
  const role = await getUserPropertyRole(userId, existing[0].propertyId);
  if (!role || !hasMinimumRole(role, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  await db.delete(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ message: "Deleted" });
});
