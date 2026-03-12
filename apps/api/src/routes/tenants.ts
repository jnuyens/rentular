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
  dbSchema = dbMod.tenants;
  eq = require("drizzle-orm").eq;
} catch {
  console.log("[Tenants] Database unavailable, using in-memory store");
}

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

tenantsRouter.get("/", async (c) => {
  try {
    if (db && dbSchema) {
      const result = await db.select().from(dbSchema);
      return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
    }
  } catch (err) {
    console.error("DB read failed, falling back to memory:", err);
  }
  const result = mem.getAll("tenants").filter((t: any) => !t.isArchived);
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

tenantsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      const result = await db.select().from(dbSchema).where(eq(dbSchema.id, id));
      return c.json({ data: result[0] || null });
    }
  } catch {
    // fallback
  }
  return c.json({ data: mem.getById("tenants", id) || null });
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");
  const tenantLanguage = data.language || "nl";
  const id = crypto.randomUUID();
  const record = { id, ownerId: c.get("userId") || "system", ...data, language: tenantLanguage, isArchived: false, createdAt: new Date().toISOString() };

  try {
    if (db && dbSchema) {
      await db.insert(dbSchema).values({
        id,
        ownerId: c.get("userId") || "system",
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        language: tenantLanguage,
        nationalRegister: data.nationalRegister || null,
        iban: data.bankAccount || null,
        notes: data.notes || null,
      });
      return c.json({ data: record, message: "Tenant created" }, 201);
    }
  } catch (err) {
    console.error("DB insert failed, using memory store:", err);
  }

  mem.insert("tenants", record);
  return c.json({ data: record, message: "Tenant created" }, 201);
});

tenantsRouter.patch(
  "/:id",
  zValidator("json", createTenantSchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    try {
      if (db && dbSchema && eq) {
        await db.update(dbSchema).set(data).where(eq(dbSchema.id, id));
        const result = await db.select().from(dbSchema).where(eq(dbSchema.id, id));
        return c.json({ data: result[0] || { id, ...data }, message: "Tenant updated" });
      }
    } catch {
      // fallback
    }
    const existing = mem.getById("tenants", id);
    mem.update("tenants", id, data);
    return c.json({ data: { ...existing, ...data }, message: "Tenant updated" });
  }
);

tenantsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      await db.update(dbSchema).set({ isArchived: true }).where(eq(dbSchema.id, id));
    }
  } catch {
    mem.remove("tenants", id);
  }
  return c.json({ message: "Tenant deleted" });
});
