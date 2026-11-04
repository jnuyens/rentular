---
phase: quick-261104-qhe
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/app/globals.css
  - apps/web/tailwind.config.ts
  - apps/web/components/ui/card.tsx
  - apps/web/components/ui/button.tsx
  - apps/web/components/ui/badge.tsx
  - apps/web/components/ui/input.tsx
  - apps/web/components/ui/textarea.tsx
  - apps/web/components/ui/select.tsx
  - apps/web/components/DashboardSidebar.tsx
  - apps/web/components/MobileNav.tsx
  - apps/web/components/DashboardUserContext.tsx
  - apps/web/app/(dashboard)/layout.tsx
  - apps/web/public/brand/*
  - apps/api/src/services/monthReceived.ts
  - apps/api/src/services/__tests__/monthReceived.test.ts
  - apps/api/src/routes/payments.ts
  - apps/web/app/(dashboard)/overview/page.tsx
  - apps/web/components/overview/*
  - apps/web/app/(marketing)/page.tsx
  - apps/web/components/marketing/*
  - apps/web/messages/{en,nl,fr,de}/common.json
  - android-app/app/src/main/res/values/colors.xml
  - android-app/app/src/main/res/values/themes.xml
  - android-app/app/src/main/res/drawable/*
  - android-app/app/src/main/res/mipmap-anydpi-v26/*
autonomous: true
requirements: [QHE-REDESIGN]

must_haves:
  truths:
    - "Every dashboard page shows the navy-gradient sidebar with a green-pill active item, rounded white cards with soft shadows and green primary buttons, without per-page edits"
    - "The overview greets the user by first name with a time-of-day greeting in EN/NL/FR/DE and keeps every existing function (month switcher, KPI breakdowns, mark paid, reminders, partial payment badge and shortfall notes, Mogelijke indexering vandaag)"
    - "The overview shows a 12-month received-rent bar chart whose bars are computed by the API from the exact settlement helpers, with no invented numbers"
    - "Portfolio, Te doen and Snelle acties cards show only real data and link to existing routes"
    - "The marketing homepage has the navy hero with canal photo, laptop and mug, the feature grid, the landlord band, the unchanged pricing content (Gratis EUR 0 up to 3 properties, Onbeperkt EUR 19/month excl. VAT, (*) and (**) footnotes, self-host as footnote) with a Meest gekozen ribbon, a trust strip and the closing band, in all 4 locales"
    - "No Bekijk demo button, no Al gebruikt door claim, no fake percentages, no em/en-dashes in any changed file"
    - "Android theme resources use the navy/green palette, applied only after 261104-qfd is merged"
  artifacts:
    - path: "apps/web/app/globals.css"
      provides: "New design tokens (navy, green, pastel tints, radius) as CSS variables"
      contains: "--brand-navy"
    - path: "apps/web/public/brand/hero-canal-laptop.webp"
      provides: "Hero photo crop from mockup-16"
    - path: "apps/web/public/brand/skyline-silhouette.svg"
      provides: "Clean SVG Belgian skyline silhouette"
    - path: "apps/web/public/brand/wave.svg"
      provides: "Blue/green wave SVG"
    - path: "apps/api/src/services/monthReceived.ts"
      provides: "receivedHistory() pure helper"
      exports: ["receivedHistory"]
    - path: "apps/web/components/overview/RentHistoryChart.tsx"
      provides: "Plain SVG 12-month bar chart"
    - path: "apps/web/components/DashboardUserContext.tsx"
      provides: "Client context exposing the signed-in user's name to dashboard pages"
  key_links:
    - from: "apps/api/src/routes/payments.ts (/dashboard)"
      to: "receivedHistory in services/monthReceived.ts"
      via: "function call over byLease rows + allocByLeaseMonth"
      pattern: "receivedHistory\\("
    - from: "apps/web/app/(dashboard)/overview/page.tsx"
      to: "/api/v1/payments/dashboard history + portfolio fields"
      via: "existing dashboard fetch"
      pattern: "history"
    - from: "apps/web/app/(dashboard)/layout.tsx"
      to: "DashboardUserContext provider"
      via: "wraps children with userName"
      pattern: "DashboardUserProvider"
---

<objective>
Redesign the look and feel of the logged-in app, the public marketing homepage and the Android wrapper app after the owner's mockups (navy-to-royal-blue gradients, lime/leaf green accent, pastel KPI tints, large rounded white cards, Belgian skyline imagery).

Purpose: a launch-ready, recognisable brand look across web and Android while keeping every existing feature and all copy honest.
Output: shared design tokens and ui components, new sidebar/mobile nav, brand assets cropped from mockup-16, redesigned overview with real 12-month rent history, redesigned marketing homepage, Android theme resources.
</objective>

<execution_context>
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/workflows/execute-plan.md
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

Mockups (read as images, source of truth for LOOK only, never for copy or claims):
- .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/mockups/mockup-15.png, mockup-17.png, mockup-18.png (dashboard)
- .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/mockups/mockup-16.png (asset sheet, 1672x941)
- .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/mockups/mockup-19.png, mockup-20.png (marketing)

Global rules for every task:
- No em-dashes or en-dashes anywhere (code, comments, copy, commit messages). Human tone, no AI marketing words.
- No Co-Authored-By lines in commits. No schema changes, never run db:generate. Do not deploy.
- All new UI strings in EN, NL, FR, DE (apps/web/messages/{locale}/common.json). apps/api/src/__tests__/i18n-completeness.test.ts must stay green.
- Do not copy mockup typos ("huurinnning") or unverifiable claims (no "Bekijk demo", no "Al gebruikt door ...", no "+3.2%" style numbers unless computed from real data).

<interfaces>
Existing code the executor builds on (extracted, do not re-explore):

apps/web/app/globals.css: shadcn-style HSL vars in :root (--background, --foreground, --card, --primary 207 90% 46%, --secondary, --muted, --accent, --destructive, --border, --input, --ring, --radius 0.5rem), duplicated in a prefers-color-scheme: dark block to force light. Keep both blocks in sync.
apps/web/tailwind.config.ts: colors map to hsl(var(--x)); `brand` 50..950 blue scale; borderRadius lg/md/sm from --radius; plugin tailwindcss-animate.
apps/web/components/ui/card.tsx: Card = "rounded-lg border bg-card text-card-foreground shadow-sm"; CardHeader p-6.
apps/web/components/ui/button.tsx: cva base "rounded-md ..."; variants default (bg-primary), outline, etc.; sizes default h-10 px-4.
apps/web/components/DashboardSidebar.tsx: props { items: NavItem[{key,href,label,iconName}], userName, userEmail, userImage, signOutAction }; iconMap of lucide icons; active = pathname === href || startsWith(href + "/"); "hidden md:flex w-64 ... bg-background"; logo /rentular.png 48x48; LanguageSwitcher + sign-out at bottom.
apps/web/components/MobileNav.tsx: fixed top bar h-14 md:hidden; Sheet side="left" w-64; big logo h-[90px] w-[82px] absolutely positioned hanging over the header line (keep this behaviour).
apps/web/app/(dashboard)/layout.tsx: server component; renders DashboardSidebar + MobileNav + <main className="relative flex-1 overflow-auto bg-muted pt-14 md:pt-0 p-4 md:p-8"> with a 2% opacity watermark logo; nav routes include /overview, /properties, /tenants, /leases, /payments, /bank-connections, /reconciliation, /mandates, /indexation, /communications, /maintenance, /settings, /import.

apps/api/src/routes/payments.ts GET /payments/dashboard (line ~309): query ?month=YYYY-MM; computes accessibleIds, activeLeaseRows, rows (payments joined with leases incl. paymentDay), byLease Map<leaseId, rows> (ignored rows skipped), allocRows filtered lte(periodMonth, month) into allocByLeaseMonth Map<"leaseId|YYYY-MM", number>, recordsByLease, deductionsByLease, settle(l, forMonth): MonthSettlement, tenantName Map from leaseTenants join tenants (selects firstName/lastName only), overdueItems/toComeItems/paidItems buckets. Returns { data: { month, expectedThisMonth, paidThisMonth, toComeThisMonth, overdueTotal, overdueThisMonth, totalWarranty, currency, ...buckets } }; empty object returned early when no accessible properties.
apps/api/src/services/monthReceived.ts exports: type PaidRowLike, type MonthSettlement { dueDate, expected, received, shortfall, oldRent, settled }, rentForDate, dueDateForMonth, attributedMonth(row, paymentDay), receivedForMonth(rows: PaidRowLike[], month: string, paymentDay, allocationSum = 0): number (round2, never adds rows and allocations, takes max), monthSettlement, preIndexationMatch, loadIndexRecords, loadMonthStatus. Tests: apps/api/src/services/__tests__/monthReceived.test.ts (vitest, describe blocks per helper).

apps/web/app/(dashboard)/overview/page.tsx (758 lines, "use client"): useTranslations("overview") as t; fetches `${apiUrl}/api/v1/payments/dashboard?month=` ; month prev/next/thisMonth switcher; MetricCard (label, value, hint, optional click to BucketBreakdown); collected progress Card (lg:col-span-2); totalWarranty MetricCard; IndexationTodayCard fetches /api/v1/indexation/raise-summary (items with leaseId, link /indexation?lease=); BucketBreakdown with partial-payment badge t("partlyPaid"), shortfall notes (shortfallRemaining, shortfallPaidOf, shortfallOldRent), lastPayment/noPaymentFound, reconcile link; MarkPaidButton (cash/bank_transfer/other), ReminderButton (friendly/formal/final). formatDate() for dd/mm/yyyy, eur() for amounts.

apps/web/app/(marketing)/page.tsx (237 lines): useTranslations("marketing"); top nav (navFeatures #features, navPricing #pricing, /download, login, getStarted), hero (heroTitle, heroSubtitle, heroCta, DashboardPreview from components/marketing/DashboardPreview.tsx), #features grid, #pricing with pricingFreeName/Sub/Feature1..3/Cta and pricingUnlimitedName/Sub/Feature1..5/Cta, pricingBankNote, pricingSmsNote, GitHub link https://github.com/jnuyens/rentular, footer privacy/terms/copyright.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Design tokens, shared ui components, navy/green sidebar and mobile nav, brand assets</name>
  <files>apps/web/app/globals.css, apps/web/tailwind.config.ts, apps/web/components/ui/card.tsx, apps/web/components/ui/button.tsx, apps/web/components/ui/badge.tsx, apps/web/components/ui/input.tsx, apps/web/components/ui/textarea.tsx, apps/web/components/ui/select.tsx, apps/web/components/DashboardSidebar.tsx, apps/web/components/MobileNav.tsx, apps/web/components/DashboardUserContext.tsx, apps/web/app/(dashboard)/layout.tsx, apps/web/public/brand/ (generated), .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/crop-assets.py</files>
  <action>
Tokens (globals.css, both :root blocks kept identical): add --brand-navy (approx #0B2A5B), --brand-royal (approx #1E5BD8), --brand-green (approx #3FAE2A) and --brand-lime (approx #7AC943) as HSL triples, plus pastel tints --tint-blue, --tint-green, --tint-peach, --tint-lavender (very light) and matching icon colours. Set --primary to the leaf green with dark-navy --primary-foreground so primary buttons render green with dark text, --ring to the royal blue, --radius to 1rem, --background to a very light blue-white, --muted to a soft blue-grey. Add a body background: subtle top-to-bottom gradient from a pale blue to white (fixed attachment). Add utility classes in @layer components: .bg-brand-gradient (navy to royal linear gradient), .bg-green-pill (lime to green gradient), .card-soft (white, radius, soft large shadow). tailwind.config.ts: expose navy, royal, green, lime and tint-* colours via the new vars, add borderRadius xl/2xl tied to --radius, add a boxShadow "soft". Keep the existing `brand` blue scale for backward compatibility.

Shared ui: Card becomes rounded-2xl, border-transparent or very light border, bg-card, shadow-soft. Button: rounded-xl; default variant uses the green gradient (bg-green-pill) with navy text and a subtle hover; outline variant white with navy border; keep variant names and props unchanged so no page breaks. Badge: rounded-full, softer tints (keep variant names). Input/Textarea/SelectTrigger: rounded-xl, h-10, light border, focus ring royal blue. Do not change component APIs.

Sidebar (DashboardSidebar.tsx): bg-brand-gradient, white text and icons, larger logo block at the top (rentular.png about 72px plus white "Rentular" wordmark, stacked like mockup-15), active item = green pill (bg-green-pill, navy text, rounded-xl, slight shadow), inactive hover = white/10. Bottom: decorative wave.svg absolutely positioned behind the language switcher and user block (pointer-events-none, low opacity); LanguageSwitcher and sign-out restyled for dark background (outline white/20 pill). MobileNav.tsx: top bar becomes navy gradient with white menu icon and wordmark; Sheet content uses the same navy gradient and green active pill; KEEP the big hanging logo behaviour (absolute h-[90px] w-[82px]).

DashboardUserContext.tsx ("use client"): export DashboardUserProvider({ userName, children }) and useDashboardUser() returning { userName: string | null, firstName: string | null } (firstName = first whitespace token of userName). layout.tsx wraps children with DashboardUserProvider using the session name it already passes to the sidebar; replace main's bg-muted with transparent so the body gradient shows; keep the watermark or drop it if it clashes (your call, note it in the summary).

Brand assets: write crop-assets.py (PIL, run with python3 -I) that reads mockup-16.png and writes into apps/web/public/brand/: hero-canal-laptop (approx box x0..1672, y0..410, full top banner incl. laptop and mug), skyline-banner (approx x8..1665, y422..568), houses-row (approx x405..720, y578..768), keys-house (approx x40..340, y575..770, near-white background turned transparent with a soft threshold, saved as png and webp). Inspect each crop as an image after writing and adjust boxes so no neighbouring element or rounded-corner background bleeds in. Save photos as .webp (quality ~82) plus .jpg fallback, each under ~250 KB. Hand-author skyline-silhouette.svg (clean path: stepped gable rooftops and a belfry tower, blue vertical gradient, viewBox based, no raster) and wave.svg (two layered blue and green wave paths with gradients) rather than tracing, for sharpness. Also hand-author house-tile.svg (simple neutral house icon on a pastel blue rounded tile) for list thumbnails, per the brief: no fake property photos.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/web && npx tsc --noEmit -p . && ls public/brand/hero-canal-laptop.webp public/brand/skyline-banner.webp public/brand/houses-row.webp public/brand/keys-house.png public/brand/skyline-silhouette.svg public/brand/wave.svg public/brand/house-tile.svg && ! grep -rnP '[\x{2013}\x{2014}]' app/globals.css tailwind.config.ts components/ui components/DashboardSidebar.tsx components/MobileNav.tsx components/DashboardUserContext.tsx "app/(dashboard)/layout.tsx"</automated>
  </verify>
  <done>Typecheck passes; all brand assets exist with sane sizes; sidebar and mobile nav render navy with green active pill; every dashboard page inherits rounded soft cards, green primary buttons and rounded inputs through shared components only; no component API changed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Overview redesign with real 12-month rent history, portfolio, to-do and quick actions</name>
  <files>apps/api/src/services/monthReceived.ts, apps/api/src/services/__tests__/monthReceived.test.ts, apps/api/src/routes/payments.ts, apps/web/app/(dashboard)/overview/page.tsx, apps/web/components/overview/KpiCard.tsx, apps/web/components/overview/ProgressRing.tsx, apps/web/components/overview/RentHistoryChart.tsx, apps/web/components/overview/PortfolioCard.tsx, apps/web/components/overview/TodoCard.tsx, apps/web/components/overview/QuickActions.tsx, apps/web/components/overview/BelgiumInfoCard.tsx, apps/web/messages/{en,nl,fr,de}/common.json</files>
  <behavior>
    - receivedHistory(leases, endMonth, 12) returns 12 entries oldest first, last entry month === endMonth
    - Each entry's received equals the sum over leases of receivedForMonth(rows, month, paymentDay, allocationSum for that lease and month)
    - A month with only an allocation and no paid row counts the allocation; a month with both counts max, never the sum (inherits receivedForMonth semantics)
    - Ignored rows and deposit rows are not counted (inherited); a year boundary (endMonth 2026-02) yields 2025-03 .. 2026-02
  </behavior>
  <action>
API (RED then GREEN): add to monthReceived.ts an exported pure function receivedHistory(input: { leases: Array<{ rows: PaidRowLike[]; paymentDay: number | null; allocations: Map<string, number> }>; endMonth: string; months: number }): Array<{ month: string; received: number }> built only on receivedForMonth and the existing shiftMonth helper (export or reuse it), rounding per month with round2. Write the tests from the behavior block first in monthReceived.test.ts, see them fail, then implement.

In payments.ts /dashboard: the allocRows query already covers all months up to the selected month; build per-lease allocation maps from it and call receivedHistory for every lease in leaseIdsInView (non-active leases count too, they received real rent), endMonth = selected month, months = 12. Add to the response data: history: Array<{ month, received }> and portfolio: { properties: accessibleIds.length, tenants: count of distinct tenant ids on active leases (add tenants.id to the existing leaseTenants select), activeLeases: activeLeaseRows.length }. Add the same keys with zero/empty values to the early-return `empty` object. Do not change existing fields or bucket logic.

Web overview (page.tsx plus new components in components/overview/): keep ALL existing behaviour: month switcher (restyle as a dark navy pill with chevrons and capitalized month), KPI click-through breakdowns, BucketBreakdown with partial-payment amber badge, shortfall notes, exact amounts, MarkPaidButton, ReminderButton, reconcile link, IndexationTodayCard, total warranty. Header: greeting from useDashboardUser().firstName, time-of-day computed client-side after mount (before 12:00 morning, 12:00 to 18:00 afternoon, else evening; render without greeting word until mounted to avoid hydration mismatch); new keys overview.greetingMorning / greetingAfternoon / greetingEvening with {name} (NL Goedemorgen/Goedemiddag/Goedenavond, FR Bonjour/Bon après-midi/Bonsoir, DE Guten Morgen/Guten Tag/Guten Abend, EN Good morning/Good afternoon/Good evening) and a fallback without name; subtitle "Uw huurinkomsten, betalingen en indexatie in één overzicht" style in 4 locales. Decorative skyline-banner image (next/image, priority, aria-hidden) top right behind the header, fading into the page with a gradient mask; hide on small screens.

KpiCard: pastel tint background per kind (expected blue, received green, to come peach, overdue lavender), icon tile, title, big amount, subline. Received and To come show ProgressRing (SVG circle, stroke-dasharray, percentage of expected, green for received, orange for to come). Overdue shows a green check badge when overdueTotal is 0, amber when only this month, red otherwise. Huurincasso deze maand card: keep the collected progress bar (green gradient) plus the to-come rows with house-tile.svg thumbnails, amount and the existing Markeer betaald / Herinnering buttons; add an overflow menu (DropdownMenu) only containing actions that already exist (open breakdown, reconcile link).

RentHistoryChart: plain SVG, 12 blue rounded bars (royal/light gradient), selected month bar green, month labels from Intl short month names in the active locale, y-axis ticks rounded to a nice step, accessible title and per-bar <title> with eur() amount. Percentage badge: compare the last two COMPLETE months before the current calendar month (exclude the in-progress month); show only when the older one is greater than 0, otherwise omit the badge entirely. Empty state text when all zero.

PortfolioCard: three rows (properties, tenants, active contracts) from data.portfolio with icons, houses-row image on the right (hidden on narrow widths). TodoCard: build items only from real data, in this order, skipping any that are zero: rent still to receive this month (count + amount from toCome bucket, link to the to-come breakdown), contracts that can be indexed now (count + per-month gain from the raise-summary data; lift that fetch into a shared hook or useQuery used by both IndexationTodayCard and TodoCard so it is fetched once), overdue payments (count + amount, link /payments). No checkboxes, no pre-checked fake items; show an "all caught up" line when empty. QuickActions: five pastel tiles linking to /properties (Nieuw eigendom), /leases (Nieuw contract), /indexation (Indexeren), /communications (Huurder berichten), /maintenance (Onderhoud melden). BelgiumInfoCard: title "Zorgeloos verhuren in België", short honest line (SEPA collection, correct indexation, clear follow-up, open source), skyline-silhouette.svg bottom right.

Layout grid like mockup-15: 4 KPI cards; collection card (2/3) + chart (1/3); indexation card + portfolio + to-do; quick actions (2/3) + info card (1/3); single column on mobile. Add all new strings under the existing "overview" namespace in all 4 locales.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/api && npx vitest run src/services/__tests__/monthReceived.test.ts src/__tests__/i18n-completeness.test.ts && npx tsc --noEmit -p . && cd ../web && npx tsc --noEmit -p . && ! grep -rnP '[\x{2013}\x{2014}]' "app/(dashboard)/overview" components/overview ../api/src/services/monthReceived.ts ../api/src/routes/payments.ts</automated>
  </verify>
  <done>receivedHistory tests pass; /payments/dashboard returns history (12 months ending at the selected month) and portfolio; overview renders greeting, tinted KPI cards with rings, collection card, real bar chart, portfolio, to-do, quick actions and info card, with every previous overview feature still present; i18n completeness green.</done>
</task>

<task type="auto">
  <name>Task 3: Marketing homepage redesign</name>
  <files>apps/web/app/(marketing)/page.tsx, apps/web/components/marketing/HeroShowcase.tsx, apps/web/components/marketing/DashboardPreview.tsx, apps/web/messages/{en,nl,fr,de}/common.json</files>
  <action>
Combine the best of mockup-19 and mockup-20. Top nav: white (or white/90 with backdrop blur, sticky) with logo, links Functies (#features), Prijzen (#pricing), Voor verhuurders (#landlords), Android (/download); Inloggen as outline button and green "Gratis starten" CTA, both to /login. Collapse links on mobile.

Hero on bg-brand-gradient with the hero-canal-laptop photo (next/image, priority, object-cover, right-aligned) and wave.svg along the bottom edge. Left column: small lime eyebrow "Voor verhuurders in België", white headline with key words in lime (render via next-intl rich text, e.g. t.rich("heroTitle", { hl: (c) => <span className="text-lime">{c}</span> })), subtitle, three-item green check list (SEPA collection via GoCardless, automatic Belgian indexation, clear overview of income), CTA "Gratis starten" to /login and a secondary outline link to #pricing (NOT "Bekijk demo"), reassurance line with three checks: Geen creditcard, Direct aan de slag, Open source. Laptop screen: HeroShowcase overlays the existing DashboardPreview (restyled to the new tokens) on the blank laptop screen in the photo using absolute positioning with a CSS perspective transform matched to the screen corners; if after a visual check (screenshot via next build + next start, or the browse skill) the overlay looks wrong, fall back to a cropped laptop region from mockup-19 or mockup-20, whichever is sharper, and note the choice in the summary. On mobile show the photo below the text without the overlay transform.

Sections below: feature grid (6 cards, pastel icon tiles, reuse/adjust existing marketing feature strings: SEPA, indexation, payment follow-up, manager roles, migration/import, multilingual); "Speciaal voor verhuurders" band (id="landlords") on a light green gradient with keys-house image and four benefit items (save time, paid sooner, stay compliant with indexation rules, clear overview of returns); pricing section: left column headline plus the existing pitch that automatic indexation usually pays for Rentular itself (open source as a side mention), right two cards. KEEP pricing content exactly: Gratis EUR 0 up to 3 properties with its existing feature lines and CTA, Onbeperkt EUR 19/month excl. VAT with its existing five feature lines and CTA, the (*) bank tracking note and (**) SMS note, self-host only as a footnote. Onbeperkt gets a green border and a "Meest gekozen" ribbon (new key pricingMostChosen in 4 locales). Trust strip: Gemaakt voor de Belgische markt, Veilig en betrouwbaar, Open source (AGPL-3.0), Code op GitHub (link https://github.com/jnuyens/rentular). NO "Al gebruikt door" item. Closing band: "Gebouwd in België, voor Belgische verhuurders." with skyline-silhouette.svg, then the existing footer (privacy, terms, copyright) restyled.

Copy: reuse existing marketing.* keys where they fit, adjust wording where needed, add new keys in all 4 locales, human tone, no em/en-dashes, no typos copied from the mockups, no invented stats.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/apps/api && npx vitest run src/__tests__/i18n-completeness.test.ts && cd ../web && npx tsc --noEmit -p . && pnpm build && ! grep -rnP '[\x{2013}\x{2014}]' "app/(marketing)" components/marketing messages && ! grep -rniE 'bekijk demo|al gebruikt door|huurinnning' "app/(marketing)" components/marketing messages</automated>
  </verify>
  <done>pnpm build succeeds; homepage shows the new nav, hero with photo, laptop and wave, features, landlord band, unchanged pricing content with ribbon, trust strip and closing band in EN/NL/FR/DE; banned claims and dashes absent.</done>
</task>

<task type="auto">
  <name>Task 4: Android theme resources (run only after 261104-qfd is merged)</name>
  <files>android-app/app/src/main/res/values/colors.xml, android-app/app/src/main/res/values/themes.xml, android-app/app/src/main/res/drawable/bg_brand_gradient.xml, android-app/app/src/main/res/drawable/btn_primary_green.xml, android-app/app/src/main/res/drawable/card_rounded.xml, android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml, android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml</files>
  <action>
DEPENDENCY GATE: parallel quick task 261104-qfd (server choice screen, version gate, Play release) is changing android-app/. Before touching anything, confirm it is merged: a 261104-qfd SUMMARY.md exists under .planning/quick/261104-qfd-android-app-for-google-play-with-self-ho/ AND `git log --oneline -- android-app` shows its commits on the current branch AND `git status --porcelain android-app` is clean. If any check fails, STOP this task, leave android-app untouched, and report "Task 4 deferred: waiting for 261104-qfd merge" in the summary (Tasks 1 to 3 still count as done).

When unblocked, touch only theme resources: colors.xml gets brand_navy, brand_royal, brand_green, brand_lime, surface, on_primary (navy) matching the web tokens (keep any color names qfd added, re-point their values rather than renaming). themes.xml: statusBarColor and navigationBarColor navy, light status bar icons off, windowBackground = bg_brand_gradient (also used as splash background; if qfd added a SplashScreen theme, set its windowSplashScreenBackground to brand_navy), colorPrimary green, colorOnPrimary navy, material button and card shape rounded (16dp) via styles, so qfd's native screens inherit green primary buttons and rounded cards without editing their layouts or Kotlin. New drawables: bg_brand_gradient (navy to royal linear gradient), btn_primary_green (rounded 14dp, lime to green gradient, pressed state), card_rounded (white, 16dp radius). Launcher: adaptive icon background becomes a navy gradient or brand_navy color, foreground unchanged. Do not bump versionCode, do not run build-and-publish.sh and do not touch apps/web/public/rentular.apk (no release in this task).
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/android-app && xmllint --noout app/src/main/res/values/colors.xml app/src/main/res/values/themes.xml app/src/main/res/drawable/*.xml app/src/main/res/mipmap-anydpi-v26/*.xml && (./gradlew -q assembleDebug || echo "gradle unavailable here: XML validated only")</automated>
  </verify>
  <done>Either the task is explicitly reported as deferred (qfd not merged, android-app untouched), or theme resources are updated, XML is valid, and assembleDebug succeeds where the Android SDK is available; no layout or Kotlin files from qfd were edited.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser to API /payments/dashboard | authenticated landlord requests aggregated financial data |
| public marketing page | unauthenticated visitors, static content only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qhe-01 | Information disclosure | /payments/dashboard history + portfolio | mitigate | Compute only over getAccessiblePropertyIds(userId) results and leases joined to them (same scoping as existing fields); no new route, no new params besides existing month regex |
| T-qhe-02 | Denial of service | 12-month history loop | accept | In-memory over rows already loaded for the request; 12 x leases iterations, no extra queries |
| T-qhe-03 | Spoofing | marketing claims | mitigate | No unverifiable usage claims or demo links; grep gate in Task 3 verify |
| T-qhe-04 | Tampering | brand asset crop script | accept | Local script on a repo-owned PNG, run with python3 -I, outputs static files only |
</threat_model>

<verification>
- apps/web: `npx tsc --noEmit -p .` and `pnpm build` succeed.
- apps/api: monthReceived and i18n-completeness vitest suites green, `npx tsc --noEmit -p .` clean.
- No em/en-dashes in changed files; no banned claims.
- Optional local visual check; real verification happens in prod after a separate deploy.
</verification>

<success_criteria>
- Dashboard pages share the new navy/green look through tokens and shared components only.
- Overview keeps every existing feature and adds greeting, tinted KPI cards with rings, real 12-month chart, portfolio, to-do, quick actions, info card.
- Marketing homepage redesigned with pricing content unchanged and honest copy in 4 locales.
- Android theme updated after 261104-qfd merges, or explicitly deferred.
</success_criteria>

<output>
Create `.planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/261104-qhe-SUMMARY.md` when done
</output>
