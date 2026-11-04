# Rentular Android app

A native Android wrapper that opens the full Rentular web app in a full-screen
WebView. It connects to rentular.com or to a self-hosted Rentular server; the
user picks one on first launch. Because it loads the real website, it has all of
the website's features and picks up web changes without a new app release.

## Why a wrapper

- **All functionality**: it is the website, so every feature works without being
  rebuilt natively.
- **Login once**: cookies are persisted (`CookieManager`), so you sign in one time
  and stay logged in.
- **Native touches**: pull-to-refresh, the back button walks the web history,
  file pickers for uploads, and downloads (PDF reports, exports) go through the
  system download manager. Links to other sites, `mailto:` and `tel:` open in the
  matching app.

## Choosing a server

On first launch the app asks: use rentular.com, or my own server. A self-hosted
server must use https. The app only saves it after the server answered on
`/api/v1/app/version`, so a typo is never stored.

The WebView stays on the chosen server. Links to anything else open in the
browser, and the session cookie is only attached to downloads from that server.

To change the server later:

- long-press the app icon and pick **Change server** (a launcher shortcut), or
- tap **Change server** on any blocking screen.

Switching to another server wipes cookies, web storage, cache and history, so you
sign in again on the new server.

## Version check

The rule is strict: latest app and latest server, no exceptions. Before the web
app loads, and again when you come back after more than an hour, the app asks
rentular.com (and the self-hosted server, if one is chosen) for
`GET /api/v1/app/version`. It answers
`{ serverVersion, requiredAppVersion, latestServerVersion }`.

The checks, in order (see `VersionGate.decide`):

1. rentular.com does not answer: "You seem to be offline", with Retry. Without
   rentular.com the app cannot know the latest versions, so it blocks.
2. This app's `versionCode` is below rentular.com's `requiredAppVersion`:
   "Update the app", with a button to the Play Store.
3. The self-hosted server does not answer: "Your server is not answering".
4. The self-hosted server has no version endpoint (an older release) or gives
   an unreadable answer: "Your server needs an update".
5. The self-hosted server runs another `serverVersion` than rentular.com, older
   or newer: "Your server needs an update", showing both versions.
6. The self-hosted server requires a newer app: "Update the app".
7. Otherwise the web app opens. An app newer than required is fine.

So self-hosted servers are blocked until they run the same `RENTULAR_VERSION` as
rentular.com.

## Releasing to Google Play

The steps in the Play Console are in `play-store/CHECKLIST.md`; listing texts are
in `play-store/metadata/`.

Version numbers live in two places and move together:

- When the native app changes, bump `versionCode` and `versionName` in
  `app/build.gradle.kts` **and** `REQUIRED_APP_VERSION` in
  `packages/shared/src/constants/appVersion.ts`, in the same commit. A vitest in
  `apps/api` fails when the two differ.
- Bump `RENTULAR_VERSION` in the same file on every server release. Web-only
  deploys do not touch `REQUIRED_APP_VERSION`.

Building:

1. Once: `./create-upload-key.sh` creates `~/.rentular/rentular-upload.keystore`
   and prints four lines (`RENTULAR_UPLOAD_STORE_FILE`,
   `RENTULAR_UPLOAD_STORE_PASSWORD`, `RENTULAR_UPLOAD_KEY_ALIAS`,
   `RENTULAR_UPLOAD_KEY_PASSWORD`) for `~/.gradle/gradle.properties`. The key and
   passwords never go into this repository. Without them a release build stops
   with a message saying what is missing.
2. `./build-play-release.sh` builds the signed bundle into
   `dist/rentular-<versionName>-<versionCode>.aab` and refuses to continue when
   `versionCode` and `REQUIRED_APP_VERSION` differ.
3. Upload the bundle in the Play Console.

Deploy order: deploy the server only after the Play release is live. A server
whose `requiredAppVersion` is above the installed app blocks every user until
they can update from Play.

First release exception: deploy the server first. The old sideloaded app does
not check versions, and the new app (and the Play reviewers) need the endpoint
on rentular.com to get past the version check.

## Sideloaded APK

`build-and-publish.sh` still builds the debug APK for the `/download` page:

```bash
# from the repo root
./android-app/build-and-publish.sh
```

It builds the debug APK, copies it to `apps/web/public/rentular.apk` (what the
`/download` page serves), and prints the signature schemes. Then commit the APK
and redeploy the web app:

```bash
# on m1
cd /var/www/rentular.com && git pull && pnpm --filter @rentular/web build && pm2 restart rentular-web
```

Key facts, so updates install cleanly:

- **The sideloaded build is the DEBUG build**, signed with this machine's
  `~/.android/debug.keystore` (v1 + v2).
- **Always rebuild on the same Mac.** Android updates an app in place only when the
  new APK is signed with the same key; building elsewhere forces an
  uninstall and reinstall.
- **Bump the version before building**, following the rule above.
- The Play build is signed with a different key, so moving from the sideloaded
  APK to Play needs one uninstall.
- The script finds the JDK (Android Studio JBR, else `java_home -v 17`) and the SDK
  (`$ANDROID_HOME` or `~/Library/Android/sdk`) automatically.

## Configuration

- The server is chosen at runtime and stored in the app's preferences. The
  canonical origin (`https://www.rentular.com`) is `CANONICAL_ORIGIN` in
  `app/src/main/java/com/rentular/app/ServerUrl.kt`.
- Build: compileSdk and targetSdk 36, minSdk 21, AGP 8.10.1, Gradle 8.11.1,
  Kotlin 2.0.21. Unit tests: `./gradlew testDebugUnitTest`.
- Texts: `app/src/main/res/values*/strings.xml` (English, Dutch, French, German).
- Icon: `app/src/main/res/drawable/ic_launcher_foreground.xml` + `res/values/colors.xml`.
- `local.properties` (git-ignored) must point `sdk.dir` at your Android SDK, or
  set `ANDROID_HOME`.
