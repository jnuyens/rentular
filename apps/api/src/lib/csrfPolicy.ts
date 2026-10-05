import type { Context } from "hono";

// Single source of truth for which requests bypass the Origin-based CSRF check.
// Webhooks authenticate with a provider signature instead of a cookie, and
// Bearer rtl_ Personal Access Tokens are not ambient browser credentials, so
// CSRF does not apply to them (T-11-06). Cookie requests always keep the full
// Origin check; never weaken the browser flow.
//
// The Bearer exemption is deliberately narrower than the auth branch (rtl_
// only): a non-rtl Bearer is rejected with 401 by authMiddleware anyway and
// must not gain a CSRF skip.
export function shouldSkipCsrf(c: Context): boolean {
  const path = c.req.path;
  if (path.includes("/webhooks/") || path.includes("/stripe/webhook")) {
    return true;
  }
  return c.req.header("Authorization")?.startsWith("Bearer rtl_") ?? false;
}
