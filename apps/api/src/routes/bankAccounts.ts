import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const bankAccountsRouter = new Hono();

// Belgian IBAN regex: BE + 2 check digits + 12 digits
const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/;

// List bank accounts for the authenticated user
bankAccountsRouter.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true";
  // TODO: Query bankAccounts where ownerId = auth user, optionally filter archived
  return c.json({ data: [] });
});

// Get a single bank account
bankAccountsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Query bankAccount by id, verify ownership
  return c.json({ data: null });
});

// Add a bank account
bankAccountsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      label: z.string().min(1).max(255),
      iban: z.string().regex(ibanRegex, "Invalid IBAN format").transform((v) => v.replace(/\s/g, "").toUpperCase()),
      bic: z.string().max(11).optional(),
      holderName: z.string().min(1).max(255),
      bankName: z.string().max(255).optional(),
      isDefault: z.boolean().default(false),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Insert into bankAccounts
    // If isDefault=true, unset isDefault on all other accounts for this owner
    return c.json({ data, message: "Bank account added" }, 201);
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
    // TODO: Update bankAccount, verify ownership
    // If isDefault=true, unset isDefault on all other accounts for this owner
    return c.json({ data, message: "Bank account updated" });
  }
);

// Archive a bank account (soft delete — cannot delete if used by active leases)
bankAccountsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Check if any active leases use this bank account
  // If yes, return 409 Conflict with message
  // If no, set isArchived = true
  return c.json({ message: "Bank account archived" });
});

// Set a bank account as default
bankAccountsRouter.post("/:id/set-default", async (c) => {
  const id = c.req.param("id");
  // TODO: Unset isDefault on all accounts, set isDefault on this one
  return c.json({ message: "Default bank account updated" });
});
