---
phase: quick-261104-qfd
plan: 01
status: complete
subsystem: android-app, api
tags: [android, google-play, self-hosting, versioning, release-signing]
requires: []
provides:
  - GET /api/v1/app/version (public)
  - RENTULAR_VERSION, REQUIRED_APP_VERSION, AppVersionInfo in @rentular/shared
  - Android server choice, version gate, SDK 36 build, upload-key signing
  - Play listing drafts (4 languages) and owner checklist
affects: [apps/api/src/index.ts (/health version field)]
tech-stack:
  added: [AGP 8.10.1, Gradle 8.11.1, Kotlin Android plugin 2.0.21, junit 4.13.2 (test only)]
  patterns: [pure Kotlin logic objects tested on the JVM, gradle property or env based signing]
key-files:
  created:
    - packages/shared/src/constants/appVersion.ts
    - apps/api/src/routes/appVersion.ts
    - apps/api/src/routes/__tests__/appVersion.test.ts
    - android-app/app/src/main/java/com/rentular/app/ServerUrl.kt
    - android-app/app/src/main/java/com/rentular/app/VersionGate.kt
    - android-app/app/src/main/java/com/rentular/app/VersionClient.kt
    - android-app/app/src/main/java/com/rentular/app/ServerPrefs.kt
    - android-app/app/src/main/java/com/rentular/app/ServerSetupActivity.kt
    - android-app/app/src/main/java/com/rentular/app/EdgeToEdge.kt
    - android-app/app/src/test/java/com/rentular/app/ServerUrlTest.kt
    - android-app/app/src/test/java/com/rentular/app/VersionGateTest.kt
    - android-app/app/src/main/res/layout/activity_server_setup.xml
    - android-app/app/src/main/res/xml/shortcuts.xml
    - android-app/app/src/main/res/values-{nl,fr,de}/strings.xml
    - android-app/build-play-release.sh
    - android-app/create-upload-key.sh
    - android-app/play-store/CHECKLIST.md
    - android-app/play-store/metadata/android/{en-US,nl-NL,fr-FR,de-DE}/{title,short_description,full_description}.txt
  modified:
    - packages/shared/src/constants/index.ts
    - apps/api/src/index.ts
    - android-app/build.gradle.kts
    - android-app/app/build.gradle.kts
    - android-app/gradle/wrapper/gradle-wrapper.properties
    - android-app/.gitignore
    - android-app/app/src/main/AndroidManifest.xml
    - android-app/app/src/main/java/com/rentular/app/MainActivity.kt
    - android-app/app/src/main/res/layout/activity_main.xml
    - android-app/app/src/main/res/values/strings.xml
    - android-app/app/src/main/res/values/colors.xml
    - android-app/README.md
decisions:
  - "AGP 8.10.1 + Gradle 8.11.1 + Kotlin 2.0.21 resolved first try; compileSdk/targetSdk 36 with build tools 36.1.0"
  - "First choice of rentular.com keeps the existing login (pre-existing app always used rentular.com); any other origin change wipes web data"
  - "themes.xml left untouched (statusBarColor causes no build error); new native-screen colors added to colors.xml under semantic names for the upcoming redesign"
metrics:
  duration: ~15 min
  completed: 2026-11-04
  tasks: 3
---

# Quick 261104-qfd: Android app for Google Play with self-hosting Summary

The Android app now lets users pick rentular.com or a self-hosted https Rentular server, refuses to load until a strict version gate against rentular.com's new public `GET /api/v1/app/version` passes, targets API 36 edge to edge, and has an upload-key release path plus Play listing drafts and an owner checklist.

## Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | f692d11 | Shared version constants, public `/api/v1/app/version`, vitest incl. versionCode parity and public-route static check |
| 2 | 17f05b5 | Android: server setup, VersionGate, origin handling, change-server shortcut, SDK 36 + insets, release signing guard, JVM tests, EN/NL/FR/DE strings |
| 3 | 39e2a7f | `build-play-release.sh`, `create-upload-key.sh`, listing drafts, `CHECKLIST.md`, README rewrite |

## Verification (observed)

- `pnpm vitest run` in apps/api: 48 files, 439 tests passed (after Task 2; after Task 1 only the parity case failed, as the plan expected).
- `npx tsc --noEmit -p .` clean in apps/api and apps/web.
- `./gradlew --no-daemon testDebugUnitTest assembleDebug` with the Android Studio JBR: BUILD SUCCESSFUL, 26 JVM tests (VersionGateTest 12, ServerUrlTest 14), 0 failures, no Kotlin warnings.
- `:app:preReleaseBuild` (no bundle produced) fails with the readable message listing the four `RENTULAR_UPLOAD_*` names. `bundleRelease`/`assembleRelease` were not run.
- Translation key sets for nl/fr/de equal the English set; no U+2013/U+2014 in any created or modified file (perl scan, detector sanity-checked).
- Listing lengths: titles 20 to 26 chars, short descriptions 62 to 70, full descriptions 1322 to 1458.
- Both scripts pass `bash -n` and are executable; neither was run. No keystore in the repo, `apps/web/public/rentular.apk` unchanged, commits carry no Co-Authored-By lines.
- Not verified: behaviour on a real device or emulator (server setup flow, gate screens, shortcut, insets on API 35+). Needs a manual test on a phone, and the endpoint must be deployed on rentular.com before the app gets past the gate.

## Deviations from Plan

**1. [Rule 3 - Blocking] Installed workspace dependencies in the worktree**
- Found during: Task 1. The worktree had no node_modules, so vitest/tsc could not run.
- Fix: `pnpm install --frozen-lockfile --offline` (lockfile only, no new packages, no tracked file changes).
- Cost if wrong: none, node_modules is gitignored.

**2. [Rule 2 - Missing] Extra helper file EdgeToEdge.kt**
- Shared inset handling for both activities lives in `EdgeToEdge.kt` (not in the plan's file list). `ServerUrl.toStoredOrigin()` was added to cover the "typing rentular.com is stored as canonical" behaviour.
- Cost if wrong: trivial to inline.

**3. [Rule 1 - Bug] First server choice does not wipe an existing rentular.com login**
- `ServerPrefs.switchTo` treats "no stored origin" as rentular.com, so users of the old build keep their session when they pick rentular.com; any other change wipes cookies, storage, cache and history.
- Cost if wrong: one extra login for upgraded users if reverted.

**4. Removed the deprecated `databaseEnabled = true` WebView setting** (no-op on current WebView, produced the only compile warning). User agent now ends with `RentularApp/<versionName>`; the web login page only matches `/RentularApp/i`, so that still works.

**5. Server change while MainActivity is alive** is handled in `onNewIntent` and `onResume` (origin compared to prefs; old page replaced by about:blank, history cleared after the first page of the new server). The plan described the wipe but not this re-entry path.

## TDD Gate Compliance

Task 1: test written first and observed RED (module missing), then GREEN. Task 2: test files were written first, but the first Gradle run took over 3 minutes to download AGP/Gradle and by the time compilation started the implementation files existed, so no RED run was observed for the Kotlin tests. Commits are one per task (orchestrator constraint), so there are no separate `test(...)` commits.

## Known Stubs

None. Screenshots, the 512 px icon and the feature graphic are owner tasks listed in CHECKLIST.md.

## Threat Flags

None beyond the plan's threat model. T-qfd-02..07 mitigations are in place (constant cacheable response, https-only normalization with userinfo rejected and verification before save, exact host+port `isInApp` with lookalike tests, cookie only on in-origin downloads, data wipe on origin change, fail-closed gate, signing values only from ~/.gradle/gradle.properties or env, keystore/jks/dist gitignored).

## Self-Check: PASSED

- Files listed under key-files exist (verified via git status and the builds above).
- Commits f692d11, 17f05b5, 39e2a7f present on worktree-agent-a3ff41420823a926c.
