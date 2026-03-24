import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { getDb, tenants, leases, leaseTenants, propertyManagers } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  canAccessDomain,
  hasMinimumRole,
} from "../lib/propertyAccess";
import type { PropertyManagerRole } from "@rentular/shared";

const db = getDb();

const createTenantSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().default(""),
  language: z.enum(["nl", "fr", "de", "en"]).optional(),
  nationalRegister: z.string().optional().default(""),
  bankAccount: z.string().optional().default(""),
  avatar: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export const tenantsRouter = new Hono();

// Helper: get tenant IDs accessible to the user (join chain: properties -> leases -> leaseTenants)
async function getAccessibleTenantIds(userId: string): Promise<string[]> {
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return [];

  // Filter out properties where user is accountant (accountant blocked from tenants per D-05)
  const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
  const allowedIds = roles.filter(r => canAccessDomain(r.role as PropertyManagerRole, "tenants")).map(r => r.propertyId);
  if (allowedIds.length === 0) return [];

  // Join chain: properties -> leases -> leaseTenants -> tenants
  const leaseRows = await db.select({ id: leases.id }).from(leases).where(inArray(leases.propertyId, allowedIds));
  const leaseIds = leaseRows.map(l => l.id);
  if (leaseIds.length === 0) return [];

  const tenantLinks = await db.select({ tenantId: leaseTenants.tenantId }).from(leaseTenants).where(inArray(leaseTenants.leaseId, leaseIds));
  return [...new Set(tenantLinks.map(t => t.tenantId))];
}

tenantsRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const tenantIds = await getAccessibleTenantIds(userId);
  if (tenantIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });

  const result = await db
    .select()
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

tenantsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);

  // Fetch tenant first
  const result = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id));
  if (!result[0]) return c.json({ error: "Tenant not found" }, 404);

  // Verify tenant is linked to an accessible property via lease
  const tenantIds = await getAccessibleTenantIds(userId);
  if (!tenantIds.includes(id)) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  return c.json({ data: result[0] });
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");
  const tenantLanguage = data.language || "nl";
  const ownerId = getRequiredUserId(c);
  const id = crypto.randomUUID();

  // Tenant creation does not require property check (tenants are linked via leases)
  // Keep ownerId = userId for the creator
  await db.insert(tenants).values({
    id,
    ownerId,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || null,
    phone: data.phone || null,
    language: tenantLanguage,
    nationalRegister: data.nationalRegister || null,
    iban: data.bankAccount || null,
    notes: data.notes || null,
  });

  const record = { id, ownerId, ...data, language: tenantLanguage, isArchived: false, createdAt: new Date().toISOString() };
  return c.json({ data: record, message: "Tenant created" }, 201);
});

tenantsRouter.patch(
  "/:id",
  zValidator("json", createTenantSchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);

    const existing = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id));
    if (!existing[0]) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    // Verify tenant is on an accessible property and user has manager+ role on at least one
    const accessibleIds = await getAccessiblePropertyIds(userId);
    if (accessibleIds.length === 0) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    // Find leases linking this tenant to accessible properties
    const tenantLeaseLinks = await db.select({ leaseId: leaseTenants.leaseId })
      .from(leaseTenants).where(eq(leaseTenants.tenantId, id));
    const tenantLeaseIds = tenantLeaseLinks.map(l => l.leaseId);
    if (tenantLeaseIds.length === 0) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const linkedLeases = await db.select({ id: leases.id, propertyId: leases.propertyId })
      .from(leases).where(and(inArray(leases.id, tenantLeaseIds), inArray(leases.propertyId, accessibleIds)));
    if (linkedLeases.length === 0) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    // Check manager+ role on at least one linked property
    let hasManagerRole = false;
    for (const lease of linkedLeases) {
      const role = await getUserPropertyRole(userId, lease.propertyId);
      if (role && hasMinimumRole(role, "manager")) {
        hasManagerRole = true;
        break;
      }
    }
    if (!hasManagerRole) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const { bankAccount, ...rest } = data;
    await db
      .update(tenants)
      .set({
        ...rest,
        ...(bankAccount !== undefined ? { iban: bankAccount } : {}),
      })
      .where(eq(tenants.id, id));
    const result = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id));
    return c.json({ data: result[0], message: "Tenant updated" });
  }
);

tenantsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);

  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id));
  if (!existing[0]) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  // Verify co_owner+ role on at least one property the tenant is linked to
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const tenantLeaseLinks = await db.select({ leaseId: leaseTenants.leaseId })
    .from(leaseTenants).where(eq(leaseTenants.tenantId, id));
  const tenantLeaseIds = tenantLeaseLinks.map(l => l.leaseId);
  if (tenantLeaseIds.length === 0) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const linkedLeases = await db.select({ id: leases.id, propertyId: leases.propertyId })
    .from(leases).where(and(inArray(leases.id, tenantLeaseIds), inArray(leases.propertyId, accessibleIds)));
  if (linkedLeases.length === 0) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Check co_owner+ role on at least one linked property
  let hasCoOwnerRole = false;
  for (const lease of linkedLeases) {
    const role = await getUserPropertyRole(userId, lease.propertyId);
    if (role && hasMinimumRole(role, "co_owner")) {
      hasCoOwnerRole = true;
      break;
    }
  }
  if (!hasCoOwnerRole) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  await db
    .update(tenants)
    .set({ isArchived: true })
    .where(eq(tenants.id, id));
  return c.json({ message: "Tenant deleted" });
});
