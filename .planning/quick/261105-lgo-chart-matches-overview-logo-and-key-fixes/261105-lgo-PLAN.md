---
quick_id: 261105-lgo
type: quick
autonomous: true
---

# Quick Task 261105-lgo: 12-month chart matches the overview, new transparent logo, new key image

Owner feedback 2026-11-05 on the redesign deployed the night before. Screenshots in assets/screenshot-24..30.png.

## Task 1: The 12-month chart must show exactly the overview's "Betaald deze maand" per month

Problem: the "Huurinkomsten (laatste 12 maanden)" bars do not match the overview figures for the same month. Prod data (owner a1e2c837-8130-438a-9a12-c285dda5cf27): history from /payments/dashboard returned 2026-08: 11489, 2026-09: 10917, 2026-10: 10134, 2026-11: 9044, while selecting those months on the overview shows Betaald 7978 (Aug), 9635 (Sep), 9620.08 (Oct), 9044 (Nov). Cause: receivedHistory() in apps/api/src/services/monthReceived.ts sums raw received amounts of all rows per month (overpayments, payments for other leases or rows outside the lease-centric settlement), while the overview's "Betaald" is the lease-centric settlement in payments.ts /dashboard (settled lease adds its expected amount, partial lease adds what was received, only leases whose rent is due that month).

Fix: extract the per-month computation of the dashboard (the loop that produces paidThisMonth / toComeThisMonth / overdueThisMonth / expectedThisMonth for one month, including the rules for lease start/end, rentForDate, charges, deductions, allocations, partial months, and the "partial shortfall is overdue from its due day" rule) into one reusable function, used both for the selected month and for each of the 12 history months. History entries become { month, paid, expected } where paid === that month's paidThisMonth exactly and expected === expectedThisMonth. Batch-load data once (no N+1 per month). The chart plots paid (current month green, others blue) and the percentage change compares the last two complete months' paid values (only when the older one is > 0), unchanged rule otherwise. Add a test proving history[month].paid equals the dashboard's paidThisMonth for the same fixtures (Carnotstraat 900/925 and Tervuursestraat 740/810 November cases, a fully paid month, an overpaid month, a month before a lease started). Keep receivedHistory only if still used elsewhere; otherwise remove it and its tests (replace with the new ones).

Expected on prod after deploy: chart bars for Aug, Sep, Oct, Nov 2026 equal 7978, 9635, 9620.08, 9044 (the overview's Betaald when that month is selected).

## Task 2: Logo everywhere from the new transparent PNG

- Source: assets/rentular-logo-transparent.png (610x570, transparent background, emblem on top, navy "Rentular" wordmark below). Current apps/web/public/rentular.png is RGB with a white background, which causes the white box around the logo (sidebar, marketing header, mobile nav, login, etc.).
- Produce (PIL, keep transparency, trim transparent margins, sharp downscales at 1x and 2x where useful):
  - apps/web/public/brand/logo-full.png: the full logo (emblem + navy wordmark) for light backgrounds.
  - apps/web/public/brand/logo-mark.png: the emblem only (crop away the wordmark), for use next to a separate "Rentular" text and on dark backgrounds.
  - apps/web/public/rentular.png: replace with the transparent emblem-only mark (square canvas, transparent padding) so every existing <Image src="/rentular.png"> stops showing a white box; check each usage listed by `grep -rn rentular.png apps/web` still looks right (login page large watermark, invite page, onboarding, download page, SupportChat avatar, MobileNav).
- Dashboard sidebar (DashboardSidebar.tsx) on the navy background: emblem-only mark, clearly bigger than now (about 96 to 112 px tall), no white box, no drop-shadow box, with the white "Rentular" text below as today. MobileNav sheet header: same mark, keep the "hangs over the line" behaviour, no white box.
- Marketing header (white nav, (marketing)/page.tsx line ~58): use the emblem mark at about 44 to 52 px next to the "Rentular" text (screenshot-29 shows it too small with a white border); footer (~line 334) likewise.
- Favicon/app icons (apps/web/app/icon.* or public favicon if present): regenerate from the emblem mark with transparency where the format allows.
- Android: regenerate the launcher foreground (android-app/app/src/main/res mipmap/drawable foreground used by the adaptive icon) from the emblem mark on the existing navy background so the icon matches; keep versionCode unchanged; `./gradlew assembleDebug` must pass. Do not replace apps/web/public/rentular.apk.

## Task 3: New key image

- Replace apps/web/public/brand/keys-house.webp (and any png/jpg fallback) with assets/keys-house-logo.png (1523x1032, the wooden house key hanger with the correct Rentular logo). Keep its soft background or make it blend with the "Speciaal voor verhuurders" band (screenshot-30 shows the old image on a light green band); export optimised webp plus png fallback at a sensible size (max ~900 px wide), update width/height props in (marketing)/page.tsx.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (set placeholder DB_PASSWORD/AUTH_SECRET env if the build needs them); android `./gradlew testDebugUnitTest assembleDebug` with the Android Studio JBR.
- Render the marketing homepage locally and screenshot the header and the key band to check the logo has no white box and the key image looks right.
- No em-dashes or en-dashes; no Co-Authored-By lines. Never deploy, never touch prod, no schema changes.
