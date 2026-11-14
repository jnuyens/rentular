import {
  BRUSSELS_EPC_CORRECTED_LABELS,
  BRUSSELS_EPC_CORRECTION_FACTORS,
  BRUSSELS_EPC_CUTOFF,
  type BrusselsAnniversaryPeriod,
  FLANDERS_EPC_FREEZE_START,
  FLANDERS_EPC_FREEZE_END,
  FLANDERS_EPC_FREEZE_FACTOR,
  FLANDERS_EPC_NEEDS_CORRECTION,
  FLANDERS_EPC_CORRECTION_FACTORS,
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
  const gateBase = parseLocalDate(input.lastIndexationDate || input.startDate);
  const applicableFrom = new Date(gateBase);
  applicableFrom.setFullYear(applicableFrom.getFullYear() + 1);
  return {
    canApply: today >= applicableFrom,
    applicableFrom: localYmd(applicableFrom),
  };
}

/**
 * Local midnight of a YYYY-MM-DD date. new Date("YYYY-MM-DD") would give UTC
 * midnight, which in Brussels is still the previous evening for a few hours.
 */
function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// An indexed rent starts with a rent period, and rent periods run per calendar
// month. The lease payment day (when the tenant pays) does not move that start.
const RENT_PERIOD_START_DAY = 1;

/** YYYY-MM-DD of a local-time date. toISOString() would shift local midnight back a day east of UTC. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/**
 * First rent due date on or after `from`, for rent due on `paymentDay` of each
 * month. In short months the due day is capped at the last day of the month.
 */
export function firstDueOnOrAfter(from: Date, paymentDay: number): Date {
  const day = normalizePaymentDay(paymentDay);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const sameMonth = dueIn(start.getFullYear(), start.getMonth(), day);
  return sameMonth >= start ? sameMonth : dueIn(start.getFullYear(), start.getMonth() + 1, day);
}

function normalizePaymentDay(paymentDay: number): number {
  return Math.min(Math.max(Math.trunc(paymentDay) || 1, 1), 31);
}

/** Rent due date in a given month, with the due day capped at the month's last day. */
function dueIn(year: number, month: number, day: number): Date {
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
}

/**
 * Rent due dates the landlord may pick as the start of the new rent, newest
 * first. The default (index 0) is the first due date on or after the
 * anniversary, or the next one after today when the landlord applies late.
 *
 * Belgian rule: for residential leases the indexation may be claimed for at
 * most 3 months before the request; for commercial leases it may go back all
 * the way to the anniversary. It never starts before the anniversary itself.
 */
export function computeEffectiveDateOptions(input: {
  indexationDate: string;
  paymentDay: number;
  leaseType: string;
  today: Date;
  applicable: boolean;
}): { effectiveDate: string; options: string[] } {
  const { today } = input;
  const day = normalizePaymentDay(input.paymentDay);
  const anniv = parseLocalDate(input.indexationDate);
  const from = anniv > today ? anniv : addDays(today, 1);
  const defaultDue = firstDueOnOrAfter(from, day);
  const effectiveDate = localYmd(defaultDue);
  if (!input.applicable || anniv > today) return { effectiveDate, options: [effectiveDate] };

  let floor = firstDueOnOrAfter(anniv, day);
  if (input.leaseType !== "commercial") {
    const capDue = firstDueOnOrAfter(
      new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()),
      day
    );
    if (capDue > floor) floor = capDue;
  }

  const options: string[] = [];
  let year = defaultDue.getFullYear();
  let month = defaultDue.getMonth();
  for (let i = 0; i < 14; i++) {
    const due = dueIn(year, month, day);
    if (due < floor) break;
    options.push(localYmd(due));
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return { effectiveDate, options: options.length > 0 ? options : [effectiveDate] };
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
  // Reference date for "today". Defaults to the current time.
  today?: Date;
  // Brussels: correction factor stored on the lease at an earlier indexation.
  // It is reused as is until it is cleared (better EPB certificate or new lease).
  brusselsEpcFactor?: number | null;
  // Brussels: whether the lease is registered. Undefined means unknown and is
  // treated as not registered, so an unregistered lease is never indexed.
  leaseRegistered?: boolean | null;
  // Current rent, used as the result when indexation is blocked. Defaults to baseRent.
  currentRent?: number | null;
}): Promise<{
  currentIndex: number;
  currentIndexMonth: string;
  unrestrictedNewRent: number;
  newRent: number;
  epcIndexationFactor: number;
  epcRestricted: boolean;
  correctionApplied: boolean;
  // Anniversary month (1..12) whose Flemish correction factor was applied, else null.
  correctionMonth: number | null;
  formulaNote: string | undefined;
  // Brussels details for the landlord (factor, label, anniversary period), else null.
  brussels: BrusselsEpcInfo | null;
  // Set when the rent may not be indexed at all; newRent then equals the current rent.
  indexationBlocked: IndexationBlockReason | null;
  effectiveDate: string;
  // Legal anniversary date: drives the EPC rules and next year's applicability.
  indexationDate: string;
  // Rent due dates the landlord may pick as the start of the new rent, newest first, default first.
  effectiveDateOptions: string[];
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
  const today = input.today ?? new Date();

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
  // Legal indexation date (the anniversary). Drives the Flemish EPC rules, which
  // depend on when the indexation is due, not on when the new rent starts.
  let indexationDateStr: string;
  if (anniversaryHasPassed) {
    const idxDate = new Date(anniversaryYear, startMonth - 1, 1); // month before the anniversary
    currentIndexYearStr = String(idxDate.getFullYear());
    currentIndexMonthStr = String(idxDate.getMonth() + 1).padStart(2, "0");
    const v = await getHealthIndexValue(currentIndexYearStr, currentIndexMonthStr);
    // If that month isn't published yet, fall back to the latest available index.
    currentIndex = v ? Number(v) : latestIndex;
    currentIndexPublished = Boolean(v);
    // The new rent starts with the first rent due on or after the anniversary.
    // A late application takes effect going forward, from the next rent due
    // after today, never in the middle of a period. The landlord may pick an
    // earlier due date from effectiveDateOptions, within the legal limits.
    const anniv = new Date(anniversaryYear, startMonth, startDay);
    indexationDateStr = localYmd(anniv);
    const from = anniv > today ? anniv : addDays(today, 1);
    effectiveDateStr = localYmd(firstDueOnOrAfter(from, RENT_PERIOD_START_DAY));
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
    indexationDateStr = effectiveDateStr;
  }

  // Apply EPC restrictions for a given "current" index value.
  const applyEpc = (atIndex: number) => {
    const unrestricted = calculateIndexedRent(input.baseRent, input.baseIndex, atIndex);
    if (input.region === "brussels") {
      const r = applyBrusselsEpcRestriction({
        baseRent: input.baseRent,
        unrestrictedNewRent: unrestricted,
        epcLabel: input.epcLabel,
        startDate: input.startDate,
        anniversaryDate: indexationDateStr,
        persistedFactor: input.brusselsEpcFactor ?? null,
        registered: input.leaseRegistered ?? false,
        currentRent: input.currentRent ?? input.baseRent,
      });
      return { unrestricted, newRent: r.newRent, factor: r.factor, epcRestricted: r.restricted, correctionApplied: r.correctionApplied, correctionMonth: null as number | null, note: r.note, brussels: r.info, blocked: r.blocked };
    }
    if (input.region === "flanders") {
      const r = applyFlandersEpcRestriction(
        input.baseRent,
        unrestricted,
        input.epcLabel,
        input.startDate,
        indexationDateStr,
        input.leaseType
      );
      return { unrestricted, newRent: r.newRent, factor: r.factor, epcRestricted: r.restricted, correctionApplied: r.correctionApplied, correctionMonth: r.correctionMonth, note: r.note, brussels: null as BrusselsEpcInfo | null, blocked: null as IndexationBlockReason | null };
    }
    // Wallonia: no EPC restrictions.
    return { unrestricted, newRent: unrestricted, factor: 1.0, epcRestricted: false, correctionApplied: false, correctionMonth: null as number | null, note: undefined as string | undefined, brussels: null as BrusselsEpcInfo | null, blocked: null as IndexationBlockReason | null };
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

  let effectiveDateOptions = [effectiveDateStr];
  if (anniversaryHasPassed) {
    const opts = computeEffectiveDateOptions({
      indexationDate: indexationDateStr,
      paymentDay: RENT_PERIOD_START_DAY,
      leaseType: input.leaseType,
      today,
      applicable: canApply,
    });
    effectiveDateStr = opts.effectiveDate;
    effectiveDateOptions = opts.options;
  }

  // Next upcoming anniversary (strictly after today).
  let nextAnnivYear = today.getFullYear();
  if (new Date(nextAnnivYear, startMonth, startDay) <= today) nextAnnivYear += 1;
  const nextAnniversaryStr = localYmd(new Date(nextAnnivYear, startMonth, startDay));

  return {
    currentIndex,
    currentIndexMonth: `${currentIndexYearStr}-${currentIndexMonthStr}`,
    unrestrictedNewRent: legal.unrestricted,
    newRent: legal.newRent,
    epcIndexationFactor: legal.factor,
    epcRestricted: legal.epcRestricted,
    correctionApplied: legal.correctionApplied,
    correctionMonth: legal.correctionMonth,
    formulaNote: legal.note,
    brussels: legal.brussels,
    indexationBlocked: legal.blocked,
    effectiveDate: effectiveDateStr,
    indexationDate: indexationDateStr,
    effectiveDateOptions,
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

export type IndexationBlockReason = "brussels_no_epc" | "brussels_not_registered";

export type BrusselsEpcInfo = {
  // EPB label used for the decision ("none" without a certificate).
  label: string;
  // Lease took effect before 14 October 2022.
  beforeCutoff: boolean;
  // Anniversary period of the lease (see BRUSSELS_EPC_CORRECTION_FACTORS).
  anniversaryPeriod: BrusselsAnniversaryPeriod;
  // Correction factor applied, or null when the rent indexes in full or is blocked.
  factor: number | null;
  // True when the factor came from the lease (stored at an earlier indexation).
  factorFromLease: boolean;
};

/**
 * Anniversary period of a lease for the Brussels table: the start month, with
 * October split into 1 to 13 ("10a") and 14 to 31 ("10b"). Read from the
 * YYYY-MM-DD string so no timezone can shift the day.
 */
export function brusselsAnniversaryPeriod(startDate: string): BrusselsAnniversaryPeriod {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  const d = m ? null : new Date(startDate);
  const month = m ? Number(m[2]) : d!.getMonth() + 1;
  const day = m ? Number(m[3]) : d!.getDate();
  if (month === 10) return day >= 14 ? "10b" : "10a";
  return String(month) as BrusselsAnniversaryPeriod;
}

/** Official Brussels correction factor for a label and anniversary period, or 1 when none applies. */
export function getBrusselsCorrectionFactor(epcLabel: string | null, period: BrusselsAnniversaryPeriod): number {
  const label = epcLabel || "none";
  if (!BRUSSELS_EPC_CORRECTED_LABELS.includes(label)) return 1;
  const row = BRUSSELS_EPC_CORRECTION_FACTORS[period];
  return label === "E" ? row.e : row.fg;
}

/** EPB labels A++ to D: a certificate this good ends a stored Brussels correction factor. */
export function isBrusselsLabelBetterThanE(epcLabel: string | null): boolean {
  if (!epcLabel || epcLabel === "none") return false;
  return ["A++", "A+", "A", "B", "C", "D"].includes(epcLabel);
}

/**
 * Apply the Brussels EPB rules to an indexation (Brussels Housing Code
 * art. 224/2, ordinance of 13 October 2023).
 *
 * - Not registered, or no EPB certificate: no indexation. The rent stays as it is.
 * - Lease took effect on or after 14 October 2022: full indexation, any label.
 * - Older lease with EPB A++ to D and no stored factor: full indexation.
 * - Older lease with EPB E, F or G: new rent = round2(standard indexed rent x
 *   correction factor). The factor multiplies the whole indexed rent. A factor
 *   stored on the lease at an earlier indexation is reused, even if the label
 *   changed since, until it is cleared by recording a better certificate.
 *
 * Guards: the result never exceeds the standard indexed rent. Like Flanders,
 * a corrected rent does not go below the base rent, unless the standard indexed
 * rent itself is lower (a falling index).
 */
export function applyBrusselsEpcRestriction(input: {
  baseRent: number;
  unrestrictedNewRent: number;
  epcLabel: string | null;
  startDate: string;
  anniversaryDate: string;
  persistedFactor?: number | null;
  registered: boolean;
  currentRent?: number;
}): {
  newRent: number;
  factor: number;
  restricted: boolean;
  correctionApplied: boolean;
  note: string | undefined;
  info: BrusselsEpcInfo;
  blocked: IndexationBlockReason | null;
} {
  const label = input.epcLabel || "none";
  const period = brusselsAnniversaryPeriod(input.startDate);
  const beforeCutoff = input.startDate.slice(0, 10) < BRUSSELS_EPC_CUTOFF;
  const unchangedRent = input.currentRent ?? input.baseRent;
  const info: BrusselsEpcInfo = { label, beforeCutoff, anniversaryPeriod: period, factor: null, factorFromLease: false };

  if (!input.registered) {
    return {
      newRent: unchangedRent,
      factor: 0,
      restricted: true,
      correctionApplied: false,
      note: "Brussels: the lease is not registered, so the rent may not be indexed",
      info,
      blocked: "brussels_not_registered",
    };
  }
  if (label === "none") {
    return {
      newRent: unchangedRent,
      factor: 0,
      restricted: true,
      correctionApplied: false,
      note: "Brussels: no EPB certificate was given to the tenant, so the rent may not be indexed",
      info,
      blocked: "brussels_no_epc",
    };
  }

  const full = {
    newRent: input.unrestrictedNewRent,
    factor: 1.0,
    restricted: false,
    correctionApplied: false,
    note: undefined as string | undefined,
    info,
    blocked: null as IndexationBlockReason | null,
  };
  // Leases that took effect on or after 14 October 2022 index in full.
  if (!beforeCutoff) return full;

  const stored = input.persistedFactor;
  const hasStored = typeof stored === "number" && Number.isFinite(stored) && stored > 0 && stored < 1;
  if (!hasStored && !BRUSSELS_EPC_CORRECTED_LABELS.includes(label)) return full;

  const factor = hasStored ? stored! : getBrusselsCorrectionFactor(label, period);
  const corrected = Math.round(input.unrestrictedNewRent * factor * 100) / 100;
  const newRent = Math.min(input.unrestrictedNewRent, Math.max(corrected, input.baseRent));
  return {
    newRent,
    factor,
    restricted: true,
    correctionApplied: true,
    note: `Brussels correction factor ${factor} applied (EPB ${label}, lease effective before 14/10/2022, anniversary period ${period}${hasStored ? ", factor stored on the lease" : ""})`,
    info: { ...info, factor, factorFromLease: hasStored },
    blocked: null,
  };
}

type FlandersEpcResult = {
  newRent: number;
  factor: number;
  restricted: boolean;
  correctionApplied: boolean;
  correctionMonth: number | null;
  note: string | undefined;
};

const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Official Flemish correction factor for indexations after the 2022-2023 freeze.
 * Returns 1 for labels that need no correction (A++ to C), column d for EPC D
 * and column efNone for E, F, G, no EPC or any unknown label.
 */
export function getFlandersCorrectionFactor(epcLabel: string | null, anniversaryMonth: number): number {
  const label = epcLabel || "none";
  if (FLANDERS_EPC_NEEDS_CORRECTION[label] === false) return 1;
  const row = FLANDERS_EPC_CORRECTION_FACTORS[anniversaryMonth];
  if (!row) return 1;
  return label === "D" ? row.d : row.efNone;
}

/**
 * Apply EPC-based indexation restrictions for Flanders.
 *
 * Rules:
 * 1. Only applies to residential leases (NOT student) started BEFORE Oct 1, 2022
 * 2. During freeze period (Oct 1, 2022 to Sep 30, 2023):
 *    - A+/A/B/C: 100%, D: 50%, E/F/G/none: 0%
 * 3. After freeze (from Oct 1, 2023):
 *    - All labels can index again, BUT D/E/F/G/none contracts multiply the
 *      standard indexed rent by the official correction factor for the lease's
 *      anniversary month (FLANDERS_EPC_CORRECTION_FACTORS, column d for EPC D,
 *      efNone for E/F/G/none).
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
): FlandersEpcResult {
  const label = epcLabel || "none";
  const leaseStart = new Date(leaseStartDate);
  const indexDate = new Date(indexationDate);
  const freezeStart = new Date(FLANDERS_EPC_FREEZE_START);
  const freezeEnd = new Date(FLANDERS_EPC_FREEZE_END);

  // Rule: does not apply to student leases
  if (leaseType === "student") {
    return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, correctionMonth: null, note: undefined };
  }

  // Rule: only applies to contracts started BEFORE Oct 1, 2022
  if (leaseStart >= freezeStart) {
    return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, correctionMonth: null, note: undefined };
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
        correctionMonth: null,
        note: `Flanders: EPC label ${label} is banned from indexation from ${year} onwards`,
      };
    }
  }

  // During the freeze period
  if (indexDate >= freezeStart && indexDate <= freezeEnd) {
    const factor = FLANDERS_EPC_FREEZE_FACTOR[label] ?? 0.0;
    if (factor >= 1.0) {
      return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, correctionMonth: null, note: undefined };
    }
    const increase = unrestrictedNewRent - baseRent;
    const newRent = Number((baseRent + increase * factor).toFixed(2));
    return {
      newRent,
      factor,
      restricted: true,
      correctionApplied: false,
      correctionMonth: null,
      note: `Flanders freeze period: ${factor === 0 ? "no" : `only ${factor * 100}% of`} indexation allowed for EPC label ${label}`,
    };
  }

  // After the freeze: multiply the standard indexed rent by the official
  // correction factor for the anniversary month.
  if (indexDate > freezeEnd && FLANDERS_EPC_NEEDS_CORRECTION[label]) {
    // Start dates are YYYY-MM-DD and parse as UTC; read the month in UTC so the
    // local timezone cannot shift it.
    const anniversaryMonth = leaseStart.getUTCMonth() + 1;
    const factor = getFlandersCorrectionFactor(epcLabel, anniversaryMonth);
    const corrected = Math.round(unrestrictedNewRent * factor * 100) / 100;
    return {
      // Indexation never takes the rent below the base rent (a falling index
      // combined with the factor could otherwise do so).
      newRent: Math.max(corrected, baseRent),
      factor,
      restricted: true,
      correctionApplied: true,
      correctionMonth: anniversaryMonth,
      note: `Flanders correction factor for anniversary month ${MONTH_NAMES_EN[anniversaryMonth - 1]} applied (EPC ${label}): x ${factor}`,
    };
  }

  return { newRent: unrestrictedNewRent, factor: 1.0, restricted: false, correctionApplied: false, correctionMonth: null, note: undefined };
}

export type IndexationCore = Awaited<ReturnType<typeof computeIndexationCore>>;
