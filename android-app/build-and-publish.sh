#!/usr/bin/env bash
#
# Build the Rentular Android app and publish the APK to the website so it can be
# downloaded at https://www.rentular.com/download (served from apps/web/public).
#
# The installable build is the DEBUG build: the `release` buildType has no signing
# config, so only the debug build is signed (v1 + v2, with this machine's debug
# keystore). Because Android updates an app in place only when the new APK is
# signed with the SAME key, ALWAYS rebuild on the same Mac that produced the
# installed APK, or the user has to uninstall first.
#
# Before building, bump versionCode (and versionName) in app/build.gradle.kts so
# the phone treats it as an update.
#
# Usage:  ./android-app/build-and-publish.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_APK="$REPO_ROOT/apps/web/public/rentular.apk"

# --- JDK (Android Studio bundles a compatible JBR 17) ---
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME:-}/bin/java" ]; then
  if [ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  else
    echo "ERROR: No JDK 17 found. Install Android Studio or a JDK 17." >&2
    exit 1
  fi
fi
echo "JAVA_HOME=$JAVA_HOME"

# --- Android SDK ---
if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "/usr/local/share/android-sdk"; do
    [ -d "$d" ] && export ANDROID_HOME="$d" && break
  done
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "ERROR: Android SDK not found. Set ANDROID_HOME." >&2
  exit 1
fi
echo "ANDROID_HOME=$ANDROID_HOME"
# gradle reads the SDK path from here if local.properties is absent
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd "$SCRIPT_DIR"
echo "==> Building debug APK (signed, installable)..."
./gradlew --no-daemon clean assembleDebug

BUILT_APK="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$BUILT_APK" ]; then
  echo "ERROR: build did not produce $BUILT_APK" >&2
  exit 1
fi

cp "$BUILT_APK" "$OUT_APK"
echo "==> Published to $OUT_APK"
ls -la "$OUT_APK"

# --- Verify signatures (needs apksigner from build-tools; best effort) ---
APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort | tail -1 || true)"
if [ -n "$APKSIGNER" ]; then
  echo "==> Signature schemes:"
  "$APKSIGNER" verify --verbose "$OUT_APK" 2>/dev/null | grep -iE "verified|scheme v[0-9]" || true
fi

echo "==> Done. Commit apps/web/public/rentular.apk and redeploy the web app."
echo "    On m1:  cd /var/www/rentular.com && git pull && pnpm --filter @rentular/web build && pm2 restart rentular-web"
