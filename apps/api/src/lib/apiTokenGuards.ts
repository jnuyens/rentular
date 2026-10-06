/**
 * Per-token guards for Bearer-authenticated requests: a Redis rate limit and a
 * fire-and-forget audit log into api_tool_calls. Both engage only when a
 * tokenId is set on the context (i.e. a PAT was resolved by authMiddleware);
 * cookie sessions pass straight through.
 *
 * No token material (the raw token, its hash, or the Authorization header) is
 * ever logged or persisted (T-11-09); redactAuditArgs scrubs sensitive values
 * before any row is written.
 */

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getDb, apiToolCalls } from "@rentular/db";

const SENSITIVE_KEY = /token|secret|password|iban|authorization/i;
const SENSITIVE_KEY_EXACT = /^(token|secret|password|iban|authorization)$/i;
const MAX_DEPTH = 6;
const MAX_STRING = 2000;

// Lazily created, mirrors the health-check client construction. Exposed so tests
// can mock the ioredis class.
let redisClient: Redis | null = null;
export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }
  return redisClient;
}

// INCR + EXPIRE per token per minute. Fails open on any Redis error: availability
// is preferred over strict limiting for a per-user token (accepted in the threat
// register, T-11-07b); the audit log still records the call.
export const bearerRateLimit = createMiddleware(async (c, next) => {
  const tokenId = c.get("tokenId");
  if (!tokenId) {
    await next();
    return;
  }

  const limit = Number(process.env.API_TOKEN_RATE_LIMIT_PER_MINUTE) || 120;
  const windowStart = Math.floor(Date.now() / 60000);
  const key = `api_token_rl:${tokenId}:${windowStart}`;

  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    if (count > limit) {
      const secondsLeft = Math.ceil(60 - ((Date.now() / 1000) % 60));
      c.header("Retry-After", String(secondsLeft));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
  } catch (err) {
    console.error("[ApiTokens] rate limit check failed (fail open):", err);
  }

  await next();
});

// Deep-copy that masks the values of sensitive keys at any depth. A key that is
// exactly a known sensitive field name (token, secret, password, iban,
// authorization) keeps its name and has only its value replaced with
// "[redacted]", so the audit row stays readable. A compound key that merely
// embeds one of those words (e.g. "secretThing") is itself masked, so the field
// name cannot leak embedded context into the log. Recursion is capped and long
// strings truncated to bound the stored row size.
export function redactAuditArgs(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";

  if (typeof input === "string") {
    return input.length > MAX_STRING ? input.slice(0, MAX_STRING) + "..." : input;
  }

  if (Array.isArray(input)) {
    return input.map((v) => redactAuditArgs(v, depth + 1));
  }

  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_EXACT.test(key)) {
        out[key] = "[redacted]";
      } else if (SENSITIVE_KEY.test(key)) {
        out["[redacted]"] = "[redacted]";
      } else {
        out[key] = redactAuditArgs(value, depth + 1);
      }
    }
    return out;
  }

  return input;
}

// Build the audit log's authoritative action label. The real request
// "METHOD path" is always present and is server-derived, so it cannot be
// spoofed by the caller. The client-supplied X-Rentular-Tool header is only
// ever appended as a claimed label (never a replacement): when present and
// non-empty after sanitization (lowercase, [a-z0-9_] only), it is added in
// parentheses. The whole string is capped at 80 chars to fit the tool column
// (varchar(80)), keeping the authoritative prefix first.
function resolveTool(c: Context): string {
  const real = `${c.req.method} ${c.req.path}`;
  const header = c.req.header("X-Rentular-Tool");
  if (header) {
    const cleaned = header.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 80);
    if (cleaned.length > 0) {
      return `${real} (${cleaned})`.slice(0, 80);
    }
  }
  return real.slice(0, 80);
}

// Records one api_tool_calls row per Bearer request, including denied ones, so a
// PAT call is never unaccounted for (T-11-05). Runs after the handler and never
// awaits the insert, so audit latency does not block the response.
export const bearerAuditLog = createMiddleware(async (c, next) => {
  await next();

  const tokenId = c.get("tokenId");
  if (!tokenId) return;

  const method = c.req.method.toUpperCase();
  let args: unknown = null;
  if (method === "GET" || method === "HEAD") {
    args = redactAuditArgs(c.req.query());
  } else {
    try {
      args = redactAuditArgs(await c.req.json());
    } catch {
      args = null;
    }
  }

  const httpStatus = c.res.status;
  const status: "ok" | "error" | "forbidden" =
    httpStatus < 400 ? "ok" : httpStatus === 403 ? "forbidden" : "error";

  let errorMessage: string | null = null;
  if (status !== "ok") {
    try {
      const body = (await c.res.clone().json()) as { error?: unknown };
      if (body && typeof body.error === "string") {
        errorMessage = body.error.slice(0, 1000);
      }
    } catch {
      errorMessage = null;
    }
  }

  // tokenId is set only when authMiddleware resolved a PAT, which also sets a
  // non-null userId; fall back to an empty string to keep the type total.
  const userId = c.get("userId") ?? "";

  const row = {
    id: randomUUID(),
    userId,
    tokenId,
    tool: resolveTool(c),
    args,
    status,
    httpStatus: String(httpStatus),
    errorMessage,
  };

  Promise.resolve(getDb().insert(apiToolCalls).values(row)).catch((err) =>
    console.error("[ApiTokens] audit insert failed:", err),
  );
});
