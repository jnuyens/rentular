import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

export const requireAuth = createMiddleware(async (c, next) => {
  if (!c.get("userId")) {
    return c.json({ error: "Authentication required" }, 401);
  }

  await next();
});

export function getRequiredUserId(c: Context): string {
  const userId = c.get("userId");
  if (!userId || typeof userId !== "string") {
    throw new Error("Authenticated user is required");
  }

  return userId;
}
