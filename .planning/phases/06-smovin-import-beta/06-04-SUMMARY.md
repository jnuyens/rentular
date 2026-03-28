---
phase: 06-smovin-import-beta
plan: 04
subsystem: ui
tags: [nextjs, react-query, i18n, tailwind, import, polling]

# Dependency graph
requires:
  - phase: 06-smovin-import-beta
    provides: Import API router with 6 endpoints, BullMQ discovery worker, importWriteWorker, smovinMapper
  - phase: 01-security-infrastructure
    provides: dashboard layout, NextAuth session, i18n patterns
provides:
  - Import page at /import with 6 view states (initial, discovering, discovered, importing, completed, failed)
  - Sidebar navigation item for import feature
  - Full i18n coverage for import UI in EN, NL, FR, DE (34 keys each)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [react-query refetchInterval callback for status polling, multi-state page component with session-driven rendering, NAV_VISIBILITY pattern for role-based sidebar filtering]

key-files:
  created:
    - apps/web/app/(dashboard)/import/page.tsx
  modified:
    - apps/web/app/(dashboard)/layout.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json

key-decisions:
  - "NAV_VISIBILITY blocking pattern added to layout to restrict import and settings to owner role only"
  - "Download icon from lucide-react used for import nav item (Import icon not available in 0.468.0)"
  - "Error message classification by keyword match (login/cloudflare) for appropriate i18n error display"
  - "Log messages accumulated in state array with auto-scroll for discovery/import progress tracking"

patterns-established:
  - "NAV_VISIBILITY: role-based sidebar nav visibility via blocking pattern (roles in array are blocked, owner always sees all)"
  - "Multi-state page component: single page.tsx rendering different UI based on session status field"
  - "refetchInterval callback pattern: polling at 2s only during active states, false otherwise"

requirements-completed: [IMP-01, IMP-04]

# Metrics
duration: 5min
completed: 2026-03-28
---

# Plan 06-04: Frontend Import UI Summary

**Import page with 6 view states (credential form, discovery/import progress with 2s polling, property selection with checkboxes, results grid, error/retry) and full i18n in 4 languages**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-28T09:53:52Z
- **Completed:** 2026-03-28T09:59:22Z
- **Tasks:** 2 (+ 1 human-verify checkpoint)
- **Files modified:** 6

## Accomplishments
- Import page with 6 view states driven by session status: credential form, discovering progress, property selection, importing progress, completed results, and failed error display
- Full i18n coverage: 34 import keys in EN, NL, FR, DE locale files plus nav section additions
- Sidebar nav item with Download icon, restricted to owner role via NAV_VISIBILITY pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Add i18n keys to all 4 locale files and sidebar nav item** - `4339b35` (feat)
2. **Task 2: Create import page.tsx with all 6 view states per UI-SPEC** - `d677fcc` (feat)

## Files Created/Modified
- `apps/web/app/(dashboard)/import/page.tsx` - Import page with 6 view states, react-query polling, property selection checkboxes, accessibility attributes
- `apps/web/app/(dashboard)/layout.tsx` - Download icon import, import nav item, NAV_VISIBILITY pattern for role-based filtering
- `apps/web/messages/en/common.json` - 34 English import i18n keys + nav key
- `apps/web/messages/nl/common.json` - 34 Dutch import i18n keys + nav key
- `apps/web/messages/fr/common.json` - 34 French import i18n keys + nav key
- `apps/web/messages/de/common.json` - 34 German import i18n keys + nav key

## Decisions Made
- Added NAV_VISIBILITY blocking pattern to dashboard layout to restrict import (and settings) sidebar items to owner role only -- all non-owner roles listed in the blocking array
- Used Download icon from lucide-react since Import icon may not be available in version 0.468.0
- Error messages in failed state are classified by keyword matching against errorMessage content (login -> login failed, cloudflare -> blocked, default -> generic error)
- Log messages are accumulated in a React state array and auto-scrolled to bottom for progress tracking during discovery and import phases

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete Smovin import UI flow is now accessible from the dashboard sidebar
- Full end-to-end flow: credential entry -> discovery -> property selection -> import -> results
- Phase 06 (smovin-import-beta) is complete with all 4 plans executed
- Ready for human verification checkpoint (Task 3) to validate the complete flow in a browser

## Self-Check: PASSED

- All 6 created/modified files verified on disk
- Both task commits (4339b35, d677fcc) found in git history
- No stubs (TODO/FIXME/placeholder) found in created files

---
*Phase: 06-smovin-import-beta*
*Completed: 2026-03-28*
