import "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    propertyRole: string | null;
    propertyId: string | null;
  }
}
