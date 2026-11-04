---
phase: quick-261104-qfd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/shared/src/constants/appVersion.ts
  - packages/shared/src/constants/index.ts
  - apps/api/src/routes/appVersion.ts
  - apps/api/src/routes/__tests__/appVersion.test.ts
  - apps/api/src/index.ts
  - android-app/build.gradle.kts
  - android-app/gradle/wrapper/gradle-wrapper.properties
  - android-app/.gitignore
  - android-app/app/build.gradle.kts
  - android-app/app/src/main/AndroidManifest.xml
  - android-app/app/src/main/java/com/rentular/app/MainActivity.kt
  - android-app/app/src/main/java/com/rentular/app/ServerSetupActivity.kt
  - android-app/app/src/main/java/com/rentular/app/ServerUrl.kt
  - android-app/app/src/main/java/com/rentular/app/VersionGate.kt
  - android-app/app/src/main/java/com/rentular/app/VersionClient.kt
  - android-app/app/src/main/java/com/rentular/app/ServerPrefs.kt
  - android-app/app/src/test/java/com/rentular/app/VersionGateTest.kt
  - android-app/app/src/test/java/com/rentular/app/ServerUrlTest.kt
  - android-app/app/src/main/res/layout/activity_main.xml
  - android-app/app/src/main/res/layout/activity_server_setup.xml
  - android-app/app/src/main/res/xml/shortcuts.xml
  - android-app/app/src/main/res/values/strings.xml
  - android-app/app/src/main/res/values-nl/strings.xml
  - android-app/app/src/main/res/values-fr/strings.xml
  - android-app/app/src/main/res/values-de/strings.xml
  - android-app/app/src/main/res/values/themes.xml
  - android-app/build-play-release.sh
  - android-app/create-upload-key.sh
  - android-app/README.md
  - android-app/play-store/CHECKLIST.md
  - android-app/play-store/metadata/android/en-US/title.txt
  - android-app/play-store/metadata/android/en-US/short_description.txt
  - android-app/play-store/metadata/android/en-US/full_description.txt
  - android-app/play-store/metadata/android/nl-NL/title.txt
  - android-app/play-store/metadata/android/nl-NL/short_description.txt
  - android-app/play-store/metadata/android/nl-NL/full_description.txt
  - android-app/play-store/metadata/android/fr-FR/title.txt
  - android-app/play-store/metadata/android/fr-FR/short_description.txt
  - android-app/play-store/metadata/android/fr-FR/full_description.txt
  - android-app/play-store/metadata/android/de-DE/title.txt
  - android-app/play-store/metadata/android/de-DE/short_description.txt
  - android-app/play-store/metadata/android/de-DE/full_description.txt
autonomous: true
requirements: [QUICK-261104-qfd]

must_haves:
  truths:
    - "GET /api/v1/app/version answers without auth with { serverVersion, requiredAppVersion, latestServerVersion } taken from @rentular/shared"
    - "REQUIRED_APP_VERSION in packages/shared always equals versionCode in android-app/app/build.gradle.kts (a vitest fails otherwise)"
    - "On first launch the app asks: use rentular.com (default) or my own server; a custom server is only saved after its /api/v1/app/version answers"
    - "The WebView never loads until the version gate passes; an outdated app, an outdated server, or an unreachable endpoint shows a native blocking screen (offline is worded differently from a version mismatch)"
    - "The WebView stays inside the chosen server's origin; other links open in the browser; downloads carry the session cookie of the chosen origin"
    - "The server can be changed later via a launcher shortcut and a link on the blocking screens; changing it wipes cookies and web storage"
    - "compileSdk and targetSdk are 36, content is not drawn under the status bar or keyboard, and assembleDebug plus the JVM unit tests pass"
    - "bundleRelease is wired to an upload key that lives outside the repo and fails with a clear message when that key is not configured"
    - "Play listing drafts in EN/NL/FR/DE and an owner checklist exist under android-app/play-store/"
  artifacts:
    - path: "packages/shared/src/constants/appVersion.ts"
      provides: "RENTULAR_VERSION, REQUIRED_APP_VERSION"
      contains: "REQUIRED_APP_VERSION"
    - path: "apps/api/src/routes/appVersion.ts"
      provides: "appVersionRouter with GET /version"
      exports: ["appVersionRouter"]
    - path: "android-app/app/src/main/java/com/rentular/app/VersionGate.kt"
      provides: "pure decide() function for the version rules"
    - path: "android-app/app/src/main/java/com/rentular/app/ServerUrl.kt"
      provides: "pure URL normalization and same-origin check"
    - path: "android-app/build-play-release.sh"
      provides: "signed AAB build into android-app/dist/"
    - path: "android-app/create-upload-key.sh"
      provides: "interactive keytool wrapper, refuses to overwrite"
    - path: "android-app/play-store/CHECKLIST.md"
      provides: "owner Play Console steps"
  key_links:
    - from: "apps/api/src/index.ts"
      to: "appVersionRouter"
      via: "app.route(\"/app\", appVersionRouter), /app not in protectedPrefixes"
      pattern: "app\\.route\\(\"/app\""
    - from: "MainActivity.kt"
      to: "VersionGate.decide"
      via: "called after VersionClient fetches, before webView.loadUrl"
      pattern: "VersionGate\\.decide"
    - from: "shouldOverrideUrlLoading"
      to: "ServerUrl.isInApp"
      via: "dynamic origin from ServerPrefs"
      pattern: "ServerUrl\\.isInApp"
---

<objective>
Make the Rentular Android app ready for Google Play: it can connect to rentular.com or a self-hosted Rentular server, enforces the owner's strict "latest app and latest server, no exceptions" rule through a shared version constant and a public version endpoint, targets API 36 with correct insets, has a release signing setup that keeps keys out of the repo, and ships store listing drafts plus an owner checklist.

Purpose: Play distribution with self-hosting support, without ever running mismatched app and server versions.
Output: API endpoint + shared constant + vitest; reworked Android app with unit tests; release scripts; listing drafts; README and checklist.

Hard rules for the executor (from the task spec and the owner's global instructions):
- Do NOT publish, deploy, run bundleRelease, run create-upload-key.sh, or generate/commit any keystore or password.
- Do NOT rebuild or replace apps/web/public/rentular.apk.
- No em-dashes or en-dashes anywhere (code, comments, strings, docs, commit messages). Regular hyphens in compound words are fine. Human tone, no hollow superlatives.
- No Co-Authored-By lines in commits.
- Do not touch ~/src/cubicraftia (reference only).
</objective>

<execution_context>
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/workflows/execute-plan.md
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/bm/5.0.4/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@android-app/README.md
@android-app/app/build.gradle.kts
@android-app/app/src/main/java/com/rentular/app/MainActivity.kt
@android-app/app/src/main/AndroidManifest.xml
@android-app/build-and-publish.sh
@apps/api/src/index.ts

Reference only (owner's existing Play Console notes, do not modify): ~/src/cubicraftia/docs/store-readiness/code-signing-runbook.md (section 3) and ~/src/cubicraftia/docs/store-readiness/play-store-metadata.md.

<interfaces>
Facts extracted from the codebase (use directly, no exploration needed):

apps/api/src/index.ts
- const app = new Hono().basePath("/api/v1");  (so a router mounted at "/app" serves /api/v1/app/version)
- const protectedPrefixes = [...] at ~l.57: requireAuth is applied per prefix. Do NOT add "/app".
- Global middleware order: Cache-Control default "no-store" only if header absent, cors, csrf (GET is not state-changing, unaffected), authMiddleware (sets userId null without a cookie, no 401), bearerRateLimit, bearerAuditLog.
- app.get("/health", ...) at ~l.135 returns { status, checks, version: "0.1.0" }. Replace the literal with RENTULAR_VERSION.
- Routers mounted at ~l.169..193 as app.route("/xxx", xxxRouter); named export routers from ./routes/*.ts.
- File ends: serve({ fetch: app.fetch, port }); export default app;  (importing index.ts starts the server and workers, so tests must import the router file, not index.ts)

apps/api tests: vitest, include "src/**/__tests__/**/*.test.ts", run with `pnpm --filter @rentular/api test` (script "vitest run"). Router test pattern (routes/__tests__/apiTokens.test.ts): build a fresh `new Hono()`, mount the router, call `app.request(path)`.

packages/shared: main/types point at ./src/index.ts (consumed from source, no build step). src/index.ts re-exports ./constants/index. Add `export * from "./appVersion";` to src/constants/index.ts.

android-app current state
- Root build.gradle.kts: AGP com.android.application 8.2.2, org.jetbrains.kotlin.android 1.9.22. Wrapper gradle-8.6-bin.
- app/build.gradle.kts: namespace/applicationId com.rentular.app, compileSdk 34, minSdk 21, targetSdk 34, versionCode 2, versionName "1.1", release buildType with no signingConfig, isMinifyEnabled false, Java/JVM 17. Deps: core-ktx 1.13.1, appcompat 1.7.0, swiperefreshlayout 1.1.0, webkit 1.11.0. No test deps yet.
- MainActivity.kt: START_URL "https://www.rentular.com", ALLOWED_HOST "rentular.com" (host or subdomain stays in app), mailto/tel/sms/intent go to ACTION_VIEW, file chooser via ActivityResult, DownloadListener adds CookieManager cookie, swipe refresh, back navigates history, onResume reloads after STALE_AFTER_MS (2h), saveState/restoreState.
- layout/activity_main.xml: SwipeRefreshLayout#swipe > WebView#webview.
- values/themes.xml: Theme.Rentular parent Theme.AppCompat.Light.NoActionBar, statusBarColor @color/rentular_primary.
- Installed SDK platforms: android-34, android-36. Build tools: 34.0.0, 36.1.0. JDK: Android Studio JBR at "/Applications/Android Studio.app/Contents/jbr/Contents/Home". Only AGP 8.2.2 is cached locally; the upgrade will download from Google Maven (network is expected to work).
- .gitignore already ignores /local.properties, /build, app/build/.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shared version constants, public GET /api/v1/app/version, vitest</name>
  <files>packages/shared/src/constants/appVersion.ts, packages/shared/src/constants/index.ts, apps/api/src/routes/appVersion.ts, apps/api/src/routes/__tests__/appVersion.test.ts, apps/api/src/index.ts</files>
  <behavior>
    - GET /version on a Hono app with appVersionRouter mounted at /app returns 200 JSON exactly { serverVersion: RENTULAR_VERSION, requiredAppVersion: REQUIRED_APP_VERSION, latestServerVersion: RENTULAR_VERSION }.
    - Response works with no cookie and no Authorization header (router has no auth middleware of its own).
    - Response sets Cache-Control "public, max-age=60".
    - typeof requiredAppVersion is "number" and Number.isInteger; serverVersion matches /^\d+\.\d+\.\d+$/.
    - Parity test: reads android-app/app/build.gradle.kts (path resolved from the test file via node:path and node:url fileURLToPath, up to the repo root), extracts versionCode with /versionCode\s*=\s*(\d+)/, and asserts it equals REQUIRED_APP_VERSION. This enforces the "bump both in the same commit" rule.
    - Static check in the same test file: index.ts source contains `app.route("/app", appVersionRouter)` and the protectedPrefixes array literal does not contain "/app" (read index.ts as text; do not import it, importing starts the server).
  </behavior>
  <action>
Create packages/shared/src/constants/appVersion.ts exporting two documented constants: `RENTULAR_VERSION = "1.0.0"` (server release, semver string, bump on every server release) and `REQUIRED_APP_VERSION = 3` (the Android versionCode the server requires; bump ONLY when the native app changes, in the same commit as versionCode in android-app/app/build.gradle.kts; web-only deploys leave it alone). Write the JSDoc in plain language, include the deploy order (Play release live first, then the server deploy, because a requiredAppVersion above the installed app blocks users). Export a `AppVersionInfo` interface { serverVersion: string; requiredAppVersion: number; latestServerVersion: string }. Re-export from packages/shared/src/constants/index.ts.

Write the test first (RED), then create apps/api/src/routes/appVersion.ts: `export const appVersionRouter = new Hono()` with `.get("/version", (c) => { c.header("Cache-Control", "public, max-age=60"); return c.json<AppVersionInfo>({...}) })`. latestServerVersion is RENTULAR_VERSION on every server (rentular.com is the canonical latest; on a self-hosted server it is informational only, the app always compares against rentular.com). No DB, no Redis, no logging per request.

In apps/api/src/index.ts: import appVersionRouter, mount `app.route("/app", appVersionRouter);` next to the /health route with a comment that it is public on purpose (the Android app calls it before login, including on self-hosted servers). Do not add "/app" to protectedPrefixes. Import RENTULAR_VERSION from "@rentular/shared" and use it instead of the "0.1.0" literal in the /health response.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && pnpm --filter @rentular/api test && (cd apps/api && npx tsc --noEmit -p .) && (cd apps/web && npx tsc --noEmit -p .)</automated>
  </verify>
  <done>appVersion.test.ts passes (including versionCode parity, which will be green once Task 2 sets versionCode = 3; if Task 1 runs first, the parity case is the one RED that Task 2 turns GREEN), the whole api suite is green, api and web tsc are clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Android app: SDK 36 + insets, server choice, origin handling, version gate, release signing, JVM unit tests</name>
  <files>android-app/build.gradle.kts, android-app/gradle/wrapper/gradle-wrapper.properties, android-app/.gitignore, android-app/app/build.gradle.kts, android-app/app/src/main/AndroidManifest.xml, android-app/app/src/main/java/com/rentular/app/{MainActivity,ServerSetupActivity,ServerUrl,VersionGate,VersionClient,ServerPrefs}.kt, android-app/app/src/test/java/com/rentular/app/{VersionGateTest,ServerUrlTest}.kt, android-app/app/src/main/res/layout/{activity_main,activity_server_setup}.xml, android-app/app/src/main/res/xml/shortcuts.xml, android-app/app/src/main/res/values{,-nl,-fr,-de}/strings.xml, android-app/app/src/main/res/values/themes.xml</files>
  <behavior>
    ServerUrl (pure Kotlin, java.net.URI only, no android.* so it runs on the plain JVM):
    - normalize("example.be") == Ok("https://example.be"); normalize(" https://Rent.Example.be/ ") == Ok("https://rent.example.be"); normalize("https://x.be:8443/some/path?q=1#f") == Ok("https://x.be:8443") (path, query, fragment dropped; non-default port kept; :443 dropped).
    - normalize("http://x.be") == Err(HTTPS_REQUIRED); normalize("") / "   " / "https://" / "ftp://x" / "https://user@x.be" / "not a host" == Err(INVALID).
    - isCanonical("https://www.rentular.com") and isCanonical("https://rentular.com") are true; typing rentular.com as custom server is stored as canonical.
    - isInApp(origin, url): https with same host and same effective port is true; for the canonical origin, rentular.com and any *.rentular.com host is also true (existing behaviour); http scheme, other hosts, and lookalikes like "evilrentular.com" or "rentular.com.evil.be" are false.
    - versionUrl(origin) == origin + "/api/v1/app/version".
    VersionGate.decide(appVersionCode: Int, canonical: FetchResult, server: FetchResult?) : GateResult, where FetchResult is Ok(AppVersionInfo) | NotFound (HTTP 404) | Unreachable (IO error, timeout, 5xx, other non-2xx) | Malformed (2xx but unparsable or missing fields), server == null means the chosen server is rentular.com. Rules, evaluated in this order:
    1. canonical is not Ok (any of NotFound/Unreachable/Malformed) -> Offline(target = CANONICAL). We cannot know the latest version, so no exceptions: block with Retry.
    2. appVersionCode < canonical.requiredAppVersion -> UpdateApp.
    3. server != null and server is Unreachable -> Offline(target = SERVER).
    4. server != null and server is NotFound or Malformed -> ServerOutdated(serverVersion = null, latest = canonical.serverVersion). Old servers without the endpoint count as outdated.
    5. server != null and server.serverVersion != canonical.serverVersion (exact string compare, so a server ahead of rentular.com is also blocked) -> ServerOutdated(server.serverVersion, canonical.serverVersion).
    6. server != null and appVersionCode < server.requiredAppVersion -> UpdateApp (defensive; normally impossible once rule 5 passed).
    7. otherwise Allowed. An app NEWER than the required code is allowed (this is what lets the Play release go live before the server deploy).
    Tests: one case per rule, plus: app newer than required with matching server is Allowed; rentular.com user (server null) with app == required is Allowed; app outdated AND server outdated reports UpdateApp (rule 2 wins, the user can fix that one themselves); canonical Unreachable wins over everything.
  </behavior>
  <action>
Build and SDK (Play requires a recent target; android-36 is installed, android-35 is not, so use 36):
- Root build.gradle.kts: AGP 8.10.1, Kotlin android plugin 2.0.21. Wrapper: gradle-8.11.1-bin.zip (regenerate via `./gradlew wrapper --gradle-version 8.11.1` or edit distributionUrl). If 8.10.1 cannot resolve, use the newest AGP 8.x that supports compileSdk 36 and its matching Gradle, and record the choice in the SUMMARY.
- app/build.gradle.kts: compileSdk 36, targetSdk 36, minSdk 21, buildToolsVersion "36.1.0" (installed, avoids a download), versionCode 3, versionName "2.0". Bump androidx deps only if AGP/compileSdk 36 requires it (core-ktx 1.13.1 is fine; add androidx.activity:activity-ktx only if needed for enableEdgeToEdge). Add testImplementation("junit:junit:4.13.2"). Keep isMinifyEnabled false (WebView wrapper, nothing worth shrinking).
- Release signing: read RENTULAR_UPLOAD_STORE_FILE, RENTULAR_UPLOAD_STORE_PASSWORD, RENTULAR_UPLOAD_KEY_ALIAS, RENTULAR_UPLOAD_KEY_PASSWORD via `providers.gradleProperty(name).orElse(providers.environmentVariable(name)).orNull` (so ~/.gradle/gradle.properties or env both work; never a file in the repo). If all four are present and the store file exists, create signingConfigs.release and assign it to buildTypes.release. Otherwise leave release unsigned and register a doFirst on the task named "preReleaseBuild" (tasks.matching by name, configureEach) that throws GradleException with a readable message listing the four property names, pointing to ./create-upload-key.sh and README. This must not affect assembleDebug or testDebugUnitTest. Never print passwords.
- android-app/.gitignore: add dist/, *.keystore, *.jks.

Pure logic files (no android imports; JVM unit tests cover them):
- ServerUrl.kt: object ServerUrl with CANONICAL_ORIGIN = "https://www.rentular.com", normalize(input): NormalizeResult (sealed Ok(origin) / Err(reason enum HTTPS_REQUIRED, INVALID)), isCanonical, isInApp(origin, url: String), versionUrl. Prepend "https://" when no scheme is present, lowercase host, reject userinfo and hosts without a dot unless they are an IP literal (keep it simple: require a dot or an IPv4 literal).
- VersionGate.kt: data class AppVersionInfo(serverVersion, requiredAppVersion, latestServerVersion), sealed FetchResult, sealed GateResult (Allowed, UpdateApp, ServerOutdated(serverVersion: String?, latest: String), Offline(target)), object VersionGate.decide implementing the rules above exactly. Put the numbered rules in a KDoc on decide.
- Write VersionGateTest and ServerUrlTest first (RED), then implement (GREEN).

Android glue:
- VersionClient.kt: fetch(url): FetchResult using HttpURLConnection (connect/read timeout 8s, GET, Accept application/json, useCaches false, no cookies), parse with org.json.JSONObject (Malformed on any parse error or missing/mistyped field; requiredAppVersion must be an Int). Run on a background Executor; deliver on the main thread. When the chosen server is canonical, fetch only once.
- ServerPrefs.kt: SharedPreferences "rentular" with key "server_origin" (null = not chosen yet), get/set/clear.
- ServerSetupActivity.kt + activity_server_setup.xml: title and short explanation, primary button "Use rentular.com", secondary "Use my own server" revealing an EditText (inputType textUri, hint e.g. "rent.example.be") and a "Connect" button with a ProgressBar. On Connect: ServerUrl.normalize (show inline error for HTTPS_REQUIRED / INVALID), then VersionClient.fetch(versionUrl): Ok -> save and continue; NotFound/Malformed -> inline error "This does not look like a Rentular server, or it runs an older version"; Unreachable -> inline error "Could not reach this server". Saving a new origin different from the stored one calls a shared clearWebData() helper (CookieManager.removeAllCookies + flush, WebStorage.getInstance().deleteAllData(), WebViewDatabase clear form data where available, and set a prefs flag so MainActivity calls webView.clearCache(true) and clearHistory() on next load). Then start MainActivity with FLAG_ACTIVITY_CLEAR_TOP | FLAG_ACTIVITY_NEW_TASK and finish. Show the current server at the top when one is set. Apply insets (see below).
- MainActivity.kt: on onCreate, if ServerPrefs has no origin, start ServerSetupActivity and finish. Layout activity_main.xml becomes a FrameLayout root containing the existing SwipeRefreshLayout/WebView (initially GONE) and a gate panel (centered icon, title TextView, message TextView, primary Button, secondary text Button "Change server", ProgressBar). Run the gate before any loadUrl: show progress, fetch canonical (and the server if not canonical), call VersionGate.decide with BuildConfig.VERSION_CODE (enable buildFeatures.buildConfig = true), then render: Allowed -> hide panel, show WebView, load origin (or restoreState); UpdateApp -> "Update the app" with Play button (Intent ACTION_VIEW market://details?id=com.rentular.app, catch ActivityNotFoundException and fall back to https://play.google.com/store/apps/details?id=com.rentular.app); ServerOutdated -> message with the two versions filled in (server version null -> the "older version" wording) and the administrator hint, buttons Retry + Change server; Offline -> friendly "You seem to be offline" (SERVER target: "Your server is not answering") with Retry + Change server. Re-run the gate on onResume when the last successful check is more than 1 hour old (GATE_RECHECK_MS = 60 min); keep the existing 2h stale reload but only when the gate is Allowed. Replace START_URL/ALLOWED_HOST with the stored origin; shouldOverrideUrlLoading uses ServerUrl.isInApp(origin, url) (keep mailto/tel/sms/intent handling and the external-browser fallback). DownloadListener only attaches the cookie header when ServerUrl.isInApp(origin, url). Handle intent action "com.rentular.app.CHANGE_SERVER" in onCreate and onNewIntent (launchMode singleTop) by opening ServerSetupActivity.
- Change-server entry points (chosen because a WebView app has no native toolbar to host a menu, and the web UI should not need changes): (a) a static launcher shortcut in res/xml/shortcuts.xml ("Change server", long-press the app icon, standard Android and discoverable), intent targetPackage com.rentular.app, targetClass com.rentular.app.ServerSetupActivity, declared via meta-data android.app.shortcuts on MainActivity; (b) the "Change server" button on every blocking screen. Mention both in README.
- Manifest: register ServerSetupActivity (exported false), shortcuts meta-data on the launcher activity, keep INTERNET permission, usesCleartextTraffic false (https only fits the normalization rule).
- Edge-to-edge (enforced from targetSdk 35): in both activities call WindowCompat.setDecorFitsSystemWindows(window, false) (or enableEdgeToEdge) and ViewCompat.setOnApplyWindowInsetsListener on the root, padding by the union of systemBars, displayCutout and ime insets, so the WebView is not under the status bar or navigation bar and the keyboard does not cover inputs. Set the root background to @color/rentular_primary so the status bar area keeps the brand color; WebView and gate panel get a white background. Drop the deprecated statusBarColor item from themes.xml only if it causes a build warning-as-error; otherwise leave it.
- Strings: every user-facing text in values/strings.xml (English) with nl, fr, de translations in values-nl/, values-fr/, values-de/. Plain human wording, no dashes, escape apostrophes as \' (French needs it). Use %1$s placeholders for versions. Keep app_name "Rentular" untranslated. Also add the shortcut labels (shortLabel/longLabel).

Run the JVM tests and assembleDebug with JAVA_HOME set to the Android Studio JBR, as build-and-publish.sh does. Do not run bundleRelease or assembleRelease. Do not copy the APK anywhere.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/android-app && export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" && ./gradlew --no-daemon testDebugUnitTest assembleDebug && grep -q "targetSdk = 36" app/build.gradle.kts && grep -q "versionCode = 3" app/build.gradle.kts && for l in nl fr de; do test -f app/src/main/res/values-$l/strings.xml || exit 1; done && ! grep -rnP "[\x{2013}\x{2014}]" app/src/main && cd .. && pnpm --filter @rentular/api test</automated>
  </verify>
  <done>JVM unit tests for VersionGate (every rule) and ServerUrl pass, assembleDebug succeeds on SDK 36, translations exist for nl/fr/de with the same keys as values/, no en/em-dashes in app sources, the api parity test is green, apps/web/public/rentular.apk is unchanged (git status shows it unmodified).</done>
</task>

<task type="auto">
  <name>Task 3: Release scripts, Play listing drafts, owner checklist, README bump procedure</name>
  <files>android-app/build-play-release.sh, android-app/create-upload-key.sh, android-app/README.md, android-app/play-store/CHECKLIST.md, android-app/play-store/metadata/android/{en-US,nl-NL,fr-FR,de-DE}/{title,short_description,full_description}.txt</files>
  <action>
build-play-release.sh (chmod +x, set -euo pipefail): reuse the JAVA_HOME and ANDROID_HOME discovery block from build-and-publish.sh verbatim, check that the four RENTULAR_UPLOAD_* values are available (grep ~/.gradle/gradle.properties for the names or check env; never print the values) and exit with a helpful message pointing to ./create-upload-key.sh if not, run `./gradlew --no-daemon clean bundleRelease`, copy app/build/outputs/bundle/release/app-release.aab to android-app/dist/rentular-<versionName>-<versionCode>.aab (mkdir -p dist), read versionCode/versionName from app/build.gradle.kts with grep/sed and REQUIRED_APP_VERSION from packages/shared/src/constants/appVersion.ts, print all three, and warn loudly (non-zero exit) if versionCode != REQUIRED_APP_VERSION. End by printing the bump rule and the deploy order. Do not run it.

create-upload-key.sh (chmod +x, set -euo pipefail): target ~/.rentular/rentular-upload.keystore, alias "rentular-upload"; refuse with exit 1 if the file exists; mkdir -p ~/.rentular with chmod 700; find keytool in $JAVA_HOME or the Android Studio JBR; run `keytool -genkeypair -v -keystore ... -alias rentular-upload -keyalg RSA -keysize 4096 -validity 10000` interactively (keytool prompts for passwords and the DN itself, so the script never reads or echoes a password); chmod 600 the keystore; then print the four lines to add to ~/.gradle/gradle.properties with the password values shown as placeholders (RENTULAR_UPLOAD_STORE_FILE=<absolute path>, RENTULAR_UPLOAD_KEY_ALIAS=rentular-upload, RENTULAR_UPLOAD_STORE_PASSWORD=<the password you just typed>, RENTULAR_UPLOAD_KEY_PASSWORD=<same>), and remind to back up the keystore off the machine (with Play App Signing a lost upload key can be reset through Play support, but it costs time). Do not run it.

Play listing drafts, fastlane supply layout under android-app/play-store/metadata/android/{en-US,nl-NL,fr-FR,de-DE}/: title.txt (max 30 chars, e.g. "Rentular: rent management" or simply "Rentular" plus a short tag that fits), short_description.txt (max 80 chars), full_description.txt (max 4000 chars). Copy reads like the website's pitch, written by a person: automatic Belgian rent indexation that pays for the subscription by itself, rent follow-up with reminders, SEPA direct debit, payment overview, residential and commercial leases under Belgian rental law, four languages, a free plan up to 3 properties, open source mentioned lightly in one sentence, and that the app also connects to a self-hosted Rentular server. Note in the full description that an account is created on the website or in the app. No dashes (use plain line breaks or "*" bullets), no hollow superlatives, no rule-of-three triads, no "seamless/robust/leverage/powerful". Each language written natively, not a word-for-word translation.

play-store/CHECKLIST.md: ordered owner steps in the Play Console, each a checkbox: deploy the server with /api/v1/app/version to rentular.com BEFORE any upload (the app blocks without it, and reviewers will open it); run ./create-upload-key.sh once and add the gradle.properties lines; ./build-play-release.sh; create the app (default language nl-BE or en-US, app, free); enrol in Play App Signing (Google holds the app signing key, the local key is the upload key); upload the AAB to Internal testing first; store listing from play-store/metadata plus screenshots and a 512 px icon and 1024x500 feature graphic (owner to capture); privacy policy URL https://www.rentular.com/privacy; Data safety answers (the app itself collects nothing beyond what the user enters into the Rentular service; data is sent over HTTPS; account data, name, email, financial info about rent are processed by the service the user chooses; cookies are used to keep the user signed in; no ads, no third-party analytics in the wrapper; users can request deletion via the service; for self-hosted servers the server operator is responsible); content rating questionnaire (utility/productivity, no user generated public content); target audience 18+ and not designed for children; App access: reviewers need a login, the owner must create a dedicated reviewer account on rentular.com with demo data and put the credentials in App access; ads declaration: no ads; if the developer account is a personal account created after November 2023, a closed test with at least 12 testers opted in for 14 continuous days is required before applying for production; note that existing sideload users must uninstall the debug APK once before installing from Play (different signing key, same package name); production rollout. Mention the ~/src/cubicraftia store-readiness notes as the owner's earlier reference.

README.md: rewrite the intro to say the app connects to rentular.com or a self-hosted Rentular server, chosen on first launch; describe the version gate rules in plain language (mirror VersionGate.decide); how to change server (long-press icon shortcut, or the button on a blocking screen; changing clears login data); a "Releasing to Google Play" section with the bump procedure: when the native app changes, bump versionCode and versionName in app/build.gradle.kts AND REQUIRED_APP_VERSION in packages/shared/src/constants/appVersion.ts in the same commit (a vitest enforces equality); bump RENTULAR_VERSION on every server release; build with ./build-play-release.sh; deploy the server only after the Play release is live, because a requiredAppVersion above the installed app blocks users; first-release exception: deploy the server first, since the old sideloaded app does not check versions. Also: self-hosted servers are blocked until they run the same RENTULAR_VERSION as rentular.com. Keep the existing sideload section (build-and-publish.sh still builds the debug APK) and update the Configuration section (origin is now chosen at runtime; canonical origin in ServerUrl.kt). Remove the old "add a release keystore" sentence.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source/android-app && bash -n build-play-release.sh && bash -n create-upload-key.sh && test -x build-play-release.sh && test -x create-upload-key.sh && for l in en-US nl-NL fr-FR de-DE; do d=play-store/metadata/android/$l; t=$(tr -d '\n' < $d/title.txt | wc -m); s=$(tr -d '\n' < $d/short_description.txt | wc -m); f=$(wc -m < $d/full_description.txt); [ $t -le 30 ] && [ $s -le 80 ] && [ $f -le 4000 ] && [ $f -gt 300 ] || { echo "length fail $l $t $s $f"; exit 1; }; done && test -f play-store/CHECKLIST.md && grep -q "REQUIRED_APP_VERSION" README.md && grep -q "rentular.com/privacy" play-store/CHECKLIST.md && ! grep -rnP "[\x{2013}\x{2014}]" README.md play-store build-play-release.sh create-upload-key.sh && git -C .. status --porcelain apps/web/public/rentular.apk | grep -c . | grep -qx 0 && ! git -C .. ls-files --others --exclude-standard | grep -E "\.(keystore|jks)$"</automated>
  </verify>
  <done>Both scripts pass bash -n and are executable (neither was run), all listing files exist within Play limits in four languages, CHECKLIST.md covers every console step listed above, README documents the gate and the bump procedure, no dashes, no keystore in the repo, sideload APK untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| internet -> GET /api/v1/app/version | unauthenticated public endpoint |
| user input -> ServerSetupActivity | arbitrary server URL typed by the user |
| WebView content -> navigation / downloads | pages may link anywhere or trigger downloads |
| repo -> signing secrets | upload key and passwords must never enter git |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qfd-01 | Information disclosure | /app/version | accept | Returns only public version numbers, no DB access, no user data |
| T-qfd-02 | Denial of service | /app/version | mitigate | Constant response, no DB/Redis, Cache-Control public max-age=60 so caches absorb load |
| T-qfd-03 | Spoofing / Tampering | custom server URL | mitigate | https only (normalize rejects http, cleartext disabled in manifest), server validated via its version endpoint before saving, userinfo rejected |
| T-qfd-04 | Information disclosure | navigation and DownloadListener | mitigate | ServerUrl.isInApp exact host + port match (lookalike hosts tested), external links go to the browser, cookie header attached only for in-origin downloads |
| T-qfd-05 | Information disclosure | server switch | mitigate | clearWebData wipes cookies, web storage, cache and history when the origin changes |
| T-qfd-06 | Tampering | version gate bypass via outdated server | mitigate | Gate always compares against rentular.com; 404/malformed/unreachable all block (fail closed) |
| T-qfd-07 | Information disclosure | upload keystore and passwords | mitigate | Values read only from ~/.gradle/gradle.properties or env, keystore in ~/.rentular with 600 perms, *.keystore/*.jks/dist gitignored, scripts never echo passwords, verify step asserts no keystore is untracked in the repo |
| T-qfd-SC | Tampering | Gradle plugin/dependency downloads | accept | Only official Google Maven / Maven Central artifacts (AGP, Kotlin plugin, junit 4.13.2); no npm/pip/cargo installs in this plan |
</threat_model>

<verification>
- pnpm --filter @rentular/api test green; apps/api and apps/web `npx tsc --noEmit -p .` clean.
- cd android-app && JAVA_HOME=<Android Studio JBR> ./gradlew testDebugUnitTest assembleDebug succeeds.
- bundleRelease, assembleRelease, create-upload-key.sh were NOT run; apps/web/public/rentular.apk is unchanged; nothing deployed or published.
- grep for U+2013/U+2014 finds nothing in changed files; commit messages contain no Co-Authored-By lines.
</verification>

<success_criteria>
- Public GET /api/v1/app/version serves the shared constants and is covered by a vitest, including versionCode parity.
- The app supports rentular.com and self-hosted servers, gates on version as specified, keeps navigation within the chosen origin, and can switch servers with a data wipe.
- The app targets API 36 with correct insets and builds a debug APK; release signing reads keys from outside the repo and fails clearly when absent.
- Play listing drafts (4 languages) and an owner checklist are ready for the Play Console.
</success_criteria>

<output>
Create `.planning/quick/261104-qfd-android-app-for-google-play-with-self-ho/261104-qfd-SUMMARY.md` when done (include the AGP/Gradle/Kotlin versions actually used).
</output>
