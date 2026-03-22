import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, tenants } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

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

tenantsRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, ownerId));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

tenantsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);
  const result = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
  return result[0]
    ? c.json({ data: result[0] })
    : c.json({ error: "Tenant not found" }, 404);
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");
  const tenantLanguage = data.language || "nl";
  const ownerId = getRequiredUserId(c);
  const id = crypto.randomUUID();

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
    const ownerId = getRequiredUserId(c);

    const existing = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
    if (!existing[0]) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    const { bankAccount, ...rest } = data;
    await db
      .update(tenants)
      .set({
        ...rest,
        ...(bankAccount !== undefined ? { iban: bankAccount } : {}),
      })
      .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
    const result = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
    return c.json({ data: result[0], message: "Tenant updated" });
  }
);

tenantsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = getRequiredUserId(c);

  const existing = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
  if (!existing[0]) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  await db
    .update(tenants)
    .set({ isArchived: true })
    .where(and(eq(tenants.id, id), eq(tenants.ownerId, ownerId)));
  return c.json({ message: "Tenant deleted" });
});
