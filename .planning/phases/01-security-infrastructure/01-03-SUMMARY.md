---
phase: 01-security-infrastructure
plan: 03
subsystem: api
tags: [drizzle-orm, typescript, type-safety, database, security]

# Dependency graph
requires:
  - phase: 01-security-infrastructure/01-01
    provides: "DB schema with properties, tenants, bankAccounts, users table definitions and indexes"
provides:
  - "Static typed DB imports in properties.ts, tenants.ts, bankAccounts.ts, authMiddleware.ts"
  - "Zero any-typed database references in route files"
  - "Fail-fast DB error handling (no memoryStore fallback)"
  - "heatingType included in property creation"
affects: [02-payment-engine, 03-rent-indexation, 04-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static import pattern: import { getDb, tableName } from '@rentular/db'"
    - "Module-level DB constant: const db = getDb()"
    - "Direct table references instead of any-typed dbSchema"

key-files:
  created: []
  modified:
    - "apps/api/src/routes/properties.ts"
    - "apps/api/src/routes/tenants.ts"
    - "apps/api/src/routes/bankAccounts.ts"
    - "apps/api/src/lib/authMiddleware.ts"

key-decisions:
  - "Removed memoryStore fallback completely -- routes now fail fast on DB errors instead of silently returning stale/empty in-memory data"
  - "Added auth guard (401) to bankAccounts GET / for unauthenticated requests instead of falling through to memoryStore"

patterns-established:
  - "All route files use static ES module imports from @rentular/db matching auth.ts reference pattern"
  - "All route files use typed table references (properties, tenants, bankAccounts, users) not any-typed dbSchema"

requirements-completed: [SEC-02]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 01 Plan 03: Remove Any-Typed DB Imports Summary

**Converted four API files from dynamic require() with any-typed DB refs and memoryStore fallback to static typed ES module imports that fail fast on errors**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T10:46:12Z
- **Completed:** 2026-03-22T10:48:59Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Eliminated all `any` typing on database imports in properties.ts, tenants.ts, bankAccounts.ts, authMiddleware.ts (SEC-02)
- Removed memoryStore fallback pattern from all four files (D-09) -- routes now fail fast
- Added heatingType to property creation insert values (research pitfall 3)
- API builds with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert properties.ts and tenants.ts to static typed imports** - `0241ae9` (feat)
2. **Task 2: Convert bankAccounts.ts and authMiddleware.ts to static typed imports** - `f4dabfc` (feat)

## Files Created/Modified
- `apps/api/src/routes/properties.ts` - Properties CRUD with static typed DB imports, heatingType in create
- `apps/api/src/routes/tenants.ts` - Tenants CRUD with static typed DB imports, bankAccount->iban mapping preserved
- `apps/api/src/routes/bankAccounts.ts` - Bank accounts CRUD with static typed DB imports, auth guard added
- `apps/api/src/lib/authMiddleware.ts` - Auth middleware with static typed users table import for ensureUser

## Decisions Made
- Removed memoryStore fallback completely rather than keeping as degraded mode -- fail-fast is more secure and prevents silent data loss
- Added explicit 401 response to bankAccounts GET / when userId is missing, instead of falling through to empty memoryStore results

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added 401 auth guard to bankAccounts GET / endpoint**
- **Found during:** Task 2 (bankAccounts.ts conversion)
- **Issue:** Original code fell through to memoryStore when userId was null/undefined; after removing memoryStore, unauthenticated requests would query DB without owner filter
- **Fix:** Added explicit `if (!ownerId)` check returning 401 before DB query
- **Files modified:** apps/api/src/routes/bankAccounts.ts
- **Verification:** Code review confirms guard is in place
- **Committed in:** f4dabfc (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential security fix to prevent unauthenticated bank account listing. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four files with dynamic require() pattern are now converted to static typed imports
- Pattern matches auth.ts reference implementation exactly
- Ready for remaining Phase 01 plans (01-04 remaining route completions, 01-05 settings)

## Self-Check: PASSED

- All 4 modified files exist on disk
- Both task commits (0241ae9, f4dabfc) found in git log
- API build succeeds with zero TypeScript errors
- Zero any-typed DB variables across all target files
- Zero memoryStore references across all target files
- Zero require() calls across all target files

---
*Phase: 01-security-infrastructure*
*Completed: 2026-03-22*
