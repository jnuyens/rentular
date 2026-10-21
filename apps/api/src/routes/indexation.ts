import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, gte, lte, inArray, isNotNull } from "drizzle-orm";
import {
  getDb,
  healthIndexValues,
  indexationRecords,
  leases,
  leaseTenants,
  properties,
  propertyManagers,
  tenants,
  users,
} from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getAccessiblePropertyIds,
  getUserPropertyRole,
  canAccessDomain,
  hasMinimumRole,
} from "../lib/propertyAccess";
import type { PropertyManagerRole } from "@rentular/shared";
import {
  getLatestHealthIndex,
  isHealthIndexStale,
  findClosestHealthIndexMonth,
} from "../services/healthIndex";
import { computeIndexationCore } from "../services/indexationCalc";
import {
  generateDefaultIndexationEmail,
  buildIndexationTemplateVars,
  type IndexationEmailParams,
} from "../services/indexationEmail";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import { formatCountry } from "../lib/belgianFormat";
import { queueEmail } from "../jobs/emailQueueWorker";
import { renderTemplate } from "../lib/email";

export const indexationRouter = new Hono();

// =====================================================================
// Shared calculation helper to avoid duplication across calculate/preview/apply
// =====================================================================

interface CalculationResult {
  lease: {
    id: string;
    ownerId: string;
    propertyId: string;
    type: string;
    region: string;
    startDate: string;
    signingDate: string | null;
    paymentMethod: string | null;
    baseRent: string | null;
    monthlyRent: string;
    indexationBaseMonth: string | null;
    indexationBaseIndex: string | null;
    currentMonthlyRent: string | null;
    lastIndexationDate: string | null;
    status: string;
  };
  property: {
    id: string;
    name: string;
    epcLabel: string | null;
    street: string;
    streetNumber: string;
    box: string | null;
    postalCode: string;
    city: string;
    country: string;
  };
  baseRent: number;
  baseIndex: number;
  currentIndex: number;
  currentIndexMonth: string;
  currentIndexValue: string;
  unrestrictedNewRent: number;
  newRent: number;
  epcIndexationFactor: number;
  epcRestricted: boolean;
  correctionApplied: boolean;
  correctionMonth: number | null;
  formulaNote: string | undefined;
  effectiveDate: string;
  // Legal anniversary date of this indexation.
  indexationDate: string;
  // Rent due dates the landlord may pick as the start of the new rent, default first.
  effectiveDateOptions: string[];
  latestIndex: number;
  latestIndexMonth: string;
  newRentAtLatest: number;
  canApply: boolean;
  applicableFrom: string;
  nextAnniversary: string;
}

/**
 * Use the start date the landlord picked, if any. Only the due dates offered
 * by computeIndexationCore are accepted, so a client cannot backdate further
 * than Belgian law allows.
 */
function withChosenEffectiveDate(
  calc: CalculationResult,
  requested: string | undefined
): CalculationResult {
  if (requested === undefined) return calc;
  if (!calc.effectiveDateOptions.includes(requested)) {
    throw {
      status: 400,
      message: `effectiveDate must be one of the offered rent due dates: ${calc.effectiveDateOptions.join(", ")}`,
    };
  }
  return { ...calc, effectiveDate: requested };
}

const effectiveDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be YYYY-MM-DD")
  .optional();

/**
 * Shared internal helper that fetches the lease, property, and health indices,
 * computes unrestricted and EPC-restricted new rents, and returns all results.
 * Throws with descriptive messages on error.
 */
async function calculateLeaseIndexation(
  leaseId: string,
  userId: string
): Promise<CalculationResult> {
  const db = getDb();

  // Fetch lease and verify access via property role
  const leaseRows = await db
    .select()
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);

  if (leaseRows.length === 0) {
    throw { status: 404, message: "Lease not found" };
  }

  // Check property access -- accountant blocked from indexation (D-05)
  const role = await getUserPropertyRole(userId, leaseRows[0]!.propertyId);
  if (!role) {
    throw { status: 404, message: "Lease not found" };
  }
  if (!canAccessDomain(role, "indexation")) {
    throw { status: 403, message: "Insufficient permissions" };
  }

  const lease = leaseRows[0]!;

  // Student leases are excluded from indexation (typically 12-month terms whose
  // only anniversary falls at/after the contract end).
  if (lease.type === "student") {
    throw { status: 400, message: "Indexation does not apply to student leases" };
  }

  if (!lease.indexationEnabled) {
    throw { status: 400, message: "Indexation is not enabled for this lease" };
  }

  // Fetch property for EPC data
  const propertyRows = await db
    .select({
      id: properties.id,
      name: properties.name,
      epcLabel: properties.epcLabel,
      street: properties.street,
      streetNumber: properties.streetNumber,
      box: properties.box,
      postalCode: properties.postalCode,
      city: properties.city,
      country: properties.country,
    })
    .from(properties)
    .where(eq(properties.id, lease.propertyId))
    .limit(1);

  if (propertyRows.length === 0) {
    throw { status: 404, message: "Property not found for this lease" };
  }

  const property = propertyRows[0]!;

  // Parse base month (YYYY-MM) to get base year and base month
  if (!lease.indexationBaseMonth) {
    throw {
      status: 400,
      message: "Lease has no indexation base month configured",
    };
  }

  const [baseYear, baseMonth] = lease.indexationBaseMonth.split("-");
  if (!baseYear || !baseMonth) {
    throw {
      status: 400,
      message: `Invalid indexation base month format: ${lease.indexationBaseMonth}`,
    };
  }

  // Get the base index: use the stored indexationBaseIndex from the lease (D-06)
  if (!lease.indexationBaseIndex) {
    throw {
      status: 400,
      message: "Lease has no base index configured",
    };
  }
  const baseIndex = Number(lease.indexationBaseIndex);

  // The indexation base is the original contract rent. Fall back to monthlyRent
  // for legacy leases created before the baseRent field existed.
  const baseRent = Number(lease.baseRent ?? lease.monthlyRent);

  const core = await computeIndexationCore({
    baseRent,
    baseIndex,
    region: lease.region,
    startDate: lease.startDate,
    epcLabel: property.epcLabel,
    leaseType: lease.type,
    lastIndexationDate: lease.lastIndexationDate,
    paymentDay: lease.paymentDay,
  });
  const {
    currentIndex,
    currentIndexMonth,
    unrestrictedNewRent,
    newRent,
    epcIndexationFactor,
    epcRestricted,
    correctionApplied,
    correctionMonth,
    formulaNote,
    effectiveDate: effectiveDateStr,
    indexationDate,
    effectiveDateOptions,
    latestIndex,
    latestIndexMonth,
    newRentAtLatest,
    canApply,
    applicableFrom,
    nextAnniversary,
  } = core;
  const currentIndexValue = String(currentIndex);

  return {
    lease: {
      id: lease.id,
      ownerId: lease.ownerId,
      propertyId: lease.propertyId,
      type: lease.type,
      region: lease.region,
      startDate: lease.startDate,
      signingDate: lease.signingDate || null,
      paymentMethod: lease.paymentMethod || null,
      baseRent: lease.baseRent ?? null,
      monthlyRent: lease.monthlyRent,
      indexationBaseMonth: lease.indexationBaseMonth,
      indexationBaseIndex: lease.indexationBaseIndex,
      currentMonthlyRent: lease.currentMonthlyRent,
      lastIndexationDate: lease.lastIndexationDate,
      status: lease.status,
    },
    property,
    baseRent,
    baseIndex,
    currentIndex,
    currentIndexMonth,
    currentIndexValue,
    unrestrictedNewRent,
    newRent,
    epcIndexationFactor,
    epcRestricted,
    correctionApplied,
    correctionMonth,
    formulaNote,
    effectiveDate: effectiveDateStr,
    indexationDate,
    effectiveDateOptions,
    latestIndex,
    latestIndexMonth,
    newRentAtLatest,
    canApply,
    applicableFrom,
    nextAnniversary,
  };
}

/**
 * Map a calculation, the addressed tenant and the owner onto the parameters
 * of the indexation letter.
 */
function buildIndexationEmailParams(input: {
  calc: CalculationResult;
  tenantLanguage: string;
  tenantName: string;
  calculatedNewRent: number;
  finalNewRent: number;
  owner: { name: string | null; email: string | null; whatsappNumber: string | null };
}): IndexationEmailParams {
  const { calc, owner } = input;
  const p = calc.property;
  const propertyAddress = `${p.street} ${p.streetNumber}${p.box ? " " + p.box : ""}, ${p.postalCode} ${p.city}, ${formatCountry(p.country, input.tenantLanguage)}`;
  return {
    tenantLanguage: input.tenantLanguage,
    region: calc.lease.region,
    tenantName: input.tenantName,
    propertyName: p.name,
    propertyAddress,
    signingDate: calc.lease.signingDate || null,
    startDate: calc.lease.startDate,
    baseRent: calc.baseRent,
    baseIndex: calc.baseIndex,
    // calculateLeaseIndexation rejects leases without a base month.
    baseIndexMonth: calc.lease.indexationBaseMonth!,
    currentIndex: calc.currentIndex,
    currentIndexMonth: calc.currentIndexMonth,
    unrestrictedNewRent: calc.unrestrictedNewRent,
    calculatedNewRent: input.calculatedNewRent,
    appliedNewRent: input.finalNewRent,
    effectiveDate: calc.effectiveDate,
    epcLabel: p.epcLabel,
    epcRestricted: calc.epcRestricted,
    correctionApplied: calc.correctionApplied,
    correctionMonth: calc.correctionMonth,
    epcIndexationFactor: calc.epcIndexationFactor,
    paymentMethod: calc.lease.paymentMethod,
    ownerName: owner.name || owner.email || "Your landlord",
    ownerEmail: owner.email,
    // users has no separate phone column; the WhatsApp number is the only one stored.
    ownerPhone: owner.whatsappNumber,
  };
}

// =====================================================================
// Endpoint 1: GET /health-index -- current Belgian health index
// =====================================================================

indexationRouter.get("/health-index", async (c) => {
  try {
    const latest = await getLatestHealthIndex();
    const stale = await isHealthIndexStale();

    if (!latest) {
      return c.json({
        currentIndex: 0,
        month: "",
        year: "",
        source: "Statbel",
        lastUpdated: null,
        isStale: true,
      });
    }

    return c.json({
      currentIndex: Number(latest.value),
      month: latest.month,
      year: latest.year,
      source: "Statbel",
      lastUpdated: latest.fetchedAt,
      isStale: stale,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Failed to get health index:", message);
    return c.json({ error: "Failed to retrieve health index" }, 500);
  }
});

// =====================================================================
// Endpoint 2: GET /health-index/history -- historical health index data
// =====================================================================

indexationRouter.get("/health-index/history", async (c) => {
  try {
    const from = c.req.query("from"); // YYYY-MM format
    const to = c.req.query("to"); // YYYY-MM format

    const db = getDb();

    // Build query conditions
    const conditions = [];
    if (from) {
      const [fromYear, fromMonth] = from.split("-");
      if (fromYear && fromMonth) {
        conditions.push(gte(healthIndexValues.year, fromYear));
      }
    }
    if (to) {
      const [toYear, toMonth] = to.split("-");
      if (toYear && toMonth) {
        conditions.push(lte(healthIndexValues.year, toYear));
      }
    }

    const rows = await db
      .select({
        year: healthIndexValues.year,
        month: healthIndexValues.month,
        value: healthIndexValues.value,
        fetchedAt: healthIndexValues.fetchedAt,
      })
      .from(healthIndexValues)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(healthIndexValues.year), desc(healthIndexValues.month));

    // Filter more precisely by month if both from and to are provided
    let filtered = rows;
    if (from) {
      const [fromYear, fromMonth] = from.split("-");
      if (fromYear && fromMonth) {
        filtered = filtered.filter((r) => {
          if (r.year > fromYear!) return true;
          if (r.year === fromYear) return r.month >= fromMonth!;
          return false;
        });
      }
    }
    if (to) {
      const [toYear, toMonth] = to.split("-");
      if (toYear && toMonth) {
        filtered = filtered.filter((r) => {
          if (r.year < toYear!) return true;
          if (r.year === toYear) return r.month <= toMonth!;
          return false;
        });
      }
    }

    return c.json({
      data: filtered.map((r) => ({
        year: r.year,
        month: r.month,
        value: Number(r.value),
        fetchedAt: r.fetchedAt,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Failed to get health index history:", message);
    return c.json({ error: "Failed to retrieve health index history" }, 500);
  }
});

// =====================================================================
// Endpoint 3: GET /calculate/:leaseId -- calculate indexed rent
// =====================================================================

indexationRouter.get("/calculate/:leaseId", async (c) => {
  try {
    const leaseId = c.req.param("leaseId");
    const userId = getRequiredUserId(c);

    const calc = await calculateLeaseIndexation(leaseId, userId);

    return c.json({
      leaseId: calc.lease.id,
      baseRent: calc.baseRent,
      baseIndex: calc.baseIndex,
      currentIndex: calc.currentIndex,
      newRent: calc.newRent,
      unrestrictedNewRent: calc.unrestrictedNewRent,
      difference: Number((calc.newRent - calc.baseRent).toFixed(2)),
      effectiveDate: calc.effectiveDate,
      indexationDate: calc.indexationDate,
      effectiveDateOptions: calc.effectiveDateOptions,
      region: calc.lease.region,
      epcLabel: calc.property.epcLabel,
      epcIndexationFactor: calc.epcIndexationFactor,
      epcRestricted: calc.epcRestricted,
      correctionApplied: calc.correctionApplied,
      correctionMonth: calc.correctionMonth,
      latestIndex: calc.latestIndex,
      latestIndexMonth: calc.latestIndexMonth,
      newRentAtLatest: calc.newRentAtLatest,
      canApply: calc.canApply,
      applicableFrom: calc.applicableFrom,
      nextAnniversary: calc.nextAnniversary,
      formula: "newRent = baseRent * (currentIndex / baseIndex)",
      formulaNote: calc.formulaNote,
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const e = error as { status: number; message: string };
      return c.json({ error: e.message }, e.status as 400 | 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Calculate error:", message);
    return c.json({ error: "Failed to calculate indexation" }, 500);
  }
});

// =====================================================================
// Endpoint 3b: GET /preview -- stateless indexation preview (unsaved lease)
// Lets the contract form show the possible rent live from the form inputs,
// without needing the lease to be saved first.
// =====================================================================

indexationRouter.get("/preview", async (c) => {
  try {
    getRequiredUserId(c);

    const baseRent = Number(c.req.query("baseRent"));
    const baseIndex = Number(c.req.query("baseIndex"));
    const region = c.req.query("region") || "";
    const startDate = c.req.query("startDate") || "";
    const epcLabel = c.req.query("epcLabel") || null;
    const leaseType = c.req.query("leaseType") || "residential_long";
    const currentRent = Number(c.req.query("currentRent"));
    const lastIndexationDate = c.req.query("lastIndexationDate") || null;

    if (!baseRent || !baseIndex || !startDate) {
      return c.json(
        { error: "baseRent, baseIndex and startDate are required" },
        400
      );
    }

    const core = await computeIndexationCore({
      baseRent,
      baseIndex,
      region,
      startDate,
      epcLabel,
      leaseType,
      lastIndexationDate,
      paymentDay: Number(c.req.query("paymentDay")) || 1,
    });

    // Estimate when the rent was last indexed by back-solving the health index
    // the current rent reflects: currentRent = baseRent * (impliedIndex / baseIndex).
    // The closest historical month to that index approximates the last indexation,
    // which tells us whether more than a year has passed (indexation available again).
    let estimatedLastIndexMonth: string | null = null;
    let impliedIndex: number | null = null;
    let monthsSinceEstimated: number | null = null;
    let yearPassed: boolean | null = null;
    if (Number.isFinite(currentRent) && currentRent > 0 && baseRent > 0) {
      impliedIndex = Number(((currentRent * baseIndex) / baseRent).toFixed(2));
      const closest = await findClosestHealthIndexMonth(impliedIndex);
      if (closest) {
        estimatedLastIndexMonth = `${closest.year}-${closest.month}`;
        const [curY, curM] = core.currentIndexMonth.split("-").map(Number);
        const estKey = Number(closest.year) * 12 + Number(closest.month);
        const curKey = (curY ?? 0) * 12 + (curM ?? 0);
        monthsSinceEstimated = curKey - estKey;
        // A full annual cycle has elapsed if the current reference month is at
        // least 12 months after the month the current rent reflects.
        yearPassed = monthsSinceEstimated >= 12;
      }
    }

    return c.json({
      baseRent,
      baseIndex,
      currentIndex: core.currentIndex,
      currentIndexMonth: core.currentIndexMonth,
      unrestrictedNewRent: core.unrestrictedNewRent,
      newRent: core.newRent,
      difference: Number((core.newRent - baseRent).toFixed(2)),
      effectiveDate: core.effectiveDate,
      indexationDate: core.indexationDate,
      effectiveDateOptions: core.effectiveDateOptions,
      region,
      epcLabel,
      epcRestricted: core.epcRestricted,
      epcIndexationFactor: core.epcIndexationFactor,
      correctionApplied: core.correctionApplied,
      correctionMonth: core.correctionMonth,
      formulaNote: core.formulaNote,
      currentRent:
        Number.isFinite(currentRent) && currentRent > 0 ? currentRent : null,
      differenceVsCurrent:
        Number.isFinite(currentRent) && currentRent > 0
          ? Number((core.newRent - currentRent).toFixed(2))
          : null,
      latestIndex: core.latestIndex,
      latestIndexMonth: core.latestIndexMonth,
      newRentAtLatest: core.newRentAtLatest,
      differenceAtLatest:
        Number.isFinite(currentRent) && currentRent > 0
          ? Number((core.newRentAtLatest - currentRent).toFixed(2))
          : null,
      canApply: core.canApply,
      applicableFrom: core.applicableFrom,
      nextAnniversary: core.nextAnniversary,
      impliedIndex,
      estimatedLastIndexMonth,
      monthsSinceEstimated,
      yearPassed,
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const e = error as { status: number; message: string };
      return c.json({ error: e.message }, e.status as 400 | 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Preview error:", message);
    return c.json({ error: "Failed to preview indexation" }, 500);
  }
});

// =====================================================================
// Endpoint 3c: GET /raise-summary -- per-lease indexation raise amounts,
// for showing a "raise" column in the indexation list.
// =====================================================================

indexationRouter.get("/raise-summary", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const db = getDb();

    const accessibleIds = await getAccessiblePropertyIds(userId);
    if (accessibleIds.length === 0) return c.json({ data: [] });

    const roles = await db
      .select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.userId, userId),
          isNotNull(propertyManagers.acceptedAt),
          inArray(propertyManagers.propertyId, accessibleIds)
        )
      );
    const allowedIds = roles
      .filter((r) => canAccessDomain(r.role as PropertyManagerRole, "indexation"))
      .map((r) => r.propertyId);
    if (allowedIds.length === 0) return c.json({ data: [] });

    const activeLeases = await db
      .select()
      .from(leases)
      .where(
        and(
          inArray(leases.propertyId, allowedIds),
          eq(leases.indexationEnabled, true),
          eq(leases.status, "active")
        )
      );

    const propRows = await db
      .select({ id: properties.id, epcLabel: properties.epcLabel })
      .from(properties)
      .where(inArray(properties.id, allowedIds));
    const epcById = new Map(propRows.map((p) => [p.id, p.epcLabel]));

    const data: Array<{
      leaseId: string;
      canApply: boolean;
      raiseAmount: number;
      newRent: number;
    }> = [];

    for (const lease of activeLeases) {
      if (lease.type === "student") continue;
      if (!lease.indexationBaseIndex) continue; // not set up for indexation yet
      try {
        const baseIndex = Number(lease.indexationBaseIndex);
        const baseRent = Number(lease.baseRent ?? lease.monthlyRent);
        const core = await computeIndexationCore({
          baseRent,
          baseIndex,
          region: lease.region,
          startDate: lease.startDate,
          epcLabel: epcById.get(lease.propertyId) ?? null,
          leaseType: lease.type,
          lastIndexationDate: lease.lastIndexationDate,
          paymentDay: lease.paymentDay,
        });
        const currentRent = Number(lease.monthlyRent);
        const shownRent = core.canApply ? core.newRent : core.newRentAtLatest;
        data.push({
          leaseId: lease.id,
          canApply: core.canApply,
          raiseAmount: Number((shownRent - currentRent).toFixed(2)),
          newRent: shownRent,
        });
      } catch {
        // Skip leases that can't be computed (e.g. missing index data).
      }
    }

    return c.json({ data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Raise-summary error:", message);
    return c.json({ error: "Failed to build raise summary" }, 500);
  }
});

// =====================================================================
// Endpoint 4: GET /upcoming -- bulk upcoming indexations
// =====================================================================

indexationRouter.get("/upcoming", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const days = Number(c.req.query("days")) || 30;
    const db = getDb();

    // Get accessible properties, filtering out accountant (blocked from indexation per D-05)
    const accessibleIds = await getAccessiblePropertyIds(userId);
    if (accessibleIds.length === 0) return c.json({ data: [], period: `next ${days} days` });

    const roles = await db.select({ propertyId: propertyManagers.propertyId, role: propertyManagers.role })
      .from(propertyManagers)
      .where(and(eq(propertyManagers.userId, userId), isNotNull(propertyManagers.acceptedAt), inArray(propertyManagers.propertyId, accessibleIds)));
    const allowedIds = roles.filter(r => canAccessDomain(r.role as PropertyManagerRole, "indexation")).map(r => r.propertyId);
    if (allowedIds.length === 0) return c.json({ data: [], period: `next ${days} days` });

    // Query active leases with indexation enabled for accessible properties
    const activeLeases = await db
      .select()
      .from(leases)
      .where(
        and(
          inArray(leases.propertyId, allowedIds),
          eq(leases.indexationEnabled, true),
          eq(leases.status, "active")
        )
      );

    const today = new Date();
    const cutoff = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    const upcoming: Array<{
      leaseId: string;
      propertyName: string;
      tenantName: string;
      currentRent: string;
      estimatedNewRent: number;
      anniversaryDate: string;
      region: string;
      epcRestricted: boolean;
    }> = [];

    for (const lease of activeLeases) {
      // Student leases are excluded from indexation.
      if (lease.type === "student") continue;

      // Calculate next anniversary date
      const startDate = new Date(lease.startDate);
      let anniversaryYear = today.getFullYear();
      let anniversary = new Date(
        anniversaryYear,
        startDate.getMonth(),
        startDate.getDate()
      );

      if (anniversary <= today) {
        anniversaryYear++;
        anniversary = new Date(
          anniversaryYear,
          startDate.getMonth(),
          startDate.getDate()
        );
      }

      // Check if anniversary falls within the requested period
      if (anniversary > cutoff) {
        continue;
      }

      // Fetch property name
      const propRows = await db
        .select({ name: properties.name })
        .from(properties)
        .where(eq(properties.id, lease.propertyId))
        .limit(1);
      const propertyName = propRows[0]?.name || "Unknown property";

      // Fetch primary tenant name
      const tenantRows = await db
        .select({
          firstName: tenants.firstName,
          lastName: tenants.lastName,
        })
        .from(leaseTenants)
        .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
        .where(
          and(
            eq(leaseTenants.leaseId, lease.id),
            eq(leaseTenants.isPrimary, true)
          )
        )
        .limit(1);
      const tenantName = tenantRows[0]
        ? `${tenantRows[0].firstName} ${tenantRows[0].lastName}`
        : "Unknown tenant";

      // Try to calculate the indexed rent
      let estimatedNewRent = Number(
        lease.currentMonthlyRent || lease.monthlyRent
      );
      let epcRestricted = false;

      try {
        const calc = await calculateLeaseIndexation(lease.id, userId);
        estimatedNewRent = calc.newRent;
        epcRestricted = calc.epcRestricted;
      } catch {
        // If calculation fails (e.g., missing index), use current rent
      }

      upcoming.push({
        leaseId: lease.id,
        propertyName,
        tenantName,
        currentRent: lease.currentMonthlyRent || lease.monthlyRent,
        estimatedNewRent,
        anniversaryDate: anniversary.toISOString().split("T")[0]!,
        region: lease.region,
        epcRestricted,
      });
    }

    return c.json({ data: upcoming, period: `next ${days} days` });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const e = error as { status: number; message: string };
      return c.json({ error: e.message }, e.status as 400 | 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Indexation] Upcoming error:", message);
    return c.json({ error: "Failed to retrieve upcoming indexations" }, 500);
  }
});

// =====================================================================
// Endpoint 5: POST /preview/:leaseId -- preview indexation + email
// =====================================================================

indexationRouter.post(
  "/preview/:leaseId",
  zValidator(
    "json",
    z.object({
      overrideNewRent: z.number().positive().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      effectiveDate: effectiveDateField,
    })
  ),
  async (c) => {
    try {
      const leaseId = c.req.param("leaseId");
      const userId = getRequiredUserId(c);
      const { overrideNewRent, subject, body, effectiveDate } = c.req.valid("json");

      const calc = withChosenEffectiveDate(
        await calculateLeaseIndexation(leaseId, userId),
        effectiveDate
      );
      const calculatedNewRent = calc.newRent;

      // D-08: override cannot exceed the indexed rent (EPC hard cap)
      if (
        overrideNewRent !== undefined &&
        overrideNewRent > calculatedNewRent
      ) {
        return c.json(
          {
            error: `Override rent cannot exceed the indexed rent of ${calculatedNewRent}`,
          },
          400
        );
      }

      const finalNewRent =
        overrideNewRent !== undefined && overrideNewRent <= calculatedNewRent
          ? overrideNewRent
          : calculatedNewRent;

      const db = getDb();

      // Primary tenant gives name and language; co-tenants are copied.
      const rec = await getLeaseEmailRecipients(leaseId);
      const tenantLanguage = rec.primary?.language || "en";
      const tenantName = rec.primary
        ? `${rec.primary.firstName} ${rec.primary.lastName}`.trim()
        : "Tenant";

      const ownerRows = await db
        .select({ name: users.name, email: users.email, whatsappNumber: users.whatsappNumber })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const params = buildIndexationEmailParams({
        calc,
        tenantLanguage,
        tenantName,
        calculatedNewRent,
        finalNewRent,
        owner: ownerRows[0] ?? { name: null, email: null, whatsappNumber: null },
      });

      // D-13: if no custom subject/body provided, generate defaults
      let emailSubject: string;
      let emailBody: string;
      let rawSubject: string;
      let rawBody: string;

      if (!subject && !body) {
        const defaults = generateDefaultIndexationEmail(params);
        rawSubject = defaults.subject;
        rawBody = defaults.body;
      } else {
        rawSubject = subject || "Rent indexation notification";
        rawBody = body || "";
      }

      // Resolves placeholders in custom templates; the default is already rendered.
      const templateVars = buildIndexationTemplateVars(params);

      emailSubject = renderTemplate(rawSubject, templateVars);
      emailBody = renderTemplate(rawBody, templateVars);

      return c.json({
        leaseId,
        calculatedNewRent,
        finalNewRent,
        isOverride: finalNewRent < calculatedNewRent,
        effectiveDate: calc.effectiveDate,
        subject: emailSubject,
        body: emailBody,
        rawSubject,
        rawBody,
        recipients: { to: rec.to, cc: rec.ccEmails },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error && "message" in error) {
        const e = error as { status: number; message: string };
        return c.json({ error: e.message }, e.status as 400 | 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Indexation] Preview error:", message);
      return c.json({ error: "Failed to preview indexation" }, 500);
    }
  }
);

// =====================================================================
// Endpoint 6: POST /apply/:leaseId -- apply indexation + notify tenant
// =====================================================================

indexationRouter.post(
  "/apply/:leaseId",
  zValidator(
    "json",
    z.object({
      newRent: z.number().positive(),
      subject: z.string().min(1),
      body: z.string().min(1),
      sendNotification: z.boolean().default(true),
      effectiveDate: effectiveDateField,
    })
  ),
  async (c) => {
    try {
      const leaseId = c.req.param("leaseId");
      const userId = getRequiredUserId(c);
      const { newRent, subject, body, sendNotification, effectiveDate } = c.req.valid("json");

      const computed = await calculateLeaseIndexation(leaseId, userId);

      // Apply requires manager+ role (write operation)
      const applyRole = await getUserPropertyRole(userId, computed.lease.propertyId);
      if (!applyRole || !hasMinimumRole(applyRole, "manager")) {
        return c.json({ error: "Insufficient permissions" }, 403);
      }

      // Indexation may only be applied once a year, from the anniversary.
      if (!computed.canApply) {
        return c.json(
          {
            error: `Indexation cannot be applied before ${computed.applicableFrom} (it may be applied once a year, from the contract anniversary)`,
          },
          400
        );
      }

      const calc = withChosenEffectiveDate(computed, effectiveDate);

      const calculatedNewRent = calc.newRent;

      // D-08: EPC hard cap -- cannot exceed calculated indexed rent
      if (newRent > calculatedNewRent) {
        return c.json(
          {
            error: `New rent (${newRent}) cannot exceed the indexed rent of ${calculatedNewRent}`,
          },
          400
        );
      }

      const db = getDb();
      const previousRent = String(
        calc.lease.currentMonthlyRent || calc.lease.monthlyRent
      );

      // D-09: store only the applied rent in the indexation record
      const indexationRecordId = crypto.randomUUID();
      await db.insert(indexationRecords).values({
        id: indexationRecordId,
        leaseId,
        effectiveDate: calc.effectiveDate,
        previousRent,
        newRent: String(newRent),
        baseIndex: String(calc.baseIndex),
        currentIndex: calc.currentIndexValue,
        status: sendNotification ? "notified" : "applied",
        notificationSentAt: sendNotification ? new Date() : null,
      });

      // Applying indexation raises the current rent (monthlyRent, shown across
      // the app). The original contract rent (baseRent) stays fixed as the
      // indexation base. currentMonthlyRent is kept in sync for compatibility.
      await db
        .update(leases)
        .set({
          monthlyRent: String(newRent),
          currentMonthlyRent: String(newRent),
          // The applicability gate and the alert cycle count a year from the
          // legal anniversary, not from the date the landlord let the new rent
          // start (see getIndexationApplicability and alertCycleDate).
          lastIndexationDate: calc.indexationDate,
          updatedAt: new Date(),
        })
        .where(eq(leases.id, leaseId));

      // D-14: send notification immediately if requested
      let notificationSent = false;
      if (sendNotification) {
        // Primary tenant addressed, co-tenants copied.
        const rec = await getLeaseEmailRecipients(leaseId);

        if (rec.to) {
          const tenantName = rec.primary
            ? `${rec.primary.firstName} ${rec.primary.lastName}`.trim()
            : "Tenant";

          const ownerRows = await db
            .select({ name: users.name, email: users.email, whatsappNumber: users.whatsappNumber })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          const params = buildIndexationEmailParams({
            calc,
            tenantLanguage: rec.primary?.language || "en",
            tenantName,
            calculatedNewRent,
            finalNewRent: newRent,
            owner: ownerRows[0] ?? { name: null, email: null, whatsappNumber: null },
          });
          const templateVars = buildIndexationTemplateVars(params);

          const renderedSubject = renderTemplate(subject, templateVars);
          const renderedBody = renderTemplate(body, templateVars);

          await queueEmail({
            to: rec.to,
            cc: rec.cc,
            subject: renderedSubject,
            body: renderedBody,
          }, undefined, {
            ownerId: userId,
            leaseId,
            type: "indexation_notification",
            recipientName: tenantName,
          });

          notificationSent = true;
        } else {
          console.log(
            `[Indexation] Tenant for lease ${leaseId} has no email -- skipping notification`
          );
        }
      }

      return c.json({
        message: "Indexation applied",
        leaseId,
        newRent,
        previousRent,
        effectiveDate: calc.effectiveDate,
        indexationDate: calc.indexationDate,
        notificationSent,
        indexationRecordId,
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error && "message" in error) {
        const e = error as { status: number; message: string };
        return c.json({ error: e.message }, e.status as 400 | 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Indexation] Apply error:", message);
      return c.json({ error: "Failed to apply indexation" }, 500);
    }
  }
);
