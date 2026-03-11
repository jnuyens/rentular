import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  BRUSSELS_EPC_INDEXATION_FACTOR,
  FLANDERS_EPC_FREEZE_START,
  FLANDERS_EPC_FREEZE_END,
  FLANDERS_EPC_FREEZE_FACTOR,
  FLANDERS_EPC_NEEDS_CORRECTION,
  FLANDERS_FUTURE_RESTRICTIONS,
} from "@rentular/shared/constants";

export const indexationRouter = new Hono();

// Get current Belgian health index
indexationRouter.get("/health-index", async (c) => {
  // TODO: Fetch from Statbel API or cached value
  return c.json({
    currentIndex: 0,
    month: "",
    year: 0,
    source: "Statbel",
    lastUpdated: null,
  });
});

// Get health index history
indexationRouter.get("/health-index/history", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  return c.json({ data: [] });
});

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

// Calculate indexed rent for a specific lease
// Takes Brussels AND Flanders EPC restrictions into account as legally required
indexationRouter.get("/calculate/:leaseId", async (c) => {
  const leaseId = c.req.param("leaseId");

  // Belgian rent indexation formula:
  // New rent = (base rent * current health index) / base health index
  //
  // Where:
  // - base rent = rent at lease start (or last formal revision)
  // - base health index = health index of the month BEFORE the lease start month
  // - current health index = health index of the month BEFORE the anniversary month
  //
  // Indexation can only happen on the anniversary date of the lease
  //
  // Regional EPC restrictions:
  // - Flanders: temporary freeze (Oct 2022-Sep 2023) + permanent correction factor for D/E/F/G/no-EPC
  //   contracts started before Oct 1, 2022. Future bans from 2028 (E/F) and 2030 (D/E/F).
  // - Wallonia: no EPC restrictions currently
  // - Brussels: permanent restrictions based on EPC label

  // TODO: Fetch lease + property (for epcLabel + region), health index values
  const baseRent = 0;       // from lease.monthlyRent
  const baseIndex = 0;      // from healthIndexValues
  const currentIndex = 0;   // from healthIndexValues
  const region: string | null = null;   // from lease.region
  const epcLabel: string | null = null; // from property.epcLabel
  const leaseStartDate = ""; // from lease.startDate
  const leaseType = "";      // from lease.type
  const indexationDate = ""; // calculated anniversary date

  // For Flanders correction factor: health index values at freeze boundaries
  const freezePeriodIndexStart = 0; // Health index at Sep 2022
  const freezePeriodIndexEnd = 0;   // Health index at Sep 2023

  // Standard unrestricted calculation
  const unrestrictedNewRent = baseIndex > 0
    ? Number(((baseRent * currentIndex) / baseIndex).toFixed(2))
    : baseRent;

  let newRent = unrestrictedNewRent;
  let epcIndexationFactor = 1.0;
  let epcRestricted = false;
  let correctionApplied = false;
  let formulaNote: string | undefined;

  if (region === "brussels") {
    const result = applyBrusselsEpcRestriction(baseRent, unrestrictedNewRent, epcLabel);
    newRent = result.newRent;
    epcIndexationFactor = result.factor;
    epcRestricted = result.restricted;
    formulaNote = result.note;
  } else if (region === "flanders") {
    const result = applyFlandersEpcRestriction(
      baseRent, unrestrictedNewRent, epcLabel,
      leaseStartDate, indexationDate, leaseType,
      baseIndex, currentIndex,
      freezePeriodIndexStart, freezePeriodIndexEnd,
    );
    newRent = result.newRent;
    epcIndexationFactor = result.factor;
    epcRestricted = result.restricted;
    correctionApplied = result.correctionApplied;
    formulaNote = result.note;
  }
  // Wallonia: no EPC restrictions, use unrestricted rent

  return c.json({
    leaseId,
    baseRent,
    baseIndex,
    currentIndex,
    newRent,
    unrestrictedNewRent,
    difference: Number((newRent - baseRent).toFixed(2)),
    effectiveDate: indexationDate || null,
    region,
    epcLabel,
    epcIndexationFactor,
    epcRestricted,
    correctionApplied,
    formula: "newRent = baseRent * (currentIndex / baseIndex)",
    formulaNote,
  });
});

// Bulk calculate all upcoming indexations
indexationRouter.get("/upcoming", async (c) => {
  const days = Number(c.req.query("days")) || 30;
  return c.json({ data: [], period: `next ${days} days` });
});

// Preview the indexation notification email before sending
// Landlord can edit subject/body and optionally lower the new rent
indexationRouter.post(
  "/preview/:leaseId",
  zValidator(
    "json",
    z.object({
      // Landlord can override the calculated rent to any lower amount
      overrideNewRent: z.number().positive().optional(),
      // Custom email content (defaults generated from calculation)
      subject: z.string().optional(),
      body: z.string().optional(),
    })
  ),
  async (c) => {
    const leaseId = c.req.param("leaseId");
    const { overrideNewRent, subject, body } = c.req.valid("json");

    // TODO:
    // 1. Calculate the indexed rent using the formula
    // 2. If overrideNewRent is provided and <= calculated new rent, use that instead
    // 3. Generate default email subject/body with all details
    // 4. Return preview with rendered placeholders

    const calculatedNewRent = 0; // TODO: actual calculation
    const finalNewRent = overrideNewRent
      ? Math.min(overrideNewRent, calculatedNewRent)
      : calculatedNewRent;

    const defaultSubject = subject || "Rent indexation notification";
    const defaultBody = body || `Dear {{tenantName}},

We would like to inform you about the annual rent indexation for your property at {{propertyName}}.

Based on the Belgian health index:
- Current rent: {{currentRent}}
- Base index: {{baseIndex}}
- Current index: {{currentIndex}}
- New indexed rent: {{newRent}}
- Effective date: {{effectiveDate}}

Formula: new rent = base rent x (current index / base index)

This adjustment is in accordance with Belgian rental law.

Kind regards,
{{ownerName}}`;

    return c.json({
      leaseId,
      calculatedNewRent,
      finalNewRent,
      subject: defaultSubject,
      body: defaultBody,
    });
  }
);

// Apply indexation to a lease and send notification to tenant
// Landlord has full control: can customize the email and set rent to any amount <= calculated
indexationRouter.post(
  "/apply/:leaseId",
  zValidator(
    "json",
    z.object({
      // The rent to apply (must be <= calculated indexed rent; landlord can choose to be generous)
      newRent: z.number().positive(),
      // Fully customized notification email
      subject: z.string().min(1),
      body: z.string().min(1),
      // Whether to send the notification email to the tenant
      sendNotification: z.boolean().default(true),
    })
  ),
  async (c) => {
    const leaseId = c.req.param("leaseId");
    const { newRent, subject, body, sendNotification } = c.req.valid("json");

    // TODO:
    // 1. Verify newRent <= calculated indexed rent (landlord can lower, not raise beyond index)
    // 2. Update lease: currentMonthlyRent = newRent, lastIndexationDate = today
    // 3. Create indexationRecord with status 'applied'
    // 4. If sendNotification, render and send the customized email to tenant
    // 5. Update indexationRecord.notificationSentAt

    return c.json({
      message: "Indexation applied",
      leaseId,
      newRent,
      notificationSent: sendNotification,
    });
  }
);
