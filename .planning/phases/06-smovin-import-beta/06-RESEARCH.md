# Phase 6: Smovin Import (Beta) - Research

**Researched:** 2026-03-25
**Domain:** Web scraping (Playwright), data import pipeline, real-time progress UX, credential encryption
**Confidence:** MEDIUM (scraping viability is inherently LOW; pipeline/architecture is HIGH)

## Summary

This phase implements a Smovin-to-Rentular data import feature using Playwright with stealth plugin to scrape the user's own Smovin account (app.smovin.be). The architecture follows a three-stage pipeline: (1) credential submission and encrypted storage, (2) BullMQ-powered scraping job that discovers all properties/tenants/leases/payments, (3) user-selected import of discovered data into Rentular's existing schema.

The primary risk is Cloudflare anti-bot detection on Smovin's app. The CONTEXT.md mandates a spike test (Task 0) as a hard gate before building the full pipeline. This is the correct approach -- if the spike fails, no further implementation proceeds.

The existing codebase provides strong foundations: AES-256-GCM encryption already exists in `apps/api/src/lib/encryption.ts`, BullMQ worker patterns are well-established across 4+ existing workers, and the Drizzle schema covers all target data models (properties, tenants, leases, payments). The main new dependencies are `playwright-extra` (v4.3.6) and `puppeteer-extra-plugin-stealth` (v2.11.2).

**Primary recommendation:** Implement as two BullMQ jobs (discovery + import), use polling for progress updates (simpler than SSE given existing patterns), store encrypted credentials in a new `import_sessions` table with TTL-based cleanup, and match Smovin data to Rentular schema using address matching for properties and email matching for tenants.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use Playwright (with stealth plugin) as the scraping engine. No browser extension, no CSV upload.
- **D-02:** Include an early spike test (Task 0) that logs into Smovin and scrapes one property page. If Cloudflare blocks it, STOP and reassess before building the full pipeline. Do not pre-build a fallback -- decide the pivot at that point.
- **D-03:** Use playwright-extra with stealth plugin, real browser fingerprint, human-like delays between actions to maximize success against Cloudflare detection.
- **D-04:** Smovin credentials (email + password) are encrypted and stored in the database during the import process. They are deleted immediately after successful import completion.
- **D-05:** If the import fails, credentials remain in the database so the user can retry without re-entering. A cleanup mechanism is needed (manual delete button or TTL-based expiry) for permanently failed imports.
- **D-06:** Skip duplicates -- match on property address for properties and email for tenants. If a match exists in Rentular, skip silently. Do not overwrite or prompt.
- **D-07:** Smovin data is mapped to Rentular's existing schema (properties, tenants, leases, payments). No new tables needed for imported data -- it becomes regular Rentular data.
- **D-08:** Selective import -- scrape all data from Smovin first, then present a list of discovered properties with their associated tenants/leases/payments. User picks which properties to import.
- **D-09:** The scrape-then-select flow means two phases: (1) discovery/scraping phase that collects everything, (2) import phase that writes selected data to the database.
- **D-10:** Real-time log with progress bar on the import page. User stays on the page and sees live updates.
- **D-11:** Use BullMQ job for the scraping/import work. Push updates to the frontend via polling or SSE.

### Claude's Discretion
- Polling vs SSE for progress updates -- choose based on existing patterns
- Encryption algorithm for stored credentials -- use existing patterns
- Smovin page navigation strategy and DOM selector design
- Whether scraping and import run as one BullMQ job or two separate jobs

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMP-01 | User can enter Smovin credentials in Rentular import settings | Frontend page under dashboard, Hono route for credential submission, AES-256-GCM encryption via existing `encryption.ts` |
| IMP-02 | System scrapes properties, tenants, leases, and payment history from user's own Smovin account | Playwright-extra + stealth plugin in BullMQ worker, Smovin navigation strategy with human-like delays |
| IMP-03 | Scraped data is mapped to Rentular's data model and imported | Data mapping layer from Smovin DOM data to Rentular schema (properties, tenants, leases, payments tables) |
| IMP-04 | User sees import progress and results (counts, errors) | BullMQ job.updateProgress() + polling endpoint on Hono route, frontend progress UI |
| IMP-05 | Credentials are used once for import and never persisted | Encrypted storage during session with auto-delete on completion, TTL-based cleanup for failed imports |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | 1.58.2 | Browser automation engine | Industry standard, Microsoft-maintained, headless Chromium |
| playwright-extra | 4.3.6 | Plugin framework for Playwright | Enables stealth plugin integration, drop-in replacement for playwright |
| puppeteer-extra-plugin-stealth | 2.11.2 | Anti-detection evasions | 450k+ weekly npm downloads, patches navigator.webdriver, spoofs plugins/fonts, works with playwright-extra |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bullmq | 5.25.0 (existing) | Job queue for scraping/import | Already in stack -- pattern established by emailQueueWorker |
| jose | 6.2.1 (existing) | Already in API deps | NOT needed -- use existing `encryption.ts` (Node.js crypto AES-256-GCM) instead |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| playwright-extra | Raw Playwright | No stealth evasions, higher detection risk |
| Polling | SSE (Server-Sent Events) | SSE requires new infrastructure (Hono SSE helper, keep-alive); polling is simpler and matches existing fetch-based frontend patterns |
| Two BullMQ jobs | Single long-running job | Two jobs (discover + import) give cleaner separation, allow user selection between phases, and prevent timeout issues on very large accounts |

**Installation:**
```bash
cd apps/api && pnpm add playwright playwright-extra puppeteer-extra-plugin-stealth
```

**Post-install browser setup:**
```bash
npx playwright install chromium --with-deps
```

**Version verification:** Verified against npm registry on 2026-03-25:
- playwright: 1.58.2
- playwright-extra: 4.3.6
- puppeteer-extra-plugin-stealth: 2.11.2

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
  routes/
    import.ts              # Hono router: POST /credentials, GET /status, POST /start-import, DELETE /credentials
  jobs/
    importDiscoveryWorker.ts  # BullMQ worker: scrapes Smovin, stores discovered data as JSON
    importWriteWorker.ts      # BullMQ worker: writes selected properties to Rentular DB
  services/
    smovinScraper.ts          # Playwright logic: login, navigate, extract data from DOM
    smovinMapper.ts           # Maps Smovin data structures to Rentular schema
packages/db/src/schema/
  imports.ts                  # import_sessions table (id, userId, status, encrypted creds, discovered data, progress, timestamps)
apps/web/app/(dashboard)/
  import/
    page.tsx                  # Import page: credential form, progress display, property selection, results
apps/web/messages/{locale}/
  common.json                # Add import-related i18n keys
```

### Pattern 1: Two-Phase BullMQ Job Architecture
**What:** Split the import into two separate BullMQ jobs: discovery (scraping) and import (writing).
**When to use:** When user interaction is needed between scraping and database writes (D-08 selective import).
**Why two jobs:** The discovery job scrapes everything and stores results as JSON in the import_sessions table. The user then selects which properties to import. The import job reads the selection and writes to the database. This avoids holding a browser open during user decision time.

```typescript
// Discovery worker pattern
const discoveryWorker = new Worker(
  "import-discovery",
  async (job) => {
    const { sessionId } = job.data;
    const db = getDb();

    // Get encrypted credentials from import_sessions
    const session = await db.select().from(importSessions)
      .where(eq(importSessions.id, sessionId)).limit(1);
    if (!session[0]) throw new Error("Import session not found");

    const email = decrypt(session[0].credentialEmail, session[0].credentialEmailIv, session[0].credentialEmailTag);
    const password = decrypt(session[0].credentialPassword, session[0].credentialPasswordIv, session[0].credentialPasswordTag);

    // Launch browser with stealth
    const { chromium } = require("playwright-extra");
    const stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
        locale: "fr-BE",
      });
      const page = await context.newPage();

      // Login to Smovin
      await job.updateProgress({ step: "login", message: "Logging into Smovin..." });
      // ... login logic ...

      // Scrape properties
      await job.updateProgress({ step: "properties", message: "Discovering properties...", count: 0 });
      // ... scraping logic with human-like delays ...

      // Store discovered data
      await db.update(importSessions).set({
        status: "discovered",
        discoveredData: JSON.stringify(discoveredProperties),
        updatedAt: new Date(),
      }).where(eq(importSessions.id, sessionId));
    } finally {
      await browser.close();
    }
  },
  { connection, concurrency: 1 }
);
```

### Pattern 2: Polling-Based Progress Updates
**What:** Frontend polls a status endpoint every 2-3 seconds to get progress updates.
**When to use:** For the import progress display (D-10).
**Why polling over SSE:** The existing frontend uses @tanstack/react-query with standard fetch calls. SSE would require new infrastructure. Polling is simple, reliable, and matches existing patterns.

```typescript
// Route handler
importRouter.get("/status/:sessionId", async (c) => {
  const userId = getRequiredUserId(c);
  const sessionId = c.req.param("sessionId");

  const session = await db.select({
    id: importSessions.id,
    status: importSessions.status,
    progress: importSessions.progress,
    discoveredData: importSessions.discoveredData,
    errorMessage: importSessions.errorMessage,
    importedCounts: importSessions.importedCounts,
  }).from(importSessions)
    .where(and(
      eq(importSessions.id, sessionId),
      eq(importSessions.userId, userId),
    )).limit(1);

  if (!session[0]) return c.json({ error: "Session not found" }, 404);
  return c.json({ data: session[0] });
});

// Frontend polling with react-query
const { data } = useQuery({
  queryKey: ["import-status", sessionId],
  queryFn: () => fetch(`/api/v1/import/status/${sessionId}`).then(r => r.json()),
  refetchInterval: isActive ? 2000 : false, // Poll every 2s while active
});
```

### Pattern 3: Credential Encryption Using Existing Library
**What:** Use the existing `apps/api/src/lib/encryption.ts` (AES-256-GCM) for Smovin credentials.
**When to use:** Encrypting/decrypting email and password stored in import_sessions table.
**Why this over jose:** The encryption.ts module already exists, uses the same AUTH_SECRET-derived key, and provides encrypt()/decrypt() functions. No need to introduce a second encryption pattern.

```typescript
import { encrypt, decrypt } from "../lib/encryption";

// Encrypt credentials before storage
const encEmail = encrypt(smovinEmail);
const encPassword = encrypt(smovinPassword);

await db.insert(importSessions).values({
  id: crypto.randomUUID(),
  userId: ownerId,
  status: "pending",
  credentialEmail: encEmail.encrypted,
  credentialEmailIv: encEmail.iv,
  credentialEmailTag: encEmail.tag,
  credentialPassword: encPassword.encrypted,
  credentialPasswordIv: encPassword.iv,
  credentialPasswordTag: encPassword.tag,
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

### Pattern 4: import_sessions Database Schema
**What:** New table to track import sessions, store encrypted credentials, and hold discovered/imported data.

```typescript
// packages/db/src/schema/imports.ts
export const importSessions = mysqlTable("import_sessions", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  status: mysqlEnum("status", [
    "pending",        // Credentials submitted, waiting to start
    "discovering",    // Scraping in progress
    "discovered",     // Scraping complete, awaiting user selection
    "importing",      // Writing selected data to DB
    "completed",      // Import finished successfully
    "failed",         // Import failed (credentials retained for retry)
  ]).default("pending").notNull(),
  // Encrypted Smovin credentials (AES-256-GCM via encryption.ts)
  credentialEmail: text("credential_email"),
  credentialEmailIv: varchar("credential_email_iv", { length: 50 }),
  credentialEmailTag: varchar("credential_email_tag", { length: 50 }),
  credentialPassword: text("credential_password"),
  credentialPasswordIv: varchar("credential_password_iv", { length: 50 }),
  credentialPasswordTag: varchar("credential_password_tag", { length: 50 }),
  // Progress tracking (JSON object with step, message, counts)
  progress: json("progress"),
  // Discovered data from Smovin (JSON: array of properties with nested tenants/leases/payments)
  discoveredData: json("discovered_data"),
  // User's selection of which properties to import (JSON: array of property indices)
  selectedProperties: json("selected_properties"),
  // Import results
  importedCounts: json("imported_counts"), // { properties: N, tenants: N, leases: N, payments: N }
  errorMessage: text("error_message"),
  // BullMQ job IDs for status tracking
  discoveryJobId: varchar("discovery_job_id", { length: 100 }),
  importJobId: varchar("import_job_id", { length: 100 }),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("import_sessions_user_idx").on(table.userId),
}));
```

### Anti-Patterns to Avoid
- **Storing credentials in plaintext:** Always use encrypt()/decrypt() from encryption.ts. Never log credentials.
- **Holding browser open during user selection:** Close the browser after discovery. Store results in DB. Open a new browser only if retry is needed.
- **Single monolithic scraping function:** Break scraping into discrete steps (login, list properties, scrape property detail, scrape tenants, etc.) so progress can be reported granularly and failures are isolated.
- **Scraping without delays:** Cloudflare and Smovin will detect rapid-fire requests. Add randomized delays (1-3s) between page navigations and use human-like mouse movements.
- **Running Playwright in the API process at import time:** Always use BullMQ workers. Browser automation is CPU/memory intensive and should not block API request handling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser stealth/anti-detection | Custom navigator patches | puppeteer-extra-plugin-stealth | Maintains 10+ evasion techniques, regularly updated against new detection methods |
| Credential encryption | Custom crypto implementation | Existing `encryption.ts` | Already uses AES-256-GCM with AUTH_SECRET key derivation, battle-tested in SMTP settings |
| Job queue with retry | Custom setTimeout/setInterval | BullMQ (existing) | Handles retries, progress tracking, failure tracking, concurrency control |
| Progress polling | WebSocket server | react-query refetchInterval + Hono GET endpoint | 5 lines of code vs. WebSocket server setup, sufficient for 2-3s polling |
| DOM data extraction | Raw string parsing/regex | Playwright page.$$eval / page.evaluate | Handles dynamic content, waits for elements, provides CSS/XPath selectors |

**Key insight:** The project already has encryption, job queues, and frontend data fetching patterns. The only genuinely new technology is Playwright for browser automation.

## Common Pitfalls

### Pitfall 1: Cloudflare Blocking (PRIMARY RISK)
**What goes wrong:** Smovin uses Cloudflare which detects automated browsers and serves challenge pages or blocks entirely.
**Why it happens:** Cloudflare analyzes browser fingerprints, TLS handshake characteristics, JavaScript execution patterns, and behavioral signals (mouse movement, scroll patterns, timing).
**How to avoid:**
- Use playwright-extra with stealth plugin (patches navigator.webdriver, spoofs plugins/fonts)
- Set realistic user agent strings
- Add randomized delays (1-3 seconds) between navigations
- Set locale to `fr-BE` or `nl-BE` (matching Belgian users)
- Use `headless: true` with stealth (headless mode is better patched by stealth plugin than headed mode in Docker)
- Consider setting `args: ['--disable-blink-features=AutomationControlled']` on browser launch
**Warning signs:** Spike test fails to reach the Smovin dashboard; page returns Cloudflare challenge HTML; HTTP 403/1020 errors.

### Pitfall 2: Smovin DOM Changes Breaking Selectors
**What goes wrong:** Smovin updates their frontend, CSS classes or HTML structure changes, selectors no longer match.
**Why it happens:** Smovin is a SaaS that likely deploys frequently. DOM selectors are inherently fragile.
**How to avoid:**
- Prefer `data-*` attributes and semantic selectors over class-based selectors
- Use `text=` selectors for stable label-based matching where possible
- Build selectors that are resilient (e.g., `table >> tr >> td:nth-child(2)` rather than `.css-hash-abc123`)
- Log the full HTML of unexpected pages for debugging
- Wrap each scraping step in try-catch with descriptive error messages
**Warning signs:** Scraper returns empty arrays; progress stalls at a specific step; error logs show "element not found".

### Pitfall 3: Playwright Memory/Resource Consumption
**What goes wrong:** Chromium process consumes excessive memory on the VPS, crashes, or starves other services.
**Why it happens:** Each Chromium instance uses 200-500MB+ of memory. Concurrent imports compound this.
**How to avoid:**
- Set BullMQ concurrency to 1 for import workers (only one browser at a time)
- Close browser in `finally` block to prevent zombie processes
- Set `--disable-dev-shm-usage` flag for Docker environments
- Consider `--single-process` flag to reduce memory footprint
- Set a job timeout (e.g., 10 minutes) to kill stuck browser sessions
**Warning signs:** OOM kills in Docker logs; API server becoming unresponsive during imports.

### Pitfall 4: Credential Cleanup Race Conditions
**What goes wrong:** Credentials are not cleaned up after import, or are cleaned up prematurely during a retry.
**Why it happens:** If the import fails and the user retries, the cleanup must not run. If the user never retries, credentials linger indefinitely.
**How to avoid:**
- Delete credentials ONLY on successful completion (status = "completed")
- Add a "delete credentials" button on the import page for manual cleanup
- Add TTL-based expiry: a cron job that deletes credentials from sessions older than 7 days regardless of status
- Never delete the import_session row itself (keep for audit) -- just null out the credential columns
**Warning signs:** Encrypted credentials still present in DB weeks after import.

### Pitfall 5: Large Data Volumes
**What goes wrong:** A landlord with 100+ properties on Smovin creates a massive discovered_data JSON blob and a very long scraping job.
**Why it happens:** Scraping is sequential (one page at a time with delays). 100 properties * 3-5 sub-pages * 2s delay = 10-25 minutes.
**How to avoid:**
- Set generous BullMQ job timeout (30 minutes)
- Report progress granularly (per-property, not per-phase)
- Store discovered data incrementally (update JSON as each property is scraped)
- Consider paginating the discovered data display on the frontend
**Warning signs:** Job times out; discoveredData JSON exceeds MySQL column limits (use `json` type which supports up to 1GB).

### Pitfall 6: Playwright Installation in Production Docker
**What goes wrong:** Playwright browsers are not installed in the Docker image, scraping fails at runtime.
**Why it happens:** `playwright install chromium --with-deps` must run during Docker build. The browser binaries are ~400MB and need system dependencies (libX11, libnss3, libatk, etc.).
**How to avoid:**
- Add `RUN npx playwright install chromium --with-deps` to the API Dockerfile
- OR use the official `mcr.microsoft.com/playwright:v1.58.2-noble` base image
- Pin Playwright version in package.json to match the Docker image version
- Test the Docker image before deploying to production
**Warning signs:** "Executable doesn't exist" or "missing shared library" errors at runtime.

## Code Examples

### Playwright-Extra Setup with Stealth
```typescript
// Source: https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

export async function createStealthBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "fr-BE",
    timezoneId: "Europe/Brussels",
    viewport: { width: 1920, height: 1080 },
  });
  return { browser, context };
}
```

### Human-Like Delay Utility
```typescript
// Source: common scraping pattern
function randomDelay(minMs = 1000, maxMs = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Use between navigations
await page.goto("https://app.smovin.be/properties");
await randomDelay(1500, 3000);
```

### BullMQ Worker with Progress Reporting
```typescript
// Source: Existing emailQueueWorker.ts pattern + BullMQ docs
import { Worker, Queue } from "bullmq";

const QUEUE_NAME = "import-discovery";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

export const importDiscoveryQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
    timeout: 1800000, // 30 minutes
  },
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[ImportDiscovery] Starting discovery for session ${job.data.sessionId}`);

    await job.updateProgress({
      step: "login",
      message: "Connecting to Smovin...",
      current: 0,
      total: 0,
    });

    // ... scraping logic ...

    await job.updateProgress({
      step: "properties",
      message: `Discovering property 3 of 12...`,
      current: 3,
      total: 12,
    });
  },
  {
    connection,
    concurrency: 1, // One browser at a time
  }
);

worker.on("failed", (job, err) => {
  console.error(`[ImportDiscovery] Job ${job?.id} failed:`, err.message);
});
```

### Smovin Data Mapping (Conceptual)
```typescript
// Map Smovin scraped property to Rentular property insert
interface SmovinProperty {
  name: string;
  address: string; // "Rue de la Loi 16, 1000 Bruxelles"
  type: string;    // "Appartement", "Maison", etc.
  tenants: SmovinTenant[];
  contracts: SmovinContract[];
}

function mapPropertyType(smovinType: string): "apartment" | "house" | "studio" | "commercial" | "garage" | "other" {
  const mapping: Record<string, string> = {
    "appartement": "apartment",
    "apartment": "apartment",
    "maison": "house",
    "house": "house",
    "studio": "studio",
    "commercial": "commercial",
    "garage": "garage",
    "parking": "garage",
  };
  return (mapping[smovinType.toLowerCase()] || "other") as any;
}

function parseAddress(fullAddress: string): {
  street: string;
  streetNumber: string;
  postalCode: string;
  city: string;
} {
  // Belgian address: "Rue de la Loi 16, 1000 Bruxelles"
  // Parse street+number, postal code, city
  // This needs robust parsing -- Belgian addresses can be complex
  // ...
}
```

### Progress Polling on Frontend
```typescript
// Source: Existing @tanstack/react-query pattern
"use client";
import { useQuery, useMutation } from "@tanstack/react-query";

function ImportProgress({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["import-status", sessionId],
    queryFn: async () => {
      const res = await fetch(`${apiUrl}/api/v1/import/status/${sessionId}`, {
        credentials: "include",
      });
      return res.json();
    },
    refetchInterval: (data) => {
      const status = data?.data?.status;
      // Stop polling when terminal
      if (status === "completed" || status === "failed" || status === "discovered") {
        return false;
      }
      return 2000; // Poll every 2 seconds while active
    },
  });

  const session = data?.data;
  const progress = session?.progress;

  return (
    <div>
      <p>{progress?.message}</p>
      {progress?.total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="bg-blue-600 h-2.5 rounded-full"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

## Smovin Application Structure (Research Findings)

**Confidence:** LOW -- based on help documentation and marketing pages, not direct app inspection.

Smovin's web application lives at `app.smovin.be`. Based on help center documentation:

### Known Sections
| Smovin Section | Contains | Rentular Mapping |
|---------------|----------|------------------|
| Patrimony / Properties | Property list with address, type, EPC, photos | `properties` table |
| Contracts | Lease details: signing date, start date, rent, charges, end date | `leases` table |
| Address Book / Contacts | Tenant details: name, email, phone | `tenants` table |
| Management | Financial records, rent requests/receipts | `payments` table |

### Smovin Data Fields (from help docs)
**Properties:** Owner, address, type (apartment/house/etc.), description, surface area, EPC certificate, photos, associated building
**Contracts:** Signing date, start date, end date, rent amount, fixed charges/advance payments, rental units
**Contacts:** Name, email, phone, role (tenant/owner/guarantor/provider)
**Payments:** Payment status, invoices, rent receipts

### Navigation Strategy (must be validated by spike test)
1. Login at `app.smovin.be` (or similar login URL)
2. Navigate to Patrimony/Properties section
3. List all properties (may require pagination)
4. For each property, navigate to detail page to get full address and metadata
5. For each property, find associated contracts/leases
6. For each contract, find associated tenants and payment history
7. Navigate to Address Book for complete tenant details if needed

**CRITICAL:** The exact URL patterns, DOM structure, and navigation flow must be discovered during the spike test. The help documentation provides conceptual structure but not implementation details.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| puppeteer with stealth | playwright-extra with stealth | 2023-2024 | Better cross-browser support, more active maintenance |
| Manual WebSocket for progress | BullMQ job.updateProgress() + QueueEvents | BullMQ v4+ | Built-in progress tracking eliminates custom pub/sub |
| Headless Chrome raw | playwright-extra v4.3 | 2024 | Stable plugin API, compatible with puppeteer-extra-plugin-stealth |

**Deprecated/outdated:**
- `playwright-extra-plugin-stealth` (npm package): This is a placeholder (v0.0.1, 5 years old). Use `puppeteer-extra-plugin-stealth` instead -- it works with playwright-extra.
- `playwright-stealth` (separate npm package): Third-party alternative. Use the official `puppeteer-extra-plugin-stealth` via `playwright-extra` for better maintenance.

## Open Questions

1. **Smovin's exact DOM structure and URL patterns**
   - What we know: Main sections are Patrimony, Contracts, Address Book, Management
   - What's unclear: Exact URLs, CSS selectors, whether it's an SPA (Vue/React/Angular), pagination patterns
   - Recommendation: The spike test (Task 0) must discover this. No pre-work needed -- the spike IS the discovery.

2. **Cloudflare detection level on app.smovin.be**
   - What we know: Smovin likely uses Cloudflare (Belgian SaaS common pattern). Stealth plugin works for many Cloudflare sites.
   - What's unclear: Which Cloudflare tier (Basic/Pro/Enterprise), whether Turnstile CAPTCHA is used on login
   - Recommendation: Spike test will determine. If Turnstile CAPTCHA blocks login, the approach may need external CAPTCHA solving service or manual user intervention.

3. **Smovin session duration and rate limits**
   - What we know: Nothing specific
   - What's unclear: How long a session stays valid, whether Smovin rate-limits page requests, whether concurrent sessions are allowed
   - Recommendation: Spike test should measure session behavior. Build with conservative delays (2-3s between pages).

4. **Docker deployment of Playwright**
   - What we know: Project runs on Proxmox/Hetzner VPS with Docker. No Dockerfile exists yet.
   - What's unclear: Whether the API currently runs in Docker or bare-metal
   - Recommendation: Document Playwright's system dependencies. If Docker is used, need `npx playwright install chromium --with-deps` in the build step. Minimum 512MB extra memory for Chromium.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test infrastructure exists in this project |
| Config file | none -- see Wave 0 |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMP-01 | User can submit credentials, they are encrypted and stored | manual-only | Manual: submit form, check DB row has encrypted fields | N/A |
| IMP-02 | System scrapes Smovin account | manual-only | Manual: run spike test against real Smovin account | N/A |
| IMP-03 | Data mapped and imported correctly | manual-only | Manual: verify imported properties/tenants/leases match Smovin data | N/A |
| IMP-04 | Progress displayed in real-time | manual-only | Manual: observe UI during import | N/A |
| IMP-05 | Credentials deleted after completion | manual-only | Manual: check DB after successful import, credential columns should be NULL | N/A |

**Justification for manual-only:** This phase is entirely dependent on scraping a third-party website (Smovin). Automated tests cannot authenticate against Smovin without real credentials, and mocking the entire Smovin DOM would provide false confidence. The spike test IS the validation.

### Sampling Rate
- **Per task commit:** Manual verification against development Smovin account
- **Per wave merge:** Full end-to-end import test with real Smovin account
- **Phase gate:** Successful import of at least one property with tenant and lease data

### Wave 0 Gaps
None -- no test infrastructure to set up. All validation is manual for this scraping-based phase.

## Sources

### Primary (HIGH confidence)
- [playwright-extra GitHub](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) - Installation, API, stealth plugin integration
- [BullMQ Events docs](https://docs.bullmq.io/guide/events) - Progress tracking via QueueEvents
- [BullMQ Workers docs](https://docs.bullmq.io/guide/workers) - job.updateProgress() API
- Existing codebase: `apps/api/src/lib/encryption.ts` - AES-256-GCM encrypt/decrypt
- Existing codebase: `apps/api/src/jobs/emailQueueWorker.ts` - BullMQ worker pattern
- npm registry (verified 2026-03-25) - Package versions: playwright 1.58.2, playwright-extra 4.3.6, puppeteer-extra-plugin-stealth 2.11.2

### Secondary (MEDIUM confidence)
- [Smovin Help Center](https://help.smovin.app/en/articles/2524025-get-started-with-smovin) - App sections and data model concepts
- [dev.to Cloudflare bypass guide](https://dev.to/hasdata_com/nodejs-playwright-stealth-bypass-cloudflare-1020-in-5-minutes-3e03) - Stealth setup patterns with human-like delays
- [Smovin features pages](https://www.smovin.app/en-be/features/) - Data fields for properties, contracts, address book

### Tertiary (LOW confidence)
- Smovin DOM structure: NOT verified. Must be discovered by spike test.
- Cloudflare detection level on app.smovin.be: NOT verified. Spike test will determine.
- Smovin API availability: Conflicting sources (GetApp says no API, Software Finder says yes). Irrelevant for scraping approach.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - playwright-extra and stealth plugin are well-established, versions verified against npm registry
- Architecture: HIGH - BullMQ worker pattern, encryption, and polling are all proven by existing codebase
- Scraping viability: LOW - Cannot verify until spike test runs against actual Smovin
- Data mapping: MEDIUM - Smovin data model understood conceptually from help docs, but exact field names/formats unknown
- Pitfalls: HIGH - Cloudflare bypass and Playwright deployment issues are well-documented in community

**Research date:** 2026-03-25
**Valid until:** 2026-04-01 (7 days -- fast-moving domain, Smovin could change their frontend at any time)
