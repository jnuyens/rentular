import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";

const createLeaseSchema = z.object({
  propertyId: z.string().min(1),
  tenantIds: z.array(z.string()).optional().default([]),
  // Frontend sends "leaseType", accept both
  leaseType: z.enum([
    "residential_short",
    "residential_long",
    "residential_lifetime",
    "student",
    "commercial",
  ]).optional(),
  type: z.enum([
    "residential_short",
    "residential_long",
    "residential_lifetime",
    "student",
    "commercial",
  ]).optional(),
  region: z.enum(["flanders", "wallonia", "brussels"]),
  signingDate: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().optional().default(""),
  // Accept string or number for rent/charges (FormData sends strings)
  monthlyRent: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  monthlyCharges: z.union([z.number(), z.string()]).optional().default("0").transform((v) => Number(v)),
  bankAccountId: z.string().optional().default(""),
  indexationEnabled: z.boolean().optional().default(true),
  paymentDay: z.number().int().min(1).max(28).optional().default(1),
});

export const leasesRouter = new Hono();

leasesRouter.get("/", async (c) => {
  const result = mem.getAll("leases").filter((l: any) => !l.isArchived);
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});

leasesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  return c.json({ data: mem.getById("leases", id) || null });
});

leasesRouter.post("/", zValidator("json", createLeaseSchema), async (c) => {
  const data = c.req.valid("json");
  const id = crypto.randomUUID();
  const leaseType = data.leaseType || data.type || "residential_long";
  const record = {
    id,
    ownerId: "system",
    propertyId: data.propertyId,
    tenantIds: data.tenantIds,
    type: leaseType,
    region: data.region,
    status: "draft",
    signingDate: data.signingDate,
    startDate: data.startDate,
    endDate: data.endDate || null,
    monthlyRent: String(data.monthlyRent),
    monthlyCharges: String(data.monthlyCharges),
    bankAccountId: data.bankAccountId || null,
    indexationEnabled: data.indexationEnabled,
    paymentDay: data.paymentDay,
    createdAt: new Date().toISOString(),
  };

  mem.insert("leases", record);
  return c.json({ data: record, message: "Lease created" }, 201);
});

// Get upcoming indexations for a lease
leasesRouter.get("/:id/indexation", async (c) => {
  const id = c.req.param("id");
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
