import { eq, and, desc } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { getDb, healthIndexValues } from "@rentular/db";

// Statbel open-data dump with every CPI and health index value for all base
// years. Statbel refreshes this file every month.
const STATBEL_OPENDATA_URL =
  "https://statbel.fgov.be/sites/default/files/files/opendata/Consumptieprijsindex%20en%20gezondheidsindex/CPI%20All%20base%20years.zip";

const STATBEL_TXT_NAME = "CPI All base years.txt";

// Belgian residential leases are indexed against the health index with base 2013 = 100.
const HEALTH_INDEX_BASE_YEAR = "2013";

export interface StatbelHealthIndexRow {
  year: string;
  month: string;
  value: string;
}

/**
 * Parse the pipe-separated "CPI All base years.txt" file from Statbel.
 * Keeps only base-2013 rows that have a published health index value
 * (older months use "." as a placeholder). Columns are looked up by header
 * name so a reordered file still parses.
 */
export function parseStatbelCpiFile(text: string): StatbelHealthIndexRow[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const header = (lines[0] ?? "").split("|").map((h) => h.trim());

  const yearCol = header.indexOf("NM_YR");
  const monthCol = header.indexOf("NM_MTH");
  const healthCol = header.indexOf("MS_HLTH_IDX");
  const baseCol = header.indexOf("NM_BASE_YR");
  if (yearCol < 0 || monthCol < 0 || healthCol < 0 || baseCol < 0) {
    throw new Error("unexpected Statbel CPI file header");
  }

  const rows: StatbelHealthIndexRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const cols = line.split("|");
    if ((cols[baseCol] ?? "").trim() !== HEALTH_INDEX_BASE_YEAR) continue;

    const raw = (cols[healthCol] ?? "").trim();
    if (raw === "" || raw === ".") continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;

    const year = (cols[yearCol] ?? "").trim();
    const month = (cols[monthCol] ?? "").trim().padStart(2, "0");
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) continue;

    rows.push({ year, month, value: Number(num.toFixed(2)).toString() });
  }
  return rows;
}

/**
 * Extract the CPI text file from the Statbel zip archive.
 * Prefers the known file name, else the first .txt entry.
 */
export function extractStatbelCpiText(zip: Uint8Array): string {
  const entries = unzipSync(zip);
  const names = Object.keys(entries);
  const name =
    names.find((n) => n === STATBEL_TXT_NAME || n.endsWith(`/${STATBEL_TXT_NAME}`)) ??
    names.find((n) => n.toLowerCase().endsWith(".txt"));
  if (!name) {
    throw new Error("no .txt file found in Statbel zip");
  }
  return strFromU8(entries[name]!);
}

export interface HealthIndexFetchResult {
  ok: boolean;
  error?: string;
  fetched: number;
  inserted: number;
}

/**
 * Fetch health index values from the Statbel open-data zip and cache them in
 * the database. Only inserts months that are not cached yet: published health
 * index values never change. Never throws: failures are logged and reported in
 * the result (the daily job retries the next day).
 */
export async function fetchAndCacheHealthIndex(): Promise<HealthIndexFetchResult> {
  try {
    const response = await fetch(STATBEL_OPENDATA_URL);
    if (!response.ok) {
      const error = `HTTP ${response.status} ${response.statusText}`;
      console.error(`[HealthIndex] Failed to fetch from Statbel: ${error}`);
      return { ok: false, error, fetched: 0, inserted: 0 };
    }

    const zip = new Uint8Array(await response.arrayBuffer());
    const rows = parseStatbelCpiFile(extractStatbelCpiText(zip));
    if (rows.length === 0) {
      const error = "no parseable health index rows in Statbel file";
      console.error(`[HealthIndex] Failed to fetch from Statbel: ${error}`);
      return { ok: false, error, fetched: 0, inserted: 0 };
    }

    const db = getDb();
    const existing = await db
      .select({ year: healthIndexValues.year, month: healthIndexValues.month })
      .from(healthIndexValues);
    const known = new Set(existing.map((r) => `${r.year}-${r.month}`));

    let inserted = 0;
    for (const row of rows) {
      const key = `${row.year}-${row.month}`;
      if (known.has(key)) continue;

      await db.insert(healthIndexValues).values({
        id: crypto.randomUUID(),
        year: row.year,
        month: row.month,
        value: row.value,
        source: "statbel-opendata",
        fetchedAt: new Date(),
      });
      known.add(key);
      inserted++;
    }

    console.log(
      `[HealthIndex] Fetched ${rows.length} index values from Statbel, ${inserted} new`
    );
    return { ok: true, fetched: rows.length, inserted };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[HealthIndex] Failed to fetch from Statbel: ${message}`);
    return { ok: false, error: message, fetched: 0, inserted: 0 };
  }
}

// From this day of the month on, the previous month's index must be cached.
// Statbel publishes near the end of the month itself, so day 5 leaves margin.
export const HEALTH_INDEX_DUE_DAY = 5;

function localDateParts(now: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The month whose health index must already be cached at `now`, judged in the
 * given timezone. From the 5th, that is the previous month (January asks for
 * December of the year before). Before the 5th there is no requirement yet.
 */
export function expectedLatestMonth(
  now: Date,
  tz: string
): { year: string; month: string } | null {
  const { year, month, day } = localDateParts(now, tz);
  if (day < HEALTH_INDEX_DUE_DAY) return null;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return { year: String(prevYear), month: String(prevMonth).padStart(2, "0") };
}

export type HealthIndexAlertKind = "fetch-failed" | "stale";

/**
 * Decide whether the admin must be warned after a refresh run: always when the
 * fetch failed, and when it succeeded but the expected month is still missing
 * (Statbel returned nothing new while we are overdue).
 */
export function decideHealthIndexAlert(
  result: HealthIndexFetchResult,
  expected: { year: string; month: string } | null,
  expectedPresent: boolean
): HealthIndexAlertKind | null {
  if (!result.ok) return "fetch-failed";
  if (expected && !expectedPresent) return "stale";
  return null;
}

export interface HealthIndexCheckDeps {
  now: Date;
  tz: string;
  adminEmail: string | undefined;
  hasMonth(year: string, month: string): Promise<boolean>;
  latestMonth(): Promise<string | null>;
  /** SET key NX EX ttl. Resolves true when this caller claimed the key. */
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>;
  /** Drop a claimed key again, used when sending the alert failed. */
  release?(key: string): Promise<void>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

// Slightly under a day so the next daily run can alert again if still broken.
const ALERT_DEDUPE_TTL_SECONDS = 82800;

/**
 * After a refresh run, warn the admin by email when the fetch failed or the
 * index is overdue. Sends at most once per problem per day (Redis dedupe key).
 * If Redis is unavailable the alert is still sent: a duplicate mail is better
 * than a silent stale index.
 */
export async function checkHealthIndexAndAlert(
  result: HealthIndexFetchResult,
  deps: HealthIndexCheckDeps
): Promise<{ kind: HealthIndexAlertKind | null; sent: boolean }> {
  const expected = expectedLatestMonth(deps.now, deps.tz);
  const present = expected ? await deps.hasMonth(expected.year, expected.month) : true;
  const kind = decideHealthIndexAlert(result, expected, present);
  if (!kind) return { kind: null, sent: false };

  const expectedKey = expected ? `${expected.year}-${expected.month}` : "none";
  if (kind === "stale") {
    console.warn(`[HealthIndex] Index for ${expectedKey} is still missing after refresh`);
  }

  if (!deps.adminEmail) {
    console.warn(`[HealthIndex] ADMIN_EMAIL not set, skipping ${kind} alert`);
    return { kind, sent: false };
  }

  const key = `healthindex:alert:${kind}:${expectedKey}`;
  try {
    const claimed = await deps.claimOnce(key, ALERT_DEDUPE_TTL_SECONDS);
    if (!claimed) {
      console.log(`[HealthIndex] ${kind} alert already sent today (${key})`);
      return { kind, sent: false };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[HealthIndex] Alert dedupe unavailable, sending anyway: ${message}`);
  }

  const latest = await deps.latestMonth();
  const body = [
    kind === "fetch-failed"
      ? "The daily health index refresh from Statbel failed."
      : "The daily health index refresh ran, but the expected month is still missing.",
    "",
    `Error: ${result.error ?? "none"}`,
    `Expected month: ${expected ? expectedKey : "not required yet"}`,
    `Latest month in database: ${latest ?? "none"}`,
    `Rows fetched: ${result.fetched}, new: ${result.inserted}`,
    `Checked at: ${deps.now.toISOString()} (${deps.tz})`,
  ].join("\n");

  try {
    await deps.sendEmail(deps.adminEmail, "[Rentular] Health index not updated", body);
  } catch (err: unknown) {
    // Free the dedupe key so the next run can try again.
    if (deps.release) await deps.release(key).catch(() => undefined);
    throw err;
  }
  console.log(`[HealthIndex] Sent ${kind} alert to admin`);
  return { kind, sent: true };
}

/**
 * Look up a specific month's health index value from the database.
 * Returns the decimal value as a string, or null if not found.
 */
export async function getHealthIndexValue(
  year: string,
  month: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ value: healthIndexValues.value })
    .from(healthIndexValues)
    .where(
      and(
        eq(healthIndexValues.year, year),
        eq(healthIndexValues.month, month)
      )
    )
    .limit(1);

  return rows.length > 0 ? rows[0]!.value : null;
}

/**
 * Find the cached health-index month whose value is closest to a target index.
 * Used to estimate when a rent was last indexed by back-solving the index that
 * the current rent reflects. Returns null if no values are cached.
 */
export async function findClosestHealthIndexMonth(
  target: number
): Promise<{ year: string; month: string; value: number } | null> {
  const db = getDb();
  const rows = await db
    .select({
      year: healthIndexValues.year,
      month: healthIndexValues.month,
      value: healthIndexValues.value,
    })
    .from(healthIndexValues);

  let best: { year: string; month: string; value: number } | null = null;
  let bestDiff = Infinity;
  let bestKey = Infinity;
  for (const r of rows) {
    const v = Number(r.value);
    const diff = Math.abs(v - target);
    const key = Number(r.year) * 12 + Number(r.month);
    // Closest value wins; on a tie prefer the earlier month.
    if (diff < bestDiff || (diff === bestDiff && key < bestKey)) {
      bestDiff = diff;
      bestKey = key;
      best = { year: r.year, month: r.month, value: v };
    }
  }
  return best;
}

/**
 * Get the most recent cached health index value.
 * Returns the row data or null if no values exist.
 */
export async function getLatestHealthIndex(): Promise<{
  year: string;
  month: string;
  value: string;
  fetchedAt: Date;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      year: healthIndexValues.year,
      month: healthIndexValues.month,
      value: healthIndexValues.value,
      fetchedAt: healthIndexValues.fetchedAt,
    })
    .from(healthIndexValues)
    .orderBy(desc(healthIndexValues.year), desc(healthIndexValues.month))
    .limit(1);

  return rows.length > 0 ? rows[0]! : null;
}

/**
 * Check whether the health index cache is stale.
 * Per D-04, values older than 7 days are considered stale.
 * Returns true if no values exist or if the latest value is older than 7 days.
 */
export async function isHealthIndexStale(): Promise<boolean> {
  const latest = await getLatestHealthIndex();

  if (!latest) {
    return true;
  }

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const age = Date.now() - latest.fetchedAt.getTime();

  return age > sevenDaysMs;
}
