import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, bankAccounts } from "@rentular/db";

const db = getDb();

export const bankAccountsRouter = new Hono();

// Belgian IBAN regex: BE + 2 check digits + 12 digits
const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/;

const createBankAccountSchema = z.object({
  label: z.string().min(1).max(255),
  iban: z.string().regex(ibanRegex, "Invalid IBAN format").transform((v) => v.replace(/\s/g, "").toUpperCase()),
  bic: z.string().max(11).optional().default(""),
  holderName: z.string().min(1).max(255),
  bankName: z.string().max(255).optional().default(""),
  isDefault: z.boolean().default(false),
});

// List bank accounts for the authenticated user
bankAccountsRouter.get("/", async (c) => {
  const ownerId = c.get("userId");
  if (!ownerId) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const result = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.ownerId, ownerId), eq(bankAccounts.isArchived, false)));
  return c.json({ data: result });
});

// Get a single bank account
bankAccountsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
  return c.json({ data: result[0] || null });
});

// Add a bank account
bankAccountsRouter.post(
  "/",
  zValidator("json", createBankAccountSchema),
  async (c) => {
    const data = c.req.valid("json");
    const ownerId = c.get("userId") || "system";
    const id = crypto.randomUUID();

    // If setting as default, unset others first
    if (data.isDefault) {
      await db.update(bankAccounts).set({ isDefault: false }).where(eq(bankAccounts.ownerId, ownerId));
    }

    await db.insert(bankAccounts).values({
      id,
      ownerId,
      label: data.label,
      iban: data.iban,
      bic: data.bic || null,
      holderName: data.holderName,
      bankName: data.bankName || null,
      isDefault: data.isDefault,
    });

    const record = {
      id,
      ownerId,
      label: data.label,
      iban: data.iban,
      bic: data.bic || null,
      holderName: data.holderName,
      bankName: data.bankName || null,
      isDefault: data.isDefault,
      isArchived: false,
      createdAt: new Date().toISOString(),
    };
    return c.json({ data: record, message: "Bank account added" }, 201);
  }
);

// Update a bank account
bankAccountsRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      label: z.string().min(1).max(255).optional(),
      iban: z.string().regex(ibanRegex, "Invalid IBAN format").transform((v) => v.replace(/\s/g, "").toUpperCase()).optional(),
      bic: z.string().max(11).optional(),
      holderName: z.string().min(1).max(255).optional(),
      bankName: z.string().max(255).optional(),
      isDefault: z.boolean().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const ownerId = c.get("userId");

    // If setting as default, unset others first
    if (data.isDefault && ownerId) {
      await db.update(bankAccounts).set({ isDefault: false }).where(eq(bankAccounts.ownerId, ownerId));
    }

    await db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id));
    return c.json({ data: { id, ...data }, message: "Bank account updated" });
  }
);

// Archive a bank account (soft delete)
bankAccountsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db.update(bankAccounts).set({ isArchived: true }).where(eq(bankAccounts.id, id));
  return c.json({ message: "Bank account archived" });
});

// Set a bank account as default
bankAccountsRouter.post("/:id/set-default", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.get("userId");
  if (ownerId) {
    await db.update(bankAccounts).set({ isDefault: false }).where(eq(bankAccounts.ownerId, ownerId));
    await db.update(bankAccounts).set({ isDefault: true }).where(eq(bankAccounts.id, id));
  }
  return c.json({ message: "Default bank account updated" });
});
