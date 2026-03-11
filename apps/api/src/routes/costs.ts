import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const costsRouter = new Hono();

// List costs with filtering
costsRouter.get("/", async (c) => {
  const propertyId = c.req.query("propertyId");
  const leaseId = c.req.query("leaseId");
  const category = c.req.query("category");
  const from = c.req.query("from");
  const to = c.req.query("to");

  // TODO: Query costs with filters
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

// Get cost details
costsRouter.get("/:id", async (c) => {
  return c.json({ data: null });
});

// Add a cost
costsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      propertyId: z.string().uuid().optional(),
      leaseId: z.string().uuid().optional(),
      category: z.enum([
        "maintenance",
        "repair",
        "insurance",
        "tax",
        "management_fee",
        "utility",
        "legal",
        "renovation",
        "other",
      ]),
      description: z.string().min(1).max(500),
      amount: z.number().positive(),
      date: z.string().date(),
      rechargedToTenant: z.boolean().default(false),
      reference: z.string().max(255).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Insert into costs table
    return c.json({ data, message: "Cost recorded" }, 201);
  }
);

// Update a cost
costsRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      category: z.enum([
        "maintenance", "repair", "insurance", "tax",
        "management_fee", "utility", "legal", "renovation", "other",
      ]).optional(),
      description: z.string().min(1).max(500).optional(),
      amount: z.number().positive().optional(),
      date: z.string().date().optional(),
      rechargedToTenant: z.boolean().optional(),
      reference: z.string().max(255).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    // TODO: Update cost
    return c.json({ data, message: "Cost updated" });
  }
);

// Delete a cost
costsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Delete cost
  return c.json({ message: "Cost deleted" });
});

// Get cost summary (totals by category, by property)
costsRouter.get("/summary/totals", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  // TODO: Aggregate costs
  return c.json({ totalCosts: 0, byCategory: {}, byProperty: {} });
});
