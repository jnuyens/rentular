# Stack Research

**Domain:** Belgian rental property management platform — missing features for launch
**Researched:** 2026-03-22
**Confidence:** MEDIUM-HIGH (most recommendations verified via official docs; Statbel API structure is LOW confidence)

## Context

Rentular already has a working stack: Next.js 15, Hono 4.6, Drizzle ORM, MySQL, GoCardless, Stripe, BullMQ, Redis, NextAuth.js, Tailwind CSS 3.4, next-intl. This research covers **only the libraries and approaches needed to fill gaps**: webhook idempotency, CSRF protection, Belgian health index integration, Smovin data import scraping, SMS delivery, structured logging, and responsive design patterns.

---

## Recommended Stack Additions

### Payment Processing & Webhooks

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Hono CSRF middleware | built-in (hono ^4.6) | CSRF protection for all state-changing endpoints | Already included in Hono since v3.12.0. Uses Origin + Sec-Fetch-Site header validation. No extra dependency needed. | HIGH |
| Drizzle ORM (existing) | ^0.36.0 | Webhook idempotency tracking table | Use existing Drizzle to create a `webhook_events` table with `event_id` as unique key. No new library needed. | HIGH |
| uuid | ^11.1.0 | Generate idempotency keys for outbound GoCardless API calls | GoCardless recommends UUIDv4 for idempotency keys. Lightweight, no alternatives needed. | HIGH |

**Webhook Idempotency Pattern (no new library):**

The existing GoCardless webhook handler already verifies signatures correctly. What's missing is idempotency tracking. The pattern:

1. Create a `webhook_events` table in Drizzle: `{ id, eventId (unique), resourceType, action, processedAt, status }`.
2. Before processing each event, `INSERT ... ON DUPLICATE KEY UPDATE` — if the row already exists with `status = 'processed'`, skip it.
3. Process the event, then mark `status = 'processed'`.
4. Use a database transaction wrapping both the idempotency check and the state mutation (e.g., payment status update).

GoCardless event IDs (like `EV00QXTDGM5895`) are globally unique and stable across retries, making them ideal deduplication keys. GoCardless guarantees idempotency keys are honored for 30 days, but events should be tracked indefinitely for audit purposes.

**CSRF Implementation:**

```typescript
import { csrf } from 'hono/csrf'

// Apply to all routes EXCEPT webhooks (webhooks use signature verification instead)
app.use('/api/v1/properties/*', csrf({ origin: process.env.WEB_URL || 'http://localhost:3000' }))
app.use('/api/v1/tenants/*', csrf({ origin: process.env.WEB_URL || 'http://localhost:3000' }))
// ... repeat for all protected prefixes
// DO NOT apply to /api/v1/webhooks/* — these use HMAC signature verification
```

**Important security note:** Hono's CSRF middleware had a bypass vulnerability (CVE-2024-48913) where requests without a Content-Type header were considered safe. This was patched in Hono v4.6.3+. The project uses `^4.6.0`, so ensure the resolved version is >= 4.6.3. Verify with `pnpm ls hono`.

---

### Belgian Health Index Integration (Statbel)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Built-in `fetch` (Node.js 20) | N/A | HTTP client for Statbel beSTAT API | Node.js 20 has native fetch. No axios/got needed for a simple GET request. | HIGH |
| node-cache or Redis (existing) | existing ioredis | Cache health index data | Health index updates monthly. Cache for 24h in Redis (already available). No new library. | HIGH |

**Statbel beSTAT API Access:**

The Belgian statistical office (Statbel) provides health index data through the beSTAT REST API. The verified endpoint pattern:

```
GET https://bestat.statbel.fgov.be/bestat/api/views/{viewId}/result/JSON
```

The view ID `208b69bd-05c5-4947-b7f9-2d2300f517b8` returns consumer price index, health index, and smoothed health index data in JSON format. The response contains a `facts` array with monthly records including:

- `Year` — calendar year
- `Month` — month name and year
- `Health index` — the raw health index value
- `Health index (moving average)` — smoothed 4-month average (used for salary indexation, NOT rent)
- `Consumer price index` — overall CPI
- `Inflation` — monthly inflation rate

**Critical: For rent indexation, use the raw `Health index` field, NOT the moving average.** The moving average is for salary/benefit indexation. Rent uses the point-in-time health index from the month before the anniversary date.

**Base year:** All current values use base year 2013=100. The indexation formula requires both base index and current index to use the same base year. Statbel's data is already normalized to 2013=100.

**Belgian Rent Indexation Formula:**
```
indexed_rent = (base_rent * new_health_index) / initial_health_index
```

Where:
- `base_rent` = rent amount in the lease agreement
- `initial_health_index` = health index of the month BEFORE the lease start date
- `new_health_index` = health index of the month BEFORE the anniversary date

**Regional EPC restrictions** are already implemented in the codebase (`apps/api/src/routes/indexation.ts`) for Brussels and Flanders. Wallonia has no EPC restrictions.

**Implementation approach:**
1. Create a `health_index_cache` table: `{ year, month, healthIndex, baseYear, fetchedAt }`
2. Background job (BullMQ repeatable, daily) fetches from beSTAT API and upserts values
3. `/health-index` endpoint reads from cache table, never directly from Statbel at request time
4. Fallback: if API is down, serve last cached values (health index changes monthly, staleness of a few days is acceptable)

**Confidence: MEDIUM** — The beSTAT API was verified to return JSON at the documented endpoint. However, the API has no official versioning or SLA documentation. It could change without notice. Build with a fallback to manual CSV import.

---

### Smovin Data Import (Web Scraping)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| playwright | ^1.50.0 | Headless browser automation for Smovin login + data extraction | Best-in-class for authenticated site scraping in 2026. Auto-wait eliminates timing bugs. Multi-browser support. Better reliability than Puppeteer. | HIGH |
| playwright-extra | ^4.3.0 | Plugin framework for stealth/anti-detection | Smovin uses Cloudflare. Stealth plugin masks automation fingerprints. | MEDIUM |
| puppeteer-extra-plugin-stealth | ^2.11.0 | Anti-detection for Cloudflare bypass | Compatible with playwright-extra. Hides `navigator.webdriver` and other automation signals. 450k+ weekly npm downloads. | MEDIUM |

**Why Playwright over alternatives:**
- **Puppeteer:** Chromium-only, Playwright supports Chromium/Firefox/WebKit
- **Cheerio/axios:** Cannot handle JavaScript-rendered SPAs or login flows
- **Selenium:** Heavier, slower, more fragile. Playwright is purpose-built for modern web

**Smovin scraping approach:**

Smovin (smovin.app) is a Belgian property management SaaS. The import flow:

1. User provides their Smovin credentials in Rentular's UI (stored temporarily, never persisted)
2. Background BullMQ job launches Playwright in headless mode
3. Automate login: navigate to login page, fill credentials, submit, wait for dashboard
4. Scrape: properties list, tenant/contact details, lease data, payment history
5. Map to Rentular's data model, insert via Drizzle
6. Report success/failure to user, discard credentials

**Smovin tech stack observations:** Uses Cloudflare CDN/WAF, so stealth plugin is recommended. Technology appears to be a standard SPA (likely Vue or React based on the ecosystem).

**Critical considerations:**
- Smovin may have anti-scraping measures beyond Cloudflare. Build defensively with retries and error reporting.
- Scraping is inherently fragile. Smovin UI changes break scrapers. Consider this a "best effort" feature with clear user expectations.
- Run Playwright in a separate worker process, not in the main API server (use BullMQ job with sandboxed processor).
- **Legal:** Users are scraping their own data. This is within GDPR data portability rights (Article 20).

**Server deployment note:** Playwright requires browser binaries (~200-400MB). On Proxmox/Docker:
```dockerfile
# In Dockerfile for API/worker
RUN npx playwright install --with-deps chromium
```
Only install Chromium (not all browsers) to minimize image size.

---

### SMS Delivery

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| twilio | ^5.13.0 | SMS delivery for payment reminders | Most mature SMS API. Excellent Node.js SDK. Belgium coverage. The project already has SMS_PROVIDER config for Twilio. | HIGH |
| messagebird | ^4.0.0 | Alternative SMS provider (EU-based) | Headquarters in Amsterdam. Strong Benelux coverage. EU data residency. Already configured as alternative in .env.example. | MEDIUM |

**Recommendation: Start with Twilio.** The codebase already has provider-switching infrastructure (`SMS_PROVIDER` env var, provider-specific credential configs for Twilio, MessageBird, and OVH). Twilio has the best developer docs and Node.js SDK. MessageBird is a solid EU-based fallback.

**OVH SMS:** The codebase lists OVH as an option. OVH offers cheap SMS for Belgian market but has a less polished API. Use only if cost is the primary concern.

**SMS rate limiting:** The existing `smsQueueWorker.ts` already uses BullMQ. Configure rate limiting in the BullMQ worker options:
```typescript
new Worker('sms-queue', processor, {
  limiter: { max: 10, duration: 60000 }, // 10 SMS per minute
  connection: redisConnection,
})
```

---

### Structured Logging

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| pino | ^10.3.0 | Structured JSON logging with secret redaction | 5x faster than Winston. JSON by default (machine-parseable). Built-in redaction for sensitive fields. De facto standard for Node.js production logging. | HIGH |
| hono-pino | ^0.10.3 | Hono middleware integration for pino | Drops into existing Hono middleware chain. Replaces `hono/logger`. Provides `c.var.logger` in route handlers. | HIGH |
| pino-pretty | ^13.0.0 | Human-readable dev output | Dev-only. Transforms JSON to colorized text. Never use in production. | HIGH |

**Why pino over existing `console.log/error`:**

The CONCERNS.md identifies "Secrets in error logs" as a security issue. Pino solves this with built-in redaction:

```typescript
import pino from 'pino'

const logger = pino({
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]'
  }
})
```

This is not achievable with `console.error`. Every `console.log` and `console.error` in the codebase should be replaced with structured pino calls.

---

### Responsive Design

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Tailwind CSS (existing) | ^3.4.16 | Responsive utilities via breakpoint prefixes | Already in use. `sm:`, `md:`, `lg:` prefixes handle all responsive needs. No new library required. | HIGH |
| @headlessui/react | ^2.2.0 | Accessible UI primitives (mobile menu, dialogs, dropdowns) | Unstyled, composable React components. Works perfectly with Tailwind. Handles focus trapping, keyboard nav, aria attributes. From the Tailwind Labs team. | HIGH |

**Responsive dashboard pattern (no new libraries):**

The current dashboard has a sidebar. For mobile:

1. **Desktop (lg+):** Fixed sidebar, content fills remaining width
2. **Tablet (md):** Collapsed sidebar with icons only, expand on hover
3. **Mobile (< md):** Sidebar hidden, hamburger menu triggers off-canvas drawer

Implementation uses:
- Tailwind breakpoints: `hidden md:block`, `md:hidden`
- Headless UI `Dialog` component for the mobile drawer (handles focus trap, escape key, backdrop click)
- CSS `transform translate-x` transitions for smooth drawer animation

**Why Headless UI over other options:**
- **Radix UI:** Also excellent, but Headless UI is lighter and built by the Tailwind team, ensuring design alignment
- **DaisyUI:** Adds opinions/themes. Rentular already has its own design system via Tailwind.
- **shadcn/ui:** Good, but brings Radix + class-variance-authority. More complexity than needed for a responsive shell.

---

## Installation

```bash
# New dependencies for API
pnpm --filter @rentular/api add uuid pino hono-pino twilio

# New dependencies for API (Smovin import worker)
pnpm --filter @rentular/api add playwright

# Dev dependencies for API
pnpm --filter @rentular/api add -D pino-pretty @types/uuid

# New dependencies for Web
pnpm --filter @rentular/web add @headlessui/react

# Install Playwright browser (Chromium only, for Docker/production)
cd apps/api && npx playwright install chromium
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono built-in CSRF | csurf (Express) or custom tokens | Never — csurf is deprecated and Express-only. Hono's built-in is sufficient for Origin/Sec-Fetch-Site validation. |
| Native fetch (Node 20) for Statbel | axios, got, node-fetch | If you need retry logic or interceptors. For a simple monthly GET request, native fetch is fine. |
| Playwright for Smovin scraping | Puppeteer | If Docker image size is critical and you only need Chromium. Playwright's auto-wait and multi-browser support outweigh the marginal size difference. |
| Pino for logging | Winston | If you need file rotation or complex transports out of the box. Pino is faster and JSON-native, which matters for production. |
| Headless UI for mobile drawer | Radix UI, shadcn/ui | If you plan to build a full component library. For just a mobile drawer and a few accessible dropdowns, Headless UI is lighter. |
| Twilio for SMS | MessageBird, OVH | MessageBird if EU data residency is required. OVH if cost must be minimized (lower quality API/docs). |
| BullMQ (existing) for cron jobs | node-cron | Never for this project. BullMQ is already running and provides persistence, retries, and distributed execution. node-cron runs in-process with no persistence. |
| Drizzle schema for idempotency | Redis SET NX for dedup | Redis is faster but loses data on restart. Database-backed dedup provides an audit trail. Use database for webhook idempotency (critical financial data). |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| csurf (npm) | Deprecated since 2022. Express-only. Known vulnerabilities. | Hono's built-in `csrf()` middleware |
| node-fetch | Unnecessary on Node.js 20+ which has native fetch | `fetch` (global, built-in) |
| axios | Overkill for the single Statbel API call. Adds 400KB+ to bundle. | Native `fetch` with manual retry |
| Puppeteer | Chromium-only, no auto-wait, being superseded by Playwright | Playwright |
| Cheerio (for Smovin) | Cannot handle SPA login flows or JavaScript-rendered content | Playwright (headless browser) |
| Winston | Slower than Pino (5x), string-based by default, larger dependency tree | Pino |
| console.log/error | No structure, no redaction, no levels, no JSON output | Pino via hono-pino middleware |
| DaisyUI | Adds opinions and themes that conflict with Rentular's existing Tailwind design | Raw Tailwind + Headless UI |
| Tailwind CSS v4 | Major breaking changes from v3. Migration risk for no launch benefit. | Stay on Tailwind CSS 3.4 |
| Custom CSRF token system | Unnecessary complexity when Hono has a built-in solution | `csrf()` from `hono/csrf` |

---

## Stack Patterns by Feature Area

**If implementing webhook idempotency:**
- Use Drizzle ORM to create a `webhook_events` table
- Use database transactions to atomically check-and-process events
- Keep events forever for audit trail
- Because financial data demands database-level consistency, not ephemeral Redis

**If Statbel API is unreliable or changes:**
- Fall back to monthly CSV download + manual import script
- The open data portal provides XLSX/TXT downloads at `statbel.fgov.be/sites/default/files/files/opendata/`
- Parse with a simple CSV parser (built-in Node.js readline or `csv-parse`)
- Because the beSTAT API has no SLA or versioning guarantees

**If Smovin adds aggressive anti-bot protection:**
- Consider asking users to export their data manually (Smovin may offer CSV export)
- Fall back to a guided manual import flow in Rentular
- Because scraping is inherently fragile and should not be a blocking launch requirement

**If scaling beyond 1000 SMS/month:**
- Switch to MessageBird bulk API or negotiate volume rates with Twilio
- Implement SMS provider abstraction (already partially in place via SMS_PROVIDER env var)
- Because per-message costs add up quickly at scale

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| hono ^4.6.0 | hono/csrf built-in | CSRF available since v3.12.0. Ensure resolved version >= 4.6.3 for CVE-2024-48913 fix. |
| hono-pino ^0.10.3 | pino ^10.0.0, hono ^4.0.0 | Requires both pino and hono as peer dependencies. |
| pino ^10.3.0 | pino-pretty ^13.0.0 | pino-pretty v13 required for pino v10 compatibility. |
| playwright ^1.50.0 | Node.js 20+ | Requires system dependencies on Linux (use `npx playwright install --with-deps chromium`). |
| playwright-extra ^4.3.0 | playwright ^1.40+ | Compatible with puppeteer-extra-plugin-stealth ^2.11.0. |
| twilio ^5.13.0 | Node.js 18+ | v5 is the current major. v4 is legacy. |
| @headlessui/react ^2.2.0 | React 18+/19 | v2 supports React 19 (used in this project). v1 does NOT. |
| uuid ^11.1.0 | Node.js 16+ | Pure JS, no native dependencies. |

---

## Sources

- [Hono CSRF Middleware docs](https://hono.dev/docs/middleware/builtin/csrf) — CSRF configuration and API (HIGH confidence)
- [CVE-2024-48913 Advisory](https://github.com/honojs/hono/security/advisories/GHSA-2234-fmw7-43wr) — CSRF bypass vulnerability details (HIGH confidence)
- [Hono v3.12.0 Release](https://github.com/honojs/hono/releases/tag/v3.12.0) — CSRF middleware introduction (HIGH confidence)
- [Statbel Health Index open data](https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index) — data download page (HIGH confidence)
- [beSTAT API](https://bestat.statbel.fgov.be/bestat/api/views/208b69bd-05c5-4947-b7f9-2d2300f517b8/result/JSON) — verified JSON endpoint returning health index data (MEDIUM confidence, no SLA)
- [beSTAT FAQ](https://statbel.fgov.be/en/statistics/bestat/faq) — API format documentation (MEDIUM confidence)
- [Statbel Rent Calculator](https://statbel.fgov.be/en/themes/consumer-prices/rent-calculator) — official indexation formula reference (HIGH confidence)
- [Brussels rent indexation rules](https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation) — EPC restrictions for Brussels (HIGH confidence)
- [GoCardless webhook docs](https://developer.gocardless.com/api-reference/) — webhook event structure and idempotency (HIGH confidence)
- [Hookdeck webhook idempotency guide](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) — idempotency patterns (MEDIUM confidence)
- [Playwright npm page](https://www.npmjs.com/package/playwright) — version 1.50+ (HIGH confidence)
- [Playwright web scraping guide (BrightData)](https://brightdata.com/blog/how-tos/playwright-web-scraping) — authenticated scraping patterns (MEDIUM confidence)
- [playwright-extra npm](https://www.npmjs.com/package/playwright-extra) — stealth plugin integration (MEDIUM confidence)
- [Pino npm](https://www.npmjs.com/package/pino) — v10.3.1 latest (HIGH confidence)
- [hono-pino GitHub](https://github.com/maou-shonen/hono-pino) — v0.10.3, Hono integration (HIGH confidence)
- [Twilio npm](https://www.npmjs.com/package/twilio) — v5.13.0 latest (HIGH confidence)
- [Headless UI React](https://headlessui.com/) — v2.x for React 19 compatibility (HIGH confidence)

---
*Stack research for: Rentular Belgian rental property management platform (missing features)*
*Researched: 2026-03-22*
