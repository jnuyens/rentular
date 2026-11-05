---
quick_id: 261105-lgo
status: complete
completed: 2026-11-04
commits:
  - 26eb0f5 fix(overview): 12-month chart shows the overview's paid figure for each month
  - 0491ece feat(brand): transparent logo everywhere, bigger sidebar mark, new app icons
  - 6b62aab feat(marketing): key image with the Rentular tag on the landlords band
  - 6c9ce17 docs(android): upload key password lives in a root-only file
key-files:
  created:
    - apps/api/src/services/monthTotals.ts
    - apps/api/src/services/__tests__/monthTotals.test.ts
    - apps/web/public/brand/logo-full.png
    - apps/web/public/brand/logo-mark.png
    - apps/web/app/icon.png
    - apps/web/app/apple-icon.png
    - android-app/app/src/main/res/drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png
  modified:
    - apps/api/src/routes/payments.ts
    - apps/api/src/services/monthReceived.ts
    - apps/web/components/overview/RentHistoryChart.tsx
    - apps/web/components/DashboardSidebar.tsx
    - apps/web/components/MobileNav.tsx
    - apps/web/app/(marketing)/page.tsx
    - apps/web/public/rentular.png
    - apps/web/public/brand/keys-house.{webp,png}
    - android-app/app/src/main/res/mipmap-*/ic_launcher{,_round}.png
    - android-app/README.md
    - android-app/play-store/CHECKLIST.md
  deleted:
    - android-app/app/src/main/res/drawable/ic_launcher_foreground.xml
---

# Quick 261105-lgo: chart matches the overview, transparent logo, new key image

The 12-month chart now plots exactly the overview's "Betaald" for each month: one `monthTotals()` function computes paid, to come, overdue and expected for a month, and both the dashboard and every history month use it. The logo now comes from the transparent source everywhere (web, favicon, Android). The landlords band shows the new key photo.

## Task 1: chart = overview paid
- New `apps/api/src/services/monthTotals.ts`: `monthTotals()` holds the lease-centric loop that used to live in `/payments/dashboard`, covering lease start and sane end date, settled = expected, partial = received, partial shortfall overdue from the due day, unpaid overdue after the due day. `makeSettler()` wraps the data loaded once (rows, allocations, indexations, deductions), and `monthHistory()` calls `monthTotals` for each of the 12 months, so there are no per-month queries.
- `/payments/dashboard` uses `monthTotals` for the selected month and `monthHistory` over the same active leases. History entries are `{ month, paid, expected }`.
- `receivedHistory` and its tests are removed (nothing else used it). The new `monthTotals.test.ts` (10 tests) covers the Carnotstraat 900/925 and Tervuursestraat 740/810 November cases, a fully paid month, an overpaid month (counts 1200, not 2000), a month before the lease started, an end date, and `history[m].paid === monthTotals(m).paid` for every month.
- `RentHistoryChart` plots `paid`. The percentage rule is unchanged and now uses `paid`. The selected (last) month is still green.

## Task 2: logo
- `logo-full.png` (480x449) and `logo-mark.png` (480x366, emblem only), trimmed, transparent, with premultiplied downscale.
- `rentular.png` is now a 512x512 transparent emblem on a square canvas, which removes the white box from login, invite, onboarding, download and SupportChat.
- Sidebar: emblem 104 px tall, no drop-shadow. MobileNav sheet: 94x72 emblem still hangs over the line. Mobile top bar, marketing header (48 px) and footer (36 px) use the mark.
- `app/icon.png` (transparent) and `app/apple-icon.png` (white 180x180) are new. The build emits `/icon.png`, and it served HTTP 200 locally.
- Android: the vector house foreground is replaced by PNG foregrounds per density (emblem inside the 66dp safe zone on the existing navy background), plus legacy square and round icons. versionCode is unchanged, rentular.apk is untouched, and bundleRelease was not run.

## Task 3: key image
- `keys-house.webp` (78 KB) and `.png` fallback (112 KB, 256 colours) are 900x632. The backdrop was keyed out with a colour-to-alpha pass so the image blends into the green band, and the soft shadows are kept.
- The image displays at 240 px wide on md+ and is vertically centred. The band padding is `md:pl-72`, and the width/height props are 900/632.

## Extra: Android docs
- The README and Play CHECKLIST now say that `create-upload-key.sh` writes the password to the root-only `/etc/rentular/android-upload-key.pass`, and that `build-play-release.sh` reads it with sudo. Env and gradle.properties remain an override.

## Verification (observed)
- `apps/api` vitest: 51 files, 476 tests passed (after Task 1). The new file has 10 tests and all pass.
- `npx tsc --noEmit -p .`: exit 0 in apps/api and apps/web.
- `apps/web pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET): succeeded, and the icon/apple-icon routes were emitted.
- `./gradlew testDebugUnitTest assembleDebug` with the Android Studio JBR and `ANDROID_HOME=~/Library/Android/sdk`: succeeded, and app-debug.apk was rebuilt.
- I ran `next start` locally and took a headless Chrome screenshot of the homepage. The header logo has no white box, and the key image sits cleanly on the band.
- Not verified: the prod chart values (Aug 7978, Sep 9635, Oct 9620.08, Nov 9044) need a deploy and live data. The dashboard sidebar and MobileNav were not rendered, because they need a logged-in session. They were checked only by typecheck and build.

## Deviations
- **[Rule 3] History scope changed to active leases.** The old history also counted ended leases. It now uses exactly the dashboard's lease set, because that is required for paid to match. Cost if wrong: income from ended leases no longer shows in past bars, which is intended by the plan.
- **[Rule 3] The worktree needed `pnpm install`.** It had no node_modules. The install ran from the lockfile and changed no files.
- **Intentional deletion: `drawable/ic_launcher_foreground.xml`.** It was replaced by the PNG foregrounds. Cost if wrong: none, because the adaptive icon XML references the same resource name.

## Known Stubs
None. `logo-full.png` is produced but not referenced yet. It is available for light backgrounds.

## Self-Check: PASSED
All four commits exist in `git log`, and the created files are present.
