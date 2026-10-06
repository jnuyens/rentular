---
status: partially-resolved
trigger: "Smovin import partially works but has major data quality issues: wrong rent prices, duplicate leases, no payments imported, no tenant language, wrong indexation dates. Also Google Chrome login broken."
created: 2026-03-29T00:00:00Z
updated: 2026-10-06T00:00:00Z
---

## Current Focus

hypothesis: Eight distinct root causes, all confirmed by code analysis (see Evidence). Fixable scope (issues 2, 4, 6, 7, 8) is applied, type-checked, tested and committed. Issue 3 deferred as follow-on work. Issues 1 and 5 blocked on Smovin account access.
test: Type check (api + web), vitest suite (184 tests incl. new smovinMapper regression tests), production observation of Google sign-in.
expecting: n/a (session closed for the fixable scope)
next_action: Follow-on work only. See Resolution for the three open items and what each needs.

## Symptoms

expected: Import should correctly import properties, tenants, leases, and payments from Smovin with accurate data. Google OAuth login should work in all browsers.
actual: Multiple issues: wrong rent prices, duplicate leases, no payments imported, tenant language always NL, indexation dates wrong, import counts wrong. Chrome Google login fails.
errors: No specific error messages. Import completes with "Import Voltooid" but data is wrong.
reproduction: Run Smovin import with valid credentials. Check imported leases for rent amounts, duplicates, and indexation dates. Try Google login in Chrome incognito.
started: Import issues since Phase 6/7. Chrome auth issue timing unclear.

## Eliminated

- hypothesis: Import write fails because of empty strings for date/decimal DB columns
  evidence: Previous fixes (parseDate returning null, parseAmount returning "0.00") resolved the write failures. Import now completes but with data quality issues.
  timestamp: 2026-03-29

- hypothesis: Indexation date calculation is wrong (issue 5)
  evidence: getNextIndexationDate() correctly returns the anniversary of lease.startDate. All imported leases showing the same date is a consequence of every lease getting the same fallback startDate (today) when scraping found none. The display logic is correct given its input.
  timestamp: 2026-04-04

## Evidence

- timestamp: 2026-04-04T00:00:00Z
  checked: Discovery worker rent scraping logic (importDiscoveryWorker.ts, lease extraction block)
  found: ISSUE 1 (Wrong rent prices): The rent scraping uses fallback logic that picks the LARGEST euro amount on the page. For multi-unit buildings, this may pick charges or totals instead of the contract's actual rent. The regex patterns try "Huidige huur" first, then "Initiele huur", then fall back to the largest amount. The original regex also matched "Huidige index" (the health index number), which produced obviously wrong rents.
  implication: Rent scraping is best-effort from page text. Cannot be made reliable without inspecting the real Smovin contract page HTML.

- timestamp: 2026-04-04T00:01:00Z
  checked: Duplicate lease handling (importWriteWorker.ts, step 4d)
  found: ISSUE 2 (Duplicate leases): When the property is NEW, ALL discovered leases are imported with no deduplication. The same physical unit can appear as multiple Smovin contracts (old + current), and re-running an import re-creates leases.
  implication: Need lease deduplication by propertyId + startDate.

- timestamp: 2026-04-04T00:02:00Z
  checked: Payment scraping in discovery worker (step 9)
  found: ISSUE 3 (No payments imported): Discovery worker explicitly SKIPS payment scraping with comment "Payments will be scraped during import phase if needed". The write worker only reads smovinProp.payments, which discovery never populates.
  implication: Payments are never scraped. payments is always []. Known gap; needs new scraping logic.

- timestamp: 2026-04-04T00:03:00Z
  checked: Tenant language mapping (smovinMapper.ts mapSmovinTenant)
  found: ISSUE 4 (Tenant language always NL): mapSmovinTenant hardcoded language: "nl". SmovinTenant had no language field. Smovin's URL carries a /nl/ or /fr/ locale prefix for the landlord's UI, which is the only language signal available; Smovin does not expose a per-tenant language.
  implication: Best available fix is to use the Smovin UI locale as a hint with an explicit, visible fallback.

- timestamp: 2026-04-04T00:04:00Z
  checked: Indexation date calculation (indexation/page.tsx getNextIndexationDate)
  found: ISSUE 5 (Wrong indexation dates): All imported leases show the same next-indexation date because they share the same startDate: the mapper falls back to today when the discovery worker could not scrape a start date. The start-date regexes (Begindatum / Date de debut / Start date ...) did not match the real page text.
  implication: Root cause is start-date scraping, not indexation. Cannot be fixed without the real Smovin page structure.

- timestamp: 2026-04-04T00:05:00Z
  checked: Import counts display (importWriteWorker.ts result block, import page.tsx)
  found: ISSUE 6/7 (Wrong import counts, over-aggressive skip): Counts were accurate reflections of what happened. The underlying logic was wrong: once a property had ANY existing lease, ALL new lease imports for it were skipped, so re-imports produced "0 Eigendommen, 2 Huurcontracten".
  implication: Replace the blanket skip with per-lease deduplication so genuinely new leases are imported for existing properties.

- timestamp: 2026-04-04T00:06:00Z
  checked: NextAuth config (apps/web/lib/auth.ts) and middleware for Chrome auth issue
  found: ISSUE 8 (Chrome login fails): NextAuth v5 beta had no trustHost setting. Behind the production reverse proxy the Host header seen by Next does not match AUTH_URL, so NextAuth rejects the request. Safari kept working on a cached session; Chrome with a fresh session failed.
  implication: Add trustHost: true for the reverse-proxied production deployment.

- timestamp: 2026-04-12T00:00:00Z
  checked: Commit 4901d2d (fix: smovin import data quality + Chrome Google auth)
  found: Applied trustHost: true (auth.ts); findExistingLease(propertyId, startDate) per-lease dedup replacing the blanket skip (importWriteWorker.ts); Smovin locale detection from URL passed as tenant.language (importDiscoveryWorker.ts) and mapTenantLanguage() replacing the hardcode (smovinMapper.ts); removed "Huidige index" from the rent regex and added a "Maandelijkse huur" / "Loyer mensuel" pattern (partial improvement to issue 1). The debug file was not closed out at the time.
  implication: Issues 2, 4, 6, 8 fixed in code; issue 1 partially improved.

- timestamp: 2026-10-06T00:00:00Z
  checked: Current main (post 4901d2d, c56743a, bf740eb). Re-read auth.ts, importWriteWorker.ts, importDiscoveryWorker.ts, smovinMapper.ts. Ran pnpm -C apps/api lint, pnpm -C apps/web lint, pnpm -C apps/api test.
  found: All four fixes are intact in the current code. tsc clean for api and web. 174 existing tests pass. Production notes (deployment memory, 2026-09-23) confirm Google sign-in works on www.rentular.com; a separate contributor to "bounced back to login" (apex rentular.com served directly instead of redirecting to www, so cookies landed on the wrong host) was fixed in the Caddyfile on 2026-09-23. Remaining gap on issue 4: the fallback was explicit in code but invisible to the landlord, and the comment described the UI locale as the tenant's language.
  implication: Issue 8 is verified in production. Issues 2 and 6 verified by code trace and type check. Issue 4 needs the fallback surfaced to the user.

- timestamp: 2026-10-06T00:10:00Z
  checked: Mapper change + new test file apps/api/src/services/__tests__/smovinMapper.test.ts
  found: Tenant notes now read "Imported from Smovin (language "fr" taken from your Smovin UI locale, please verify with the tenant)" or "(language defaulted to "nl", ...)". mapTenantLanguage exported and tested. 10 new tests pass; tsc clean.
  implication: Issue 4 closed to the extent Smovin allows.

## Resolution

root_cause: Eight distinct root causes under one symptom report:
  1. Wrong rent prices: best-effort rent scraping (regex over page text, fallback to the largest euro amount) picks the wrong number on some contract pages.
  2. Duplicate leases: no deduplication when importing leases for a property.
  3. No payments: discovery worker never scrapes payments; the write worker only writes what discovery found.
  4. Tenant language: hardcoded "nl"; Smovin exposes no per-tenant language.
  5. Wrong indexation dates: start-date scraping finds nothing, mapper falls back to today, so every lease gets the same anniversary. Indexation math itself is correct.
  6/7. Import counts looked wrong because the write worker skipped ALL lease imports for any property that already had a lease.
  8. Chrome Google login: NextAuth v5 lacked trustHost: true behind the reverse proxy, so fresh sessions failed the host check (Safari hid it with a cached session).

fix:
  Issue 8 (FIXED, commit 4901d2d): trustHost: true added to the NextAuth() config in apps/web/lib/auth.ts with a comment explaining why. Deployed to production.
  Issue 2 (FIXED, commit 4901d2d): findExistingLease(db, propertyId, startDate) in apps/api/src/jobs/importWriteWorker.ts; before inserting each mapped lease the worker looks up (propertyId, startDate) and reuses the existing lease id instead of inserting a duplicate.
  Issue 6 (FIXED, commit 4901d2d): the blanket "property already has leases, skip all" branch was removed; the per-lease dedup above replaces it, so genuinely new leases for existing properties are imported and the counts reflect real work.
  Issue 4 (FIXED to the extent possible, commits 4901d2d + this session): importDiscoveryWorker.ts detects the landlord's Smovin UI locale from the redirected URL and passes it as tenant.language; smovinMapper.ts mapTenantLanguage() maps nl/fr/de/en and falls back to "nl" for missing or unsupported hints; mapSmovinTenant() writes the source of the language ("taken from your Smovin UI locale" or "defaulted to") into the tenant notes so the landlord can see it was inferred and correct it. Comments state plainly that Smovin has no per-tenant language.
  Issue 1 (PARTIAL, commit 4901d2d): "Huidige index" removed from the rent regex (it matched the health index number); explicit monthly-rent label pattern added. The largest-amount fallback remains. See blocked items below.
  Issue 7: no code change needed; counts were correct, the fix is issue 6.

  DEFERRED / FOLLOW-ON:
  Issue 3 (payments never imported): requires new scraping logic in importDiscoveryWorker.ts (visit each contract's payment history page, parse date / amount / status rows, populate property.payments) plus a mapping decision for how historical Smovin payments relate to Rentular's expected-payment schedule (see expectedPayments.ts). Not small and not safe to write blind against an unknown page structure. Scope as its own task once a Smovin account is available to inspect the payments page. Until then the write worker's payment path is correct but always receives an empty array.

  BLOCKED ON SMOVIN ACCESS (Smovin-access-limited, deferred):
  Issue 1 (rent amounts): fixing properly means replacing text-regex guessing with selectors anchored on the real contract page DOM (the labelled "Huidige huur" / "Loyer actuel" field). Needs: a login to a real Smovin account with at least one multi-unit building, a saved copy of a contract page (HTML + rendered text) in both NL and FR UI locales, and one known-correct rent per contract to assert against. Do not guess selectors.
  Issue 5 (start dates, and therefore indexation dates): the Begindatum / Date de debut regexes do not match what Smovin renders. Needs the same page captures as issue 1 to see how the start date is labelled and formatted, then the fallback-to-today in mapSmovinLease can be kept only as a last resort. Note the fallback also weakens issue 2's dedup: two leases with no scraped start date on different import days get different fallback dates and are not detected as duplicates.

verification:
  Issue 8: trustHost present in apps/web/lib/auth.ts on main; web tsc clean; production Google sign-in on https://www.rentular.com confirmed working in the 2026-09-23 deployment notes (apex-to-www redirect fixed the same day for a related cookie-host symptom).
  Issues 2 and 6: code trace of importWriteWorker.ts step 4d (per-lease findExistingLease, no blanket skip); api tsc clean; full vitest suite green (174 pre-existing tests). No DB-backed worker test exists; a live re-import against production data has not been re-run in this session.
  Issue 4: 10 new tests in apps/api/src/services/__tests__/smovinMapper.test.ts (locale mapping, nl fallback, notes wording, startDate fallback behaviour) pass; api tsc clean.
  Issues 1, 3, 5: not verified; open as documented above.

files_changed:
  - apps/web/lib/auth.ts (commit 4901d2d: trustHost: true)
  - apps/api/src/jobs/importWriteWorker.ts (commit 4901d2d: findExistingLease per-lease dedup, blanket skip removed)
  - apps/api/src/jobs/importDiscoveryWorker.ts (commit 4901d2d: Smovin locale detection, tenant.language, rent regex cleanup)
  - apps/api/src/services/smovinMapper.ts (commit 4901d2d: mapTenantLanguage; this session: exported, documented, language source written to tenant notes)
  - apps/api/src/services/__tests__/smovinMapper.test.ts (this session: new regression tests)
