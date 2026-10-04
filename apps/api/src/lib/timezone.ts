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
