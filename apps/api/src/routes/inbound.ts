/**
 * Inbound mail from the Cloudflare Email Worker (infra/cloudflare/inbound-email).
 *
 *   POST /api/v1/inbound/email
 *     body:    the raw RFC 822 message
 *     headers: X-Inbound-Secret     shared secret (INBOUND_WEBHOOK_SECRET)
 *              X-Inbound-Recipient  envelope recipient (reply+<token>@domain)
 *              X-Inbound-Sender     envelope sender
 *
 * Public on purpose (not behind requireAuth): the secret is the
 * authentication, compared in constant time. Without INBOUND_WEBHOOK_SECRET
 * the endpoint answers 404. Bodies above 12 MB are refused, and each client
 * address gets a fixed number of calls per minute.
 */
import crypto from "crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { defaultInboundDeps, processInboundEmail, type InboundDeps } from "../services/inboundEmail";

export const MAX_INBOUND_BYTES = 12 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = Number(process.env.INBOUND_RATE_LIMIT) || 120;

/** Constant-time comparison of the presented secret against the configured one. */
export function secretMatches(presented: string | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const hits = new Map<string, { windowStart: number; count: number }>();

function clientKey(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function rateLimited(key: string, now = Date.now()): boolean {
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart >= 60_000) {
    hits.set(key, { windowStart: now, count: 1 });
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.windowStart >= 60_000) hits.delete(k);
    }
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_PER_MINUTE;
}

/** Test hook: start every test with an empty rate-limit table. */
export function resetInboundRateLimit(): void {
  hits.clear();
}

export function createInboundRouter(getDeps: () => InboundDeps = defaultInboundDeps): Hono {
  const router = new Hono();

  router.post(
    "/email",
    async (c, next) => {
      if (!process.env.INBOUND_WEBHOOK_SECRET) return c.json({ error: "Not found" }, 404);
      if (rateLimited(clientKey(c))) return c.json({ error: "Too many requests" }, 429);
      if (!secretMatches(c.req.header("x-inbound-secret"), process.env.INBOUND_WEBHOOK_SECRET)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    },
    bodyLimit({
      maxSize: MAX_INBOUND_BYTES,
      onError: (c) => c.json({ error: "Message too large" }, 413),
    }),
    async (c) => {
      const raw = Buffer.from(await c.req.arrayBuffer());
      if (raw.length === 0) return c.json({ error: "Empty message" }, 400);
      try {
        const result = await processInboundEmail(
          raw,
          { to: c.req.header("x-inbound-recipient") ?? null, from: c.req.header("x-inbound-sender") ?? null },
          getDeps(),
        );
        console.log(`[Inbound] ${result.outcome}`);
        return c.json(result, result.status);
      } catch (err) {
        console.error("[Inbound] processing failed:", err);
        // Non-2xx: the worker forwards the raw message to its fallback address.
        return c.json({ error: "Processing failed" }, 500);
      }
    },
  );

  return router;
}

export const inboundRouter = createInboundRouter();
