import { createMiddleware } from "hono/factory";
import { eq, and, isNotNull } from "drizzle-orm";
import { getDb, propertyManagers } from "@rentular/db";
import type { PropertyManagerRole } from "@rentular/shared";

// Role hierarchy: higher number = more permissions
export const ROLE_LEVEL: Record<PropertyManagerRole, number> = {
  viewer: 1,
  accountant: 2,
  manager: 3,
  co_owner: 4,
  owner: 5,
};

// Roles that the accountant CANNOT access (per D-05: accountant sees payments/costs only)
const ACCOUNTANT_BLOCKED_DOMAINS = [
  "leases",
  "tenants",
  "indexation",
  "maintenance",
] as const;

export function hasMinimumRole(
  userRole: PropertyManagerRole,
  requiredRole: PropertyManagerRole
): boolean {
  return (ROLE_LEVEL[userRole] ?? 0) >= (ROLE_LEVEL[requiredRole] ?? Infinity);
}

// Check if a role can access a given domain (handles accountant special case per D-05)
export function canAccessDomain(
  role: PropertyManagerRole,
  domain: string
): boolean {
  if (
    role === "accountant" &&
    ACCOUNTANT_BLOCKED_DOMAINS.includes(
      domain as (typeof ACCOUNTANT_BLOCKED_DOMAINS)[number]
    )
  ) {
    return false;
  }
  return true;
}

// Helper to get a typed db handle (getDb returns union type; cast for query use)
function db() {
  return getDb() as ReturnType<typeof getDb> & {
    select: (fields?: Record<string, unknown>) => {
      from: (table: unknown) => {
        where: (condition: unknown) => Promise<Record<string, unknown>[]>;
      };
    };
    insert: (table: unknown) => {
      values: (data: unknown) => Promise<unknown>;
    };
  };
}

// Middleware factory: require minimum role for a property
export function requirePropertyAccess(minRole: PropertyManagerRole) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Authentication required" }, 401);

    // Extract propertyId from params, query, or JSON body
    const propertyId =
      c.req.param("propertyId") ||
      c.req.query("propertyId") ||
      (c.req.method !== "GET"
        ? (await c.req.json().catch(() => ({}))).propertyId
        : null);

    if (!propertyId)
      return c.json({ error: "Property ID required" }, 400);

    const d = db() as any;
    const access = await d
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, propertyId),
          eq(propertyManagers.userId, userId),
          isNotNull(propertyManagers.acceptedAt)
        )
      );

    if (
      !access[0] ||
      !hasMinimumRole(access[0].role as PropertyManagerRole, minRole)
    ) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    c.set("propertyRole", access[0].role);
    c.set("propertyId", propertyId);
    await next();
  });
}

// Get all property IDs a user has accepted access to
export async function getAccessiblePropertyIds(
  userId: string
): Promise<string[]> {
  const d = db() as any;
  const managed = await d
    .select({ propertyId: propertyManagers.propertyId })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        isNotNull(propertyManagers.acceptedAt)
      )
    );
  return managed.map((m: { propertyId: string }) => m.propertyId);
}

// Get property IDs where user has at least the specified role
export async function getAccessiblePropertyIdsForRole(
  userId: string,
  minRole: PropertyManagerRole
): Promise<string[]> {
  const d = db() as any;
  const managed = await d
    .select({
      propertyId: propertyManagers.propertyId,
      role: propertyManagers.role,
    })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        isNotNull(propertyManagers.acceptedAt)
      )
    );
  return managed
    .filter((m: { role: string }) =>
      hasMinimumRole(m.role as PropertyManagerRole, minRole)
    )
    .map((m: { propertyId: string }) => m.propertyId);
}

// Get the user's role for a specific property (null if no access)
export async function getUserPropertyRole(
  userId: string,
  propertyId: string
): Promise<PropertyManagerRole | null> {
  const d = db() as any;
  const access = await d
    .select({ role: propertyManagers.role })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.propertyId, propertyId),
        eq(propertyManagers.userId, userId),
        isNotNull(propertyManagers.acceptedAt)
      )
    );
  return access[0] ? (access[0].role as PropertyManagerRole) : null;
}
