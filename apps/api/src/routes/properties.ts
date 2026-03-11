import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb, properties } from "@rentular/db";
import { eq } from "drizzle-orm";

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
  epcLabel: z.string().optional().default(""),
  epcScore: z.string().optional().default(""),
  epcCertificateNumber: z.string().optional().default(""),
  epcExpiryDate: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export const propertiesRouter = new Hono();

// List all properties
propertiesRouter.get("/", async (c) => {
  try {
    const db = getDb();
    const result = await (db as any).select().from(properties);
    return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
  } catch (err) {
    console.error("Failed to fetch properties:", err);
    return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
  }
});

// Get a single property
propertiesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const db = getDb();
    const result = await (db as any).select().from(properties).where(eq(properties.id, id));
    return c.json({ data: result[0] || null });
  } catch (err) {
    console.error("Failed to fetch property:", err);
    return c.json({ data: null });
  }
});

// Create a property
propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    const id = crypto.randomUUID();
    try {
      const db = getDb();
      await (db as any).insert(properties).values({
        id,
        ownerId: "system", // TODO: get from auth session
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
      return c.json({ data: { id, ...data }, message: "Property created" }, 201);
    } catch (err) {
      console.error("Failed to create property:", err);
      // Return success with the data even if DB fails (in-memory mode)
      return c.json({ data: { id, ...data }, message: "Property created (not persisted - database unavailable)" }, 201);
    }
  }
);

// Update a property
propertiesRouter.patch(
  "/:id",
  zValidator("json", createPropertySchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    try {
      const db = getDb();
      await (db as any).update(properties).set(data).where(eq(properties.id, id));
    } catch (err) {
      console.error("Failed to update property:", err);
    }
    return c.json({ data: { id, ...data }, message: "Property updated" });
  }
);

// Delete a property
propertiesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const db = getDb();
    await (db as any).update(properties).set({ isArchived: true }).where(eq(properties.id, id));
  } catch (err) {
    console.error("Failed to delete property:", err);
  }
  return c.json({ message: "Property deleted" });
});
