import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, properties } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

const db = getDb();

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

// List all properties
propertiesRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db
    .select()
    .from(properties)
    .where(eq(properties.ownerId, ownerId));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

// Get a single property
propertiesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const result = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
  return result[0]
    ? c.json({ data: result[0] })
    : c.json({ error: "Property not found" }, 404);
});

// Create a property
propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    const ownerId = getRequiredUserId(c);
    const id = crypto.randomUUID();

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
      heatingType: data.heatingType && data.heatingType !== "" ? data.heatingType : null,
      epcLabel: data.epcLabel || null,
      epcScore: data.epcScore || null,
      epcCertificateNumber: data.epcCertificateNumber || null,
      epcExpiryDate: data.epcExpiryDate || null,
      notes: data.notes || null,
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
    const ownerId = getRequiredUserId(c);

    const existing = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
    if (!existing[0]) {
      return c.json({ error: "Property not found" }, 404);
    }

    await db
      .update(properties)
      .set(data)
      .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
    const result = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
    return c.json({ data: result[0], message: "Property updated" });
  }
);

// Delete a property
propertiesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  const existing = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
  if (!existing[0]) {
    return c.json({ error: "Property not found" }, 404);
  }

  await db
    .update(properties)
    .set({ isArchived: true })
    .where(and(eq(properties.id, id), eq(properties.ownerId, ownerId)));
  return c.json({ message: "Property deleted" });
});
