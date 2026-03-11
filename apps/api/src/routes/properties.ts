import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";

let db: any = null;
let dbSchema: any = null;
let eq: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  dbSchema = dbMod.properties;
  eq = require("drizzle-orm").eq;
} catch {
  console.log("[Properties] Database unavailable, using in-memory store");
}

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
    if (db && dbSchema) {
      const result = await db.select().from(dbSchema);
      return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
    }
  } catch (err) {
    console.error("DB read failed, falling back to memory:", err);
  }
  const result = mem.getAll("properties").filter((p: any) => !p.isArchived);
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

// Get a single property
propertiesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      const result = await db.select().from(dbSchema).where(eq(dbSchema.id, id));
      return c.json({ data: result[0] || null });
    }
  } catch {
    // fallback
  }
  return c.json({ data: mem.getById("properties", id) || null });
});

// Create a property
propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    const id = crypto.randomUUID();
    const record = { id, ownerId: c.get("userId") || "system", ...data, isArchived: false, createdAt: new Date().toISOString() };

    try {
      if (db && dbSchema) {
        await db.insert(dbSchema).values({
          id,
          ownerId: c.get("userId") || "system",
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
        return c.json({ data: record, message: "Property created" }, 201);
      }
    } catch (err) {
      console.error("DB insert failed, using memory store:", err);
    }

    mem.insert("properties", record);
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
    try {
      if (db && dbSchema && eq) {
        await db.update(dbSchema).set(data).where(eq(dbSchema.id, id));
      }
    } catch {
      mem.update("properties", id, data);
    }
    return c.json({ data: { id, ...data }, message: "Property updated" });
  }
);

// Delete a property
propertiesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      await db.update(dbSchema).set({ isArchived: true }).where(eq(dbSchema.id, id));
    }
  } catch {
    mem.remove("properties", id);
  }
  return c.json({ message: "Property deleted" });
});
