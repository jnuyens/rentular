import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const createTenantSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  // Language for communications (emails, SMS). If not provided, inherits the landlord's language.
  language: z.enum(["nl", "fr", "de", "en"]).optional(),
  nationalRegister: z.string().optional(), // Belgian national register number
  bankAccount: z.string().optional(), // IBAN
  notes: z.string().optional(),
});

export const tenantsRouter = new Hono();

tenantsRouter.get("/", async (c) => {
  const search = c.req.query("search");
  const includeArchived = c.req.query("includeArchived") === "true";
  // TODO: Query tenants with search filter and archive flag
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

tenantsRouter.get("/:id", async (c) => {
  return c.json({ data: null });
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");

  // If no language specified, inherit the landlord's language preference
  // TODO: Fetch the authenticated user's locale from the database
  // const ownerLocale = await getOwnerLocale(authUserId);
  // const tenantLanguage = data.language || ownerLocale || "nl";
  const tenantLanguage = data.language || "nl";

  return c.json({
    data: { ...data, language: tenantLanguage },
    message: "Tenant created",
  }, 201);
});

tenantsRouter.patch(
  "/:id",
  zValidator("json", createTenantSchema.partial()),
  async (c) => {
    const data = c.req.valid("json");
    return c.json({ data, message: "Tenant updated" });
  }
);
