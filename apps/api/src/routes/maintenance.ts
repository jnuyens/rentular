import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, maintenanceTasks, leases, properties } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

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

// List all maintenance tasks for owner
maintenanceRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(maintenanceTasks)
    .where(eq(maintenanceTasks.ownerId, ownerId));
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
    const ownerId = getRequiredUserId(c);
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
  const ownerId = getRequiredUserId(c);
  const task = await db.select().from(maintenanceTasks)
    .where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.ownerId, ownerId)));
  if (!task[0]) return c.json({ error: "Not found" }, 404);

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
      .where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.ownerId, ownerId)));
  }

  const [updated] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ data: { ...updated, status: computeStatus(updated.nextDue) } });
});

// Mark task as completed (today)
maintenanceRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const task = await db.select().from(maintenanceTasks)
    .where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.ownerId, ownerId)));
  if (!task[0]) return c.json({ error: "Not found" }, 404);

  const today = new Date().toISOString().split("T")[0];
  const nextDue = computeNextDue(today, task[0].intervalMonths);

  await db.update(maintenanceTasks).set({ lastCompleted: today, nextDue })
    .where(eq(maintenanceTasks.id, id));
  const [updated] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ data: { ...updated, status: computeStatus(nextDue) } });
});

// Auto-generate maintenance tasks for all leases based on property heating type
maintenanceRouter.post("/auto-generate", async (c) => {
  const ownerId = getRequiredUserId(c);
  // Query active leases for this owner
  const activeLeases = await db.select().from(leases)
    .where(and(eq(leases.ownerId, ownerId), eq(leases.status, "active")));
  // Query all properties for this owner (to get heatingType)
  const ownerProperties = await db.select().from(properties)
    .where(eq(properties.ownerId, ownerId));
  // Query existing maintenance tasks for this owner
  const existingTasks = await db.select().from(maintenanceTasks)
    .where(eq(maintenanceTasks.ownerId, ownerId));

  const propMap = new Map(ownerProperties.map((p) => [p.id, p]));
  const created: any[] = [];

  for (const lease of activeLeases) {
    const prop = propMap.get(lease.propertyId);
    if (!prop) continue;

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
  const ownerId = getRequiredUserId(c);
  const existing = await db.select().from(maintenanceTasks)
    .where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.ownerId, ownerId)));
  if (!existing[0]) return c.json({ error: "Not found" }, 404);
  await db.delete(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  return c.json({ message: "Deleted" });
});
