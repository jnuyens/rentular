/**
 * Owner-scoped /api-tokens management router.
 *
 * Session-only: a Personal Access Token caller (tokenId set on the context) is
 * refused with 403, so a leaked PAT cannot mint further tokens or revoke others
 * (T-11-08). Every response is re-projected to the ApiTokenPublic fields so a
 * future service change can never leak the stored hash (T-11-10). The plaintext
 * token is returned once in the create response and never again.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getRequiredUserId } from "../lib/routeAuth";
import { listTokens, mintToken, revokeToken } from "../lib/apiTokens";
import type { ApiTokenPublic } from "@rentular/shared";

export const apiTokensRouter = new Hono();

// Guard: authenticated browser session only. A PAT (tokenId present) must not be
// able to manage tokens, even though it carries a valid userId.
apiTokensRouter.use("*", async (c, next) => {
  if (!c.get("userId")) {
    return c.json({ error: "Authentication required" }, 401);
  }
  if (c.get("tokenId")) {
    return c.json(
      { error: "Token management requires a browser session" },
      403,
    );
  }
  await next();
});

// Explicit projection: never echo the stored hash even if the service hands one back.
function toPublic(token: ApiTokenPublic): ApiTokenPublic {
  return {
    id: token.id,
    name: token.name,
    scope: token.scope,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
  };
}

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["read", "write"]),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

apiTokensRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const tokens = await listTokens(userId);
  return c.json({ data: tokens.map(toPublic) });
});

apiTokensRouter.post("/", zValidator("json", createTokenSchema), async (c) => {
  const userId = getRequiredUserId(c);
  const body = c.req.valid("json");
  try {
    const { token, record } = await mintToken({ userId, ...body });
    return c.json(
      {
        data: toPublic(record),
        token,
        message: "Store this token now; it will not be shown again.",
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("API_TOKEN_PEPPER")) {
      console.error("[ApiTokens] mint refused:", message);
      return c.json(
        { error: "API tokens are not configured on this server" },
        500,
      );
    }
    throw err;
  }
});

apiTokensRouter.delete("/:id", async (c) => {
  const userId = getRequiredUserId(c);
  const id = c.req.param("id");
  const ok = await revokeToken(userId, id);
  return ok
    ? c.json({ data: { id, revokedAt: new Date().toISOString() } })
    : c.json({ error: "Token not found" }, 404);
});
