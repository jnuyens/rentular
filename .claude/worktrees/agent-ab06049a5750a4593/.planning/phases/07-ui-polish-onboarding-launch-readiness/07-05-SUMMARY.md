---
phase: 07-ui-polish-onboarding-launch-readiness
plan: 05
subsystem: ui, auth, api
tags: [onboarding, wizard, next-auth, middleware, i18n, drizzle, hono]

# Dependency graph
requires:
  - phase: 07-01
    provides: shadcn/ui components, CSS variables, responsive layout
  - phase: 07-03
    provides: middleware auth routing, landing page redirect logic
provides:
  - NextAuth type augmentation with onboardingComplete on Session and JWT
  - Full-page onboarding wizard with 4 steps at /onboarding
  - Middleware redirect for incomplete onboarding users
  - GET/PATCH /api/v1/auth/onboarding endpoints for progress tracking
  - Database-tracked onboarding progress (onboardingStep, onboardingComplete columns)
  - Smovin import detection with summary cards
  - 17 onboarding i18n keys in EN, NL, FR, DE
affects: [07-06, launch-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns: [NextAuth type augmentation via .d.ts module declaration, JWT-cached onboarding status to avoid per-request DB queries]

key-files:
  created:
    - apps/web/types/next-auth.d.ts
    - apps/web/app/onboarding/page.tsx
  modified:
    - apps/web/lib/auth.ts
    - apps/web/middleware.ts
    - apps/api/src/routes/auth.ts
    - packages/db/src/schema/users.ts
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json

key-decisions:
  - "NextAuth type augmentation via .d.ts module declaration eliminates all 'as any' casts for session.onboardingComplete"
  - "Onboarding status cached in JWT token at sign-in to avoid per-request database queries"
  - "Middleware onboarding redirect placed after auth check (order: public page, auth, onboarding) to prevent redirect loops"

patterns-established:
  - "NextAuth type augmentation: extend Session and JWT interfaces via apps/web/types/next-auth.d.ts"
  - "JWT-cached user flags: query DB once at sign-in, embed in token for middleware access"

requirements-completed: [ONB-01, ONB-02, ONB-03]

# Metrics
duration: 6min
completed: 2026-03-28
---

# Phase 07 Plan 05: Onboarding Wizard Summary

**Full-page onboarding wizard with 4 steps (property, tenant, lease, payment), JWT-cached progress, middleware redirect, and Smovin import detection in 4 languages**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-28T20:51:11Z
- **Completed:** 2026-03-28T20:57:30Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- NextAuth type augmentation with onboardingComplete on Session and JWT, eliminating all `as any` casts
- Full-page onboarding wizard at /onboarding with 4-step progress indicator, form validation, and real data creation via existing API endpoints
- Middleware redirect for users with incomplete onboarding (with loop prevention for /onboarding and /api paths)
- GET and PATCH /api/v1/auth/onboarding endpoints for reading and updating onboarding progress
- Smovin import detection showing green summary cards when existing data is present
- Skip option to bypass setup and go directly to dashboard
- 17 onboarding i18n keys added to all 4 locale files (EN, NL, FR, DE)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create NextAuth type augmentation, extend auth session with onboardingComplete, add middleware onboarding redirect, create onboarding API endpoint** - `787ff33` (feat)
2. **Task 2: Create onboarding wizard page with 4 steps, import detection, skip option, and i18n** - `88de933` (feat)

## Files Created/Modified
- `apps/web/types/next-auth.d.ts` - NextAuth type augmentation declaring onboardingComplete on Session and JWT interfaces
- `apps/web/lib/auth.ts` - Extended JWT callback to fetch onboardingComplete from DB, session callback passes it to client
- `apps/web/middleware.ts` - Added onboarding redirect for incomplete users, with loop prevention
- `apps/api/src/routes/auth.ts` - Added GET/PATCH /onboarding endpoints with validation and auth
- `packages/db/src/schema/users.ts` - Added onboardingStep (int) and onboardingComplete (boolean) columns
- `apps/web/app/onboarding/page.tsx` - Full-page wizard with 4 steps, step indicator, form validation, import detection
- `apps/web/messages/en/common.json` - 17 onboarding i18n keys (English)
- `apps/web/messages/nl/common.json` - 17 onboarding i18n keys (Dutch)
- `apps/web/messages/fr/common.json` - 17 onboarding i18n keys (French)
- `apps/web/messages/de/common.json` - 17 onboarding i18n keys (German)

## Decisions Made
- Used NextAuth type augmentation via .d.ts module declaration to extend Session and JWT interfaces, eliminating all `as any` casts per CLAUDE.md strict TypeScript rules
- Onboarding status cached in JWT token at sign-in to avoid per-request database queries (per RESEARCH.md pitfall 4)
- Middleware redirect order: (1) public page check, (2) auth check, (3) onboarding check -- prevents redirect loops and ensures /onboarding requires auth

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added onboardingStep and onboardingComplete columns to users schema**
- **Found during:** Task 1 (auth session extension)
- **Issue:** Plan stated columns exist from Plan 01, but they were missing from the users table schema in this worktree
- **Fix:** Added `onboardingStep: int("onboarding_step").default(1)` and `onboardingComplete: boolean("onboarding_complete").default(false)` to users schema, imported `boolean` from drizzle-orm/mysql-core
- **Files modified:** packages/db/src/schema/users.ts
- **Verification:** Column definitions verified in schema, auth.ts query references match column names
- **Committed in:** 787ff33 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Schema columns required for all onboarding functionality. No scope creep.

## Issues Encountered
None

## Known Stubs
None - all wizard steps create real data via existing API endpoints, and the payment setup step (Step 4) is intentionally informational as GoCardless configuration happens in Settings.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Onboarding wizard complete and ready for user testing
- Database migration needed for onboardingStep and onboardingComplete columns (migration generation deferred per Phase 07 decision)
- Plan 06 (final i18n validation) can proceed

## Self-Check: PASSED

All 10 files verified as present. Both task commit hashes (787ff33, 88de933) confirmed in git history.

---
*Phase: 07-ui-polish-onboarding-launch-readiness*
*Completed: 2026-03-28*
