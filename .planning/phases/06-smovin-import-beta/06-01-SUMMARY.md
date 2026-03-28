---
phase: 06-smovin-import-beta
plan: 01
subsystem: database, api
tags: [playwright, stealth, scraping, drizzle, mysql]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: database connection, schema patterns
provides:
  - import_sessions schema table with encrypted credential columns
  - Stealth Playwright browser factory (smovinScraper.ts)
  - Validated spike test confirming Smovin login works
affects: [06-02, 06-03, 06-04]

# Tech tracking
tech-stack:
  added: [playwright, playwright-extra, puppeteer-extra-plugin-stealth]
  patterns: [stealth browser with human-like delays, SPA waitForSelector hydration, auth-indicator login detection]

key-files:
  created:
    - packages/db/src/schema/imports.ts
    - apps/api/src/services/smovinScraper.ts
    - apps/api/src/services/spikeTest.ts
  modified:
    - packages/db/src/schema/index.ts
    - apps/api/package.json

key-decisions:
  - "Smovin redirects app.smovin.be -> web.smovin.app (Nuxt.js SPA) — all scraping must target web.smovin.app"
  - "Login detection uses auth indicators (Dashboard, Eigendommen, etc.) not URL check — Smovin uses /login as post-auth route"
  - "SPA hydration requires load + networkidle + waitForSelector chain — domcontentloaded alone is insufficient"
  - "pressSequentially (Locator API) required instead of fill() for SPA framework input event compatibility"
  - "Properties page accessible at web.smovin.app/patrimony"

patterns-established:
  - "Stealth browser pattern: chromium.launch + stealth plugin + human-like delays via randomDelay()"
  - "SPA interaction: waitForLoadState('load') -> waitForLoadState('networkidle') -> waitForSelector('input')"
  - "Locator API for all form interactions (not ElementHandle page.$)"

requirements-completed: [IMP-01, IMP-05]

# Metrics
duration: ~45min (including spike test iterations)
completed: 2026-03-28
---

# Plan 06-01: Schema + Spike Test Summary

**Import sessions DB schema with encrypted credentials, stealth Playwright browser factory, and validated D-02 spike test confirming Smovin login bypasses Cloudflare**

## Performance

- **Duration:** ~45 min (including 5 spike test iterations)
- **Started:** 2026-03-27
- **Completed:** 2026-03-28
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `import_sessions` table with encrypted credential columns (`credentialEmail`, `credentialPassword`) and JSON `discoveredData`/`importResult` columns
- Stealth Playwright browser factory with anti-detection measures (randomDelay, locale fr-BE, custom UA)
- D-02 spike test PASSED: Cloudflare bypass works, SPA login form found, credentials accepted, properties page accessible

## Task Commits

1. **Task 1: Schema + Playwright + Browser Factory** - `94aaf2d` (feat) + `81fdd20` (merge)
2. **Task 2: Spike Test Script** - `b32a4e3` (feat) + `094594f` (fix: login detection)

## Files Created/Modified
- `packages/db/src/schema/imports.ts` - import_sessions table schema
- `packages/db/src/schema/index.ts` - Re-export imports schema
- `apps/api/src/services/smovinScraper.ts` - Stealth browser factory + loginToSmovin()
- `apps/api/src/services/spikeTest.ts` - D-02 spike test script
- `apps/api/package.json` - Added playwright, playwright-extra, puppeteer-extra-plugin-stealth

## Decisions Made
- Smovin uses `web.smovin.app` (Nuxt.js) not `app.smovin.be` — discovery worker must scrape the new domain
- Login detection via page content (auth indicators) not URL matching — Smovin's dashboard URL contains "/login"
- SPA hydration needs full `load` + `networkidle` + explicit `waitForSelector` chain — `domcontentloaded` alone races
- Locator API (`pressSequentially`) required for form input — ElementHandle `fill()` doesn't trigger SPA events reliably

## Deviations from Plan

### Auto-fixed Issues

**1. [Blocking] networkidle timeout on navigation**
- **Found during:** Spike test iteration 1
- **Issue:** `waitUntil: "networkidle"` causes 30s timeout — Cloudflare/SPA keeps connections open
- **Fix:** Changed to `waitUntil: "load"` + separate `waitForLoadState("networkidle")` with catch
- **Verification:** Page loads successfully

**2. [Blocking] SPA not hydrated before form lookup**
- **Found during:** Spike test iteration 2
- **Issue:** DOM only has `<head>` content after `domcontentloaded` — JS hasn't rendered the form
- **Fix:** Added `waitForSelector("input", { timeout: 30000 })` before form interaction
- **Verification:** Input elements consistently found

**3. [Blocking] pressSequentially not a function**
- **Found during:** Spike test iteration 4
- **Issue:** `page.$()` returns ElementHandle which lacks `pressSequentially` — Locator API required
- **Fix:** Switched to `page.locator()` for all form interactions
- **Verification:** Email/password values confirmed set correctly

**4. [Blocking] Login falsely reported as failed**
- **Found during:** Spike test iteration 5
- **Issue:** URL check `includes("/login")` returns true because Smovin dashboard URL is `/login`
- **Fix:** Detect auth via page content indicators (Dashboard, Eigendommen, etc.)
- **Verification:** Spike test passes, user name visible in page body

---

**Total deviations:** 4 auto-fixed (all blocking)
**Impact on plan:** All fixes necessary for Playwright/SPA compatibility. Pattern changes propagate to Plans 02-03 discovery worker.

## Issues Encountered
- Smovin domain redirect (`app.smovin.be` → `web.smovin.app`) was undocumented in research — discovery worker URLs need updating
- SPA hydration timing is non-deterministic — needs generous timeouts (30s)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema ready for Plan 02 (API routes) to use
- smovinScraper.ts `createStealthBrowser()` and `loginToSmovin()` ready for discovery worker
- Key insight for Plans 02-03: all scraping must target `web.smovin.app`, not `app.smovin.be`
- Properties at `/patrimony`, navigation items visible in Dutch/French depending on user language

---
*Phase: 06-smovin-import-beta*
*Completed: 2026-03-28*
