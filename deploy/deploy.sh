#!/usr/bin/env bash
# ===========================================================================
# Rentular — atomic build-on-box deploy (m1 / Hetzner)
# ===========================================================================
# Adapts the modulejail git-push -> webhook -> atomic-release model to the
# dynamic, multi-process Docker case (D-05/D-07). Unlike modulejail (a static
# Astro rsync where flipping `current` instantly swaps served files), the LIVE
# artifact here is the set of running containers — so a release is:
#
#   1. check the pushed tree out into releases/<ts>
#   2. pnpm install --frozen-lockfile  (installs devDeps too: the release tree
#      therefore has drizzle-kit + tsx available for the bootstrap step)
#   3. pnpm build      <-- THE DEPLOY GATE (tsup ESM + next build). NEVER the
#                          linter — `tsc --noEmit` has ~57 pre-existing errors
#                          (Phase 2/6 debt) that would fail every deploy (D-06).
#                          Lint debt is tracked separately, not a deploy gate.
#   4. flip the `current` symlink to releases/<ts> ATOMICALLY (ln -sfn to a
#      temp name, then mv over `current` — a same-directory rename is atomic)
#   5. docker compose -f current/docker-compose.prod.yml build && up -d
#   6. one-shot idempotent bootstrap (drizzle-kit push + owner create) run from
#      the release BUILD TREE (has devDeps) as a HOST shell process
#   7. prune releases/ to the newest 5
#
# ROLLBACK: repoint `current` at the previous release dir and re-run
#   docker compose -f current/docker-compose.prod.yml up -d --build
# (see rollback_hint below). A failed build/flip leaves `current` UNCHANGED,
# so the previously-running release stays live (T-10-05-05).
#
# SECRETS (T-10-05-03): this is a HOST shell script, so compose's `env_file:`
# does NOT apply to it — the one-shot bootstrap must source the secrets itself.
# We `. /opt/rentular/.env` (source only — NEVER cat/echo/print the file) and
# OVERRIDE DB_HOST=127.0.0.1 for the bootstrap, because the compose service DNS
# name `mariadb` does not resolve from the host shell and MariaDB is
# loopback-published at 127.0.0.1:3306 by docker-compose.prod.yml (Plan 04).
# ===========================================================================
set -euo pipefail

# --- Configuration ---------------------------------------------------------
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/rentular}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
ENV_FILE="$DEPLOY_ROOT/.env"
COMPOSE_FILE="docker-compose.prod.yml"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
KEEP_RELEASES=5
# SOURCE_REPO: a git checkout/mirror of the repo on the box that the webhook
# has already fetched (git-push target). Defaults to a bare/working mirror.
SOURCE_REPO="${SOURCE_REPO:-$DEPLOY_ROOT/repo}"

TS="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$TS"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

rollback_hint() {
  cat >&2 <<'EOF'
[deploy] ROLLBACK: the `current` symlink was NOT flipped; the previous release
[deploy] stays live. To roll back to an earlier release manually:
[deploy]   ln -sfn "$DEPLOY_ROOT/releases/<previous-ts>" "$DEPLOY_ROOT/current.tmp"
[deploy]   mv -Tf  "$DEPLOY_ROOT/current.tmp" "$DEPLOY_ROOT/current"
[deploy]   docker compose -f "$DEPLOY_ROOT/current/docker-compose.prod.yml" up -d --build
EOF
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then log "FAILED (exit $rc)"; rollback_hint; fi' EXIT

# --- 1. Materialise the pushed tree into releases/<ts> ---------------------
log "Creating release $TS at $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
# Export the deploy branch's committed tree into the release dir (no .git — a
# clean, immutable snapshot of exactly what was pushed).
git -C "$SOURCE_REPO" fetch --prune origin "$DEPLOY_BRANCH"
git -C "$SOURCE_REPO" archive --format=tar "origin/$DEPLOY_BRANCH" | tar -x -C "$RELEASE_DIR"

cd "$RELEASE_DIR"

# --- 2. Install (incl. devDeps: drizzle-kit + tsx needed by bootstrap) -----
log "Installing dependencies (frozen lockfile; includes devDeps for bootstrap)"
pnpm install --frozen-lockfile

# --- 3. BUILD GATE (never lint) --------------------------------------------
# `pnpm build` == tsup ESM (api) + next build (web). This is the ONLY quality
# gate. Do NOT add the linter (tsc --noEmit) here (D-06).
log "Running build gate: pnpm build"
pnpm build

# --- 4. Atomic symlink flip (only AFTER a green build) ---------------------
log "Flipping current -> releases/$TS (atomic)"
ln -sfn "$RELEASE_DIR" "$DEPLOY_ROOT/current.tmp"
mv -Tf "$DEPLOY_ROOT/current.tmp" "$CURRENT_LINK"

# --- 5. Build + (re)start the container stack off `current` ----------------
log "Building container images"
docker compose -f "$CURRENT_LINK/$COMPOSE_FILE" build
log "Starting/updating the stack"
docker compose -f "$CURRENT_LINK/$COMPOSE_FILE" up -d

# --- 6. One-shot idempotent bootstrap (host shell; sources secrets) --------
# Load the secrets into THIS shell WITHOUT printing them. `set -a` auto-exports
# every var the file defines; `. "$ENV_FILE"` sources it (sourcing is required
# and allowed — the "never cat/echo the .env" rule means never PRINT it).
if [ -f "$ENV_FILE" ]; then
  log "Sourcing secrets for bootstrap (not printed)"
  set -a
  # shellcheck disable=SC1090
  . "$DEPLOY_ROOT/.env"
  set +a
  # The compose service DNS `mariadb` does not resolve from the host shell;
  # MariaDB is loopback-published at 127.0.0.1:3306 (Plan 04). Override so the
  # host-shell bootstrap reaches it. This override is local to this process.
  export DB_HOST=127.0.0.1
  log "Running idempotent bootstrap (drizzle-kit push + owner create) via DB_HOST=127.0.0.1"
  # Run from the release build tree — devDeps (drizzle-kit + tsx) are present.
  pnpm --filter @rentular/api bootstrap
else
  log "WARNING: $ENV_FILE not found — skipping bootstrap (containers still started)"
fi

# --- 7. Prune old releases (keep newest 5) ---------------------------------
log "Pruning releases/ to the newest $KEEP_RELEASES"
if [ -d "$RELEASES_DIR" ]; then
  # List newest-first, skip the newest KEEP_RELEASES, remove the rest. Never
  # touch whatever `current` points at.
  CURRENT_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  # shellcheck disable=SC2012
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
    old_resolved="$(readlink -f "$old" 2>/dev/null || true)"
    if [ -n "$old_resolved" ] && [ "$old_resolved" = "$CURRENT_TARGET" ]; then
      continue
    fi
    log "Removing old release: $old"
    rm -rf "$old"
  done
fi

log "Deploy $TS complete — current -> $(readlink -f "$CURRENT_LINK")"
