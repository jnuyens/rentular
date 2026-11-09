import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray, isNotNull, like } from "drizzle-orm";
import { getDb, leases, leaseTenants, payments, properties, propertyManagers } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import { ensureExpectedPayments, depositNoteLike, isDepositNote } from "../services/expectedPayments";
import {
  loadMuteState,
  loadPastCommunications,
  loadScheduledCommunications,
} from "../services/leaseCommunications";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import {
  arrearsAmount,
  contractBalance,
  isCreditNote,
  isOddAmountNote,
  loadBalanceData,
  withArrearsMark,
} from "../services/contractBalance";
import { wallClock } from "../services/communicationSchedule";
import { getScheduleTimezone } from "../lib/timezone";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  canAccessDomain,
  hasMinimumRole,
} from "../lib/propertyAccess";
import type { PropertyManagerRole } from "@rentular/shared";
import { computeIndexReferenceMonth } from "@rentular/shared/validation";

const db = getDb();

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
  // Rental deposit / warranty (waarborg). Defaults to 2x monthly rent in the UI.
  deposit: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
  // Indexation setup: original contract rent + reference month + base index.
  baseRent: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
  indexationBaseMonth: z.string().optional(),
  indexationBaseIndex: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
  lastIndexationDate: z.string().optional().nullable(),
  bankAccountId: z.string().optional().default(""),
  status: z.enum(["active", "draft", "terminated", "expired"]).optional().default("active"),
  indexationEnabled: z.boolean().optional().default(true),
  landlordLateNotify: z.boolean().optional().default(true),
  priorPaymentsSettled: z.boolean().optional().default(true),
  paymentDay: z.number().int().min(1).max(28).optional().default(1),
});

export const leasesRouter = new Hono();

// List all leases for accessible properties (filtered by role)
leasesRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);
  if (accessibleIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });

  // Filter out properties where user is accountant (accountant blocked from leases per D-05)
  const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
    .from(propertyManagers)
    .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
  const allowedIds = roles.filter(r => canAccessDomain(r.role as PropertyManagerRole, "leases")).map(r => r.propertyId);
  if (allowedIds.length === 0) return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });

  const result = await db.select().from(leases)
    .where(inArray(leases.propertyId, allowedIds));
  // For each lease, fetch tenant IDs from junction table
  const data = await Promise.all(result.map(async (lease) => {
    const tenantRows = await db.select().from(leaseTenants)
      .where(eq(leaseTenants.leaseId, lease.id));
    return { ...lease, tenantIds: tenantRows.map(t => t.tenantId) };
  }));
  return c.json({ data, meta: { total: data.length, page: 1, perPage: 100 } });
});

// Get a single lease
leasesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const result = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!result[0]) return c.json({ data: null });

  // Check property access
  const role = await getUserPropertyRole(userId, result[0].propertyId);
  if (!role) return c.json({ data: null });
  if (!canAccessDomain(role, "leases")) return c.json({ error: "Insufficient permissions" }, 403);

  const tenantRows = await db.select().from(leaseTenants)
    .where(eq(leaseTenants.leaseId, id));
  return c.json({ data: { ...result[0], tenantIds: tenantRows.map(t => t.tenantId) } });
});

// Every message sent for a contract (tenant messages and, flagged apart, the
// notices to the landlord), newest first, plus what is scheduled to go out.
// Message bodies hold tenant data, so manager rights or more are required.
leasesRouter.get("/:id/communications", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const lease = await db
    .select({ propertyId: leases.propertyId })
    .from(leases)
    .where(eq(leases.id, id))
    .limit(1);
  if (!lease[0]) return c.json({ error: "Lease not found" }, 404);
  const role = await getUserPropertyRole(userId, lease[0].propertyId);
  if (!role) return c.json({ error: "Lease not found" }, 404);
  if (!hasMinimumRole(role, "manager")) return c.json({ error: "Insufficient permissions" }, 403);

  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 100));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  try {
    const past = await loadPastCommunications(db, id, { limit, offset });
    let scheduled: Awaited<ReturnType<typeof loadScheduledCommunications>> = [];
    try {
      scheduled = await loadScheduledCommunications(db, id);
    } catch (err) {
      console.error("[Leases] scheduled communications failed:", err);
    }
    let muteState: Awaited<ReturnType<typeof loadMuteState>> = null;
    try {
      muteState = await loadMuteState(db, id);
    } catch (err) {
      console.error("[Leases] reminder mute state failed:", err);
    }
    const prop = await db
      .select({ name: properties.name })
      .from(properties)
      .where(eq(properties.id, lease[0].propertyId))
      .limit(1);
    const rec = await getLeaseEmailRecipients(id);
    const tenantName = rec.primary ? `${rec.primary.firstName} ${rec.primary.lastName}`.trim() : "";
    return c.json({
      data: {
        lease: { id, propertyName: prop[0]?.name ?? "", tenantName },
        past: past.items,
        scheduled,
        mute: muteState?.mute ?? null,
        nextDueDate: muteState?.nextDueDate ?? null,
        total: past.total,
        lastSevenDays: past.lastSevenDays,
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error("[Leases] communications history failed:", err);
    return c.json({ error: "Could not load the communication history" }, 500);
  }
});

// Create a lease
leasesRouter.post("/",zValidator("json", createLeaseSchema), async (c) => {
  const data = c.req.valid("json");
  const userId = getRequiredUserId(c);

  // Check manager+ role on the target property
  const role = await getUserPropertyRole(userId, data.propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Look up the property's actual owner to set ownerId correctly
  const [property] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, data.propertyId));
  if (!property) return c.json({ error: "Property not found" }, 404);
  const ownerId = property.ownerId;

  const id = crypto.randomUUID();
  const leaseType = data.leaseType || data.type || "residential_long";

  await db.insert(leases).values({
    id,
    ownerId,
    propertyId: data.propertyId,
    type: leaseType,
    region: data.region,
    status: data.status || "active",
    signingDate: data.signingDate,
    startDate: data.startDate,
    endDate: data.endDate || null,
    monthlyRent: String(data.monthlyRent),
    monthlyCharges: String(data.monthlyCharges),
    baseRent: data.baseRent !== undefined ? String(data.baseRent) : null,
    indexationBaseMonth:
      data.indexationBaseMonth ||
      computeIndexReferenceMonth(data.region, data.signingDate, data.startDate),
    indexationBaseIndex:
      data.indexationBaseIndex !== undefined ? String(data.indexationBaseIndex) : null,
    lastIndexationDate: data.lastIndexationDate || null,
    deposit: data.deposit !== undefined ? String(data.deposit) : "0.00",
    bankAccountId: data.bankAccountId || null,
    // Student leases are never indexed (see indexation route).
    indexationEnabled: leaseType === "student" ? false : data.indexationEnabled,
    landlordLateNotify: data.landlordLateNotify,
    priorPaymentsSettled: data.priorPaymentsSettled,
    paymentDay: data.paymentDay,
  });

  // Insert tenant associations into junction table
  if (data.tenantIds && data.tenantIds.length > 0) {
    for (const [index, tenantId] of data.tenantIds.entries()) {
      await db.insert(leaseTenants).values({
        leaseId: id,
        tenantId,
        isPrimary: index === 0,
      });
    }
  }

  const [created] = await db.select().from(leases).where(eq(leases.id, id));
  // Generate the expected (pending) rent payments for this contract. Best-effort:
  // never fail the request if generation errors.
  if (created && created.status === "active") {
    try {
      const n = await ensureExpectedPayments(created);
      if (n > 0) console.log(`[Payments] Generated ${n} expected payment(s) for new lease ${id}`);
    } catch (err) {
      console.error("[Payments] Expected-payment generation failed on create:", err);
    }
  }
  return c.json({ data: { ...created, tenantIds: data.tenantIds || [] }, message: "Lease created" }, 201);
});

// Update a lease
leasesRouter.put("/:id", zValidator("json", createLeaseSchema.partial()), async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);

  // Check manager+ role on the lease's property
  const role = await getUserPropertyRole(userId, existing[0].propertyId);
  if (!role || !hasMinimumRole(role, "manager")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const data = c.req.valid("json");
  const leaseType = data.leaseType || data.type;
  const updates: Record<string, any> = {};

  if (data.propertyId !== undefined) updates.propertyId = data.propertyId;
  if (leaseType) updates.type = leaseType;
  if (data.region !== undefined) updates.region = data.region;
  if (data.status !== undefined) updates.status = data.status;
  if (data.signingDate !== undefined) updates.signingDate = data.signingDate;
  if (data.startDate !== undefined) updates.startDate = data.startDate;
  if (data.endDate !== undefined) updates.endDate = data.endDate || null;
  if (data.monthlyRent !== undefined) updates.monthlyRent = String(data.monthlyRent);
  if (data.monthlyCharges !== undefined) updates.monthlyCharges = String(data.monthlyCharges);
  if (data.baseRent !== undefined) updates.baseRent = String(data.baseRent);
  if (data.indexationBaseMonth !== undefined) {
    updates.indexationBaseMonth =
      data.indexationBaseMonth ||
      computeIndexReferenceMonth(
        data.region ?? existing[0].region,
        data.signingDate ?? existing[0].signingDate,
        data.startDate ?? existing[0].startDate,
      );
  }
  if (data.indexationBaseIndex !== undefined) updates.indexationBaseIndex = String(data.indexationBaseIndex);
  if (data.lastIndexationDate !== undefined) updates.lastIndexationDate = data.lastIndexationDate || null;
  if (data.deposit !== undefined) updates.deposit = String(data.deposit);
  if (data.bankAccountId !== undefined) updates.bankAccountId = data.bankAccountId || null;
  if (data.indexationEnabled !== undefined) updates.indexationEnabled = data.indexationEnabled;
  if (data.landlordLateNotify !== undefined) updates.landlordLateNotify = data.landlordLateNotify;
  if (data.priorPaymentsSettled !== undefined) updates.priorPaymentsSettled = data.priorPaymentsSettled;
  if (data.paymentDay !== undefined) updates.paymentDay = data.paymentDay;

  // Student leases are never indexed, whatever the request asked for.
  const effectiveType = leaseType || existing[0].type;
  if (effectiveType === "student") updates.indexationEnabled = false;

  if (Object.keys(updates).length > 0) {
    await db.update(leases).set(updates)
      .where(eq(leases.id, id));
  }

  // Earlier payments now confirmed as settled on an older contract: close the
  // still-pending auto-generated deposit, dated at the contract start. The
  // reverse (true -> false) leaves payments alone; the landlord can edit the
  // deposit payment by hand.
  if (data.priorPaymentsSettled === true && existing[0].priorPaymentsSettled === false) {
    const startDay = String(data.startDate ?? existing[0].startDate ?? "").slice(0, 10);
    const created = existing[0].createdAt ? new Date(existing[0].createdAt) : new Date();
    const createdDay = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
    if (startDay && startDay < createdDay) {
      await db.update(payments)
        .set({ status: "paid", paidDate: startDay, updatedAt: new Date() })
        .where(
          and(
            eq(payments.leaseId, id),
            like(payments.notes, depositNoteLike),
            eq(payments.status, "pending"),
          ),
        );
    }
  }

  // Update tenant associations if provided
  if (data.tenantIds !== undefined) {
    await db.delete(leaseTenants).where(eq(leaseTenants.leaseId, id));
    for (const [index, tenantId] of data.tenantIds.entries()) {
      await db.insert(leaseTenants).values({
        leaseId: id,
        tenantId,
        isPrimary: index === 0,
      });
    }
  }

  const [updated] = await db.select().from(leases).where(eq(leases.id, id));
  // Keep the expected-payment schedule in sync. resetFuture re-creates the
  // not-yet-due auto-generated rows so a changed payment day is reflected.
  if (updated && updated.status === "active") {
    try {
      await ensureExpectedPayments(updated, { resetFuture: true });
    } catch (err) {
      console.error("[Payments] Expected-payment generation failed on update:", err);
    }
  }
  const tenantRows = await db.select().from(leaseTenants)
    .where(eq(leaseTenants.leaseId, id));
  return c.json({ data: { ...updated, tenantIds: tenantRows.map(t => t.tenantId) }, message: "Lease updated" });
});

// Delete a lease
leasesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const existing = await db.select().from(leases)
    .where(eq(leases.id, id));
  if (!existing[0]) return c.json({ error: "Lease not found" }, 404);

  // Check co_owner+ role on the lease's property
  const role = await getUserPropertyRole(userId, existing[0].propertyId);
  if (!role || !hasMinimumRole(role, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Delete tenant associations first (foreign key)
  await db.delete(leaseTenants).where(eq(leaseTenants.leaseId, id));
  await db.delete(leases).where(eq(leases.id, id));
  return c.json({ message: "Lease deleted" });
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

// The contract balance: rent due so far against everything received, with
// the paid rent rows so the landlord can mark money that paid older arrears.
leasesRouter.get("/:id/balance", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const lease = await db
    .select({
      id: leases.id,
      propertyId: leases.propertyId,
      monthlyRent: leases.monthlyRent,
      monthlyCharges: leases.monthlyCharges,
      paymentDay: leases.paymentDay,
      startDate: leases.startDate,
      endDate: leases.endDate,
    })
    .from(leases)
    .where(eq(leases.id, id))
    .limit(1);
  if (!lease[0]) return c.json({ error: "Lease not found" }, 404);
  const role = await getUserPropertyRole(userId, lease[0].propertyId);
  if (!role) return c.json({ error: "Lease not found" }, 404);
  try {
    const data = await loadBalanceData(db, lease[0]);
    if (!data) return c.json({ error: "Lease not found" }, 404);
    const today = wallClock(new Date(), getScheduleTimezone()).ymd;
    const b = contractBalance({ ...data, today });
    const paidRows = data.rows
      .filter((r) => r.status === "paid" && !r.isIgnored && !isDepositNote(r.notes))
      .map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        dueDate: String(r.dueDate).slice(0, 10),
        paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : null,
        arrears: arrearsAmount(r.notes),
        oddAmount: isOddAmountNote(r.notes),
        credit: isCreditNote(r.notes),
      }))
      .sort((a, b2) => (a.paidDate ?? a.dueDate) < (b2.paidDate ?? b2.dueDate) ? 1 : -1);
    return c.json({
      data: {
        leaseId: id,
        today,
        owed: b.owed,
        credit: b.credit,
        expected: b.expected,
        received: b.received,
        arrearsRepaid: b.arrearsRepaid,
        fromMonth: b.fromMonth,
        canEdit: hasMinimumRole(role, "manager"),
        paidRows,
      },
    });
  } catch (err) {
    console.error("[Leases] contract balance failed:", err);
    return c.json({ error: "Could not compute the contract balance" }, 500);
  }
});

// Mark (part of) a paid rent row as paying off older arrears: rent from before
// the contract was tracked here, or otherwise missing from the history. That
// money then no longer counts as credit for later months. Amount 0 unmarks.
leasesRouter.post(
  "/:id/payments/:paymentId/arrears",
  zValidator("json", z.object({ amount: z.number().min(0) })),
  async (c) => {
    const id = c.req.param("id");
    const paymentId = c.req.param("paymentId");
    const userId = getRequiredUserId(c);
    const { amount } = c.req.valid("json");
    const lease = await db
      .select({ propertyId: leases.propertyId })
      .from(leases)
      .where(eq(leases.id, id))
      .limit(1);
    if (!lease[0]) return c.json({ error: "Lease not found" }, 404);
    const role = await getUserPropertyRole(userId, lease[0].propertyId);
    if (!role) return c.json({ error: "Lease not found" }, 404);
    if (!hasMinimumRole(role, "manager")) return c.json({ error: "Insufficient permissions" }, 403);

    const row = (
      await db
        .select({
          id: payments.id,
          status: payments.status,
          amount: payments.amount,
          notes: payments.notes,
          isIgnored: payments.isIgnored,
        })
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.leaseId, id)))
        .limit(1)
    )[0];
    if (!row) return c.json({ error: "Payment not found" }, 404);
    if (row.status !== "paid" || row.isIgnored || isDepositNote(row.notes)) {
      return c.json({ error: "Only a paid rent payment can be marked" }, 400);
    }
    const cents = Math.round(amount * 100);
    if (cents > Math.round(Number(row.amount) * 100)) {
      return c.json({ error: "The amount is larger than the payment" }, 400);
    }
    const notes = withArrearsMark(row.notes, cents / 100);
    await db
      .update(payments)
      .set({ notes, updatedAt: new Date() })
      .where(eq(payments.id, row.id));
    console.log(
      `[Leases] user ${userId} set arrears repayment on payment ${row.id} (lease ${id}) to ${(cents / 100).toFixed(2)} (was ${arrearsAmount(row.notes).toFixed(2)})`,
    );
    return c.json({ data: { paymentId: row.id, arrears: cents / 100 } });
  },
);

// Get payment history for a lease
leasesRouter.get("/:id/payments", async (c) => {
  const id = c.req.param("id");
  return c.json({ data: [], leaseId: id });
});
