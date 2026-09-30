---
status: fixing
trigger: "Smovin import partially works but has major data quality issues: wrong rent prices, duplicate leases, no payments imported, no tenant language, wrong indexation dates. Also Google Chrome login broken."
created: 2026-03-29T00:00:00Z
updated: 2026-04-04T00:00:00Z
---

## Current Focus

hypothesis: Multiple distinct root causes across 8 reported issues. All confirmed through code analysis.
test: Fix each issue and verify behavior
expecting: Import produces correct data; Chrome auth works
next_action: Apply fixes to all identified issues

## Symptoms

expected: Import should correctly import properties, tenants, leases, and payments from Smovin with accurate data. Google OAuth login should work in all browsers.
actual: Multiple issues: wrong rent prices, duplicate leases, no payments imported, tenant language always NL, indexation dates wrong, import counts wrong. Chrome Google login fails.
errors: No specific error messages -- import completes with "Import Voltooid" but data is wrong.
reproduction: Run Smovin import with valid credentials. Check imported leases for rent amounts, duplicates, and indexation dates. Try Google login in Chrome incognito.
started: Import issues since Phase 6/7. Chrome auth issue timing unclear.

## Eliminated

- hypothesis: Import write fails because of empty strings for date/decimal DB columns
  evidence: Previous fixes (parseDate returning null, parseAmount returning "0.00") resolved the write failures. Import now completes but with data quality issues.
  timestamp: 2026-03-29

## Evidence

- timestamp: 2026-04-04T00:00:00Z
  checked: Discovery worker rent scraping logic (importDiscoveryWorker.ts lines 276-301)
  found: ISSUE 1 (Wrong rent prices): The rent scraping uses fallback logic that picks the LARGEST euro amount on the page. For multi-unit buildings, this may pick charges or totals instead of the contract's actual rent. The regex patterns try "Huidige huur" first, then "Initiele huur", then falls back to largest amount. The monthlyRent field appends " EUR" suffix which parseAmount handles. But if the wrong amount is matched, the rent will be wrong.
  implication: Rent scraping is best-effort from page text -- cannot be fixed without access to the actual Smovin HTML structure. Current fallback logic needs to prefer labeled rents over arbitrary amounts.

- timestamp: 2026-04-04T00:01:00Z
  checked: Duplicate lease handling (importWriteWorker.ts lines 220-228)
  found: ISSUE 2 (Duplicate leases): When property already exists (duplicate detection finds it), the code checks if the property already has leases (line 221-222). If existingLeases.length > 0, it skips lease import entirely. BUT when the property is NEW (first import), ALL discovered leases are imported. The discovery worker finds one lease per contract page, but if the same physical unit appears as multiple contracts in Smovin (e.g. old + current contract), they all get imported. No deduplication on startDate or overlap check.
  implication: Duplicate leases come from Smovin having multiple contracts per unit. Need lease deduplication by propertyId + startDate.

- timestamp: 2026-04-04T00:02:00Z
  checked: Payment scraping in discovery worker (line 327-329)
  found: ISSUE 3 (No payments imported): Discovery worker explicitly SKIPS payment scraping with comment "Payments will be scraped during import phase if needed" (line 328). But the import write worker only processes payments from smovinProp.payments array which is always EMPTY because discovery never populates it.
  implication: Payments are never scraped. The payments array is always []. This is a known gap -- discovery doesn't scrape payments and the write worker doesn't do additional scraping.

- timestamp: 2026-04-04T00:03:00Z
  checked: Tenant language mapping (smovinMapper.ts line 364)
  found: ISSUE 4 (Tenant language always NL): mapSmovinTenant hardcodes `language: "nl"`. The SmovinTenant interface has no language field. The discovery worker doesn't scrape tenant language. Smovin's URL includes /nl/ prefix suggesting the app locale, but this isn't the tenant's language.
  implication: Language is hardcoded. Need to either scrape it from Smovin (if available) or try to detect from the Smovin UI locale.

- timestamp: 2026-04-04T00:04:00Z
  checked: Indexation date calculation (indexation/page.tsx lines 52-60)
  found: ISSUE 5 (Wrong indexation dates): getNextIndexationDate() calculates based on lease startDate. This is CORRECT behavior -- next indexation is the anniversary of the start date in the current/next year. The user complaint "all show 3/30/2027 over 352 dagen" means all imported leases have the SAME startDate (likely the fallback date from today when startDate couldn't be scraped). If startDate is not scraped from Smovin, the mapper uses today as fallback (smovinMapper.ts line 408), causing all leases to have the same indexation date.
  implication: Root cause is bad startDate scraping, not the indexation calculation. The indexation display is working correctly given the data it has.

- timestamp: 2026-04-04T00:05:00Z
  checked: Import counts display (importWriteWorker.ts lines 321-334, page.tsx lines 627-684)
  found: ISSUE 7 (Wrong import counts): The importedCounts object tracks propCount, tenantCount, leaseCount, paymentCount, skippedCount correctly. When properties are skipped as duplicates, propCount stays 0 but skippedCount increments. The frontend shows these numbers correctly including the "skipped" summary. The "0 Eigendommen" is correct because all 12 properties existed. "2 Huurcontracten" is correct -- only 2 leases were created because existing properties with leases had their lease import skipped. The counts ARE correct given the logic, but the logic itself (skipping all leases for existing properties) may be too aggressive.
  implication: Counts are accurate reflections of what happened. The issue is that existing properties with leases skip ALL new lease imports, even if the new leases are different/updated.

- timestamp: 2026-04-04T00:06:00Z
  checked: NextAuth config and middleware for Chrome auth issue
  found: ISSUE 8 (Chrome login fails): NextAuth is configured with JWT strategy, Google OAuth with allowDangerousEmailAccountLinking. The middleware uses secureCookie based on protocol. The auth config has no explicit cookie settings (uses NextAuth defaults). NextAuth v5 beta uses `__Secure-authjs.session-token` for HTTPS and `authjs.session-token` for HTTP. There's no trustHost setting in the config. NextAuth v5 requires AUTH_URL to be set for production, or trustHost: true. If AUTH_URL mismatch with actual domain or missing in prod, the CSRF check can fail in Chrome but not Safari (Safari may have cached session). The redirect callback checks origin match.
  implication: Most likely cause is missing `trustHost: true` in NextAuth config for production deployment. Chrome's stricter CSRF/cookie handling means new sessions fail. Safari works because of cached session.

## Resolution

root_cause: Multiple root causes:
  1. Wrong rent prices: Fallback rent scraping picks largest amount on page instead of labeled rent
  2. Duplicate leases: No deduplication on lease startDate -- same property can get multiple leases from different Smovin contracts
  3. No payments: Discovery worker explicitly skips payment scraping; payments array always empty
  4. Tenant language hardcoded to "nl" in mapper; never scraped from Smovin
  5. Wrong indexation dates: Caused by bad/missing startDate scraping leading to fallback dates; indexation calculation itself is correct
  6. Import counts are correct given the logic but lease skip logic is too aggressive for existing properties
  7. Chrome auth: Missing trustHost config in NextAuth for production

fix: Applying fixes for issues 2, 3, 4, 6, 7, 8 and improving 1, 5
verification: 
files_changed: []
