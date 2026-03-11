import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const rentAdjustmentsRouter = new Hono();

// === Rent-free periods ===

// List rent-free periods for a lease
rentAdjustmentsRouter.get("/free-periods", async (c) => {
  const leaseId = c.req.query("leaseId");
  // TODO: Query rentFreePeriods
  return c.json({ data: [] });
});

// Add a rent-free period
rentAdjustmentsRouter.post(
  "/free-periods",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      startDate: z.string().date(),
      endDate: z.string().date(),
      reason: z.string().min(1).max(500),
      waiveCharges: z.boolean().default(false),
      notes: z.string().optional(),
    }).refine(
      (data) => new Date(data.endDate) >= new Date(data.startDate),
      { message: "End date must be on or after start date" }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Insert into rentFreePeriods
    return c.json({ data, message: "Rent-free period added" }, 201);
  }
);

// Update a rent-free period
rentAdjustmentsRouter.patch(
  "/free-periods/:id",
  zValidator(
    "json",
    z.object({
      startDate: z.string().date().optional(),
      endDate: z.string().date().optional(),
      reason: z.string().min(1).max(500).optional(),
      waiveCharges: z.boolean().optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    // TODO: Update rentFreePeriod
    return c.json({ data, message: "Rent-free period updated" });
  }
);

// Delete a rent-free period
rentAdjustmentsRouter.delete("/free-periods/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Delete rentFreePeriod
  return c.json({ message: "Rent-free period deleted" });
});

// === Rent deductions ===

// List rent deductions for a lease
rentAdjustmentsRouter.get("/deductions", async (c) => {
  const leaseId = c.req.query("leaseId");
  const active = c.req.query("active"); // "true" to only show currently active deductions
  // TODO: Query rentDeductions
  return c.json({ data: [] });
});

// Add a rent deduction
rentAdjustmentsRouter.post(
  "/deductions",
  zValidator(
    "json",
    z.object({
      leaseId: z.string().uuid(),
      type: z.enum(["temporary", "permanent"]),
      amount: z.number().positive(),
      startDate: z.string().date(),
      endDate: z.string().date().optional(),
      reason: z.string().min(1).max(500),
      notes: z.string().optional(),
    }).refine(
      (data) => {
        if (data.type === "temporary" && !data.endDate) {
          return false;
        }
        if (data.endDate && new Date(data.endDate) < new Date(data.startDate)) {
          return false;
        }
        return true;
      },
      { message: "Temporary deductions require an end date; end date must be on or after start date" }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Insert into rentDeductions
    return c.json({ data, message: "Rent deduction added" }, 201);
  }
);

// Update a rent deduction
rentAdjustmentsRouter.patch(
  "/deductions/:id",
  zValidator(
    "json",
    z.object({
      amount: z.number().positive().optional(),
      startDate: z.string().date().optional(),
      endDate: z.string().date().nullable().optional(),
      reason: z.string().min(1).max(500).optional(),
      notes: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    // TODO: Update rentDeduction
    return c.json({ data, message: "Rent deduction updated" });
  }
);

// Delete a rent deduction
rentAdjustmentsRouter.delete("/deductions/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Delete rentDeduction
  return c.json({ message: "Rent deduction deleted" });
});
