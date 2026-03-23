import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb, communications, leases, leaseTenants, tenants } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import { queueEmail, type CommunicationMeta } from "../jobs/emailQueueWorker";
import { queueSms } from "../jobs/smsQueueWorker";

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
  const propertyId = c.req.query("propertyId");
  const tenantId = c.req.query("tenantId");
  const page = Number(c.req.query("page")) || 1;
  const perPage = Number(c.req.query("perPage")) || 20;

  const ownerId = getRequiredUserId(c);
  const conditions: ReturnType<typeof eq>[] = [eq(communications.ownerId, ownerId)];
  if (leaseId) conditions.push(eq(communications.leaseId, leaseId));
  if (channel) conditions.push(eq(communications.channel, channel as any));
  if (type) conditions.push(eq(communications.type, type as any));
  if (status) conditions.push(eq(communications.status, status as any));

  // Filter by propertyId: find all leases for that property, then filter communications
  if (propertyId) {
    const propertyLeases = await db.select({ id: leases.id }).from(leases)
      .where(and(eq(leases.ownerId, ownerId), eq(leases.propertyId, propertyId)));
    const leaseIds = propertyLeases.map(l => l.id);
    if (leaseIds.length > 0) {
      conditions.push(inArray(communications.leaseId, leaseIds));
    } else {
      return c.json({ data: [], meta: { total: 0, page, perPage } });
    }
  }

  // Filter by tenantId: find all leases for that tenant via leaseTenants join
  if (tenantId) {
    const tenantLeases = await db.select({ leaseId: leaseTenants.leaseId }).from(leaseTenants)
      .where(eq(leaseTenants.tenantId, tenantId));
    const leaseIds = tenantLeases.map(l => l.leaseId);
    if (leaseIds.length > 0) {
      conditions.push(inArray(communications.leaseId, leaseIds));
    } else {
      return c.json({ data: [], meta: { total: 0, page, perPage } });
    }
  }

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

// Resend a failed communication via the email/SMS queue
communicationsRouter.post("/:id/resend", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const original = await db.select().from(communications)
    .where(and(eq(communications.id, id), eq(communications.ownerId, ownerId)));
  if (!original[0]) return c.json({ error: "Communication not found" }, 404);
  if (!["failed", "bounced"].includes(original[0].status)) {
    return c.json({ error: "Only failed or bounced communications can be resent" }, 400);
  }

  const meta: CommunicationMeta = {
    ownerId: original[0].ownerId,
    leaseId: original[0].leaseId || undefined,
    type: original[0].type as CommunicationMeta["type"],
    recipientName: original[0].recipientName,
  };

  if (original[0].channel === "email") {
    await queueEmail(
      { to: original[0].recipientEmail!, subject: original[0].subject || "", body: original[0].body },
      undefined,
      meta,
    );
  } else if (original[0].channel === "sms") {
    await queueSms(
      { to: original[0].recipientPhone!, body: original[0].body },
      undefined,
      meta,
    );
  }

  return c.json({ message: "Communication re-queued for delivery" });
});

// Send a custom message to a tenant (looks up tenant from lease)
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

    // Look up the lease and verify ownership
    const lease = await db.select().from(leases)
      .where(and(eq(leases.id, data.leaseId), eq(leases.ownerId, ownerId))).limit(1);
    if (!lease[0]) return c.json({ error: "Lease not found" }, 404);

    // Get primary tenant for this lease
    const tenantLink = await db.select().from(leaseTenants)
      .where(and(eq(leaseTenants.leaseId, data.leaseId), eq(leaseTenants.isPrimary, true))).limit(1);
    if (!tenantLink[0]) return c.json({ error: "No primary tenant found for this lease" }, 404);

    const tenant = await db.select().from(tenants)
      .where(eq(tenants.id, tenantLink[0].tenantId)).limit(1);
    if (!tenant[0]) return c.json({ error: "Tenant not found" }, 404);

    const tenantName = `${tenant[0].firstName} ${tenant[0].lastName}`.trim();

    if (data.channel === "email") {
      if (!tenant[0].email) {
        return c.json({ error: "Tenant has no email address" }, 400);
      }
      await queueEmail(
        { to: tenant[0].email, subject: data.subject!, body: data.body },
        undefined,
        {
          ownerId,
          leaseId: data.leaseId,
          type: "custom",
          recipientName: tenantName || tenant[0].email,
        },
      );
    } else if (data.channel === "sms") {
      if (!tenant[0].phone) {
        return c.json({ error: "Tenant has no phone number" }, 400);
      }
      await queueSms(
        { to: tenant[0].phone, body: data.body },
        undefined,
        {
          ownerId,
          leaseId: data.leaseId,
          type: "custom",
          recipientName: tenantName || tenant[0].phone,
        },
      );
    }

    return c.json({ message: "Message queued for delivery" }, 201);
  }
);
