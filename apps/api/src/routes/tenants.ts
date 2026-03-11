import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const createTenantSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  language: z.enum(["nl", "fr", "de", "en"]).default("nl"),
  nationalRegister: z.string().optional(), // Belgian national register number
  bankAccount: z.string().optional(), // IBAN
});

export const tenantsRouter = new Hono();

tenantsRouter.get("/", async (c) => {
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

tenantsRouter.get("/:id", async (c) => {
  return c.json({ data: null });
});

tenantsRouter.post("/", zValidator("json", createTenantSchema), async (c) => {
  const data = c.req.valid("json");
  return c.json({ data, message: "Tenant created" }, 201);
});

tenantsRouter.patch(
  "/:id",
  zValidator("json", createTenantSchema.partial()),
  async (c) => {
    const data = c.req.valid("json");
    return c.json({ data, message: "Tenant updated" });
  }
);
