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
