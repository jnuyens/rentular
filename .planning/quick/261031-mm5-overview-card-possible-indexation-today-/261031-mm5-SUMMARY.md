---
phase: quick-261031-mm5
plan: 01
subsystem: overview, indexation
tags: [overview, indexation, i18n]
requires: []
provides: ["raise-summary items with propertyName, tenantNames, currentRent", "Overview card: possible indexation today"]
affects: [apps/web/app/(dashboard)/indexation/page.tsx (consumer of raise-summary, fields unchanged)]
tech-stack:
  added: []
  patterns: ["best-effort secondary fetch in a self-contained card component that renders null on empty or error"]
key-files:
  created: []
  modified:
    - apps/api/src/routes/indexation.ts
    - apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
decisions:
  - "Overview indexation card fetches raise-summary once on mount (deps [apiUrl]) and ignores the month navigator"
metrics:
  completed: 2026-10-31
  tasks: 2
  files: 6
---

# Quick 261031-mm5: Overview card "Possible indexation today" Summary

The overview now has a card listing contracts that can be indexed right now (canApply and raise above 0.005), each with property, tenants, current rent → new rent and the monthly raise in green, plus the total raise per month in the header. Rows link to `/indexation?lease=<id>`. The raise-summary endpoint was extended with `propertyName`, `tenantNames` and `currentRent`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Extend raise-summary with propertyName, tenantNames, currentRent | ed6fa17 | apps/api/src/routes/indexation.ts |
| 2 | Overview card plus i18n (EN/NL/FR/DE) | 83452ec | overview/page.tsx, messages/{en,nl,fr,de}/common.json |

## Verification (observed)

- apps/api `npx tsc --noEmit -p .`: exit 0
- apps/api `npx vitest run`: 46 files, 410 tests passed
- apps/api `TZ=UTC npx vitest run`: 46 files, 410 tests passed
- apps/api `vitest run src/__tests__/i18n-completeness.test.ts`: 7 passed
- apps/web `npx tsc --noEmit -p .`: exit 0
- i18n key check: en, nl, fr, de all have indexationToday, indexationTodayHint, perMonth, perMonthShort
- No em-dash or en-dash in page.tsx, indexation.ts, or the added message lines
- Not verified: the prod sanity data (Provinciestraat 199 +30.00, Arendonckstraat 27 +10.28, total +40.28/month, Tervuursestraat 97 absent). That needs a deploy, which was out of scope here.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree had no node_modules**
- **Found during:** Task 1 verify
- **Issue:** tsc failed with missing Node types because the worktree had no installed dependencies.
- **Fix:** `pnpm install --frozen-lockfile --offline` (lockfile deps linked from the local store, no new packages, lockfile untouched).
- **Cost if wrong:** none; only local node_modules in the worktree.

Notes: `TrendingUp` was already imported on the overview page, so no import change was needed. Tenant lookup only runs on lease ids already filtered by the indexation access check (T-mm5-01); the card swallows fetch errors and renders null (T-mm5-02).

## Self-Check: PASSED

- ed6fa17 and 83452ec present on branch worktree-agent-a78fd42c91f38f222
- All modified files exist
