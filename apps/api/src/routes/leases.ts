import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const createLeaseSchema = z.object({
  propertyId: z.string().uuid(),
  tenantIds: z.array(z.string().uuid()).min(1),
  type: z.enum([
    "residential_short",   // 3 years max (Belgium)
    "residential_long",    // 9 years (Belgium standard)
    "residential_lifetime", // lifetime lease
    "student",
    "commercial",
  ]),
  region: z.enum(["flanders", "wallonia", "brussels"]),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  monthlyRent: z.number().positive(),
  monthlyCharges: z.number().min(0).default(0),
  chargesType: z.enum(["fixed", "provision"]).default("fixed"),
  deposit: z.number().min(0).default(0),
  depositAccount: z.string().optional(), // Blocked bank account for deposit
  indexationEnabled: z.boolean().default(true),
  indexationBaseMonth: z.string().optional(), // Month used as base for health index
  indexationBaseIndex: z.number().optional(), // Base health index value
  paymentDay: z.number().int().min(1).max(28).default(1),
  gocardlessMandateId: z.string().optional(),
  // Late payment administrative fee (per contract)
  latePaymentFeeEnabled: z.boolean().default(false),
  latePaymentFeeAmount: z.number().min(0).default(15.0),
  latePaymentFeeEnforcement: z.enum(["soft", "strict"]).default("soft"),
});

export const leasesRouter = new Hono();

leasesRouter.get("/", async (c) => {
  return c.json({ data: [], meta: { total: 0, page: 1, perPage: 20 } });
});

leasesRouter.get("/:id", async (c) => {
  return c.json({ data: null });
});

leasesRouter.post("/", zValidator("json", createLeaseSchema), async (c) => {
  const data = c.req.valid("json");
  return c.json({ data, message: "Lease created" }, 201);
});

// Get upcoming indexations for a lease
leasesRouter.get("/:id/indexation", async (c) => {
  const id = c.req.param("id");
  // TODO: Calculate next indexation based on health index
  return c.json({
    leaseId: id,
    currentRent: 0,
    indexedRent: 0,
    indexationDate: null,
    baseIndex: 0,
    currentIndex: 0,
    formula: "newRent = baseRent * (currentIndex / baseIndex)",
  });
});

// Get payment history for a lease
leasesRouter.get("/:id/payments", async (c) => {
  const id = c.req.param("id");
  return c.json({ data: [], leaseId: id });
});
