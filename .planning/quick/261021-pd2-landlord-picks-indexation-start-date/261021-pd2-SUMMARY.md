---
phase: quick-261021-pd2
plan: 01
subsystem: indexation
tags: [indexation, belgian-law, api, web, i18n]
requires: []
provides:
  - computeEffectiveDateOptions (apps/api/src/services/indexationCalc.ts)
  - effectiveDate on POST /indexation/preview/:leaseId and /apply/:leaseId
  - indexationDate and effectiveDateOptions on GET /indexation/calculate/:leaseId and GET /indexation/preview
affects:
  - leases.lastIndexationDate now holds the legal anniversary date
tech-stack:
  added: []
  patterns: [server-side whitelist of client-chosen dates, injectable today for TZ-independent tests]
key-files:
  created:
    - apps/api/src/routes/__tests__/indexation.test.ts
  modified:
    - apps/api/src/services/indexationCalc.ts
    - apps/api/src/services/__tests__/indexationCalc.test.ts
    - apps/api/src/routes/indexation.ts
    - apps/web/app/(dashboard)/indexation/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
decisions:
  - "Indexation start date: residential leases may start the new rent at most 3 months back (first due date on or after today minus 3 months), commercial leases back to the anniversary; never before the first due date on or after the anniversary"
  - "leases.lastIndexationDate stores the legal anniversary (indexationDate), not the chosen start date, so the yearly gate and alert cycle are unaffected by backdating"
  - "getIndexationApplicability parses YYYY-MM-DD as a local date so the gate flips at local midnight in Brussels"
metrics:
  duration: ~15min
  completed: 2026-10-21
  tasks: 3
  files: 9
---

# Quick 261021-pd2: Landlord picks the indexation start date Summary

Landlords can now pick which rent due date an indexation starts from: the next due date by default, or an earlier one within the Belgian limits (3 months back for residential, back to the anniversary for commercial). The server validates the choice against its own list.

## What changed

- **indexationCalc.ts**: new pure `computeEffectiveDateOptions` that lists due dates newest first with the default at index 0, the 3 month residential cap, the anniversary floor, no cap for commercial, capped days in short months and any payment day. `computeIndexationCore` accepts an optional `today` and now returns `indexationDate` (legal anniversary) and `effectiveDateOptions`. Before indexation is applicable, only the default date is offered. The private `dueIn` helper was pulled out of `firstDueOnOrAfter` so both use it.
- **routes/indexation.ts**: `effectiveDate` (zod `YYYY-MM-DD`, optional) on POST preview and apply. `withChosenEffectiveDate` rejects anything outside `effectiveDateOptions` with a 400 that lists the allowed dates. The chosen date goes into the letter params, the `indexation_records.effectiveDate` row and the response. The lease update now writes `lastIndexationDate: calc.indexationDate`. Apply's response includes `indexationDate`. GET calculate and GET preview expose `indexationDate` and `effectiveDateOptions`. In apply, the date is checked after the role check and the canApply check, so existing error priorities stay the same.
- **Web apply dialog**: step 1 has a "New rent from" select (dd/mm/yyyy, default preselected, disabled when there is only one option). Picking a past date shows the backdating note. The "Effective from" row shows the chosen date, and `effectiveDate` is sent to both POST endpoints.
- **i18n**: `newRentFromLabel` and `backdatedNote` in EN/NL/FR/DE, copied as given in the plan.

## Verification (observed)

- `apps/api` vitest, local TZ (CEST): 42 files, **367 passed** (347 before plus 12 calc tests and 8 route tests).
- `TZ=UTC` `apps/api` vitest: 42 files, **367 passed**.
- `indexationCalc.test.ts` alone: 30 passed in both TZ settings.
- `apps/api` `tsc --noEmit`: exit 0. `apps/web` `tsc --noEmit`: exit 0.
- i18n completeness test: 7 passed. Each locale file has exactly one `newRentFromLabel`.
- Dash grep over the touched source and test files: no matches. The new locale values have no dashes.
- `packages/db`: no changes.
- Not verified: the human check in the browser (opening /indexation, picking a date, preparing and applying). That needs the running app in prod, per the project's testing practice.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 RED | 2653e04 | test(api): add failing tests for landlord-chosen indexation start dates |
| 1 GREEN | 2790787 | feat(api): offer earlier rent due dates as the start of an indexation |
| 2 RED | 0af8a64 | test(api): add failing route tests for the chosen indexation start date |
| 2 GREEN | c45ecdc | feat(api): let the landlord choose the indexation start date |
| 3 | 4e259c6 | feat(web): pick the date the indexed rent starts from in the apply dialog |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Applicability gate was off by up to two hours in Brussels**
- **Found during:** Task 1 (RED run)
- **Issue:** `getIndexationApplicability` parsed `YYYY-MM-DD` with `new Date(string)` (UTC midnight). With `today = new Date(2027, 4, 1)` (local midnight in Brussels) it returned `canApply: false`, which the plan's own behavior case expects to be `true`. In production this means an indexation could not be applied for the first one or two hours of the anniversary day.
- **Fix:** Parse the date with a local constructor (`parseLocalDate`) and format `applicableFrom` with `localYmd`. The existing applicability tests still pass in both TZ settings.
- **Files modified:** apps/api/src/services/indexationCalc.ts
- **Commit:** 2790787

### Other notes

- The plan's verify commands point at the main repo path (`/Users/jnuyens/src/rentular/source/apps/api`). I ran the same commands in this worktree instead.
- I did not run `pnpm --filter api exec tsc`. I ran `npx tsc --noEmit -p .` in each package directory instead.
- The worktree base was wrong at spawn (038538a) and was reset to d9066f5 as instructed. node_modules was restored with `pnpm install --frozen-lockfile --offline`, with no new packages.

## Known Stubs

None. Rent already paid for backdated months is not adjusted. The UI note says so, and the plan puts that work out of scope (Phase 11.1 IDX-07).

## TDD Gate Compliance

Tasks 1 and 2 each have a `test(...)` commit followed by a `feat(...)` commit. Both RED runs failed for the expected reasons (11 failures and 8 failures) before the implementation went in.

## Self-Check: PASSED

- FOUND: apps/api/src/routes/__tests__/indexation.test.ts
- FOUND: apps/api/src/services/indexationCalc.ts (computeEffectiveDateOptions exported)
- FOUND commits: 2653e04, 2790787, 0af8a64, c45ecdc, 4e259c6
