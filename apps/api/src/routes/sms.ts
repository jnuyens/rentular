import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getRequiredUserId } from "../lib/routeAuth";
import { sendSms, normalizePhoneNumber } from "../lib/sms";

export const smsRouter = new Hono();

// Send a test SMS to verify the configured provider/gateway end-to-end.
// POST /api/v1/sms/test  { "to": "+32...", "body": "optional" }
smsRouter.post(
  "/test",
  zValidator(
    "json",
    z.object({ to: z.string().min(6), body: z.string().optional() })
  ),
  async (c) => {
    getRequiredUserId(c);
    const { to, body } = c.req.valid("json");
    const provider = process.env.SMS_PROVIDER || "console";
    const normalized = normalizePhoneNumber(to);
    try {
      const result = await sendSms({
        to: normalized,
        body: body || "Rentular test SMS -- the gateway works.",
      });
      return c.json({
        data: { provider, to: normalized, messageId: result.messageId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `SMS send failed via ${provider}: ${message}` }, 502);
    }
  }
);
