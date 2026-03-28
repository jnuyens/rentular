---
phase: 07-ui-polish-onboarding-launch-readiness
plan: 01
subsystem: ui
tags: [shadcn-ui, radix, tailwindcss-animate, sonner, toast, css-variables, onboarding, drizzle-migration]

# Dependency graph
requires:
  - phase: 06-smovin-import
    provides: existing dashboard layout, users schema, tailwind config
provides:
  - shadcn/ui component library (18 components) importable from @/components/ui/*
  - cn() class merge utility at apps/web/lib/utils.ts
  - Toaster (sonner) in root layout for toast notifications
  - CSS variable tokens for all shadcn/ui theming (card, popover, secondary, accent, input, radius)
  - tailwindcss-animate plugin configured
  - Onboarding columns (onboardingStep, onboardingComplete) on users table
  - Bigger dashboard logo (48x48) and lighter watermark (opacity 0.02)
affects: [07-02, 07-03, 07-04, 07-05, 07-06]

# Tech tracking
tech-stack:
  added: [class-variance-authority, tailwindcss-animate, sonner, @radix-ui/react-dialog, @radix-ui/react-slot, @radix-ui/react-label, @radix-ui/react-separator, @radix-ui/react-select, @radix-ui/react-tabs, @radix-ui/react-alert-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tooltip, next-themes]
  patterns: [shadcn/ui component convention, cn() class merging, CSS variable theming]

key-files:
  created:
    - apps/web/lib/utils.ts
    - apps/web/components.json
    - apps/web/components/ui/button.tsx
    - apps/web/components/ui/card.tsx
    - apps/web/components/ui/dialog.tsx
    - apps/web/components/ui/alert-dialog.tsx
    - apps/web/components/ui/input.tsx
    - apps/web/components/ui/table.tsx
    - apps/web/components/ui/badge.tsx
    - apps/web/components/ui/skeleton.tsx
    - apps/web/components/ui/label.tsx
    - apps/web/components/ui/separator.tsx
    - apps/web/components/ui/sheet.tsx
    - apps/web/components/ui/select.tsx
    - apps/web/components/ui/textarea.tsx
    - apps/web/components/ui/tabs.tsx
    - apps/web/components/ui/alert.tsx
    - apps/web/components/ui/dropdown-menu.tsx
    - apps/web/components/ui/tooltip.tsx
    - apps/web/components/ui/sonner.tsx
    - packages/db/drizzle/0000_futuristic_the_initiative.sql
  modified:
    - apps/web/tailwind.config.ts
    - apps/web/app/globals.css
    - apps/web/package.json
    - apps/web/app/layout.tsx
    - apps/web/app/(dashboard)/layout.tsx
    - packages/db/src/schema/users.ts
    - pnpm-lock.yaml

key-decisions:
  - "Used shadcn@2.3.0 (pinned) for Tailwind v3 compatibility instead of @latest which targets v4"
  - "Preserved brand primary color (207 90% 46%) during CSS variable merge -- not overwritten by shadcn defaults"
  - "Migration generated but db:push/migrate deferred -- no DB connection in build environment"

patterns-established:
  - "shadcn/ui components at @/components/ui/* with cn() utility for class merging"
  - "CSS variables for all theming tokens (--card, --popover, --secondary, --accent, --input, --radius)"
  - "Toaster rendered at root layout level for app-wide toast notifications"

requirements-completed: [UI-01, UI-05]

# Metrics
duration: 4min
completed: 2026-03-28
---

# Phase 7 Plan 1: shadcn/ui Foundation Summary

**shadcn/ui initialized with 18 Radix-based components, cn() utility, Toaster in root layout, bigger dashboard logo (48x48), lighter watermark (0.02), and onboarding columns on users schema**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-28T20:24:48Z
- **Completed:** 2026-03-28T20:28:54Z
- **Tasks:** 2
- **Files modified:** 28

## Accomplishments
- Installed and configured shadcn/ui with all 18 component primitives (button, card, dialog, alert-dialog, input, table, badge, skeleton, label, separator, sheet, select, textarea, tabs, alert, dropdown-menu, tooltip, sonner)
- Created cn() class merge utility and updated CSS variables with full shadcn/ui token set while preserving brand colors
- Added Toaster (sonner) to root layout for app-wide toast notifications at bottom-right
- Increased dashboard logo to 48x48 and reduced watermark opacity to 0.02
- Added onboardingStep and onboardingComplete columns to users schema with Drizzle migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize shadcn/ui, install all components, create cn() utility, update CSS variables and Tailwind config** - `7e85947` (feat)
2. **Task 2: Add Toaster to root layout, increase dashboard logo to 48x48, reduce watermark opacity, add onboarding columns to users schema, generate migration** - `c877112` (feat)

## Files Created/Modified
- `apps/web/lib/utils.ts` - cn() class merge utility (clsx + tailwind-merge)
- `apps/web/components.json` - shadcn/ui configuration file
- `apps/web/components/ui/*.tsx` - 18 shadcn/ui component files
- `apps/web/tailwind.config.ts` - Added tailwindcss-animate plugin and borderRadius CSS variable references
- `apps/web/app/globals.css` - Full shadcn/ui CSS variable tokens (card, popover, secondary, accent, input, radius) for both light and dark modes
- `apps/web/package.json` - Added Radix UI, CVA, sonner, tailwindcss-animate, next-themes dependencies
- `apps/web/app/layout.tsx` - Added Toaster import and component at bottom-right position
- `apps/web/app/(dashboard)/layout.tsx` - Logo 36x36 to 48x48, watermark 0.03 to 0.02
- `packages/db/src/schema/users.ts` - Added onboardingStep (int, default 1) and onboardingComplete (boolean, default false)
- `packages/db/drizzle/0000_futuristic_the_initiative.sql` - Full schema migration including onboarding columns

## Decisions Made
- Used shadcn@2.3.0 (pinned) for Tailwind v3 compatibility, as @latest generates Tailwind v4 CSS
- Preserved existing brand primary color (207 90% 46%) during CSS variable merge
- Database migration generated but push/migrate deferred -- no database connection available in build environment; migration file committed for deployment

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree initially had no node_modules -- ran `pnpm install` before migration generation (resolved quickly)

## User Setup Required

None - no external service configuration required. Database migration needs to be run on deployment (`pnpm db:migrate` or `drizzle-kit push`).

## Next Phase Readiness
- All 18 shadcn/ui components available for import in Plans 02-06
- Toaster ready for success/error toast notifications throughout the app
- Onboarding columns ready for wizard implementation in Plan 05
- CSS variable system ready for consistent theming

## Self-Check: PASSED

All 21 created files verified present. Both task commits (7e85947, c877112) verified in git log.

---
*Phase: 07-ui-polish-onboarding-launch-readiness*
*Completed: 2026-03-28*
