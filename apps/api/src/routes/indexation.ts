import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import {
  getDb,
  healthIndexValues,
  indexationRecords,
  leases,
  leaseTenants,
  properties,
  tenants,
  users,
} from "@rentular/db";
import {
  BRUSSELS_EPC_INDEXATION_FACTOR,
  FLANDERS_EPC_FREEZE_START,
  FLANDERS_EPC_FREEZE_END,
  FLANDERS_EPC_FREEZE_FACTOR,
  FLANDERS_EPC_NEEDS_CORRECTION,
  FLANDERS_FUTURE_RESTRICTIONS,
} from "@rentular/shared/constants";
import { calculateIndexedRent } from "@rentular/shared/validation";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getHealthIndexValue,
  getLatestHealthIndex,
  isHealthIndexStale,
} from "../services/healthIndex";
import {
  generateDefaultIndexationEmail,
  LEGAL_REFERENCES,
} from "../services/indexationEmail";
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
  };
  baseRent: number;
  baseIndex: number;
  currentIndex: number;
  currentIndexValue: string;
  unrestrictedNewRent: number;
  newRent: number;
  epcIndexationFactor: number;
  epcRestricted: boolean;
  correctionApplied: boolean;
  formulaNote: string | undefined;
  effectiveDate: string;
}

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

  // Fetch lease with ownership check
  const leaseRows = await db
    .select()
    .from(leases)
    .where(and(eq(leases.id, leaseId), eq(leases.ownerId, userId)))
    .limit(1);

  if (leaseRows.length === 0) {
    throw { status: 404, message: "Lease not found" };
  }

  const lease = leaseRows[0]!;

  if (!lease.indexationEnabled) {
    throw { status: 400, message: "Indexation is not enabled for this lease" };
  }

  // Fetch property for EPC data
  const propertyRows = await db
    .select({
      id: properties.id,
      name: properties.name,
      epcLabel: properties.epcLabel,
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

  // Calculate the "current" index month: the month before the lease anniversary month
  // Anniversary month = same month as lease start
  const startDate = new Date(lease.startDate);
  const anniversaryMonth = startDate.getMonth(); // 0-based
  // Current index month = anniversary month - 1
  let currentIndexMonth = anniversaryMonth; // getMonth() is 0-based, so this is already month-1 in 1-based
  let currentIndexYear = new Date().getFullYear();

  // If anniversary hasn't happened yet this year, use current year
  // If it already passed, use current year (for the most recent indexation)
  // The month before the anniversary: if anniversary is January (0), previous month is December (11) of previous year
  if (anniversaryMonth === 0) {
    currentIndexMonth = 12;
    currentIndexYear = currentIndexYear - 1;
  }

  const currentIndexMonthStr = currentIndexMonth.toString().padStart(2, "0");
  const currentIndexYearStr = currentIndexYear.toString();

  const currentIndexValue = await getHealthIndexValue(
    currentIndexYearStr,
    currentIndexMonthStr
  );
  if (!currentIndexValue) {
    throw {
      status: 400,
      message: `Current health index not available for ${currentIndexYearStr}-${currentIndexMonthStr}`,
    };
  }

  const currentIndex = Number(currentIndexValue);
  const baseRent = Number(lease.monthlyRent);

  // Calculate unrestricted new rent using the standard formula
  const unrestrictedNewRent = calculateIndexedRent(
    baseRent,
    baseIndex,
    currentIndex
  );

  // Calculate effective date: next lease anniversary
  const today = new Date();
  let effectiveYear = today.getFullYear();
  const anniversaryDate = new Date(
    effectiveYear,
    startDate.getMonth(),
    startDate.getDate()
  );
  if (anniversaryDate <= today) {
    effectiveYear++;
  }
  const effectiveDate = new Date(
    effectiveYear,
    startDate.getMonth(),
    startDate.getDate()
  );
  const effectiveDateStr = effectiveDate.toISOString().split("T")[0]!;

  // Apply EPC restrictions based on region
  let newRent = unrestrictedNewRent;
  let epcIndexationFactor = 1.0;
  let epcRestricted = false;
  let correctionApplied = false;
  let formulaNote: string | undefined;

  if (lease.region === "brussels") {
    const result = applyBrusselsEpcRestriction(
      baseRent,
      unrestrictedNewRent,
      property.epcLabel
    );
    newRent = result.newRent;
    epcIndexationFactor = result.factor;
    epcRestricted = result.restricted;
    formulaNote = result.note;
  } else if (lease.region === "flanders") {
    // For Flanders correction factor: fetch freeze boundary indices
    const freezeStartValue = await getHealthIndexValue("2022", "09");
    const freezeEndValue = await getHealthIndexValue("2023", "09");

    const result = applyFlandersEpcRestriction(
      baseRent,
      unrestrictedNewRent,
      property.epcLabel,
      lease.startDate,
      effectiveDateStr,
      lease.type,
      baseIndex,
      currentIndex,
      freezeStartValue ? Number(freezeStartValue) : 0,
      freezeEndValue ? Number(freezeEndValue) : 0
    );
    newRent = result.newRent;
    epcIndexationFactor = result.factor;
    epcRestricted = result.restricted;
    correctionApplied = result.correctionApplied;
    formulaNote = result.note;
  }
  // Wallonia: no EPC restrictions, use unrestricted rent

  return {
    lease: {
      id: lease.id,
      ownerId: lease.ownerId,
      propertyId: lease.propertyId,
      type: lease.type,
      region: lease.region,
      startDate: lease.startDate,
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
    currentIndexValue,
    unrestrictedNewRent,
    newRent,
    epcIndexationFactor,
    epcRestricted,
    correctionApplied,
    formulaNote,
    effectiveDate: effectiveDateStr,
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
// EPC restriction helper functions (preserved exactly from stub)
// =====================================================================

/**
 * Apply EPC-based indexation restrictions for Brussels.
 * Brussels restrictions are permanent and apply to all residential leases.
 */
function applyBrusselsEpcRestriction(
  baseRent: number,
  unrestrictedNewRent: number,
  epcLabel: string | null
): { newRent: number; factor: number; restricted: boolean; note: string | undefined } {
  const label = epcLabel || "none";
  const factor = BRUSSELS_EPC_INDEXATION_FACTOR[label] ?? 0.0;

  if (factor >= 1.0) {
    return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, note: undefined };
  }

  const increase = unrestrictedNewRent - baseRent;
  const newRent = Number((baseRent + increase * factor).toFixed(2));
  return {
    newRent,
    factor,
    restricted: true,
    note: `Brussels EPC restriction: only ${factor * 100}% of the increase allowed for EPC label ${label}`,
  };
}

/**
 * Apply EPC-based indexation restrictions for Flanders.
 *
 * Rules:
 * 1. Only applies to residential leases (NOT student) started BEFORE Oct 1, 2022
 * 2. During freeze period (Oct 1, 2022 – Sep 30, 2023):
 *    - A+/A/B/C: 100%, D: 50%, E/F/G/none: 0%
 * 3. After freeze (from Oct 1, 2023):
 *    - All labels can index again, BUT D/E/F/G/none contracts must apply a
 *      correction factor that excludes the index growth during the freeze period.
 *    - This correction is permanent for the contract's lifetime unless a better EPC is obtained.
 * 4. Future: from 2028 E/F banned, from 2030 D/E/F banned.
 */
function applyFlandersEpcRestriction(
  baseRent: number,
  unrestrictedNewRent: number,
  epcLabel: string | null,
  leaseStartDate: string,
  indexationDate: string,
  leaseType: string,
  baseIndex: number,
  currentIndex: number,
  freezePeriodIndexStart: number, // Health index at Sep 2022 (before freeze)
  freezePeriodIndexEnd: number,   // Health index at Sep 2023 (end of freeze)
): { newRent: number; factor: number; restricted: boolean; correctionApplied: boolean; note: string | undefined } {
  const label = epcLabel || "none";
  const leaseStart = new Date(leaseStartDate);
  const indexDate = new Date(indexationDate);
  const freezeStart = new Date(FLANDERS_EPC_FREEZE_START);
  const freezeEnd = new Date(FLANDERS_EPC_FREEZE_END);

  // Rule: does not apply to student leases
  if (leaseType === "student") {
    return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, note: undefined };
  }

  // Rule: only applies to contracts started BEFORE Oct 1, 2022
  if (leaseStart >= freezeStart) {
    return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, note: undefined };
  }

  // Check future bans (2028+)
  const indexYear = indexDate.getFullYear();
  for (const [yearStr, restriction] of Object.entries(FLANDERS_FUTURE_RESTRICTIONS)) {
    const year = Number(yearStr);
    if (indexYear >= year && restriction.bannedLabels.includes(label)) {
      return {
        newRent: baseRent,
        factor: 0.0,
        restricted: true,
        correctionApplied: false,
        note: `Flanders: EPC label ${label} is banned from indexation from ${year} onwards`,
      };
    }
  }

  // During the freeze period
  if (indexDate >= freezeStart && indexDate <= freezeEnd) {
    const factor = FLANDERS_EPC_FREEZE_FACTOR[label] ?? 0.0;
    if (factor >= 1.0) {
      return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, note: undefined };
    }
    const increase = unrestrictedNewRent - baseRent;
    const newRent = Number((baseRent + increase * factor).toFixed(2));
    return {
      newRent,
      factor,
      restricted: true,
      correctionApplied: false,
      note: `Flanders freeze period: ${factor === 0 ? "no" : `only ${factor * 100}% of`} indexation allowed for EPC label ${label}`,
    };
  }

  // After the freeze: apply correction factor if needed
  if (indexDate > freezeEnd && FLANDERS_EPC_NEEDS_CORRECTION[label]) {
    // The correction factor excludes the health index growth during the freeze period.
    // Corrected formula: newRent = baseRent * (currentIndex - frozenGrowth) / baseIndex
    // Where frozenGrowth = freezePeriodIndexEnd - freezePeriodIndexStart
    if (baseIndex > 0 && freezePeriodIndexEnd > 0 && freezePeriodIndexStart > 0) {
      const frozenGrowth = freezePeriodIndexEnd - freezePeriodIndexStart;
      const correctedIndex = currentIndex - frozenGrowth;
      const newRent = Number(((baseRent * correctedIndex) / baseIndex).toFixed(2));
      return {
        newRent: Math.max(newRent, baseRent), // Cannot go below base rent
        factor: correctedIndex / currentIndex,
        restricted: true,
        correctionApplied: true,
        note: `Flanders correction factor applied: index growth during freeze period (${frozenGrowth.toFixed(2)} points) excluded for EPC label ${label}`,
      };
    }
  }

  return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, note: undefined };
}

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
      region: calc.lease.region,
      epcLabel: calc.property.epcLabel,
      epcIndexationFactor: calc.epcIndexationFactor,
      epcRestricted: calc.epcRestricted,
      correctionApplied: calc.correctionApplied,
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
// Endpoint 4: GET /upcoming -- bulk upcoming indexations
// =====================================================================

indexationRouter.get("/upcoming", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const days = Number(c.req.query("days")) || 30;
    const db = getDb();

    // Query active leases with indexation enabled for this owner
    const activeLeases = await db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.ownerId, userId),
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
    })
  ),
  async (c) => {
    try {
      const leaseId = c.req.param("leaseId");
      const userId = getRequiredUserId(c);
      const { overrideNewRent, subject, body } = c.req.valid("json");

      const calc = await calculateLeaseIndexation(leaseId, userId);
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

      // Fetch primary tenant for language and name
      const tenantRows = await db
        .select({
          firstName: tenants.firstName,
          lastName: tenants.lastName,
          email: tenants.email,
          language: tenants.language,
        })
        .from(leaseTenants)
        .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
        .where(
          and(
            eq(leaseTenants.leaseId, leaseId),
            eq(leaseTenants.isPrimary, true)
          )
        )
        .limit(1);

      const tenant = tenantRows[0];
      const tenantLanguage = tenant?.language || "en";
      const tenantName = tenant
        ? `${tenant.firstName} ${tenant.lastName}`
        : "Tenant";

      // Fetch owner name
      const ownerRows = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const ownerName = ownerRows[0]?.name || "Your landlord";

      // D-13: if no custom subject/body provided, generate defaults
      let emailSubject: string;
      let emailBody: string;
      let rawSubject: string;
      let rawBody: string;

      if (!subject && !body) {
        const defaults = generateDefaultIndexationEmail({
          tenantLanguage,
          region: calc.lease.region,
          tenantName,
          propertyName: calc.property.name,
          currentRent: String(calc.lease.currentMonthlyRent || calc.lease.monthlyRent),
          calculatedNewRent: String(calculatedNewRent),
          appliedNewRent: String(finalNewRent),
          baseIndex: String(calc.baseIndex),
          currentIndex: String(calc.currentIndex),
          effectiveDate: calc.effectiveDate,
          ownerName,
        });
        rawSubject = defaults.subject;
        rawBody = defaults.body;
      } else {
        rawSubject = subject || "Rent indexation notification";
        rawBody = body || "";
      }

      // Render the template with real values for the preview
      const templateVars: Record<string, string> = {
        tenantName,
        propertyName: calc.property.name,
        currentRent: String(calc.lease.currentMonthlyRent || calc.lease.monthlyRent),
        newRent: String(finalNewRent),
        calculatedNewRent: String(calculatedNewRent),
        baseIndex: String(calc.baseIndex),
        currentIndex: String(calc.currentIndex),
        effectiveDate: calc.effectiveDate,
        ownerName,
        legalReference:
          LEGAL_REFERENCES[calc.lease.region]?.[tenantLanguage] ||
          LEGAL_REFERENCES[calc.lease.region]?.en ||
          "",
        overrideNote: "",
      };

      emailSubject = renderTemplate(rawSubject, templateVars);
      emailBody = renderTemplate(rawBody, templateVars);

      return c.json({
        leaseId,
        calculatedNewRent,
        finalNewRent,
        isOverride: finalNewRent < calculatedNewRent,
        subject: emailSubject,
        body: emailBody,
        rawSubject,
        rawBody,
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
    })
  ),
  async (c) => {
    try {
      const leaseId = c.req.param("leaseId");
      const userId = getRequiredUserId(c);
      const { newRent, subject, body, sendNotification } = c.req.valid("json");

      const calc = await calculateLeaseIndexation(leaseId, userId);
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

      // D-07: update lease -- only currentMonthlyRent changes, NEVER monthlyRent
      await db
        .update(leases)
        .set({
          currentMonthlyRent: String(newRent),
          lastIndexationDate: calc.effectiveDate,
          updatedAt: new Date(),
        })
        .where(eq(leases.id, leaseId));

      // D-14: send notification immediately if requested
      let notificationSent = false;
      if (sendNotification) {
        // Fetch primary tenant email and language
        const tenantRows = await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            email: tenants.email,
            language: tenants.language,
          })
          .from(leaseTenants)
          .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
          .where(
            and(
              eq(leaseTenants.leaseId, leaseId),
              eq(leaseTenants.isPrimary, true)
            )
          )
          .limit(1);

        const tenant = tenantRows[0];

        if (tenant?.email) {
          const tenantName = `${tenant.firstName} ${tenant.lastName}`;

          // Fetch owner name
          const ownerRows = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const ownerName = ownerRows[0]?.name || "Your landlord";

          // Render the provided subject and body with all variables
          const templateVars: Record<string, string> = {
            tenantName,
            propertyName: calc.property.name,
            currentRent: previousRent,
            newRent: String(newRent),
            calculatedNewRent: String(calculatedNewRent),
            baseIndex: String(calc.baseIndex),
            currentIndex: String(calc.currentIndex),
            effectiveDate: calc.effectiveDate,
            ownerName,
            legalReference:
              LEGAL_REFERENCES[calc.lease.region]?.[tenant.language] ||
              LEGAL_REFERENCES[calc.lease.region]?.en ||
              "",
            overrideNote: "",
          };

          const renderedSubject = renderTemplate(subject, templateVars);
          const renderedBody = renderTemplate(body, templateVars);

          await queueEmail({
            to: tenant.email,
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
