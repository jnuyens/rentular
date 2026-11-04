#!/usr/bin/env bash
#
# Create the upload key for Google Play releases, once.
#
# The key goes to ~/.rentular/rentular-upload.keystore, outside the repository.
# keytool asks for the passwords and your name itself, so this script never sees
# or prints a password.
#
# Usage:  ./android-app/create-upload-key.sh
#
set -euo pipefail

KEY_DIR="$HOME/.rentular"
KEYSTORE="$KEY_DIR/rentular-upload.keystore"
ALIAS="rentular-upload"

if [ -e "$KEYSTORE" ]; then
  echo "ERROR: $KEYSTORE already exists. Refusing to overwrite it." >&2
  echo "If you really want a new upload key, move the old one away first." >&2
  exit 1
fi

# --- keytool ---
KEYTOOL=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
elif [ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" ]; then
  KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
elif command -v keytool >/dev/null 2>&1; then
  KEYTOOL="$(command -v keytool)"
else
  echo "ERROR: keytool not found. Install Android Studio or set JAVA_HOME to a JDK." >&2
  exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

echo "==> Creating $KEYSTORE (alias $ALIAS)."
echo "    keytool will ask for a keystore password, your name and organisation."
"$KEYTOOL" -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000

chmod 600 "$KEYSTORE"

cat <<EOF

==> Done. Add these lines to ~/.gradle/gradle.properties (not to the repository):

RENTULAR_UPLOAD_STORE_FILE=$KEYSTORE
RENTULAR_UPLOAD_KEY_ALIAS=$ALIAS
RENTULAR_UPLOAD_STORE_PASSWORD=<the password you just typed>
RENTULAR_UPLOAD_KEY_PASSWORD=<the same password>

Then run: chmod 600 ~/.gradle/gradle.properties

Back up $KEYSTORE and its password somewhere off this machine (a password
manager works). With Play App Signing a lost upload key can be reset through
Play support, but that takes time and blocks releases until it is done.
EOF
