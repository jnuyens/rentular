import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { getDb, leases, leaseTenants, properties, propertyManagers } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  canAccessDomain,
  hasMinimumRole,
} from "../lib/propertyAccess";
import type { PropertyManagerRole } from "@rentular/shared";

const db = getDb();

const createLeaseSchema = z.object({
  propertyId: z.string().min(1),
  tenantIds: z.array(z.string()).optional().default([]),
  // Frontend sends "leaseType", accept both
  leaseType: z.enum([
    "residential_short",
    "residential_long",
    "residential_lifetime",
    "student",
    "commercial",
  ]).optional(),
  type: z.enum([
    "residential_short",
    "residential_long",
    "residential_lifetime",
    "student",
    "commercial",
  ]).optional(),
  region: z.enum(["flanders", "wallonia", "brussels"]),
  signingDate: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().optional().default(""),
  // Accept string or number for rent/charges (FormData sends strings)
  monthlyRent: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  monthlyCharges: z.union([z.number(), z.string()]).optional().default("0").transform((v) => Number(v)),
  bankAccountId: z.string().optional().default(""),
  status: z.enum(["active", "draft", "terminated", "expired"]).optional().default("active"),
  indexationEnabled: z.boolean().optional().default(true),
  paymentDay: z.number().int().min(1).max(28).optional().default(1),
});

export const leasesRouter = new Hono();

// List all leases for accessible properties (filtered by role)
leasesRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });

  // Filter out properties where user is accountant (accountant blocked from leases per D-05)
  const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
  const allowedIds = roles.filter(r => canAccessDomain(r.role as PropertyManagerRole, "leases")).map(r => r.propertyId);
  if (allowedIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });

  const result = await db.select().from(leases)
    .where(inArray(leases.propertyId, allowedIds));
  // For each lease, fetch tenant IDs from junction table
  const data = await Promise.all(result.map(async (lease) => {
    const tenantRows = await db.select().from(leaseTenants)
      .where(eq(leaseTenants.leaseId, lease.id));
    return { ...lease, tenantIds: tenantRows.map(t => t.tenantId) };
  }));
  return c.json({ data, meta: { total: data.length, page: 1, perPage: 100 } });
});

// Get a single lease
leasesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const result = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!result[0]) return c.json({ data: null });

  // Check property access
  const role = await getUserPropertyRole(userId, result[0].propertyId);
  if (!role) return c.json({ data: null });
  if (!canAccessDomain(role, "leases")) return c.json({ error: "Insufficient permissions" }, 403);

  const tenantRows = await db.select().from(leaseTenants)
    .where(eq(leaseTenants.leaseId, id));
  return c.json({ data: { ...result[0], tenantIds: tenantRows.map(t => t.tenantId) } });
});

// Create a lease
leasesRouter.post("/", zValidator("json", createLeaseSchema), async (c) => {
  const data = c.req.valid("json");
  const userId = getRequiredUserId(c);

  // Check manager+ role on the target property
  const role = await getUserPropertyRole(userId, data.propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Look up the property's actual owner to set ownerId correctly
  const [property] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, data.propertyId));
  if (!property) return c.json({ error: "Property not found" }, 404);
  const ownerId = property.ownerId;

  const id = crypto.randomUUID();
  const leaseType = data.leaseType || data.type || "residential_long";

  await db.insert(leases).values({
    id,
    ownerId,
    propertyId: data.propertyId,
    type: leaseType,
    region: data.region,
    status: data.status || "active",
    signingDate: data.signingDate,
    startDate: data.startDate,
    endDate: data.endDate || null,
    monthlyRent: String(data.monthlyRent),
    monthlyCharges: String(data.monthlyCharges),
    bankAccountId: data.bankAccountId || null,
    indexationEnabled: data.indexationEnabled,
    paymentDay: data.paymentDay,
  });

  // Insert tenant associations into junction table
  if (data.tenantIds && data.tenantIds.length > 0) {
    for (const [index, tenantId] of data.tenantIds.entries()) {
      await db.insert(leaseTenants).values({
        leaseId: id,
        tenantId,
        isPrimary: index === 0,
      });
    }
  }

  const [created] = await db.select().from(leases).where(eq(leases.id, id));
  return c.json({ data: { ...created, tenantIds: data.tenantIds || [] }, message: "Lease created" }, 201);
});

// Update a lease
leasesRouter.put("/:id", zValidator("json", createLeaseSchema.partial()), async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);

  // Check manager+ role on the lease's property
  const role = await getUserPropertyRole(userId, existing[0].propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const data = c.req.valid("json");
  const leaseType = data.leaseType || data.type;
  const updates: Record<string, any> = {};

  if (data.propertyId !== undefined) updates.propertyId = data.propertyId;
  if (leaseType) updates.type = leaseType;
  if (data.region !== undefined) updates.region = data.region;
  if (data.status !== undefined) updates.status = data.status;
  if (data.signingDate !== undefined) updates.signingDate = data.signingDate;
  if (data.startDate !== undefined) updates.startDate = data.startDate;
  if (data.endDate !== undefined) updates.endDate = data.endDate || null;
  if (data.monthlyRent !== undefined) updates.monthlyRent = String(data.monthlyRent);
  if (data.monthlyCharges !== undefined) updates.monthlyCharges = String(data.monthlyCharges);
  if (data.bankAccountId !== undefined) updates.bankAccountId = data.bankAccountId || null;
  if (data.indexationEnabled !== undefined) updates.indexationEnabled = data.indexationEnabled;
  if (data.paymentDay !== undefined) updates.paymentDay = data.paymentDay;

  if (Object.keys(updates).length > 0) {
    await db.update(leases).set(updates)
      .where(eq(leases.id, id));
  }

  // Update tenant associations if provided
  if (data.tenantIds !== undefined) {
    await db.delete(leaseTenants).where(eq(leaseTenants.leaseId, id));
    for (const [index, tenantId] of data.tenantIds.entries()) {
      await db.insert(leaseTenants).values({
        leaseId: id,
        tenantId,
        isPrimary: index === 0,
      });
    }
  }

  const [updated] = await db.select().from(leases).where(eq(leases.id, id));
  const tenantRows = await db.select().from(leaseTenants)
    .where(eq(leaseTenants.leaseId, id));
  return c.json({ data: { ...updated, tenantIds: tenantRows.map(t => t.tenantId) }, message: "Lease updated" });
});

// Delete a lease
leasesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);

  // Check co_owner+ role on the lease's property
  const role = await getUserPropertyRole(userId, existing[0].propertyId);
  if (!role || !hasMinimumRole(role, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Delete tenant associations first (foreign key)
  await db.delete(leaseTenants).where(eq(leaseTenants.leaseId, id));
  await db.delete(leases).where(eq(leases.id, id));
  return c.json({ message: "Lease deleted" });
});

// Get upcoming indexations for a lease
leasesRouter.get("/:id/indexation", async (c) => {
  const id = c.req.param("id");
  return c.json({
    leaseId: id,
    currentRent: 0,
    indexedRent: 0,
    indexationDate: null,
    baseIndex: 0,
    currentIndex: 0,
    formula: "newRent = baseRent * (currentIndex / baseIndex)",
  });
});

// Get payment history for a lease
leasesRouter.get("/:id/payments", async (c) => {
  const id = c.req.param("id");
  return c.json({ data: [], leaseId: id });
});
