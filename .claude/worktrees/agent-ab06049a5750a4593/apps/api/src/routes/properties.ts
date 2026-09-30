import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { getDb, properties, propertyManagers } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  hasMinimumRole,
} from "../lib/propertyAccess";

const createPropertySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["apartment", "house", "studio", "commercial", "garage", "other"]),
  street: z.string().min(1),
  streetNumber: z.string().min(1),
  box: z.string().optional().default(""),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().max(2).default("BE"),
  cadastralReference: z.string().optional().default(""),
  heatingType: z.enum(["gas", "oil", "electric", "heat_pump", "wood", "pellet", "none", ""]).optional().default(""),
  epcLabel: z.string().optional().default(""),
  epcScore: z.string().optional().default(""),
  epcCertificateNumber: z.string().optional().default(""),
  epcExpiryDate: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export const propertiesRouter = new Hono();

// List all properties accessible to the current user
propertiesRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const db = getDb();
  const accessibleIds = await getAccessiblePropertyIds(userId);

  if (accessibleIds.length === 0) {
    return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });
  }

  const result = await db
    .select()
    .from(properties)
    .where(inArray(properties.id, accessibleIds));

  // D-07, D-08: Attach role info to each property for the dashboard
  const propertyRoles = await db
    .select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        inArray(propertyManagers.propertyId, accessibleIds)
      )
    );

  const roleMap = new Map(propertyRoles.map((r) => [r.propertyId, r.role]));

  const data = result.map((prop) => ({
    ...prop,
    userRole: roleMap.get(prop.id) || "viewer",
  }));

  return c.json({ data, meta: { total: data.length, page: 1, perPage: 100 } });
});

// Get a single property
propertiesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const db = getDb();
  const accessibleIds = await getAccessiblePropertyIds(userId);

  const result = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), inArray(properties.id, accessibleIds)));

  if (!result[0]) {
    return c.json({ error: "Property not found" }, 404);
  }

  const role = await getUserPropertyRole(userId, id);
  return c.json({ data: { ...result[0], userRole: role || "viewer" } });
});

// Create a property
propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    const id = crypto.randomUUID();
    const ownerId = getRequiredUserId(c);
    const db = getDb();

    await db.insert(properties).values({
      id,
      ownerId,
      name: data.name,
      type: data.type,
      street: data.street,
      streetNumber: data.streetNumber,
      box: data.box || null,
      postalCode: data.postalCode,
      city: data.city,
      country: data.country,
      cadastralReference: data.cadastralReference || null,
      epcLabel: data.epcLabel || null,
      epcScore: data.epcScore || null,
      epcCertificateNumber: data.epcCertificateNumber || null,
      epcExpiryDate: data.epcExpiryDate || null,
      notes: data.notes || null,
    });

    // Auto-register owner in propertyManagers (Pattern 6 from research)
    await db.insert(propertyManagers).values({
      id: crypto.randomUUID(),
      propertyId: id,
      userId: ownerId,
      role: "owner",
      invitedBy: null,
      acceptedAt: new Date(),
      invitedAt: new Date(),
    });

    const record = { id, ownerId, ...data, isArchived: false, createdAt: new Date().toISOString() };
    return c.json({ data: record, message: "Property created" }, 201);
  }
);

// Update a property
propertiesRouter.patch(
  "/:id",
  zValidator("json", createPropertySchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const db = getDb();

    // Check user has manager+ role for this property
    const userRole = await getUserPropertyRole(userId, id);
    if (!userRole || !hasMinimumRole(userRole, "manager")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await db.update(properties).set(data as Record<string, unknown>).where(eq(properties.id, id));
    const result = await db.select().from(properties).where(eq(properties.id, id));
    return c.json({ data: result[0] || { id, ...data }, message: "Property updated" });
  }
);

// Delete (archive) a property
propertiesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const db = getDb();

  // Check user has co_owner+ role for this property
  const userRole = await getUserPropertyRole(userId, id);
  if (!userRole || !hasMinimumRole(userRole, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  await db.update(properties).set({ isArchived: true }).where(eq(properties.id, id));
  return c.json({ message: "Property deleted" });
});
