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

## Build

Requirements: Android Studio (or the Android SDK) and JDK 17.

```bash
# from this folder
JAVA_HOME="/path/to/jdk-17" ./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android-app` folder in Android Studio and press Run.

The debug APK is unsigned/debug-signed; install it by enabling "install unknown
apps" on the phone. For Play Store distribution, create a release keystore and run
`./gradlew :app:assembleRelease` (or use Android Studio's Build > Generate Signed
Bundle / APK).

## Configuration

- Start URL and allowed host: `app/src/main/java/com/rentular/app/MainActivity.kt`
  (`START_URL`, `ALLOWED_HOST`).
- App name: `app/src/main/res/values/strings.xml`.
- Icon: `app/src/main/res/drawable/ic_launcher_foreground.xml` + `res/values/colors.xml`.
- `local.properties` (git-ignored) must point `sdk.dir` at your Android SDK.
