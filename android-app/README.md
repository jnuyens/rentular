# Rentular Android app

A native Android wrapper that opens the full Rentular web app (https://www.rentular.com)
in a full-screen WebView. Because it loads the real website, it has all of the
website's functionality automatically, and it stays up to date whenever the site
is updated, no app-store release needed for web changes.

## Why a wrapper

- **All functionality**: it is the website, so every feature works without being
  rebuilt natively.
- **Login once**: cookies are persisted (`CookieManager`), so you sign in one time
  and stay logged in. The session token is refreshed on use, so you do not have to
  remember a password on the phone.
- **Native touches**: pull-to-refresh, hardware back button navigates web history,
  file pickers for uploads, and downloads (PDF reports, exports) go through the
  system download manager with the session cookie attached. Links to other sites,
  `mailto:` and `tel:` open in the appropriate app.

## Build and release (the real logic)

Requirements: Android Studio (it bundles a JDK 17 JBR) and the Android SDK.

**To cut a new release of the sideloaded app, run the publish script:**

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

- **The installable build is the DEBUG build.** The `release` buildType has no
  signing config, so only the debug build is signed (v1 + v2). v2 is required for
  installing a targetSdk-34 app on Android 11+, and the debug build has it.
- **Always rebuild on the same Mac.** Android updates an app in place only when the
  new APK is signed with the same key. The debug key is this machine's
  `~/.android/debug.keystore`; building elsewhere forces an uninstall/reinstall.
- **Bump the version before building.** Increase `versionCode` (and `versionName`)
  in `app/build.gradle.kts` so the phone treats it as an update.
- The script finds the JDK (Android Studio JBR, else `java_home -v 17`) and the SDK
  (`$ANDROID_HOME` or `~/Library/Android/sdk`) automatically.

For Play Store distribution instead of sideloading, add a release keystore + signing
config and use `./gradlew :app:assembleRelease`.

## Configuration

- Start URL and allowed host: `app/src/main/java/com/rentular/app/MainActivity.kt`
  (`START_URL`, `ALLOWED_HOST`).
- App name: `app/src/main/res/values/strings.xml`.
- Icon: `app/src/main/res/drawable/ic_launcher_foreground.xml` + `res/values/colors.xml`.
- `local.properties` (git-ignored) must point `sdk.dir` at your Android SDK.
