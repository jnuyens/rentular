#!/usr/bin/env bash
#
# Create the upload key for Google Play releases, once.
#
# - A random password is generated and written straight to a root-owned file
#   that only root can read: /etc/rentular/android-upload-key.pass (0400). It is
#   never printed and never written anywhere else.
# - The key goes to ~/.rentular/rentular-upload.keystore, outside the repository,
#   locked with that password.
# - build-play-release.sh reads the password back with sudo at build time.
#
# You are asked for your Mac password once, by sudo.
#
# Usage:  ./android-app/create-upload-key.sh "CN=Your Name, O=Your Organisation, C=BE"
#         (the argument is the certificate name; it defaults to "CN=Rentular, O=Rentular, C=BE")
#
set -euo pipefail

DNAME="${1:-CN=Rentular, O=Rentular, C=BE}"
KEY_DIR="$HOME/.rentular"
KEYSTORE="$KEY_DIR/rentular-upload.keystore"
ALIAS="rentular-upload"
PASS_DIR="/etc/rentular"
PASS_FILE="$PASS_DIR/android-upload-key.pass"

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

# --- Password file (root only) ---
if sudo test -e "$PASS_FILE"; then
  echo "==> Reusing the existing password in $PASS_FILE."
else
  echo "==> Generating a random password into $PASS_FILE (root only)."
  sudo sh -c "umask 077 && mkdir -p '$PASS_DIR' && openssl rand -base64 24 | tr -d '\n' > '$PASS_FILE' && chown root:wheel '$PASS_DIR' '$PASS_FILE' && chmod 700 '$PASS_DIR' && chmod 400 '$PASS_FILE'"
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

echo "==> Creating $KEYSTORE (alias $ALIAS, $DNAME)."
# The password only lives in this process's environment while keytool runs.
RENTULAR_UPLOAD_PW="$(sudo cat "$PASS_FILE")" \
  "$KEYTOOL" -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -dname "$DNAME" \
    -storepass:env RENTULAR_UPLOAD_PW \
    -keypass:env RENTULAR_UPLOAD_PW

chmod 600 "$KEYSTORE"

cat <<EOF

==> Done.
    Key:      $KEYSTORE
    Password: $PASS_FILE (root only, never shown)

Build a Play release with: ./android-app/build-play-release.sh

Back up both files somewhere off this machine (the password can be read with
"sudo cat $PASS_FILE" when you make the backup). With Play App Signing a lost
upload key can be reset through Play support, but that takes time and blocks
releases until it is done.
EOF
