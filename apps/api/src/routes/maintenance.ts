import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";

const createMaintenanceSchema = z.object({
  propertyId: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  intervalMonths: z.number().int().min(1).max(120).default(12),
  lastCompleted: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

function computeNextDue(lastCompleted: string | undefined, intervalMonths: number): string {
  if (lastCompleted) {
    const d = new Date(lastCompleted);
    d.setMonth(d.getMonth() + intervalMonths);
    return d.toISOString().split("T")[0];
  }
  // No history: due now
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
      type: data.type,
      name: data.name,
      intervalMonths: data.intervalMonths,
      lastCompleted: data.lastCompleted || null,
      nextDue,
      notes: data.notes || null,
      status: computeStatus(nextDue),
      createdAt: new Date().toISOString(),
    };

    mem.insert("maintenance", record);
    return c.json({ data: record, message: "Maintenance task created" }, 201);
  }
);

// Mark task as completed
maintenanceRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const task = mem.getById("maintenance", id);
  if (!task) return c.json({ error: "Not found" }, 404);

  const today = new Date().toISOString().split("T")[0];
  const nextDue = computeNextDue(today, task.intervalMonths);

  mem.update("maintenance", id, {
    lastCompleted: today,
    nextDue,
  });

  const updated = { ...task, lastCompleted: today, nextDue, status: computeStatus(nextDue) };
  return c.json({ data: updated });
});

maintenanceRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  mem.remove("maintenance", id);
  return c.json({ message: "Deleted" });
});
