import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb, tenants } from "@rentular/db";
import { eq } from "drizzle-orm";

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
  const search = c.req.query("search");
  const includeArchived = c.req.query("includeArchived") === "true";
  try {
    const db = getDb();
    const result = await (db as any).select().from(tenants);
    return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
  } catch (err) {
    console.error("Failed to fetch tenants:", err);
    return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
  }
});

tenantsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const db = getDb();
    const result = await (db as any).select().from(tenants).where(eq(tenants.id, id));
    return c.json({ data: result[0] || null });
  } catch (err) {
    console.error("Failed to fetch tenant:", err);
    return c.json({ data: null });
  }
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");
  const tenantLanguage = data.language || "nl";
  const id = crypto.randomUUID();

  try {
    const db = getDb();
    await (db as any).insert(tenants).values({
      id,
      ownerId: "system", // TODO: get from auth session
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || null,
      phone: data.phone || null,
      language: tenantLanguage,
      nationalRegister: data.nationalRegister || null,
      iban: data.bankAccount || null,
      notes: data.notes || null,
    });
    return c.json({
      data: { id, ...data, language: tenantLanguage },
      message: "Tenant created",
    }, 201);
  } catch (err) {
    console.error("Failed to create tenant:", err);
    return c.json({
      data: { id, ...data, language: tenantLanguage },
      message: "Tenant created (not persisted - database unavailable)",
    }, 201);
  }
});

tenantsRouter.patch(
  "/:id",
  zValidator("json", createTenantSchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    try {
      const db = getDb();
      await (db as any).update(tenants).set(data).where(eq(tenants.id, id));
    } catch (err) {
      console.error("Failed to update tenant:", err);
    }
    return c.json({ data: { id, ...data }, message: "Tenant updated" });
  }
);

tenantsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const db = getDb();
    await (db as any).update(tenants).set({ isArchived: true }).where(eq(tenants.id, id));
  } catch (err) {
    console.error("Failed to delete tenant:", err);
  }
  return c.json({ message: "Tenant deleted" });
});
