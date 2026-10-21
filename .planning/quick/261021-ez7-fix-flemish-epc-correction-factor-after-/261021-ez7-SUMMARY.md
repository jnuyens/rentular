---
phase: quick-261021-ez7
plan: 01
subsystem: indexation
tags: [indexation, flanders, epc, i18n, shared]
requires: []
provides:
  - FLANDERS_EPC_CORRECTION_FACTORS (shared constants)
  - getFlandersCorrectionFactor (api service, exported)
  - computeIndexReferenceMonth (shared validation)
  - correctionMonth / epcIndexationFactor on both indexation calc endpoints
affects:
  - apps/api/src/services/indexationCalc.ts consumers (calc, preview, upcoming, raise-summary, indexation alerts)
tech-stack:
  added: []
  patterns: [table-driven legal factor, shared pure helper between API and web]
key-files:
  created:
    - apps/api/src/__tests__/indexReferenceMonth.test.ts
  modified:
    - packages/shared/src/constants/index.ts
    - packages/shared/src/validation/index.ts
    - apps/api/src/services/indexationCalc.ts
    - apps/api/src/services/__tests__/indexationCalc.test.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/routes/leases.ts
    - apps/web/app/(dashboard)/indexation/page.tsx
    - apps/web/app/(dashboard)/leases/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
decisions:
  - Flemish post-freeze correction = round2(standard indexed rent x official anniversary-month factor), floored at base rent
  - EPC G uses the efNone column (not on the official page, worse than F)
  - Anniversary month read with getUTCMonth from the YYYY-MM-DD start date
metrics:
  duration: ~25 min
  completed: 2026-10-21
---

# Quick 261021-ez7: Flemish EPC correction factor after the freeze Summary

Flemish leases started before 2022-10-01 with EPC D, E, F, G or no EPC now get the official vlaanderen.be anniversary-month correction factor multiplied onto the standard indexed rent, replacing the old "subtract Sep 2022 to Sep 2023 index growth" formula; the indexation page explains the factor in EN/NL/FR/DE, and the reference-month rule is one shared function.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | 13a8467 | test: add failing tests for Flemish anniversary-month EPC correction factor |
| 1 (GREEN) | ed4e1b7 | fix: Flemish EPC correction uses official anniversary-month factor table |
| 2 | 5da81ad | feat: show the Flemish anniversary-month correction factor on the indexation page |
| 3 (RED) | 020bb10 | test: add failing tests for the shared index reference month helper |
| 3 (GREEN) | 7e9190c | refactor: share computeIndexReferenceMonth between API and web |

## What was done

- `FLANDERS_EPC_CORRECTION_FACTORS` (12 months, columns d / efNone, values copied from the official page with a citation comment). Stale `FLANDERS_EPC_NEEDS_CORRECTION` comment rewritten; the two en-dashes in the freeze comments replaced with "to".
- `getFlandersCorrectionFactor(label, month)` exported; `applyFlandersEpcRestriction` no longer takes indices; the Sep 2022 / Sep 2023 `getHealthIndexValue` lookups were removed from `computeIndexationCore`. Student, start-date, 2028+ ban and freeze branches are unchanged. New `correctionMonth` field on the core result (null unless the Flemish factor applied).
- Both `/calculate/:leaseId` and `/preview` return `epcIndexationFactor` and `correctionMonth`.
- Indexation page: extra paragraph `flandersCorrectionApplied` with localized month name (`Intl.DateTimeFormat(locale, { month: "long" })`) and the factor to 9 decimals.
- `computeIndexReferenceMonth` moved verbatim into `@rentular/shared/validation`; API (`leases.ts`, 2 call sites) and web lease form (`?? ""`) use it. The two old bodies were logically identical (same cutoff, same useStart/anchor fallbacks, same UTC previous-month math); only the web one returned "" instead of null, preserved via `?? ""`.

## Apply path finding (T-ez7-01)

`POST /apply/:leaseId` takes the landlord's `newRent`, rejects it with 400 when it exceeds `calc.newRent` (the core's corrected value), and writes that `newRent` to the indexation record and to `monthlyRent` / `currentMonthlyRent`. Nothing uses `unrestrictedNewRent` there, so no change was needed: the stored rent is the corrected rent or a lower, landlord-rounded value. The page pre-fills from `calc.newRent`.

## Verification (observed)

- `npx vitest run src/services/__tests__/indexationCalc.test.ts`: RED 7 failed / 6 passed before the fix, then 13 passed after.
- `npx vitest run src/__tests__/indexReferenceMonth.test.ts`: RED 7 failed (not a function), then passing within the full run.
- `npx vitest run src/__tests__/i18n-completeness.test.ts`: 7 passed. Each locale has exactly 1 `flandersCorrectionApplied`.
- Full API suite: 37 test files, 268 tests passed.
- `npx tsc --noEmit -p .` apps/api: exit 0. apps/web: exit 0.
- `DB_PASSWORD=placeholder AUTH_SECRET=placeholder pnpm --filter web build`: succeeded.
- No en/em-dashes in added lines (grep count 0). None of healthIndex.ts, healthIndexWorker.ts, email.ts, indexationAlerts.ts were touched. No deploy, no m1 access.

## Which leases change outcome

Changes: Flemish, non-student leases started before 2022-10-01 with EPC D, E, F, G or no EPC, for indexations dated after 2023-09-30 (until the 2028 E/F and 2030 D ban branches take over, which still return the base rent). Their new rent is now standard indexation x month factor instead of the old index-subtraction formula. D leases get a smaller cut (column d) than E/F/G/none (column efNone). How far the new figure is from the old one depends on the anniversary month and the current index. Example: base 675, 108.98 to 139.33, May anniversary, EPC E: 814.55.

Unchanged: EPC A++ to C, Flemish leases started on or after 2022-10-01, student leases, freeze-period indexations, Brussels and Wallonia leases.

Already-applied indexations stored in the database are not recalculated by this change. Indexation alerts and the upcoming list call `computeIndexationCore`, so their figures pick up the new rule automatically.

## Deviations from Plan

**1. [Rule 2 - Missing functionality] Orange EPC block also shows for corrected leases without an EPC label**
- Found during: Task 2
- Issue: the block was gated on `calc.epcLabel`, so a no-EPC lease (which gets the efNone factor) would never see the new factor note.
- Fix: condition is now `(calc.epcLabel || calc.correctionApplied) && calc.epcRestricted`; the title only appends "(EPC X)" when a label exists. The yellow "EPC needed" block still shows for those leases too.
- Commit: 5da81ad

**2. TDD commit messages** use `test:` / `fix:` / `feat:` / `refactor:` without the phase scope, in line with the plan's suggested commit message style.

## Assumption Drift (advisory)

- Found during Task 1 RED: planned assumption was that the old code would compute the subtraction formula in the tests; actually the Sep 2022 / Sep 2023 indices were not mocked so the old code skipped the correction and returned the unrestricted rent (732.02, 862.98). The RED run still failed as intended.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: indexReferenceMonth.test.ts, constants and validation changes present.
- Commits 13a8467, ed4e1b7, 5da81ad, 020bb10, 7e9190c present in `git log`.
