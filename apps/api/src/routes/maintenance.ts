import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";

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

maintenanceRouter.get("/", async (c) => {
  const result = mem.getAll("maintenance").map((t: any) => ({
    ...t,
    status: computeStatus(t.nextDue),
  }));
  return c.json({ data: result, meta: { total: result.length } });
});

maintenanceRouter.post(
  "/",
  zValidator("json", createMaintenanceSchema),
  async (c) => {
    const data = c.req.valid("json");
    const id = crypto.randomUUID();
    const nextDue = computeNextDue(data.lastCompleted || undefined, data.intervalMonths);
    const record = {
      id,
      ownerId: c.get("userId") || "system",
      propertyId: data.propertyId,
      leaseId: data.leaseId || null,
      type: data.type,
      name: data.name,
      intervalMonths: data.intervalMonths,
      lastCompleted: data.lastCompleted || null,
      nextDue,
      autoEmail: data.autoEmail,
      notes: data.notes || null,
      status: computeStatus(nextDue),
      createdAt: new Date().toISOString(),
    };

    mem.insert("maintenance", record);
    return c.json({ data: record, message: "Maintenance task created" }, 201);
  }
);

// Update a task (toggle autoEmail, set lastCompleted date, etc.)
maintenanceRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const task = mem.getById("maintenance", id);
  if (!task) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};

  if (body.autoEmail !== undefined) updates.autoEmail = body.autoEmail;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.lastCompleted !== undefined) {
    updates.lastCompleted = body.lastCompleted;
    updates.nextDue = computeNextDue(body.lastCompleted, task.intervalMonths);
  }

  mem.update("maintenance", id, updates);
  const updated = { ...task, ...updates };
  updated.status = computeStatus(updated.nextDue);
  return c.json({ data: updated });
});

// Mark task as completed (today)
maintenanceRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const task = mem.getById("maintenance", id);
  if (!task) return c.json({ error: "Not found" }, 404);

  const today = new Date().toISOString().split("T")[0];
  const nextDue = computeNextDue(today, task.intervalMonths);

  mem.update("maintenance", id, { lastCompleted: today, nextDue });
  const updated = { ...task, lastCompleted: today, nextDue, status: computeStatus(nextDue) };
  return c.json({ data: updated });
});

// Auto-generate maintenance tasks for all leases based on property heating type
maintenanceRouter.post("/auto-generate", async (c) => {
  const leases = mem.getAll("leases").filter((l: any) => !l.isArchived && l.status === "active");
  const properties = mem.getAll("properties");
  const existingTasks = mem.getAll("maintenance");
  const propMap = new Map(properties.map((p: any) => [p.id, p]));

  const created: any[] = [];

  for (const lease of leases) {
    const prop = propMap.get(lease.propertyId);
    if (!prop) continue;

    const heatingType = prop.heatingType || "";

    // Fire alarm - always, every 12 months
    const hasFireAlarm = existingTasks.some(
      (t: any) => t.leaseId === lease.id && t.type === "fire_alarm"
    );
    if (!hasFireAlarm) {
      const id = crypto.randomUUID();
      const nextDue = computeNextDue(undefined, 12);
      const record = {
        id,
        ownerId: c.get("userId") || "system",
        propertyId: lease.propertyId,
        leaseId: lease.id,
        type: "fire_alarm",
        name: "Brandalarm controle",
        intervalMonths: 12,
        lastCompleted: null,
        nextDue,
        autoEmail: true,
        notes: null,
        status: computeStatus(nextDue),
        createdAt: new Date().toISOString(),
      };
      mem.insert("maintenance", record);
      created.push(record);
    }

    // Heating maintenance - not for electric
    if (heatingType && heatingType !== "electric" && heatingType !== "none") {
      const hasHeating = existingTasks.some(
        (t: any) => t.leaseId === lease.id && t.type === "heating_maintenance"
      );
      if (!hasHeating) {
        const interval = heatingType === "heat_pump" ? 24 : 12;
        const id = crypto.randomUUID();
        const nextDue = computeNextDue(undefined, interval);
        const record = {
          id,
          ownerId: c.get("userId") || "system",
          propertyId: lease.propertyId,
          leaseId: lease.id,
          type: "heating_maintenance",
          name: heatingType === "heat_pump" ? "Warmtepomp onderhoud" : "CV-ketel onderhoud",
          intervalMonths: interval,
          lastCompleted: null,
          nextDue,
          autoEmail: true,
          notes: null,
          status: computeStatus(nextDue),
          createdAt: new Date().toISOString(),
        };
        mem.insert("maintenance", record);
        created.push(record);
      }
    }

    // Chimney sweep - only for gas, oil, wood, pellet
    if (["gas", "oil", "wood", "pellet"].includes(heatingType)) {
      const hasChimney = existingTasks.some(
        (t: any) => t.leaseId === lease.id && t.type === "chimney_sweep"
      );
      if (!hasChimney) {
        const id = crypto.randomUUID();
        const nextDue = computeNextDue(undefined, 12);
        const record = {
          id,
          ownerId: c.get("userId") || "system",
          propertyId: lease.propertyId,
          leaseId: lease.id,
          type: "chimney_sweep",
          name: "Schouwveger",
          intervalMonths: 12,
          lastCompleted: null,
          nextDue,
          autoEmail: true,
          notes: null,
          status: computeStatus(nextDue),
          createdAt: new Date().toISOString(),
        };
        mem.insert("maintenance", record);
        created.push(record);
      }
    }
  }

  return c.json({ data: created, message: `Generated ${created.length} tasks` });
});

maintenanceRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  mem.remove("maintenance", id);
  return c.json({ message: "Deleted" });
});
