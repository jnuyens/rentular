import "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    propertyRole: string | null;
    propertyId: string | null;
    // Bearer-token auth state. Only authMiddleware may set these: a Bearer
    // "rtl_" token resolves to the same userId as a cookie session, plus a
    // scope. A null tokenScope means a cookie session with full access.
    tokenScope: "read" | "write" | null;
    tokenId: string | null; // api_tokens.id when Bearer-authed, else null
  }
}
