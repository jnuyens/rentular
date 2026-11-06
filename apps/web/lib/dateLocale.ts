"use client";

// Date order derived from the user's LOCATION (IANA time zone), independent of
// the browser/keyboard language. Month-first (mdy) is used only for US time
// zones; everywhere else (Belgium and the large majority of the world) is
// day-first (dd/mm/yyyy).

const US_TIME_ZONES = new Set([
  "America/New_York",
  "America/Detroit",
  "America/Kentucky/Louisville",
  "America/Kentucky/Monticello",
  "America/Indiana/Indianapolis",
  "America/Indiana/Vincennes",
  "America/Indiana/Winamac",
  "America/Indiana/Marengo",
  "America/Indiana/Petersburg",
  "America/Indiana/Vevay",
  "America/Indiana/Tell_City",
  "America/Indiana/Knox",
  "America/Chicago",
  "America/Menominee",
  "America/North_Dakota/Center",
  "America/North_Dakota/New_Salem",
  "America/North_Dakota/Beulah",
  "America/Denver",
  "America/Boise",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Sitka",
  "America/Metlakatla",
  "America/Yakutat",
  "America/Nome",
  "America/Adak",
  "Pacific/Honolulu",
]);

export type DateOrder = "dmy" | "mdy";

export function localeDateOrder(): DateOrder {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return US_TIME_ZONES.has(tz) ? "mdy" : "dmy";
  } catch {
    return "dmy";
  }
}

/** ISO (yyyy-mm-dd) -> display string in the given order. */
export function isoToDisplay(iso: string, order: DateOrder): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const [, y, mo, d] = m;
  return order === "mdy" ? `${mo}/${d}/${y}` : `${d}/${mo}/${y}`;
}

/** display string (dd/mm/yyyy or mdy) -> ISO, or "" when incomplete/invalid. */
export function displayToIso(text: string, order: DateOrder): string {
  const parts = text.split(/[/.\-\s]+/).filter(Boolean);
  if (parts.length !== 3) return "";
  const [a, b, y] = parts;
  const d = order === "mdy" ? b : a;
  const mo = order === "mdy" ? a : b;
  if (!/^\d{4}$/.test(y)) return "";
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31)
    return "";
  return `${y}-${mm}-${dd}`;
}

export function datePlaceholder(order: DateOrder): string {
  return order === "mdy" ? "mm/dd/yyyy" : "dd/mm/yyyy";
}

/**
 * Format a Date or an ISO/date string for display in the viewer's date order
 * (day-first in Belgium and most of the world). For a plain yyyy-mm-dd string
 * the date parts are used as-is to avoid a timezone shift.
 */
export function formatDate(
  value: Date | string | null | undefined,
  tz: string = DISPLAY_TIMEZONE
): string {
  if (!value) return "";
  const order = localeDateOrder();
  if (typeof value === "string") {
    const dateOnly = calendarDatePart(value);
    if (dateOnly) return isoToDisplay(dateOnly, order);
  }
  const d = parseInstant(value);
  return d ? isoToDisplay(ymdInZone(d, tz), order) : "";
}

/**
 * The time zone timestamps are shown in: the one that belongs to the data (the
 * landlord's, or the bank account's for bank data). No per-entity zone is
 * stored yet, so this is the platform default.
 */
export const DISPLAY_TIMEZONE =
  process.env.NEXT_PUBLIC_APP_TIMEZONE || "Europe/Brussels";

// A calendar date (DATE column) arrives as "yyyy-mm-dd", or from a raw driver
// value as UTC midnight. Those are used as-is and never shifted by a zone.
function calendarDatePart(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Parse an API timestamp (ISO with Z, or a zone-less UTC wall clock) to a Date. */
function parseInstant(value: Date | string): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = value.trim();
  const zoneLess = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(zoneLess ? `${s.replace(" ", "T")}Z` : s);
  return isNaN(d.getTime()) ? null : d;
}

function zoneParts(d: Date, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/** The calendar date (yyyy-mm-dd) of an instant in a time zone. */
export function ymdInZone(d: Date, tz: string = DISPLAY_TIMEZONE): string {
  const p = zoneParts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today (yyyy-mm-dd) in a time zone; use instead of toISOString().slice(0, 10). */
export function todayInZone(
  tz: string = DISPLAY_TIMEZONE,
  now: Date = new Date()
): string {
  return ymdInZone(now, tz);
}

/** The current month (yyyy-mm) in a time zone. */
export function monthInZone(
  tz: string = DISPLAY_TIMEZONE,
  now: Date = new Date()
): string {
  return todayInZone(tz, now).slice(0, 7);
}

/** Shift a calendar date (yyyy-mm-dd) by a number of days, without zones. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The last day (yyyy-mm-dd) of the month of a calendar date. */
export function monthEndYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * A UTC instant shown as "dd/mm/yyyy HH:mm" (date in the viewer's date order) in
 * the time zone that belongs to the data, Europe/Brussels by default. Calendar
 * dates without a time are shown as a date only.
 */
export function formatDateTime(
  value: Date | string | null | undefined,
  tz: string = DISPLAY_TIMEZONE
): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return isoToDisplay(value.trim(), localeDateOrder());
  }
  const d = parseInstant(value);
  if (!d) return "";
  const p = zoneParts(d, tz);
  return `${isoToDisplay(`${p.year}-${p.month}-${p.day}`, localeDateOrder())} ${p.hour}:${p.minute}`;
}
