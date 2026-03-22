---
phase: 03-rent-indexation
verified: 2026-03-23T00:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
human_verification:
  - test: "POST /preview/:leaseId with overrideNewRent < calculatedNewRent"
    expected: "Email body contains 'The indexed rent would be X, but your landlord has set it to Y.' text in tenant's language"
    why_human: "Override note is pre-baked into rawBody by generateDefaultIndexationEmail() before renderTemplate() runs. The code path is correct but the exact rendering output requires a live DB with test data to confirm the text appears in the rendered email body."
  - test: "GET /upcoming returns leases with anniversaries in the next 30 days"
    expected: "Each entry shows correct estimatedNewRent with EPC restrictions applied, not the stale currentMonthlyRent"
    why_human: "Requires active leases with indexationEnabled=true in DB and cached health index data to verify the calculation path executes instead of the fallback."
---

# Phase 3: Rent Indexation Verification Report

**Phase Goal:** Implement rent indexation with Belgian health index data pipeline, regional calculation formulas (Brussels/Flanders/Wallonia EPC restrictions), and tenant notification workflow
**Verified:** 2026-03-23
**Status:** PASSED
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Health index data is fetched from Statbel beSTAT API and cached in the healthIndexValues table | VERIFIED | `fetchAndCacheHealthIndex()` fetches from `208b69bd-05c5-4947-b7f9-2d2300f517b8`, upserts via Drizzle with dedup check |
| 2 | A daily BullMQ cron job refreshes the health index cache at 06:00 | VERIFIED | `healthIndexWorker.ts` uses `repeat: { pattern: "0 6 * * *" }`, queue name `health-index-refresh` |
| 3 | If Statbel API is down, the job silently fails and retries next day | VERIFIED | `fetchAndCacheHealthIndex` wraps entire fetch in try/catch, logs error and returns without throwing |
| 4 | Cache staleness is detectable (values older than 7 days are stale) | VERIFIED | `isHealthIndexStale()` computes `age > 7 * 24 * 60 * 60 * 1000` against `fetchedAt` |
| 5 | Landlord can preview an indexed rent calculation showing correct formula for their property's region | VERIFIED | `GET /calculate/:leaseId` returns `{ newRent, unrestrictedNewRent, epcRestricted, formulaNote, formula, region }` via `calculateLeaseIndexation()` |
| 6 | EPC correction factors are applied for Brussels (E/F/G penalty) and Flanders (correction factor) | VERIFIED | `applyBrusselsEpcRestriction()` uses `BRUSSELS_EPC_INDEXATION_FACTOR`; `applyFlandersEpcRestriction()` uses `FLANDERS_EPC_FREEZE_FACTOR`, `FLANDERS_EPC_NEEDS_CORRECTION`, and correction formula |
| 7 | Landlord can choose to apply a lower-than-indexed rent amount but never higher than the EPC-restricted maximum | VERIFIED | `POST /preview` enforces `overrideNewRent > calculatedNewRent` returns 400; `POST /apply` enforces `newRent > calculatedNewRent` returns 400 |
| 8 | Applying indexation updates the lease's currentMonthlyRent and lastIndexationDate and creates an indexationRecords entry | VERIFIED | `/apply` inserts into `indexationRecords`, updates `leases.currentMonthlyRent` and `leases.lastIndexationDate` via Drizzle; `leases.monthlyRent` (base rent) is never modified |
| 9 | Landlord can customize the notification email subject and body before sending | VERIFIED | `/preview` returns `rawSubject`/`rawBody` with placeholders; `/apply` accepts `subject`/`body` fields |
| 10 | Tenant receives indexation notification email in their preferred language with region-specific legal reference | VERIFIED | `generateDefaultIndexationEmail` selects template by `tenantLanguage`, legal reference by `region`; `LEGAL_REFERENCES` has all 3 regions x 4 languages; `/apply` calls `queueEmail` |
| 11 | When landlord chose a lower amount, email shows both calculated and applied amounts | VERIFIED | `generateDefaultIndexationEmail` bakes override note into body when `calculatedNewRent !== appliedNewRent`; `OVERRIDE_NOTE_TEMPLATES` defined for en/nl/fr/de |
| 12 | Health index and upcoming endpoint return real data from the database | VERIFIED | `GET /health-index` calls `getLatestHealthIndex()` (real DB query); `GET /upcoming` queries active leases from DB and attempts `calculateLeaseIndexation` for each |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/services/healthIndex.ts` | Statbel beSTAT API client with fetch, parse, upsert, lookup, staleness | VERIFIED | 168 lines; exports `fetchAndCacheHealthIndex`, `getHealthIndexValue`, `getLatestHealthIndex`, `isHealthIndexStale`; correct Statbel URL; try/catch wraps fetch |
| `apps/api/src/jobs/healthIndexWorker.ts` | BullMQ daily cron worker for health index refresh | VERIFIED | 61 lines; exports `setupHealthIndexSchedule`; cron `"0 6 * * *"`; queue name `health-index-refresh`; imports `fetchAndCacheHealthIndex` |
| `apps/api/src/index.ts` | Worker startup registration | VERIFIED | Imports `setupHealthIndexSchedule` (line 30); calls `setupHealthIndexSchedule().catch(...)` (line 152) |
| `apps/api/src/services/indexationEmail.ts` | Indexation email template generation per language and region | VERIFIED | 199 lines; exports `LEGAL_REFERENCES`, `DEFAULT_INDEXATION_TEMPLATES`, `generateDefaultIndexationEmail`; all 3 regions, all 4 languages; override note logic present |
| `apps/api/src/routes/indexation.ts` | All 6 indexation endpoints wired to real DB queries | VERIFIED | 971 lines; all 6 endpoints present; uses `getDb()`, `calculateLeaseIndexation()` shared helper; no stub comments remain |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `healthIndexWorker.ts` | `services/healthIndex.ts` | `import fetchAndCacheHealthIndex` | WIRED | Line 2 import; line 18 call inside Worker handler |
| `index.ts` | `jobs/healthIndexWorker.ts` | `import setupHealthIndexSchedule` | WIRED | Line 30 import; line 152 startup call |
| `services/healthIndex.ts` | `@rentular/db healthIndexValues` | Drizzle insert/select | WIRED | `getDb()` called; `healthIndexValues` queried at lines 67, 82, 113, 139 |
| `routes/indexation.ts` | `services/healthIndex.ts` | `import getHealthIndexValue, getLatestHealthIndex, isHealthIndexStale` | WIRED | Lines 26-29 import; called in `calculateLeaseIndexation()` and endpoint handlers |
| `routes/indexation.ts` | `@rentular/db` (6 tables) | Drizzle select/insert/update | WIRED | `getDb()` line 85; all tables imported lines 6-14; `indexationRecords` inserted line 860; `leases` updated line 875 |
| `routes/indexation.ts` | `services/indexationEmail.ts` | `import generateDefaultIndexationEmail, LEGAL_REFERENCES` | WIRED | Lines 31-34; `generateDefaultIndexationEmail` called in `/preview` line 756; `LEGAL_REFERENCES` used in template vars |
| `routes/indexation.ts` | `jobs/emailQueueWorker.ts` | `import queueEmail` | WIRED | Line 34; `queueEmail` called in `/apply` at line 937 |
| `routes/indexation.ts` | `lib/email.ts` | `import renderTemplate` | WIRED | Line 35; `renderTemplate` called in `/preview` lines 794-795 and `/apply` lines 934-935 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| IDX-01 | 03-01-PLAN.md | System fetches Belgian health index data from Statbel beSTAT API and caches in database | SATISFIED | `fetchAndCacheHealthIndex()` fetches from beSTAT API UUID endpoint; upserts into `healthIndexValues` table; daily cron via BullMQ |
| IDX-02 | 03-02-PLAN.md | System calculates indexed rent using correct regional formula (Brussels, Flanders, Wallonia) | SATISFIED | `calculateIndexedRent()` from `@rentular/shared/validation`; regional dispatch in `calculateLeaseIndexation()`; separate `applyBrusselsEpcRestriction` and `applyFlandersEpcRestriction` helpers |
| IDX-03 | 03-02-PLAN.md | System applies EPC correction factors for Brussels (E/F/G permanent penalty) and Flanders (correction factor) | SATISFIED | Brussels: `BRUSSELS_EPC_INDEXATION_FACTOR` applied to increase; Flanders: freeze period factors, post-freeze correction formula subtracting `frozenGrowth`; future bans (2028+) handled |
| IDX-04 | 03-02-PLAN.md | Landlord can preview indexed rent calculation before applying | SATISFIED | `GET /calculate/:leaseId` returns full calculation; `POST /preview/:leaseId` returns calculation + rendered email preview |
| IDX-05 | 03-02-PLAN.md | Landlord can choose to apply a lower-than-indexed rent amount | SATISFIED | `/preview` accepts `overrideNewRent`; `/apply` accepts `newRent`; both enforce cap at `calculatedNewRent` |
| IDX-06 | 03-02-PLAN.md | Landlord can customize the indexation notification message to tenant | SATISFIED | `/preview` returns `rawSubject`/`rawBody` (with placeholders) for editing; `/apply` accepts custom `subject`/`body` |
| IDX-07 | 03-02-PLAN.md | Applying indexation updates the lease rent and creates an indexation history record | SATISFIED | `db.insert(indexationRecords)` with all fields; `db.update(leases).set({ currentMonthlyRent, lastIndexationDate })`; `monthlyRent` (base rent) never modified |
| IDX-08 | 03-02-PLAN.md | System sends indexation notification email to tenant in their preferred language | SATISFIED | `generateDefaultIndexationEmail({ tenantLanguage })` selects template; `LEGAL_REFERENCES[region][language]` provides legal text; `queueEmail` sends via BullMQ |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `routes/indexation.ts` | 791, 931 | `overrideNote: ""` hardcoded in `templateVars` | Info | Not a bug: `generateDefaultIndexationEmail()` pre-substitutes `{{overrideNote}}` into the body before `renderTemplate()` runs. The `""` value in templateVars is never applied to an active `{{overrideNote}}` placeholder. D-12 is satisfied via the pre-substitution path. |
| `indexationEmail.ts` | 55, 157 | "placeholder" appears in comments | Info | These are code comments describing the `{{placeholder}}` template syntax, not implementation stubs. Not a concern. |

No blocker anti-patterns found. No stub implementations. Build passes cleanly with 2 tasks successful (api + web).

### Human Verification Required

#### 1. Override Note in Rendered Email

**Test:** Create a test lease with indexationEnabled=true, apply indexation with `newRent` lower than the calculated EPC-restricted maximum. Check the notification email body received by the tenant.
**Expected:** Email body contains the localized override note text, e.g. for English: "The indexed rent would be 950.00, but your landlord has set it to 900.00."
**Why human:** The code path relies on `generateDefaultIndexationEmail()` pre-baking the override note into `rawBody` before `renderTemplate()` is called. This is correct by code analysis but requires end-to-end execution with real data to confirm the text appears in the delivered email.

#### 2. Upcoming Indexations Endpoint

**Test:** With active leases having anniversary dates within 30 days and cached health index data in DB, call `GET /api/v1/indexation/upcoming`.
**Expected:** Response includes leases with `estimatedNewRent` reflecting EPC restrictions (not just `currentMonthlyRent`).
**Why human:** The endpoint falls back silently to `currentMonthlyRent` when `calculateLeaseIndexation` throws (e.g., missing health index data). Without a seeded DB, cannot verify the calculation path runs rather than the fallback.

### Gaps Summary

No gaps found. All 12 observable truths are verified. All 8 IDX requirements (IDX-01 through IDX-08) are satisfied by substantive, wired implementations. The build passes cleanly with no TypeScript errors.

The implementation is complete:
- Plan 01 delivered the Statbel health index data pipeline (IDX-01): service + BullMQ worker + API startup registration
- Plan 02 delivered the full indexation workflow (IDX-02 through IDX-08): 6 wired endpoints, regional EPC calculations, localized email templates with legal references, indexation record creation, and lease rent updates

The only items flagged for human verification are behavioral edge cases (override note text in delivered email, fallback path in /upcoming) that require a live database with test data to confirm end-to-end.

---

_Verified: 2026-03-23_
_Verifier: Claude (gsd-verifier)_
