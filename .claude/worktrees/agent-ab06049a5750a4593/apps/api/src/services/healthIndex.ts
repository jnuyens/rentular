import { eq, and, desc } from "drizzle-orm";
import { getDb, healthIndexValues } from "@rentular/db";

const STATBEL_API_URL =
  "https://bestat.statbel.fgov.be/bestat/api/views/208b69bd-05c5-4947-b7f9-2d2300f517b8/result/JSON";

// Month name to two-digit string mapping (English names from Statbel beSTAT API)
const months: Record<string, string> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};

/**
 * Parse Statbel month string (e.g. "January 2025") into year and month components.
 */
function parseStatbelMonth(monthStr: string): { year: string; month: string } {
  const parts = monthStr.split(" ");
  return { year: parts[1]!, month: months[parts[0]!] || "01" };
}

/**
 * Fetch health index values from Statbel beSTAT API and cache in the database.
 * Upserts: skips rows that already exist (health index values never change once published).
 * On API failure, logs error and returns silently (retry next day per D-03).
 */
export async function fetchAndCacheHealthIndex(): Promise<void> {
  try {
    const response = await fetch(STATBEL_API_URL);
    if (!response.ok) {
      console.error(
        `[HealthIndex] Failed to fetch from Statbel: HTTP ${response.status} ${response.statusText}`
      );
      return;
    }

    const data = (await response.json()) as {
      facts: Array<{
        Year: string;
        Month: string;
        "Health index": number;
      }>;
    };

    if (!data.facts || !Array.isArray(data.facts)) {
      console.error("[HealthIndex] Failed to fetch from Statbel: unexpected response format (no facts array)");
      return;
    }

    const db = getDb();
    let inserted = 0;

    for (const fact of data.facts) {
      const { year, month } = parseStatbelMonth(fact.Month);
      const healthIndex = fact["Health index"];

      // Check if this year+month combination already exists
      const existing = await db
        .select({ id: healthIndexValues.id })
        .from(healthIndexValues)
        .where(
          and(
            eq(healthIndexValues.year, year),
            eq(healthIndexValues.month, month)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        continue; // Health index values never change once published
      }

      await db.insert(healthIndexValues).values({
        id: crypto.randomUUID(),
        year,
        month,
        value: Number(healthIndex.toFixed(2)).toString(),
        source: "statbel",
        fetchedAt: new Date(),
      });

      inserted++;
    }

    console.log(
      `[HealthIndex] Fetched ${data.facts.length} index values from Statbel, ${inserted} new`
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
