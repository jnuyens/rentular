---
phase: 07-ui-polish-onboarding-launch-readiness
plan: 03
subsystem: web, api
tags: [marketing-page, auth-routing, stripe-pricing, i18n, shadcn-ui, landing-page]

# Dependency graph
requires:
  - phase: 07-ui-polish-onboarding-launch-readiness
    plan: 01
    provides: shadcn/ui Button and Card components, cn() utility, CSS variables
provides:
  - Facebook-style auth routing on / (redirect authenticated users to /properties)
  - Marketing landing page with hero, features, pricing, footer sections
  - GET /api/v1/stripe/plans endpoint returning real or fallback pricing data
  - 25 marketing i18n keys in 4 locales (EN, NL, FR, DE)
  - Public routes for /privacy, /terms, /accept-invitation in middleware
affects: [07-04, 07-05, 07-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [server-component auth routing, client marketing page with API pricing fetch, light-mode-only marketing wrapper]

key-files:
  created:
    - apps/web/app/(marketing)/page.tsx
  modified:
    - apps/web/app/page.tsx
    - apps/api/src/routes/stripe.ts
    - apps/web/middleware.ts
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json

key-decisions:
  - "Used Stripe.Product type cast instead of any for Stripe product metadata access in GET /plans endpoint"
  - "Marketing page uses useEffect fetch for pricing rather than @tanstack/react-query to keep dependency footprint minimal"
  - "Dashboard preview uses CSS placeholder instead of screenshot image (no rentular-dashboard.png exists yet)"
  - "Added /accept-invitation to public patterns preemptively for property manager invitation flow"

patterns-established:
  - "Server component auth routing: auth() check in page.tsx, redirect to dashboard if session exists"
  - "Marketing page as (marketing) route group for clean URL structure"
  - "Client-side pricing fetch with static fallback for resilience"

requirements-completed: [UI-02, UI-04]

# Metrics
duration: 3min
completed: 2026-03-28
---

# Phase 7 Plan 3: Marketing Landing Page Summary

**Rewrote 702-line client landing page as thin server component with Facebook-style auth routing plus professional marketing page with hero, 6 feature cards, real Stripe pricing via GET /plans endpoint, sticky nav, and 25 i18n keys in 4 languages**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T20:34:23Z
- **Completed:** 2026-03-28T20:37:23Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments

- Rewrote apps/web/app/page.tsx from 702-line client component to 11-line server component with auth routing (authenticated users redirected to /properties, others see marketing page)
- Created apps/web/app/(marketing)/page.tsx as a professional marketing landing page with 4 sections: sticky nav (fixed top-0 with logo, anchor links, Login, Get Started, LanguageSwitcher), hero (headline + subtitle + CTA + browser mockup), features (6 cards with icons using shadcn Card), pricing (fetched from Stripe API with fallback), footer (logo, privacy/terms links, copyright, mobile language switcher)
- Added GET /plans endpoint to Stripe API router returning real Stripe prices when configured or static EUR fallback prices when not configured, with try/catch error fallback
- Added 25 marketing i18n keys to all 4 locale files (EN, NL, FR, DE) covering nav, hero, features, pricing, and footer copy
- Updated middleware.ts publicPatterns to include /privacy, /terms, and /accept-invitation as public routes
- Marketing page uses light mode only (className="light" on wrapper div)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Stripe plans endpoint, rewrite page.tsx with auth routing, create marketing page component** - `d67d84e` (feat)

## Files Created/Modified

- `apps/web/app/page.tsx` - Thin server component: auth check + redirect or render MarketingPage (11 lines)
- `apps/web/app/(marketing)/page.tsx` - Full marketing landing page with hero, features, pricing, footer sections (230 lines)
- `apps/api/src/routes/stripe.ts` - Added GET /plans endpoint with Stripe API pricing and static fallback
- `apps/web/middleware.ts` - Added /privacy, /terms, /accept-invitation to publicPatterns
- `apps/web/messages/en/common.json` - Added 25 marketing.* i18n keys
- `apps/web/messages/nl/common.json` - Added 25 marketing.* i18n keys (Dutch translations)
- `apps/web/messages/fr/common.json` - Added 25 marketing.* i18n keys (French translations)
- `apps/web/messages/de/common.json` - Added 25 marketing.* i18n keys (German translations)

## Decisions Made

- Used `Stripe.Product` type cast instead of `any` for Stripe product metadata access, maintaining TypeScript strict mode compliance
- Marketing page uses `useEffect` fetch for pricing rather than @tanstack/react-query to minimize dependencies for this public-facing page
- Dashboard preview uses CSS placeholder div (gradient background with text) since no screenshot image exists yet
- Added /accept-invitation to public patterns preemptively since property manager invitation flow needs it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used Stripe.Product type instead of any**
- **Found during:** Task 1
- **Issue:** Plan code used `(p.product as any)` which violates TypeScript strict mode (implicit any forbidden per CLAUDE.md)
- **Fix:** Cast to `Stripe.Product` instead: `(p.product as Stripe.Product)`
- **Files modified:** apps/api/src/routes/stripe.ts
- **Commit:** d67d84e

## Known Stubs

None -- all sections render real data or have proper fallback mechanisms. Dashboard preview is a styled placeholder but this is intentional UX (no screenshot exists yet) and does not prevent the plan's goal from being achieved.

## Self-Check: PASSED
