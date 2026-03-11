import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const communicationsRouter = new Hono();

// List communications with filtering
communicationsRouter.get("/", async (c) => {
  const leaseId = c.req.query("leaseId");
  const channel = c.req.query("channel");   // email, sms, letter
  const type = c.req.query("type");         // payment_reminder_friendly, etc.
  const status = c.req.query("status");     // queued, sent, delivered, failed, bounced
  const from = c.req.query("from");         // date range start
  const to = c.req.query("to");             // date range end
  const page = Number(c.req.query("page")) || 1;
  const perPage = Number(c.req.query("perPage")) || 20;

  // TODO: Query communications table with filters, ordered by createdAt desc
  // JOIN with leases for property/tenant info
  return c.json({
    data: [],
    meta: { total: 0, page, perPage },
  });
});

// Get a single communication with full details
communicationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Query communication by id, verify ownership
  return c.json({ data: null });
});

// Resend a failed communication
communicationsRouter.post("/:id/resend", async (c) => {
  const id = c.req.param("id");
  // TODO:
  // 1. Fetch original communication
  // 2. Verify it's in 'failed' or 'bounced' status
  // 3. Re-queue via email or SMS queue
  // 4. Create a new communication record referencing the original
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
    // TODO:
    // 1. Fetch lease + tenant info
    // 2. Queue email or SMS
    // 3. Create communication record with type 'custom'
    return c.json({ data, message: "Message queued for delivery" }, 201);
  }
);

// Get communication statistics
communicationsRouter.get("/stats/summary", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  // TODO: Aggregate communications by channel, type, status
  return c.json({
    totalSent: 0,
    byChannel: { email: 0, sms: 0, letter: 0 },
    byStatus: { queued: 0, sent: 0, delivered: 0, failed: 0, bounced: 0 },
    byType: {},
  });
});
