import { createMiddleware } from "hono/factory";

// Re-export property access utilities for convenience
export {
  ROLE_LEVEL,
  hasMinimumRole,
  requirePropertyAccess,
  getAccessiblePropertyIds,
  getAccessiblePropertyIdsForRole,
  getUserPropertyRole,
  canAccessDomain,
} from "./propertyAccess";

// Middleware: require authenticated user (401 if not logged in)
export const requireAuth = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Authentication required" }, 401);
  }
  await next();
});

// Middleware: block a read-only Personal Access Token from state-changing
// requests. Cookie sessions have tokenScope null and are unaffected (the browser
// flow is unchanged, CONTEXT locked decision); the route's own manager+ role
// check still applies on top (belt and suspenders).
export const requireWriteScope = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }
  if (c.get("tokenScope") === "read") {
    return c.json({ error: "Token is read-only" }, 403);
  }
  await next();
});

// Helper: get userId or throw (for use inside handlers that already have requireAuth)
export function getRequiredUserId(c: { get: (key: string) => unknown }): string {
  const userId = c.get("userId") as string | null;
  if (!userId) {
    throw new Error("Authenticated user is required");
  }
  return userId;
}
