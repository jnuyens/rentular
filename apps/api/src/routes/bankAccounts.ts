import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";

let db: any = null;
let dbSchema: any = null;
let eq: any = null;
let and: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  dbSchema = dbMod.bankAccounts;
  const drizzle = require("drizzle-orm");
  eq = drizzle.eq;
  and = drizzle.and;
} catch {
  console.log("[BankAccounts] Database unavailable, using in-memory store");
}

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
  try {
    if (db && dbSchema && ownerId) {
      const conditions = [eq(dbSchema.ownerId, ownerId), eq(dbSchema.isArchived, false)];
      const result = await db.select().from(dbSchema).where(and(...conditions));
      return c.json({ data: result });
    }
  } catch (err) {
    console.error("[BankAccounts] DB read failed:", err);
  }
  const result = mem.getAll("bankAccounts").filter((b: any) => !b.isArchived && (!ownerId || b.ownerId === ownerId));
  return c.json({ data: result });
});

// Get a single bank account
bankAccountsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      const result = await db.select().from(dbSchema).where(eq(dbSchema.id, id));
      return c.json({ data: result[0] || null });
    }
  } catch {
    // fallback
  }
  return c.json({ data: mem.getById("bankAccounts", id) || null });
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
    if (data.isDefault && db && dbSchema) {
      try {
        await db.update(dbSchema).set({ isDefault: false }).where(eq(dbSchema.ownerId, ownerId));
      } catch {}
    }

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

    try {
      if (db && dbSchema) {
        await db.insert(dbSchema).values({
          id,
          ownerId,
          label: data.label,
          iban: data.iban,
          bic: data.bic || null,
          holderName: data.holderName,
          bankName: data.bankName || null,
          isDefault: data.isDefault,
        });
        return c.json({ data: record, message: "Bank account added" }, 201);
      }
    } catch (err) {
      console.error("[BankAccounts] DB insert failed:", err);
    }

    mem.insert("bankAccounts", record);
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
    if (data.isDefault && db && dbSchema && ownerId) {
      try {
        await db.update(dbSchema).set({ isDefault: false }).where(eq(dbSchema.ownerId, ownerId));
      } catch {}
    }

    try {
      if (db && dbSchema && eq) {
        await db.update(dbSchema).set(data).where(eq(dbSchema.id, id));
      }
    } catch {
      mem.update("bankAccounts", id, data);
    }
    return c.json({ data: { id, ...data }, message: "Bank account updated" });
  }
);

// Archive a bank account (soft delete)
bankAccountsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (db && dbSchema && eq) {
      await db.update(dbSchema).set({ isArchived: true }).where(eq(dbSchema.id, id));
    }
  } catch {
    mem.remove("bankAccounts", id);
  }
  return c.json({ message: "Bank account archived" });
});

// Set a bank account as default
bankAccountsRouter.post("/:id/set-default", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.get("userId");
  try {
    if (db && dbSchema && eq && ownerId) {
      await db.update(dbSchema).set({ isDefault: false }).where(eq(dbSchema.ownerId, ownerId));
      await db.update(dbSchema).set({ isDefault: true }).where(eq(dbSchema.id, id));
    }
  } catch (err) {
    console.error("[BankAccounts] Set default failed:", err);
  }
  return c.json({ message: "Default bank account updated" });
});
