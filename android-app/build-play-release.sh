#!/usr/bin/env bash
#
# Build the signed Android App Bundle (AAB) for Google Play.
#
# The bundle is signed with the upload key from ~/.gradle/gradle.properties (or
# the environment). Run ./create-upload-key.sh once to create that key. With Play
# App Signing, Google re-signs the app with the app signing key it holds.
#
# Output: android-app/dist/rentular-<versionName>-<versionCode>.aab
#
# Usage:  ./android-app/build-play-release.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GRADLE_FILE="$SCRIPT_DIR/app/build.gradle.kts"
VERSION_FILE="$REPO_ROOT/packages/shared/src/constants/appVersion.ts"

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

# --- Upload key (only checks that the values exist, never prints them) ---
GRADLE_PROPS="$HOME/.gradle/gradle.properties"
missing=()
for name in RENTULAR_UPLOAD_STORE_FILE RENTULAR_UPLOAD_STORE_PASSWORD RENTULAR_UPLOAD_KEY_ALIAS RENTULAR_UPLOAD_KEY_PASSWORD; do
  if [ -n "${!name:-}" ]; then
    continue
  fi
  if [ -f "$GRADLE_PROPS" ] && grep -qE "^[[:space:]]*$name[[:space:]]*=[[:space:]]*[^[:space:]]" "$GRADLE_PROPS"; then
    continue
  fi
  missing+=("$name")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: the upload key is not configured. Missing:" >&2
  for name in "${missing[@]}"; do echo "  $name" >&2; done
  echo "Run ./android-app/create-upload-key.sh once, then add the lines it prints to $GRADLE_PROPS." >&2
  exit 1
fi

# --- Versions ---
VERSION_CODE="$(grep -E '^[[:space:]]*versionCode[[:space:]]*=' "$GRADLE_FILE" | head -1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
VERSION_NAME="$(grep -E '^[[:space:]]*versionName[[:space:]]*=' "$GRADLE_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
REQUIRED_APP_VERSION="$(grep -E 'export const REQUIRED_APP_VERSION' "$VERSION_FILE" | sed -E 's/[^0-9]*([0-9]+).*/\1/')"

echo "versionName          = $VERSION_NAME"
echo "versionCode          = $VERSION_CODE"
echo "REQUIRED_APP_VERSION = $REQUIRED_APP_VERSION"

if [ "$VERSION_CODE" != "$REQUIRED_APP_VERSION" ]; then
  echo "" >&2
  echo "ERROR: versionCode ($VERSION_CODE) differs from REQUIRED_APP_VERSION ($REQUIRED_APP_VERSION)." >&2
  echo "Bump both in the same commit: app/build.gradle.kts and packages/shared/src/constants/appVersion.ts." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
echo "==> Building signed release bundle..."
./gradlew --no-daemon clean bundleRelease

BUILT_AAB="$SCRIPT_DIR/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$BUILT_AAB" ]; then
  echo "ERROR: build did not produce $BUILT_AAB" >&2
  exit 1
fi

mkdir -p "$SCRIPT_DIR/dist"
OUT_AAB="$SCRIPT_DIR/dist/rentular-$VERSION_NAME-$VERSION_CODE.aab"
cp "$BUILT_AAB" "$OUT_AAB"
echo "==> Bundle ready: $OUT_AAB"
ls -la "$OUT_AAB"

cat <<EOF

Next steps:
  1. Upload $OUT_AAB in the Play Console (Internal testing first).
  2. Deploy the server only after this release is live on Play. A server whose
     REQUIRED_APP_VERSION is above the installed app blocks users until they update.

Bump rule: when the native app changes, bump versionCode and versionName in
app/build.gradle.kts and REQUIRED_APP_VERSION in packages/shared/src/constants/appVersion.ts
in the same commit. Bump RENTULAR_VERSION on every server release.
EOF
