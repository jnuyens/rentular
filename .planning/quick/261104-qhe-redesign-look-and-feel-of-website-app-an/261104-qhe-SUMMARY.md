---
phase: quick-261104-qhe
plan: 01
status: complete
subsystem: web-ui, api-dashboard
tags: [design, branding, overview, marketing, i18n]
requires: []
provides:
  - navy/green design tokens and restyled shared ui components
  - navy gradient sidebar and mobile nav with green active pill
  - DashboardUserContext (first name for the greeting)
  - receivedHistory() helper and history + portfolio on GET /payments/dashboard
  - redesigned overview and marketing homepage
affects: [every dashboard page through shared components, public homepage]
tech-stack:
  added: []
  patterns: [CSS-variable brand palette merged into Tailwind default palettes, plain SVG chart, CSS matrix3d perspective overlay]
key-files:
  created:
    - apps/web/components/DashboardUserContext.tsx
    - apps/web/components/overview/{format.ts,KpiCard.tsx,ProgressRing.tsx,RentHistoryChart.tsx,PortfolioCard.tsx,TodoCard.tsx,QuickActions.tsx,BelgiumInfoCard.tsx}
    - apps/web/components/marketing/HeroShowcase.tsx
    - apps/web/public/brand/* (hero-canal-laptop, skyline-banner, houses-row as webp+jpg; keys-house png+webp; skyline-silhouette.svg, wave.svg, house-tile.svg)
    - .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/crop-assets.py
  modified:
    - apps/web/app/globals.css, apps/web/tailwind.config.ts
    - apps/web/components/ui/{card,button,badge,input,textarea,select}.tsx
    - apps/web/components/{DashboardSidebar,MobileNav,LanguageSwitcher}.tsx
    - apps/web/app/(dashboard)/layout.tsx, apps/web/app/(dashboard)/overview/page.tsx
    - apps/web/app/(marketing)/page.tsx, apps/web/components/marketing/DashboardPreview.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
    - apps/api/src/services/monthReceived.ts (+ test), apps/api/src/routes/payments.ts
decisions:
  - "Brand colours are exposed as navy, royal, green.DEFAULT, lime.DEFAULT, tint-* and icon-*; green and lime are merged objects so Tailwind's green-600, lime-400 etc. keep working"
  - "Dashboard watermark logo dropped: it clashed with the new body gradient"
  - "Hero laptop overlay uses a JS-measured layout plus a fixed matrix3d homography onto the measured screen corners; it is applied on mobile too"
metrics:
  completed: 2026-11-04
  tasks_done: 3
  tasks_deferred: 1
---

# Quick 261104-qhe: Redesign look and feel (web app and homepage) Summary

Navy-to-royal gradients, a leaf/lime green accent, pastel KPI tints and big rounded cards across the logged-in app and the public homepage, with a real 12-month rent history on the overview computed by the API from the same settlement helpers as the rest of the dashboard.

**Task 4 (Android theme) is deferred:** waiting for the 261104-qfd merge. There is no qfd SUMMARY.md in `.planning/quick/261104-qfd-android-app-for-google-play-with-self-ho/` (only its PLAN), so per the plan's gate android-app/ was not touched.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e6f4280 | Tokens, shared ui components, sidebar, mobile nav, user context, brand assets |
| 1 | c33ea06 | Crop script kept under the quick task folder |
| 2 (RED) | 50c2646 | Failing receivedHistory tests |
| 2 (GREEN) | d3e7041 | receivedHistory() and history + portfolio on /payments/dashboard |
| 2 | d338492 | Overview redesign and new overview strings (4 locales) |
| 3 | 5e9feb7 | Marketing homepage redesign and marketing strings (4 locales) |
| 4 | none | Deferred: waiting for 261104-qfd merge |

## What was built

**Task 1.** New HSL variables in both :root blocks of globals.css (`--brand-navy`, `--brand-royal`, `--brand-green`, `--brand-lime`, `--tint-*`, `--icon-*`), primary is leaf green with navy text, ring is royal blue, radius 1rem, light blue-to-white fixed body gradient, plus `.bg-brand-gradient`, `.bg-green-pill` and `.card-soft`. Tailwind exposes navy/royal/green/lime/tint/icon colours, `rounded-xl/2xl` and `shadow-soft`. Card, Button, Badge, Input, Textarea and SelectTrigger restyled without API changes. Sidebar and MobileNav are navy gradients with a green pill for the active item; the mobile nav keeps the big hanging logo. LanguageSwitcher got an optional `tone="dark"` prop (backward compatible). Brand rasters cropped from mockup-16 and checked visually; SVGs drawn by hand.

**Task 2.** `receivedHistory()` sums `receivedForMonth` per lease and month over 12 months, so max-not-sum of rows vs allocations, ignored rows and deposits all behave as before. `/payments/dashboard` adds `history` and `portfolio` (properties, distinct tenants on active leases, active leases); the early-return empty object has the same keys. No existing field or bucket logic changed. The overview keeps every existing feature (month switcher, KPI click-through breakdowns, partial-payment amber badge, shortfall notes, amber received amounts in the paid list, Mark paid, reminders, reconcile link, possible indexation today, total warranty, which now sits in the portfolio card). New: time-of-day greeting by first name (rendered after mount), skyline banner, pastel KPI cards with progress rings and an overdue status badge, collection card with to-come rows and an overflow menu limited to existing actions, the plain SVG 12-month chart (percentage badge only from the last two complete months, and only when the older one is above 0), portfolio, to-do from real figures only, quick actions and the info card. The raise-summary fetch now happens once per page and feeds both the indexation card and the to-do card.

**Task 3.** Sticky white nav (links collapse below lg), navy hero with the canal photo; the existing DashboardPreview, restyled, is drawn onto the blank laptop screen with a matrix3d homography. Feature grid, "Made for landlords" band with the keys image, pricing with unchanged content (Free EUR 0 up to 3 properties, Unlimited EUR 19/month excl. VAT, (*) and (**) notes, self-host as a footnote) and a "Most chosen" ribbon, trust strip, closing band and restyled footer. No demo button, no usage claims, no made-up numbers.

## Verification (observed)

- `apps/api`: `npx vitest run` gave 47 files and 439 tests passed. monthReceived plus i18n-completeness gave 44 passed. `npx tsc --noEmit -p .` was clean.
- `apps/web`: `npx tsc --noEmit -p .` was clean. `pnpm build` exited 0, but only with placeholder `DB_PASSWORD`/`AUTH_SECRET` env vars, because page-data collection imports the DB module and that refuses to start without a password. This worktree has no .env.
- Dash and banned-phrase greps from the plan returned no matches.
- Visual check: I took Playwright screenshots of the built homepage at 1440, 1100 and 390 wide. The laptop overlay lines up with the screen, and the hero photo fades into the gradient without overlapping the text.
- Not visually verified: the logged-in dashboard and overview. They need auth plus the API and DB, and I did not run those locally. Typecheck and build passed for them, but nothing more.

## Deviations from Plan

**1. [Rule 3 - Blocking] Crop script run with `python3 -P` instead of `-I`**
- Found during: Task 1. `-I` ignores user site-packages, where PIL is installed. `-P` still keeps the script directory off sys.path.
- Cost if wrong: none for the outputs; they are static files that I checked by eye.

**2. [Rule 3 - Blocking] Removed pre-existing em-dashes from `ibanityPurpose` in all 4 locales**
- Found during: Task 3. Without this, the plan's `! grep ... messages` gate fails. I replaced each spaced em-dash with ": ".
- Cost if wrong: one wording change in the bank-connection consent text.

**3. [Rule 2] Fixed missing accents in existing FR/DE/NL marketing copy that the redesign shows** (for example gérer, données, für, Brüssel, officiële, Wallonië). I also changed the NL feature titles from Title Case to sentence case.
- Cost if wrong: copy-only.

**4. Laptop overlay also on mobile.** Because the layout is measured in JS, the perspective overlay works at any size. So instead of a blank laptop below the text on mobile, the overlay is kept there too.
- Cost if wrong: one prop and class change to hide it below lg.

**5. Quick action labels link to list pages.** "New property" and "New contract" open /properties and /leases, which have their own add buttons. Neither route has a dedicated "new" page.

## Assumption Drift (advisory)

- Planned: hero photo as a right-aligned object-cover. Actual: the photo is placed by JS (bottom-right, scaled so the laptop and mug fit) and faded into the gradient with masks. Why: a plain cover crop either upscaled the 390 px tall photo a lot or put the laptop under the headline. Cost if wrong: the layout constants live in HeroShowcase.tsx.

## Notes for the owner

- The "Most chosen" ribbon is a soft popularity claim. The plan asked for it, but it can't be verified yet. Remove the `pricingMostChosen` span if you'd rather not make it.
- The build prints a standalone-tracing warning about `(marketing)/page_client-reference-manifest.js`. The build still succeeds. I did not check whether it happens on main as well.
- Tailwind opacity modifiers like `bg-tint-green/80` work because the colours are `hsl(var(--x))`.

## Known Stubs

None. Every new card reads real API data or links to existing routes.

## Threat Flags

None. history and portfolio are computed only over `getAccessiblePropertyIds(userId)` and the leases joined to them (T-qhe-01). There are no new routes or parameters.

## Self-Check: PASSED

- Files exist: apps/web/public/brand/{hero-canal-laptop.webp,skyline-banner.webp,houses-row.webp,keys-house.png,skyline-silhouette.svg,wave.svg,house-tile.svg}, components/overview/RentHistoryChart.tsx, components/DashboardUserContext.tsx, components/marketing/HeroShowcase.tsx
- Commits exist: e6f4280, c33ea06, 50c2646, d3e7041, d338492, 5e9feb7
