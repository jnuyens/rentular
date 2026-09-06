#!/usr/bin/env bash
#
# Ponto Connect (Ibanity) production certificate preparation.
#
# Generates the private keys + CSRs for BOTH applications (PPM, CPM) and BOTH
# certificate types each (transport = mTLS, signature = request signing).
# You submit each .csr in the Ibanity Developer Portal, then download the issued
# certificate PEM back into the matching directory.
#
# Run this on the machine that runs the API (m1), NOT inside the git repo.
# Private keys never leave this machine and must never be committed.
#
# Ibanity's portal shows its own step-by-step commands when you create a
# certificate. If they differ from these (key size, subject, .pfx bundling),
# FOLLOW THE PORTAL. These match Ibanity's standard RSA-2048 flow.
#
set -euo pipefail

BASE="${PONTO_CERT_DIR:-$HOME/ponto-certs}"
SUBJ_O="${CERT_ORG:-Linux Belgium BV}"
SUBJ_C="${CERT_COUNTRY:-BE}"

gen() {
  local app="$1" kind="$2"   # app: ppm|cpm   kind: transport|signature
  local dir="$BASE/$app"
  mkdir -p "$dir"
  chmod 700 "$dir"
  local key="$dir/${app}-${kind}.key"
  local csr="$dir/${app}-${kind}.csr"
  if [ -f "$key" ]; then
    echo "SKIP  $key already exists (not overwriting)"
  else
    # Add -aes256 here if you want a passphrase-protected key (then set the
    # matching *_PASSPHRASE env var). Unencrypted is fine for a locked-down box.
    openssl genrsa -out "$key" 2048
    chmod 600 "$key"
    echo "KEY   $key"
  fi
  openssl req -new -key "$key" -out "$csr" \
    -subj "/CN=Rentular ${app^^} ${kind^}/O=${SUBJ_O}/C=${SUBJ_C}"
  echo "CSR   $csr  <- submit this in the Ibanity portal"
}

mkdir -p "$BASE"; chmod 700 "$BASE"
for app in ppm cpm; do
  for kind in transport signature; do
    gen "$app" "$kind"
  done
done

echo
echo "Done. Next steps:"
echo "  1. In the Ibanity portal, create the PPM application, then the CPM application."
echo "  2. For each app, create a Transport certificate and a Signature certificate,"
echo "     pasting the matching .csr from $BASE/<app>/."
echo "  3. Download each issued certificate PEM next to its key, e.g.:"
echo "        $BASE/ppm/ppm-transport.pem"
echo "        $BASE/ppm/ppm-signature.pem"
echo "  4. Copy each SIGNATURE certificate's UUID (shown in the certificates"
echo "     overview) - that UUID is the keyId for request signing."
echo "  5. Wire the env vars (see .env.example PONTO_PPM_* / PONTO_CPM_*)."
