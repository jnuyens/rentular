import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb, communications } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

const db = getDb();

export const communicationsRouter = new Hono();

// Stats summary must be registered before /:id to avoid route conflicts
communicationsRouter.get("/stats/summary", async (c) => {
  const ownerId = getRequiredUserId(c);
  const conditions = [eq(communications.ownerId, ownerId)];
  const all = await db.select().from(communications).where(and(...conditions));
  const byChannel: Record<string, number> = { email: 0, sms: 0, letter: 0 };
  const byStatus: Record<string, number> = { queued: 0, sent: 0, delivered: 0, failed: 0, bounced: 0 };
  const byType: Record<string, number> = {};
  for (const comm of all) {
    byChannel[comm.channel] = (byChannel[comm.channel] || 0) + 1;
    byStatus[comm.status] = (byStatus[comm.status] || 0) + 1;
    byType[comm.type] = (byType[comm.type] || 0) + 1;
  }
  return c.json({ totalSent: all.length, byChannel, byStatus, byType });
});

// List communications with filtering
communicationsRouter.get("/", async (c) => {
  const leaseId = c.req.query("leaseId");
  const channel = c.req.query("channel");   // email, sms, letter
  const type = c.req.query("type");         // payment_reminder_friendly, etc.
  const status = c.req.query("status");     // queued, sent, delivered, failed, bounced
  const page = Number(c.req.query("page")) || 1;
  const perPage = Number(c.req.query("perPage")) || 20;

  const ownerId = getRequiredUserId(c);
  const conditions = [eq(communications.ownerId, ownerId)];
  if (leaseId) conditions.push(eq(communications.leaseId, leaseId));
  if (channel) conditions.push(eq(communications.channel, channel as any));
  if (type) conditions.push(eq(communications.type, type as any));
  if (status) conditions.push(eq(communications.status, status as any));
  const result = await db.select().from(communications)
    .where(and(...conditions))
    .orderBy(desc(communications.createdAt));
  // Simple pagination (offset-based)
  const offset = (page - 1) * perPage;
  const paged = result.slice(offset, offset + perPage);
  return c.json({ data: paged, meta: { total: result.length, page, perPage } });
});

// Get a single communication with full details
communicationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(communications)
    .where(and(eq(communications.id, id), eq(communications.ownerId, ownerId)));
  return result[0] ? c.json({ data: result[0] }) : c.json({ error: "Communication not found" }, 404);
});

// Resend a failed communication
communicationsRouter.post("/:id/resend", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const original = await db.select().from(communications)
    .where(and(eq(communications.id, id), eq(communications.ownerId, ownerId)));
  if (!original[0]) return c.json({ error: "Communication not found" }, 404);
  if (!["failed", "bounced"].includes(original[0].status)) {
    return c.json({ error: "Only failed or bounced communications can be resent" }, 400);
  }
  // Phase 4: Implement actual re-queueing via email/SMS queue
  // For now, create a new communication record marking it as queued
  const newId = crypto.randomUUID();
  await db.insert(communications).values({
    ...original[0],
    id: newId,
    status: "queued",
    queuedAt: new Date(),
    sentAt: null,
    errorMessage: null,
    externalId: null,
  });
  return c.json({ message: "Communication re-queued for delivery" });
});

// Send a custom message to a tenant
communicationsRouter.post(
  "/send",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      channel: z.enum(["email", "sms"]),
      subject: z.string().max(500).optional(), // Required for email
      body: z.string().min(1),
    }).refine(
      (data) => data.channel !== "email" || (data.subject && data.subject.length > 0),
      { message: "Subject is required for email" }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    const ownerId = getRequiredUserId(c);
    const id = crypto.randomUUID();
    // Phase 4: Implement actual queueing via email/SMS queue
    // For now, create the communication record
    await db.insert(communications).values({
      id,
      ownerId,
      leaseId: data.leaseId,
      channel: data.channel,
      type: "custom",
      recipientName: "Tenant", // Phase 4: look up tenant name from lease
      recipientEmail: data.channel === "email" ? "pending" : null,
      recipientPhone: data.channel === "sms" ? "pending" : null,
      subject: data.subject || null,
      body: data.body,
      status: "queued",
    });
    const [created] = await db.select().from(communications).where(eq(communications.id, id));
    return c.json({ data: created, message: "Message queued for delivery" }, 201);
  }
);
