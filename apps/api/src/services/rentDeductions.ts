import { eq } from "drizzle-orm";
import { getDb, rentDeductions, rentFreePeriods } from "@rentular/db";

type Db = ReturnType<typeof getDb>;

export type DeductionRow = {
  id: string;
  type: "temporary" | "permanent";
  amount: string | number;
  startDate: string;
  endDate: string | null;
  reason: string;
};

export type FreePeriodRow = {
  id: string;
  startDate: string;
  endDate: string;
  waiveCharges: boolean;
  reason: string;
};

function ymd(v: string): string {
  return String(v).slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The deductions that apply to a rent period with the given due date.
 * A temporary deduction applies when start <= due <= end; a permanent one
 * applies from its start date onward. Dates compare as YYYY-MM-DD strings.
 */
export function deductionsForDueDate(
  rows: DeductionRow[],
  dueDate: string,
): DeductionRow[] {
  const due = ymd(dueDate);
  return rows.filter((r) => {
    if (ymd(r.startDate) > due) return false;
    if (r.type === "permanent") return true;
    return r.endDate != null && due <= ymd(r.endDate);
  });
}

/** Total amount deducted from the rent of the period due on `dueDate`. */
export function deductedAmount(rows: DeductionRow[], dueDate: string): number {
  return round2(
    deductionsForDueDate(rows, dueDate).reduce(
      (s, r) => s + (Number(r.amount) || 0),
      0,
    ),
  );
}

/**
 * Last day of the rent period that starts on `dueDate`: the day before the
 * next month's due date, with the payment day clamped to that month's length.
 */
export function periodEndFor(dueDate: string, paymentDay: number): string {
  const d = ymd(dueDate);
  const y = Number(d.slice(0, 4));
  const m0 = Number(d.slice(5, 7)) - 1;
  const ny = m0 === 11 ? y + 1 : y;
  const nm0 = (m0 + 1) % 12;
  const lastDay = new Date(ny, nm0 + 1, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(paymentDay) || 1), lastDay);
  const end = new Date(ny, nm0, day - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

export interface PeriodRentDue {
  /** What the tenant owes for the period after deductions and free periods. */
  rentDue: number;
  /** Rent plus charges before any deduction or free period. */
  grossRentDue: number;
  deductions: Array<{ id: string; amount: number; reason: string }>;
  rentFree: boolean;
}

/**
 * Amount due for one rent period. A rent-free period covering the due date
 * zeroes the rent (and the charges too when it waives them); otherwise the
 * applicable deductions are subtracted from rent plus charges, never going
 * below zero.
 */
export function periodRentDue(input: {
  monthlyRent: number;
  charges: number;
  dueDate: string;
  deductions: DeductionRow[];
  freePeriods: FreePeriodRow[];
}): PeriodRentDue {
  const { monthlyRent, charges, dueDate } = input;
  const due = ymd(dueDate);
  const grossRentDue = round2(monthlyRent + charges);

  const freePeriod = input.freePeriods.find(
    (f) => ymd(f.startDate) <= due && due <= ymd(f.endDate),
  );
  if (freePeriod) {
    return {
      rentDue: freePeriod.waiveCharges ? 0 : round2(charges),
      grossRentDue,
      deductions: [],
      rentFree: true,
    };
  }

  const applicable = deductionsForDueDate(input.deductions, due);
  const deducted = round2(
    applicable.reduce((s, r) => s + (Number(r.amount) || 0), 0),
  );
  return {
    rentDue: Math.max(0, round2(grossRentDue - deducted)),
    grossRentDue,
    deductions: applicable.map((r) => ({
      id: r.id,
      amount: round2(Number(r.amount) || 0),
      reason: r.reason,
    })),
    rentFree: false,
  };
}

export async function loadLeaseDeductions(
  db: Db,
  leaseId: string,
): Promise<DeductionRow[]> {
  const rows = await db
    .select({
      id: rentDeductions.id,
      type: rentDeductions.type,
      amount: rentDeductions.amount,
      startDate: rentDeductions.startDate,
      endDate: rentDeductions.endDate,
      reason: rentDeductions.reason,
    })
    .from(rentDeductions)
    .where(eq(rentDeductions.leaseId, leaseId));
  return rows as DeductionRow[];
}

export async function loadLeaseFreePeriods(
  db: Db,
  leaseId: string,
): Promise<FreePeriodRow[]> {
  const rows = await db
    .select({
      id: rentFreePeriods.id,
      startDate: rentFreePeriods.startDate,
      endDate: rentFreePeriods.endDate,
      waiveCharges: rentFreePeriods.waiveCharges,
      reason: rentFreePeriods.reason,
    })
    .from(rentFreePeriods)
    .where(eq(rentFreePeriods.leaseId, leaseId));
  return rows as FreePeriodRow[];
}
