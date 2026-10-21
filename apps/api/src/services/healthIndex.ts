import { eq, and, desc } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { getDb, healthIndexValues } from "@rentular/db";

// Statbel open-data dump with every CPI and health index value for all base
// years. Updated by Statbel each month, unlike the fixed-range beSTAT views.
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

/**
 * Fetch health index values from the Statbel open-data zip and cache them in
 * the database. Only inserts months that are not cached yet: published health
 * index values never change. On failure, logs and returns (retried next day).
 */
export async function fetchAndCacheHealthIndex(): Promise<void> {
  try {
    const response = await fetch(STATBEL_OPENDATA_URL);
    if (!response.ok) {
      console.error(
        `[HealthIndex] Failed to fetch from Statbel: HTTP ${response.status} ${response.statusText}`
      );
      return;
    }

    const zip = new Uint8Array(await response.arrayBuffer());
    const rows = parseStatbelCpiFile(extractStatbelCpiText(zip));

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[HealthIndex] Failed to fetch from Statbel: ${message}`);
  }
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
