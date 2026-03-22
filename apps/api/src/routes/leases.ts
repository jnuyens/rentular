import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, leases, leaseTenants } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

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

// List all leases for owner
leasesRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(leases)
    .where(eq(leases.ownerId, ownerId));
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
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(leases)
    .where(and(eq(leases.id, id), eq(leases.ownerId, ownerId)));
  if (!result[0]) return c.json({ data: null });
  const tenantRows = await db.select().from(leaseTenants)
    .where(eq(leaseTenants.leaseId, id));
  return c.json({ data: { ...result[0], tenantIds: tenantRows.map(t => t.tenantId) } });
});

// Create a lease
leasesRouter.post("/", zValidator("json", createLeaseSchema), async (c) => {
  const data = c.req.valid("json");
  const ownerId = getRequiredUserId(c);
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
  const ownerId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(and(eq(leases.id, id), eq(leases.ownerId, ownerId)));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);

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
      .where(and(eq(leases.id, id), eq(leases.ownerId, ownerId)));
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
  const ownerId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(and(eq(leases.id, id), eq(leases.ownerId, ownerId)));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);
  // Delete tenant associations first (foreign key)
  await db.delete(leaseTenants).where(eq(leaseTenants.leaseId, id));
  await db.delete(leases).where(and(eq(leases.id, id), eq(leases.ownerId, ownerId)));
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
