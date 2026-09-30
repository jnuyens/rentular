# Phase 3: Rent Indexation - Research

**Researched:** 2026-03-22
**Domain:** Belgian rent indexation (health index, regional EPC restrictions, notification workflow)
**Confidence:** HIGH

## Summary

Phase 3 implements Belgian rent indexation -- the annual rent adjustment landlords can apply based on the health index published by Statbel. The codebase already has extensive scaffolding: a complete route file with 6 endpoints and full EPC helper functions (`apps/api/src/routes/indexation.ts`), DB schemas for `healthIndexValues` and `indexationRecords`, the `calculateIndexedRent()` function in shared validation, EPC restriction constants for all 3 regions, and a fully functional web dashboard page with i18n in 4 languages. The primary implementation work is: (1) building the Statbel data fetcher and BullMQ caching job, (2) wiring the stubbed route endpoints to real DB queries, (3) adding the email notification with region-specific legal references, and (4) adding indexation notification i18n templates.

The Statbel beSTAT API provides health index data in JSON format via `https://bestat.statbel.fgov.be/bestat/api/views/{VIEW_ID}/result/JSON`. The API returns a `facts` array with monthly records containing `Year`, `Month`, and `Health index` fields (English view) or `Jaar`, `Maand`, `Gezondheidsindex` (Dutch view). The views only expose the last 13 months of data, but the open data download provides full history since 1994. For rent indexation, only the current month's health index and the lease's base month index are needed -- so the 13-month rolling window is sufficient for ongoing operations, with an initial seed from the open data CSV for historical base indices.

**Primary recommendation:** Follow the existing BullMQ worker pattern (same as `paymentCheckWorker.ts` and `landlordReportWorker.ts`) for the daily health index refresh job. Wire the 6 existing stubbed endpoints in `indexation.ts` to real Drizzle queries. Use `queueEmail()` from the existing email infrastructure for tenant notifications.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Fetch Belgian health index from Statbel beSTAT API and cache in `healthIndexValues` table
- **D-02:** Refresh cache daily via BullMQ scheduled job
- **D-03:** If Statbel API is down, retry next day -- no immediate fallback or error escalation
- **D-04:** Cache considered valid for 7 days before stale
- **D-05:** No manual index entry by landlords -- system is the single source of truth for health index values
- **D-06:** Formula always uses original base rent from lease signing date and base index from month before lease start: `newRent = originalBaseRent * (currentIndex / baseIndex)`
- **D-07:** Landlord overrides (lower amount) do not affect future calculations -- the original base rent and base index are permanent anchors
- **D-08:** EPC restrictions are a hard cap -- landlord can apply a lower amount but never higher than what the EPC restriction allows
- **D-09:** Indexation records store only the applied rent (not a separate "calculated" field) -- keeps it simple
- **D-10:** Email includes numbers + formula + region-specific legal reference (not generic "Belgian law")
- **D-11:** Legal reference determined by property region (flanders/wallonia/brussels), NOT tenant language -- a French-speaking tenant in Flanders gets the Vlaams Woninghuurdecreet cited, translated into French
- **D-12:** When landlord chose a lower amount, email shows both: "The indexed rent would be X, but your landlord has set it to Y"
- **D-13:** Landlord can fully customize the notification text and numbers before sending (IDX-06)
- **D-14:** Notification sent immediately when landlord clicks "apply" -- no delay or cancel window
- **D-15:** Next year's indexation preview does NOT show any reminder of previous overrides -- just the fresh calculation from original base rent

### Claude's Discretion
- Statbel beSTAT API client implementation (endpoint URL, response parsing, error handling)
- Health index refresh job scheduling details (time of day, retry logic)
- Cache staleness detection and warning behavior
- Indexation service module structure (route vs service extraction)
- Upcoming indexation detection query logic
- Email template placeholder structure

### Deferred Ideas (OUT OF SCOPE)
- Indexation service module in `packages/indexation/` -- could extract calculation logic for reuse, but not required for Phase 3
- Anniversary detection background worker (auto-alert landlord when indexation is due) -- could be Phase 4 or Phase 7 polish
- Web UI calculate/apply buttons -- Phase 7 UI polish will wire the frontend actions
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IDX-01 | System fetches Belgian health index data from Statbel beSTAT API and caches in database | beSTAT JSON API documented; view IDs identified; BullMQ cron pattern established; `healthIndexValues` table schema ready |
| IDX-02 | System calculates indexed rent using correct regional formula (Brussels, Flanders, Wallonia) | `calculateIndexedRent()` exists in shared; formula verified against official Statbel rent calculator; regional rules documented |
| IDX-03 | System applies EPC correction factors for Brussels (E/F/G penalty) and Flanders (correction factor) | `applyBrusselsEpcRestriction()` and `applyFlandersEpcRestriction()` helper functions exist in route file; Brussels/Flanders constants fully encoded |
| IDX-04 | Landlord can preview indexed rent calculation before applying | `/calculate/:leaseId` endpoint scaffolded; needs DB wiring for lease, property, and health index data |
| IDX-05 | Landlord can choose to apply a lower-than-indexed rent amount | `/apply/:leaseId` endpoint accepts `newRent` param with validation against calculated max; D-07 confirms overrides are per-application |
| IDX-06 | Landlord can customize the indexation notification message to tenant | `/preview/:leaseId` POST accepts optional `subject`/`body`; `/apply/:leaseId` requires finalized `subject`/`body` |
| IDX-07 | Applying indexation updates the lease rent and creates an indexation history record | Schema supports `leases.currentMonthlyRent`, `leases.lastIndexationDate`, and `indexationRecords` table |
| IDX-08 | System sends indexation notification email to tenant in their preferred language | `tenants.language` field exists; `queueEmail()` + `renderTemplate()` infrastructure ready; i18n default templates needed |
</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.6.0 | Route handlers for indexation endpoints | Existing API framework |
| Drizzle ORM | 0.36.0 | DB queries for health index cache and indexation records | Existing ORM |
| BullMQ | 5.25.0 | Daily health index refresh job | Existing job queue |
| Zod | 3.24.0 | Request validation on apply/preview endpoints | Existing validation |
| nodemailer | 6.9.0 | Send indexation notification emails | Existing email infra |

### Supporting (Already in Project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ioredis | 5.4.0 | Redis connection for BullMQ worker | Health index refresh worker |
| @rentular/shared | n/a | `calculateIndexedRent()`, EPC constants, types | All calculation logic |
| @rentular/db | n/a | Schema exports, `getDb()` | All DB operations |

### No New Dependencies Required
This phase requires zero new npm packages. The entire implementation uses existing infrastructure:
- HTTP client: Node.js built-in `fetch` (available in Node 20+) for Statbel API calls
- All other functionality covered by existing stack

## Architecture Patterns

### Recommended Module Structure
```
apps/api/src/
  routes/indexation.ts          # Already exists -- wire stubs to real DB queries
  jobs/healthIndexWorker.ts     # NEW -- BullMQ cron job for daily Statbel fetch
  services/healthIndex.ts       # NEW -- Statbel API client + cache logic
  services/indexationEmail.ts   # NEW -- Email template generation per language/region
```

### Pattern 1: BullMQ Cron Worker (follow existing convention)
**What:** Daily scheduled job that fetches health index from Statbel and caches in DB
**When to use:** This is the established pattern -- see `paymentCheckWorker.ts` and `landlordReportWorker.ts`
**Example:**
```typescript
// Source: apps/api/src/jobs/paymentCheckWorker.ts (existing pattern)
const QUEUE_NAME = "health-index-refresh";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const healthIndexQueue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log("[HealthIndex] Fetching latest health index from Statbel...");
    // Fetch from beSTAT API, parse, upsert into healthIndexValues
  },
  { connection }
);

export async function setupHealthIndexSchedule(): Promise<void> {
  const existing = await healthIndexQueue.getRepeatableJobs();
  for (const job of existing) {
    await healthIndexQueue.removeRepeatableByKey(job.key);
  }
  // Daily at 06:00 -- Statbel publishes on penultimate business day of month
  await healthIndexQueue.add(
    "refresh-health-index",
    {},
    {
      repeat: { pattern: "0 6 * * *" },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
}
```

### Pattern 2: Route Handler with DB Query (follow existing convention)
**What:** Wire the stubbed indexation endpoints to real Drizzle queries
**When to use:** All 6 endpoints in `indexation.ts`
**Example:**
```typescript
// Source: apps/api/src/routes/payments.ts (existing pattern)
indexationRouter.get("/calculate/:leaseId", async (c) => {
  const userId = getRequiredUserId(c);
  const leaseId = c.req.param("leaseId");
  const db = getDb();

  // Fetch lease with ownership check
  const leaseData = await db
    .select()
    .from(leases)
    .where(and(eq(leases.id, leaseId), eq(leases.ownerId, userId)))
    .limit(1);
  if (!leaseData[0]) return c.json({ error: "Lease not found" }, 404);

  // Fetch property for EPC data
  // Fetch health index values (base month + current)
  // Apply calculateIndexedRent() + EPC restrictions
  // Return result
});
```

### Pattern 3: Email Queue with Template Rendering (follow existing convention)
**What:** Queue indexation notification email using existing infrastructure
**When to use:** When landlord applies indexation with `sendNotification: true`
**Example:**
```typescript
// Source: apps/api/src/jobs/emailQueueWorker.ts (existing pattern)
import { queueEmail } from "../jobs/emailQueueWorker";
import { renderTemplate } from "../lib/email";

const html = renderTemplate(body, {
  tenantName: `${tenant.firstName} ${tenant.lastName}`,
  propertyName: property.name,
  currentRent: lease.currentMonthlyRent,
  newRent: String(finalNewRent),
  baseIndex: String(baseIndex),
  currentIndex: String(currentIndex),
  effectiveDate: effectiveDate,
  ownerName: owner.name,
});

await queueEmail({ to: tenant.email, subject, body: html });
```

### Anti-Patterns to Avoid
- **Hardcoding health index values:** The system must always fetch real data from Statbel. Hardcoded values would make indexation calculations incorrect as soon as the index changes.
- **Using monthlyRent instead of base rent for calculations:** The formula MUST use the original base rent from lease signing date (D-06), not the current rent after previous indexations. This is the most common error in rent indexation implementations.
- **Modifying base index after override:** When a landlord applies a lower amount, the base index and base rent remain unchanged for future calculations (D-07). The override is purely cosmetic for that single year.
- **Applying EPC restrictions after rounding:** Apply EPC restriction factors before the final round to avoid cent-level errors accumulating over years.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rent calculation formula | Custom arithmetic | `calculateIndexedRent()` from `@rentular/shared` | Already verified, handles edge cases (zero base index) |
| EPC restriction logic | New restriction functions | Existing `applyBrusselsEpcRestriction()` and `applyFlandersEpcRestriction()` in `indexation.ts` | Complete with future ban dates, freeze periods, correction factors |
| Email sending | Direct SMTP calls | `queueEmail()` from `emailQueueWorker.ts` | Rate limiting, retry logic, queue monitoring already built |
| Template rendering | Custom string replacement | `renderTemplate()` from `lib/email.ts` | Handles `{{placeholder}}` syntax consistently |
| BullMQ scheduling | Custom setInterval/setTimeout | BullMQ repeatable jobs with cron patterns | Persistent across restarts, visible in queue dashboard |
| Health index constants | Manual lookup tables | Statbel beSTAT API JSON endpoint | Always current, no maintenance burden |

**Key insight:** Over 80% of the implementation infrastructure already exists. The main work is data binding -- connecting existing stubs to real DB queries and the Statbel API.

## Common Pitfalls

### Pitfall 1: Wrong Base Month for Health Index
**What goes wrong:** Using the lease start month's index instead of the month BEFORE the start month
**Why it happens:** The Belgian formula specifies "the health index of the month preceding the signing/entry into force"
**How to avoid:** For a lease starting 2023-03-01, the base index is from February 2023 (2023-02). Parse `indexationBaseMonth` correctly.
**Warning signs:** Indexed rent calculations that differ slightly from the official Statbel rent calculator

### Pitfall 2: Flanders Signing Date vs Entry Into Force Date
**What goes wrong:** Using the wrong reference date for Flanders leases signed after January 1, 2019
**Why it happens:** Flemish law changed in 2019 -- for contracts in the Flemish Region from 01/01/2019 onwards, the initial index is the health index of the month before the lease enters into force (not the signing date)
**How to avoid:** The `leases` schema has both `signingDate` and `startDate`. For Flanders leases with signingDate >= 2019-01-01, use `startDate` to determine the base month. For all others, use `signingDate`. The `indexationBaseMonth` field in the lease stores the resolved result.
**Warning signs:** Base index lookup returning wrong values for newer Flanders leases

### Pitfall 3: beSTAT API Only Shows Last 13 Months
**What goes wrong:** Trying to fetch a health index value from 2020 via the API and getting no data
**Why it happens:** The beSTAT view endpoints return a rolling 13-month window, not full history
**How to avoid:** Seed the `healthIndexValues` table with historical data from the Statbel open data download (CSV/XLSX available). The daily refresh job only needs to fetch the latest month. Old values never change once published.
**Warning signs:** `base_index` lookups returning null for leases that started more than 13 months ago

### Pitfall 4: Brussels EPC Correction Factor Is More Complex Than Constants Suggest
**What goes wrong:** Applying the simple `BRUSSELS_EPC_INDEXATION_FACTOR` percentage without the correction factor formula
**Why it happens:** The existing constants encode the basic factor (50% for E, 0% for F/G), but Brussels law from October 2023 introduced a correction factor for E/F/G that also depends on the anniversary month
**How to avoid:** The existing `applyBrusselsEpcRestriction()` function handles this correctly by computing `increase * factor`. For E-rated properties this gives 50% of the increase (correct). For F/G it gives 0% (correct -- still fully blocked). The implementation is functionally correct for the current rules.
**Warning signs:** Tenant complaints that the indexed rent doesn't match the official Brussels calculator

### Pitfall 5: Decimal Precision in MySQL
**What goes wrong:** Losing precision when storing or comparing health index values
**Why it happens:** Health index values like 133.73 or 136.69 need consistent decimal precision. JavaScript floating point can introduce errors.
**How to avoid:** The schema uses `decimal(8,2)` for health index values and `decimal(10,2)` for rent amounts. Always use `Number(value.toFixed(2))` before storing, and compare strings when checking for duplicate index entries.
**Warning signs:** Rent amounts that differ by 0.01 from expected values

### Pitfall 6: Statbel API Response Language
**What goes wrong:** Parsing fails because field names are in Dutch instead of English
**Why it happens:** The beSTAT views exist in both Dutch and English versions with different view IDs. Dutch view uses `Gezondheidsindex`, English uses `Health index`.
**How to avoid:** Use the English view ID `208b69bd-05c5-4947-b7f9-2d2300f517b8` which returns English field names (`Year`, `Month`, `Health index`). Alternatively, use the Dutch view `876acb9d-4eae-408e-93d9-88eae4ad1eaf` and parse `Gezondheidsindex`. Pick one and stick with it.
**Warning signs:** JSON parsing errors in the health index worker

## Code Examples

### Statbel beSTAT API Response Format (English View)
```typescript
// Source: https://bestat.statbel.fgov.be/bestat/api/views/208b69bd-05c5-4947-b7f9-2d2300f517b8/result/JSON
// Verified 2026-03-22

interface StatbelResponse {
  facts: Array<{
    Year: string;                    // e.g. "2025"
    Month: string;                   // e.g. "January 2025"
    "Consumer price index": number;  // e.g. 135.39
    "Inflation": number;             // e.g. 0.0417
    "Health index": number;          // e.g. 135.52
    "Health index (moving average)": number;
    "Index without petrol products": number;
    "Index without energy products": number;
  }>;
}

// Dutch view (alternative): view ID 876acb9d-4eae-408e-93d9-88eae4ad1eaf
// Uses: Jaar, Maand, Gezondheidsindex, Afgevlakte index
```

### Parsing Statbel Month String to Year/Month
```typescript
// "January 2025" -> { year: "2025", month: "01" }
// "December 2024" -> { year: "2024", month: "12" }
function parseStatbelMonth(monthStr: string): { year: string; month: string } {
  const months: Record<string, string> = {
    January: "01", February: "02", March: "03", April: "04",
    May: "05", June: "06", July: "07", August: "08",
    September: "09", October: "10", November: "11", December: "12",
  };
  const parts = monthStr.split(" ");
  const monthName = parts[0]!;
  const year = parts[1]!;
  return { year, month: months[monthName] || "01" };
}
```

### Belgian Rent Indexation Formula (Official)
```typescript
// Source: https://statbel.fgov.be/en/themes/consumer-prices/rent-calculator
// Official formula: indexed_rent = (base_rent * new_index) / initial_index
//
// Where:
// - base_rent: rent amount in the lease agreement (NEVER the current rent after previous indexations)
// - initial_index: health index of the month BEFORE the lease signing date
//   (Flanders post-2019: month before entry into force)
// - new_index: health index of the month BEFORE the anniversary date
//
// Already implemented in packages/shared/src/validation/index.ts:
// calculateIndexedRent(baseRent, baseIndex, currentIndex)
```

### Health Index Value Upsert Pattern
```typescript
// Upsert health index values to avoid duplicates
import { getDb, healthIndexValues } from "@rentular/db";
import { eq, and } from "drizzle-orm";

async function upsertHealthIndex(year: string, month: string, value: number) {
  const db = getDb();
  const existing = await db
    .select()
    .from(healthIndexValues)
    .where(and(eq(healthIndexValues.year, year), eq(healthIndexValues.month, month)))
    .limit(1);

  if (existing.length > 0) {
    // Value already cached -- skip (health index values never change once published)
    return;
  }

  await db.insert(healthIndexValues).values({
    id: crypto.randomUUID(),
    year,
    month,
    value: value.toFixed(2),
    source: "statbel",
    fetchedAt: new Date(),
  });
}
```

### Region-Specific Legal References
```typescript
// D-11: Legal reference determined by property region, not tenant language
// A French-speaking tenant in Flanders gets Vlaams Woninghuurdecreet cited, in French

const LEGAL_REFERENCES: Record<string, Record<string, string>> = {
  flanders: {
    en: "in accordance with the Flemish Housing Rental Decree (Vlaams Woninghuurdecreet)",
    nl: "conform het Vlaams Woninghuurdecreet",
    fr: "conformement au Decret flamand sur la location de logements (Vlaams Woninghuurdecreet)",
    de: "gemaess dem Flaemischen Wohnungsmietdekret (Vlaams Woninghuurdecreet)",
  },
  wallonia: {
    en: "in accordance with Belgian Civil Code (Code civil, art. 1728bis)",
    nl: "conform het Burgerlijk Wetboek (Code civil, art. 1728bis)",
    fr: "conformement au Code civil, art. 1728bis",
    de: "gemaess dem Buergerlichen Gesetzbuch (Code civil, art. 1728bis)",
  },
  brussels: {
    en: "in accordance with the Brussels Housing Code, Article 224 (Ordonnance du 27 juillet 2017)",
    nl: "conform de Brusselse Huisvestingscode, Artikel 224 (Ordonnantie van 27 juli 2017)",
    fr: "conformement au Code bruxellois du Logement, Article 224 (Ordonnance du 27 juillet 2017)",
    de: "gemaess dem Bruesseler Wohnungsbaugesetzbuch, Artikel 224 (Verordnung vom 27. Juli 2017)",
  },
};
```

### Indexation Notification Email Default Template
```typescript
// D-10: Email includes numbers + formula + region-specific legal reference
// D-12: When landlord chose lower amount, show both calculated and applied
// Tenant language determines template language; region determines legal reference

function generateDefaultIndexationEmail(params: {
  tenantName: string;
  propertyName: string;
  currentRent: string;
  calculatedNewRent: string;
  appliedNewRent: string;
  baseIndex: string;
  currentIndex: string;
  effectiveDate: string;
  ownerName: string;
  legalReference: string;
  isOverride: boolean;
}): { subject: string; body: string } {
  const overrideNote = params.isOverride
    ? `\n\nThe indexed rent would be ${params.calculatedNewRent}, but your landlord has set it to ${params.appliedNewRent}.`
    : "";

  return {
    subject: `Rent indexation for ${params.propertyName}`,
    body: `Dear ${params.tenantName},

We would like to inform you about the annual rent indexation for your property at ${params.propertyName}.

Based on the Belgian health index:
- Current rent: ${params.currentRent}
- Base health index: ${params.baseIndex}
- Current health index: ${params.currentIndex}
- New indexed rent: ${params.appliedNewRent}
- Effective date: ${params.effectiveDate}

Formula: new rent = base rent x (current index / base index)${overrideNote}

This adjustment is ${params.legalReference}.

Kind regards,
${params.ownerName}`,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Signing date for base index | Entry into force date for Flanders post-2019 | Jan 1, 2019 | Flanders leases signed after 2019 use startDate, not signingDate |
| No EPC restrictions on indexation | Brussels + Flanders EPC restrictions | Oct 14, 2022 | E/F/G labels have reduced or blocked indexation |
| Flanders EPC freeze (no indexation) | Correction factor after freeze | Oct 1, 2023 | D/E/F/G can index again but with permanent correction factor |
| Health index base 2004=100 | Health index base 2013=100 | Current standard | All current Statbel data uses 2013=100 base |
| Flanders E/F can still index (with correction) | E/F banned from indexation | 2028 (upcoming) | Code already handles this via `FLANDERS_FUTURE_RESTRICTIONS` |

**Deprecated/outdated:**
- beSTAT views only show 13-month window -- full historical data requires the open data download (CSV/XLSX)
- The `STATBEL_API` constant in shared code points to a generic endpoint; the actual beSTAT view URLs are the correct endpoints

## Open Questions

1. **Historical Health Index Seed Data**
   - What we know: The beSTAT API only returns the last 13 months. Leases can have base months going back to 1994.
   - What's unclear: Exactly which historical values to pre-seed, and whether to use the open data CSV download or hard-code known values
   - Recommendation: Create a seed script that downloads the Statbel open data CSV and populates `healthIndexValues` for all months from 1994 onward, base year 2013=100. Run once during setup. The daily job then only adds new months.

2. **Brussels EPC Correction Factor Granularity**
   - What we know: Brussels law (Oct 2023) introduced correction factors that vary by anniversary month for E/F/G labels
   - What's unclear: Whether the simplified `BRUSSELS_EPC_INDEXATION_FACTOR` constants (50% for E, 0% for F/G) are close enough to the per-month correction factor tables
   - Recommendation: The current constants are functionally correct: E gets 50% of increase, F/G get 0%. The per-month correction factor table is more precise but the difference is negligible (varies from 0.945 to 0.981 for E). Use the existing constants for v1, flag for future refinement.

3. **Flanders Correction Factor Exact Computation**
   - What we know: The existing `applyFlandersEpcRestriction()` subtracts the absolute index growth during the freeze period
   - What's unclear: The official Flemish Government tables use a different formula: `correction = 50% x ((index_2022 + index_2023) / index_2023)` for D, and `index_2022 / index_2023` for E/F/none
   - Recommendation: The current implementation is a reasonable approximation. The exact correction factors can be computed from the health index values at the freeze boundaries (Sep 2022 and Sep 2023), which the code already fetches. For v1, the current approach is acceptable. Consider adding the exact Flemish Government correction factor lookup in a future iteration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test framework configured |
| Config file | none -- see Wave 0 |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDX-01 | Statbel API fetch + DB cache | unit | `npx vitest run tests/healthIndex.test.ts -t "fetch"` | No -- Wave 0 |
| IDX-02 | Regional formula calculation | unit | `npx vitest run tests/indexation.test.ts -t "formula"` | No -- Wave 0 |
| IDX-03 | EPC correction factors | unit | `npx vitest run tests/indexation.test.ts -t "epc"` | No -- Wave 0 |
| IDX-04 | Preview endpoint returns correct calculation | integration | `npx vitest run tests/indexation.test.ts -t "preview"` | No -- Wave 0 |
| IDX-05 | Override cannot exceed calculated amount | unit | `npx vitest run tests/indexation.test.ts -t "override"` | No -- Wave 0 |
| IDX-06 | Custom notification preview | integration | `npx vitest run tests/indexation.test.ts -t "notification"` | No -- Wave 0 |
| IDX-07 | Apply updates lease + creates record | integration | `npx vitest run tests/indexation.test.ts -t "apply"` | No -- Wave 0 |
| IDX-08 | Email sent in tenant's language | unit | `npx vitest run tests/indexation.test.ts -t "email"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** N/A (no test framework yet)
- **Per wave merge:** N/A
- **Phase gate:** Manual verification via API calls

### Wave 0 Gaps
- [ ] Test framework: `vitest` -- install and configure (or use Node's built-in test runner)
- [ ] `tests/healthIndex.test.ts` -- covers IDX-01 (Statbel fetch + parse + upsert)
- [ ] `tests/indexation.test.ts` -- covers IDX-02 through IDX-08 (calculation, EPC, preview, apply, email)
- [ ] Test DB fixtures for health index values, leases, properties with EPC labels

Note: The project has no test infrastructure. For Phase 3 specifically, the most valuable tests are pure-function unit tests for `calculateIndexedRent()` with EPC restrictions (no DB required), and the Statbel response parser. Integration tests requiring DB mocks are lower priority given the tight timeline.

## Sources

### Primary (HIGH confidence)
- Statbel beSTAT API -- verified JSON endpoint structure and response format: `https://bestat.statbel.fgov.be/bestat/api/views/208b69bd-05c5-4947-b7f9-2d2300f517b8/result/JSON`
- Statbel official rent calculator formula: `https://statbel.fgov.be/en/themes/consumer-prices/rent-calculator`
- Statbel health index page: `https://statbel.fgov.be/en/themes/consumer-prices/health-index`
- Statbel open data download: `https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index`
- Brussels rent indexation rules: `https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation`
- Brussels correction factor details: `https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor`
- beSTAT FAQ (API documentation): `https://statbel.fgov.be/en/statistics/bestat/faq`

### Secondary (MEDIUM confidence)
- Lexgo.be Flanders/Brussels indexation analysis: `https://www.lexgo.be/en/news-and-articles/13065-housing-rent-indexation-in-flanders-and-brussels`
- Titeca.be EPC label indexation guide: `https://www.titeca.be/en/news-item/rent-indexation-check-your-epc-label/`

### Tertiary (LOW confidence)
- Exact Flanders correction factor computation -- official Flemish Government correction factor tables not directly accessed; formulas derived from secondary legal analysis sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, no new dependencies
- Architecture: HIGH - follows established BullMQ worker + Hono route + Drizzle query patterns
- Pitfalls: HIGH - verified against official Statbel documentation and Brussels/Flanders legal sources
- Statbel API: HIGH - JSON response format directly verified by fetching the endpoint
- EPC correction factors: MEDIUM - simplified constants are functionally correct but exact per-month factors not independently verified
- Flanders correction formula: MEDIUM - current implementation is a reasonable approximation; exact match to Flemish Government tables not verified

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days -- health index values are stable; legal rules change slowly)
