// Scheduling timezone resolution.
//
// Rule (per the product decision): a timer runs in the timezone of the BANK
// ACCOUNT being monitored; if that has no timezone, the LANDLORD's timezone;
// otherwise the platform default (Europe/Brussels, the Belgian market).
//
// Today every bank account and landlord is Belgian and no per-entity timezone
// is stored, so this resolves to the default for everyone and the global cron
// jobs all run on Europe/Brussels. When multi-timezone support is added, store a
// `timezone` on bank accounts / users and pass it to resolveTimezone(); the
// reminder jobs can then resolve per lease, and per-timezone scheduling can fan
// the evening jobs out across the distinct timezones in use.

export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "Europe/Brussels";

/**
 * Resolve the timezone to use: the monitored bank account's, else the
 * landlord's, else the platform default. Nulls/blanks fall through.
 */
export function resolveTimezone(opts?: {
  bankAccountTimezone?: string | null;
  landlordTimezone?: string | null;
}): string {
  const bank = opts?.bankAccountTimezone?.trim();
  if (bank) return bank;
  const landlord = opts?.landlordTimezone?.trim();
  if (landlord) return landlord;
  return DEFAULT_TIMEZONE;
}

/**
 * The timezone the global scheduled jobs (BullMQ repeatable crons) run in. Until
 * per-entity scheduling exists this is the platform default, so every timer
 * fires at its configured wall-clock time in that zone rather than in UTC.
 */
export function getScheduleTimezone(): string {
  return DEFAULT_TIMEZONE;
}

/**
 * The calendar date (YYYY-MM-DD) of an instant as seen in a timezone. Use this
 * instead of `toISOString().slice(0, 10)`, which gives the UTC date and is a day
 * behind in Brussels between 00:00 and 01:00/02:00 local time.
 */
export function ymdInZone(at: Date, tz: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's calendar date (YYYY-MM-DD) in a timezone (default: platform zone). */
export function todayInZone(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return ymdInZone(now, tz);
}

/** Day of the month (1-31) of an instant in a timezone. */
export function dayOfMonthInZone(at: Date, tz: string = DEFAULT_TIMEZONE): number {
  return Number(ymdInZone(at, tz).slice(8, 10));
}

/**
 * Normalize a TIMESTAMP value to an ISO 8601 UTC string ending in Z. Database
 * sessions run in UTC, so a zone-less "YYYY-MM-DD HH:MM:SS" string from a raw
 * query is a UTC wall clock and must not be parsed as server-local time.
 */
export function toUtcIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  const zoneLess = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(zoneLess ? `${s.replace(" ", "T")}Z` : s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
