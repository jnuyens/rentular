import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const createPropertySchema = z.object({
  name: z.string().min(1),
  address: z.object({
    street: z.string(),
    number: z.string(),
    box: z.string().optional(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string().default("BE"),
  }),
  type: z.enum(["apartment", "house", "studio", "commercial", "garage", "other"]),
  cadastralReference: z.string().optional(),
  units: z.number().int().min(1).default(1),
});

export const propertiesRouter = new Hono();

// List all properties
propertiesRouter.get("/", async (c) => {
  // TODO: Fetch from database
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

// Get a single property
propertiesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Fetch from database
  return c.json({ data: null });
});

// Create a property
propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Insert into database
    return c.json({ data, message: "Property created" }, 201);
  }
);

// Update a property
propertiesRouter.patch(
  "/:id",
  zValidator("json", createPropertySchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    // TODO: Update in database
    return c.json({ data, message: "Property updated" });
  }
);

// Delete a property
propertiesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Soft delete in database
  return c.json({ message: "Property deleted" });
});
