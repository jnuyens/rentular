import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, bankAccounts } from "@rentular/db";

const db = getDb();

export const bankAccountsRouter = new Hono();

// IBAN format regex
const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/;

// IBAN mod-97 check (ISO 13616)
function isValidIbanMod97(iban: string): boolean {
  // Move first 4 chars to end, convert letters to digits (A=10, B=11, ...)
  const rearranged = iban.substring(4) + iban.substring(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  // Mod 97 on the large number (process in chunks to avoid BigInt)
  let remainder = 0;
  for (let i = 0; i < digits.length; i++) {
    remainder = (remainder * 10 + parseInt(digits[i], 10)) % 97;
  }
  return remainder === 1;
}

const ibanSchema = z.string()
  .transform((v) => v.replace(/\s/g, "").toUpperCase())
  .pipe(z.string().regex(ibanRegex, "Invalid IBAN format"))
  .refine(isValidIbanMod97, "Invalid IBAN check digits (mod-97 verification failed)");

const createBankAccountSchema = z.object({
  label: z.string().min(1).max(255),
  iban: ibanSchema,
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
      iban: ibanSchema.optional(),
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
