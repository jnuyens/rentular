import {
  BRUSSELS_EPC_INDEXATION_FACTOR,
  FLANDERS_EPC_FREEZE_START,
  FLANDERS_EPC_FREEZE_END,
  FLANDERS_EPC_FREEZE_FACTOR,
  FLANDERS_EPC_NEEDS_CORRECTION,
  FLANDERS_FUTURE_RESTRICTIONS,
} from "@rentular/shared/constants";
import { calculateIndexedRent } from "@rentular/shared/validation";
import { getHealthIndexValue, getLatestHealthIndex } from "./healthIndex";

/**
 * Indexation may be applied once a year, from the anniversary of the later of
 * (last indexation, contract start). Before that date it is informational only.
 */
export function getIndexationApplicability(input: {
  startDate: string;
  lastIndexationDate?: string | null;
  today?: Date;
}): { canApply: boolean; applicableFrom: string } {
  const today = input.today ?? new Date();
  const gateBase = input.lastIndexationDate
    ? new Date(input.lastIndexationDate)
    : new Date(input.startDate);
  const applicableFrom = new Date(gateBase);
  applicableFrom.setFullYear(applicableFrom.getFullYear() + 1);
  return {
    canApply: today >= applicableFrom,
    applicableFrom: applicableFrom.toISOString().split("T")[0]!,
  };
}

/**
 * Pure indexation math: given the base rent/index, region, start date, EPC label
 * and lease type, compute the current index, the (EPC-restricted) new rent and the
 * effective date. Shared by the saved-lease calculation and the stateless preview
 * endpoint so both use identical Belgian rules -- keep them in sync.
 */
export async function computeIndexationCore(input: {
  baseRent: number;
  baseIndex: number;
  region: string;
  startDate: string;
  epcLabel: string | null;
  leaseType: string;
  lastIndexationDate?: string | null;
}): Promise<{
  currentIndex: number;
  currentIndexMonth: string;
  unrestrictedNewRent: number;
  newRent: number;
  epcIndexationFactor: number;
  epcRestricted: boolean;
  correctionApplied: boolean;
  formulaNote: string | undefined;
  effectiveDate: string;
  // Informational "risen so far" figure, using the latest published index.
  latestIndex: number;
  latestIndexMonth: string;
  newRentAtLatest: number;
  // Applicability: indexation may be applied once a year from the anniversary.
  canApply: boolean;
  applicableFrom: string;
  // Next upcoming anniversary -- for a "coming up" forecast at the latest index.
  nextAnniversary: string;
  // True only when the index for the month before the most recent anniversary
  // is published (false on the latest-index fallback and before the first
  // anniversary).
  currentIndexPublished: boolean;
}> {
  const startDate = new Date(input.startDate);
  const startMonth = startDate.getMonth();
  const startDay = startDate.getDate();
  const today = new Date();

  // Latest published index -- how much the rent has already risen, even before
  // this lease's anniversary comes round again.
  const latest = await getLatestHealthIndex();
  const latestIndex = latest ? Number(latest.value) : input.baseIndex;
  const latestIndexMonth = latest ? `${latest.year}-${latest.month}` : "";

  // The applicable indexation is the one for the most recent anniversary that has
  // already occurred; it uses the health index of the month BEFORE that
  // anniversary (NOT this calendar year's, which for a lease whose anniversary is
  // later in the year would be an unpublished, future month).
  let anniversaryYear = today.getFullYear();
  if (new Date(anniversaryYear, startMonth, startDay) > today) anniversaryYear -= 1;
  const anniversaryHasPassed = anniversaryYear > startDate.getFullYear();

  let currentIndex: number;
  let currentIndexPublished = false;
  let currentIndexYearStr: string;
  let currentIndexMonthStr: string;
  let effectiveDateStr: string;
  if (anniversaryHasPassed) {
    const idxDate = new Date(anniversaryYear, startMonth - 1, 1); // month before the anniversary
    currentIndexYearStr = String(idxDate.getFullYear());
    currentIndexMonthStr = String(idxDate.getMonth() + 1).padStart(2, "0");
    const v = await getHealthIndexValue(currentIndexYearStr, currentIndexMonthStr);
    // If that month isn't published yet, fall back to the latest available index.
    currentIndex = v ? Number(v) : latestIndex;
    currentIndexPublished = Boolean(v);
    // Effective date = the anniversary, but a late application takes effect going
    // forward (from today), not retroactively -- so never show a past date.
    const anniv = new Date(anniversaryYear, startMonth, startDay);
    effectiveDateStr = (anniv > today ? anniv : today).toISOString().split("T")[0]!;
  } else {
    // Before the first anniversary there is nothing to apply: the legal "current"
    // index equals the base (0 change) and we avoid looking up a future month.
    currentIndex = input.baseIndex;
    const baseRefDate = new Date(startDate);
    baseRefDate.setMonth(startDate.getMonth() - 1);
    currentIndexYearStr = String(baseRefDate.getFullYear());
    currentIndexMonthStr = String(baseRefDate.getMonth() + 1).padStart(2, "0");
    const firstAnniversary = new Date(startDate);
    firstAnniversary.setFullYear(startDate.getFullYear() + 1);
    effectiveDateStr = firstAnniversary.toISOString().split("T")[0]!;
  }

  // Freeze-period boundary indices (Flanders EPC correction), fetched once.
  let freezeStart = 0;
  let freezeEnd = 0;
  if (input.region === "flanders") {
    const fs = await getHealthIndexValue("2022", "09");
    const fe = await getHealthIndexValue("2023", "09");
    freezeStart = fs ? Number(fs) : 0;
    freezeEnd = fe ? Number(fe) : 0;
  }

  // Apply EPC restrictions for a given "current" index value.
  const applyEpc = (atIndex: number) => {
    const unrestricted = calculateIndexedRent(input.baseRent, input.baseIndex, atIndex);
    if (input.region === "brussels") {
      const r = applyBrusselsEpcRestriction(input.baseRent, unrestricted, input.epcLabel);
      return { unrestricted, newRent: r.newRent, factor: r.factor, epcRestricted: r.restricted, correctionApplied: false, note: r.note };
    }
    if (input.region === "flanders") {
      const r = applyFlandersEpcRestriction(
        input.baseRent,
        unrestricted,
        input.epcLabel,
        input.startDate,
        effectiveDateStr,
        input.leaseType,
        input.baseIndex,
        atIndex,
        freezeStart,
        freezeEnd
      );
      return { unrestricted, newRent: r.newRent, factor: r.factor, epcRestricted: r.restricted, correctionApplied: r.correctionApplied, note: r.note };
    }
    // Wallonia: no EPC restrictions.
    return { unrestricted, newRent: unrestricted, factor: 1.0, epcRestricted: false, correctionApplied: false, note: undefined as string | undefined };
  };

  const legal = applyEpc(currentIndex);
  const atLatest = applyEpc(latestIndex);

  // Indexation may be applied once a year, from the anniversary of the later of
  // (last indexation, contract start). Before that date it's informational only.
  const { canApply, applicableFrom: applicableFromStr } = getIndexationApplicability({
    startDate: input.startDate,
    lastIndexationDate: input.lastIndexationDate,
    today,
  });

  // Next upcoming anniversary (strictly after today).
  let nextAnnivYear = today.getFullYear();
  if (new Date(nextAnnivYear, startMonth, startDay) <= today) nextAnnivYear += 1;
  const nextAnniversaryStr = new Date(nextAnnivYear, startMonth, startDay)
    .toISOString()
    .split("T")[0]!;

  return {
    currentIndex,
    currentIndexMonth: `${currentIndexYearStr}-${currentIndexMonthStr}`,
    unrestrictedNewRent: legal.unrestricted,
    newRent: legal.newRent,
    epcIndexationFactor: legal.factor,
    epcRestricted: legal.epcRestricted,
    correctionApplied: legal.correctionApplied,
    formulaNote: legal.note,
    effectiveDate: effectiveDateStr,
    latestIndex,
    latestIndexMonth,
    newRentAtLatest: atLatest.newRent,
    canApply,
    applicableFrom: applicableFromStr,
    nextAnniversary: nextAnniversaryStr,
    currentIndexPublished,
  };
}

// =====================================================================
// EPC restriction helper functions
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
 * 2. During freeze period (Oct 1, 2022 to Sep 30, 2023):
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

export type IndexationCore = Awaited<ReturnType<typeof computeIndexationCore>>;
