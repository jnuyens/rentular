#!/usr/bin/env bash
# ===========================================================================
# Rentular — post-deploy smoke checks (run on m1 after deploy.sh)
# ===========================================================================
# Proves the deployment's observable signals. Exits non-zero with a clear
# message on the first failure. Usage:
#   ./deploy/smoke.sh [BASE_URL]     (default https://rentular.com)
#
# Checks (VALIDATION signals):
#   1. HTTPS home returns 200
#   2. /api/v1/health returns JSON containing "status":"healthy"
#   3. TLS cert has valid notBefore/notAfter dates (LE via existing automation)
#   4. Served HTML contains ZERO `localhost:4000` (Pitfall 1 — the baked
#      NEXT_PUBLIC_API_URL must point at rentular.com/api/v1, not localhost)
#   5. `docker compose -f docker-compose.prod.yml ps` shows services up/healthy
# ===========================================================================
set -euo pipefail

BASE_URL="${1:-https://rentular.com}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HOST="$(printf '%s\n' "$BASE_URL" | sed -E 's#^https?://##; s#/.*$##')"

pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

echo "== Rentular smoke checks against $BASE_URL =="

# --- 1. HTTPS home returns 200 ---------------------------------------------
echo "1. HTTPS home returns 200"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL" || true)"
[ "$code" = "200" ] || fail "expected HTTP 200 from $BASE_URL, got '$code'"
pass "home returned 200"

# --- 2. /api/v1/health healthy ---------------------------------------------
echo "2. /api/v1/health reports healthy"
health="$(curl -sSf "$BASE_URL/api/v1/health" || true)"
case "$health" in
  *'"status":"healthy"'* | *'"status": "healthy"'*)
    pass "/api/v1/health reported healthy"
    ;;
  *)
    fail "/api/v1/health did not report healthy; body: ${health:-<empty>}"
    ;;
esac

# --- 3. TLS cert dates valid ------------------------------------------------
echo "3. TLS certificate has valid dates"
dates="$(echo | openssl s_client -connect "${HOST}:443" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -dates 2>/dev/null || true)"
case "$dates" in
  *notBefore=*notAfter=*)
    pass "TLS cert dates present: $(echo "$dates" | tr '\n' ' ')"
    ;;
  *)
    fail "could not read TLS certificate dates for $HOST:443"
    ;;
esac

# --- 4. No localhost:4000 in served HTML (baked API URL correctness) --------
echo "4. Served HTML has zero localhost:4000 references"
count="$(curl -sS "$BASE_URL" | grep -c 'localhost:4000' || true)"
[ "$count" -eq 0 ] || fail "served HTML contains $count 'localhost:4000' reference(s) — NEXT_PUBLIC_API_URL was not baked correctly (Pitfall 1)"
pass "no localhost:4000 in served HTML"

# --- 5. Compose services healthy/running ------------------------------------
echo "5. docker compose services are up"
if command -v docker >/dev/null 2>&1; then
  ps_out="$(docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || true)"
  if printf '%s\n' "$ps_out" | grep -Eq '(unhealthy|exited|restarting)'; then
    printf '%s\n' "$ps_out" >&2
    fail "one or more compose services are unhealthy/exited/restarting"
  fi
  if printf '%s\n' "$ps_out" | grep -Eiq '(healthy|running|Up)'; then
    pass "compose services report healthy/running"
  else
    fail "no running compose services found (is the stack up?)"
  fi
else
  fail "docker CLI not found — run this smoke check on the m1 host"
fi

echo "== All smoke checks passed =="
