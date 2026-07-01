---
phase: 10-deploy-to-hetzner-m1-production-deployment
plan: 05
subsystem: infra
tags: [deploy, atomic-release, symlink, github-webhook, hmac, systemd, nginx, reverse-proxy, smoke-test, bootstrap]

# Dependency graph
requires:
  - phase: 10-04
    provides: docker-compose.prod.yml (loopback publishes, env_file secrets, mariadb 127.0.0.1:3306, api /api/v1/health) + .env.production.example
  - phase: 10-03
    provides: apps/api + apps/web Dockerfiles (api runs dist/index.mjs; web bakes NEXT_PUBLIC_API_URL build ARG)
provides:
  - deploy/deploy.sh — atomic build-on-box release (pnpm build gate, current symlink flip, host-shell bootstrap via DB_HOST=127.0.0.1, prune to 5)
  - deploy/webhook-receiver.mjs — HMAC-SHA256 (constant-time) GitHub push receiver on loopback 127.0.0.1:9000
  - deploy/webhook-receiver.test.mjs — 8 node:test cases proving signature verification
  - deploy/rentular-webhook.service — systemd unit (non-root, EnvironmentFile=/opt/rentular/.env, Restart=always)
  - deploy/smoke.sh — post-deploy checks (HTTPS 200, /api/v1/health healthy, TLS dates, zero localhost:4000, compose ps healthy)
  - deploy/nginx/rentular.conf — reverse-proxy server block (/ -> web:3000, /api/v1 -> api:4000 prefix-preserved, /deploy-webhook -> 127.0.0.1:9000)
affects: [10-06 on-box install + wiring (nginx -t, systemctl enable, first real deploy + smoke)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic release: git archive -> releases/<ts> -> pnpm build gate -> ln -sfn + mv -Tf symlink flip (build failure leaves current unchanged)"
    - "Host-shell bootstrap sources /opt/rentular/.env (never prints) and overrides DB_HOST=127.0.0.1 to reach loopback-published MariaDB"
    - "GitHub webhook: HMAC-SHA256 constant-time verify (timingSafeEqual, length-guarded) BEFORE JSON parse + branch allowlist, Node built-ins only"
    - "nginx /api/v1 proxy_pass with NO trailing slash to preserve the Hono basePath prefix"

key-files:
  created:
    - deploy/deploy.sh
    - deploy/webhook-receiver.mjs
    - deploy/webhook-receiver.test.mjs
    - deploy/rentular-webhook.service
    - deploy/smoke.sh
    - deploy/nginx/rentular.conf
  modified: []

key-decisions:
  - "deploy.sh gates on pnpm build ONLY, never the linter (tsc --noEmit has ~57 pre-existing errors; D-06). Verified by `! grep pnpm lint`."
  - "Release tree built with full `pnpm install --frozen-lockfile` (devDeps present) so the host-shell bootstrap has drizzle-kit + tsx available; bootstrap runs `pnpm --filter @rentular/api bootstrap`."
  - "Secrets sourced with `set -a; . $DEPLOY_ROOT/.env; set +a` (sourcing required + allowed; the never-cat/echo rule means never PRINT). DB_HOST=127.0.0.1 override is process-local."
  - "Webhook receiver is a self-contained Node .mjs (built-ins only, no npm deps) bound to 127.0.0.1:9000, per RESEARCH Open-Question-1 resolution (independent of host PHP state, ships in-repo)."
  - "Signature verified over the RAW body BEFORE JSON.parse; wrong-length header returns false via an explicit length guard (timingSafeEqual would otherwise throw)."
  - "nginx proxy_pass to /api/v1 without a trailing slash preserves the full path the Hono basePath expects (a trailing slash would strip the prefix)."
  - "systemd unit + nginx conf are reference artifacts installed on the box in Plan 06 (non-root deploy user, existing LE cert paths)."

patterns-established:
  - "Atomic-release + current symlink adapted from static-rsync (modulejail) to multi-process Docker: the running containers are the live artifact, so a flip is followed by `compose build && up -d` off current; rollback = repoint symlink + up -d --build."

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-07-01
---

# Phase 10 Plan 05: Deploy Pipeline Artifacts Summary

**The full build-on-box deploy pipeline: an atomic `releases/<ts>` + `current`-symlink `deploy.sh` gated on `pnpm build` (never lint) whose host-shell bootstrap sources `/opt/rentular/.env` and reaches the loopback MariaDB via `DB_HOST=127.0.0.1`; an HMAC-SHA256 (constant-time) GitHub webhook receiver on loopback:9000 (+ 8 passing unit tests + a non-root systemd unit); and a `smoke.sh` + nginx reverse-proxy block that preserves the `/api/v1` prefix and exposes `/deploy-webhook` to the receiver.**

## Performance
- **Duration:** ~4 min
- **Tasks:** 3
- **Files:** 6 (6 created, 0 modified)

## Accomplishments
- **`deploy/deploy.sh`** (`set -euo pipefail`): `git archive` of `origin/main` into `releases/<ts>` → `pnpm install --frozen-lockfile` (devDeps for bootstrap) → **`pnpm build` gate** (never lint) → **atomic** `current` flip (`ln -sfn` to a temp name then `mv -Tf`) → `docker compose -f current/docker-compose.prod.yml build && up -d` → one-shot idempotent bootstrap that **sources** `/opt/rentular/.env` with `set -a; . …; set +a` (never printed) and **overrides `DB_HOST=127.0.0.1`** for `pnpm --filter @rentular/api bootstrap` → prune `releases/` to the newest 5 (never removes the `current` target). A failed build leaves `current` unchanged; rollback (repoint symlink + `up -d --build`) is documented in-file and via an EXIT trap hint.
- **`deploy/webhook-receiver.mjs`**: Node built-ins only (`node:http`/`node:crypto`/`node:child_process`), binds **127.0.0.1:9000 only**. Reads the raw body, `verifySignature()` computes `sha256=`+HMAC-SHA256 and compares with `crypto.timingSafeEqual` **after a length guard** (wrong-length header → `false`, no throw). Authenticates **before** `JSON.parse`; enforces a **branch allowlist** (`refs/heads/main` → deploy, else 200 no-op); spawns `deploy.sh` **detached** only on a verified main push (202); never logs the secret or raw body; 5 MB body cap.
- **`deploy/webhook-receiver.test.mjs`**: 8 `node:test` cases — valid (string + Buffer), tampered body, wrong secret, missing/empty header, wrong-length header (no throw), missing `sha256=` prefix, empty secret. All pass.
- **`deploy/rentular-webhook.service`**: systemd unit running `node /opt/rentular/current/deploy/webhook-receiver.mjs`, `WorkingDirectory=/opt/rentular/current`, `EnvironmentFile=/opt/rentular/.env` (for `DEPLOY_WEBHOOK_SECRET`), non-root `User=deploy`, `Restart=always`, plus `NoNewPrivileges`/`ProtectSystem`/`PrivateTmp` hardening. Loopback bind documented.
- **`deploy/smoke.sh`** (`set -euo pipefail`, arg = base URL, default `https://rentular.com`): asserts HTTPS home 200; `/api/v1/health` JSON contains `"status":"healthy"`; TLS `notBefore`/`notAfter` present via `openssl s_client`; **zero** `localhost:4000` in served HTML (Pitfall 1); `docker compose -f docker-compose.prod.yml ps` shows no unhealthy/exited/restarting and at least one running service. Fails fast with a clear message.
- **`deploy/nginx/rentular.conf`**: HTTP→HTTPS redirect (with ACME passthrough) + HTTPS server for `rentular.com`. `location /api/v1 { proxy_pass http://127.0.0.1:4000; }` (**no trailing slash → prefix preserved** for the Hono basePath), `location /deploy-webhook { proxy_pass http://127.0.0.1:9000; }`, `location / { proxy_pass http://127.0.0.1:3000; }`. Shared proxy headers include `X-Forwarded-Proto https` (NextAuth, Pitfall 7) + Host/X-Real-IP/X-Forwarded-For + WebSocket upgrade. Existing LE certbot cert paths referenced.

## Task Commits
1. **Task 1 — deploy/deploy.sh (atomic build-on-box deploy)** — `5d2549c` (feat)
2. **Task 2 — webhook-receiver.mjs + test + systemd unit** — `340d82a` (feat)
3. **Task 3 — smoke.sh + nginx/rentular.conf** — `2eb08e1` (feat)

## Files Created/Modified
- `deploy/deploy.sh` (created) — atomic build-on-box release, pnpm build gate, host-shell bootstrap, prune-to-5.
- `deploy/webhook-receiver.mjs` (created) — HMAC-verified loopback GitHub push receiver.
- `deploy/webhook-receiver.test.mjs` (created) — 8 signature-verification unit tests.
- `deploy/rentular-webhook.service` (created) — systemd unit (reference; installed in Plan 06).
- `deploy/smoke.sh` (created) — post-deploy HTTP/TLS/compose smoke checks.
- `deploy/nginx/rentular.conf` (created) — reverse-proxy server block (reference; installed in Plan 06).

## Deviations from Plan
None — plan executed exactly as written. (One in-flight adjustment while authoring Task 1: reworded two comments and switched the source line from the `$ENV_FILE` alias to the literal `$DEPLOY_ROOT/.env` so the acceptance greps — `! grep "pnpm lint"` and `grep sources-.env` — match against the same load-bearing behavior. No behavior change.)

## Verification

### Ran locally (all PASS)
- **`bash -n deploy/deploy.sh`** — syntax OK. Greps: contains `pnpm build`; does **NOT** contain `pnpm lint`; sources `…/.env` (`^\s*(\.|source) .*/\.env`); `DB_HOST=127.0.0.1`; no `cat/echo` of the env file or `echo …SECRET`; `docker-compose.prod.yml`; `releases/`; `set -euo pipefail`.
- **`node --check deploy/webhook-receiver.mjs`** — syntax OK. **`node --test deploy/webhook-receiver.test.mjs`** — 8/8 pass. Greps: `127.0.0.1` and `timingSafeEqual` present in the receiver; `webhook-receiver.mjs` + `EnvironmentFile=/opt/rentular/.env` present in the unit.
- **`bash -n deploy/smoke.sh`** — syntax OK. Greps: `api/v1/health` and `localhost:4000` present in smoke.sh; `X-Forwarded-Proto`, `/api/v1`, `location /deploy-webhook`, `127.0.0.1:9000`, `proxy_pass` present in the nginx conf.

### Deferred to the on-box install (Plan 06 on m1)
- **`nginx -t`** — nginx is not installed on this build machine; the authoritative config syntax check runs on m1 when the operator installs `rentular.conf` (per the plan's note to defer nginx -t to Plan 06).
- **A real deploy + live smoke run** — `deploy.sh` needs the box's git mirror, Docker, `/opt/rentular/.env`, and a public `rentular.com` A record; `smoke.sh` needs the live HTTPS endpoint. Both are exercised for real in Plan 06.
- **`systemctl enable --now rentular-webhook`** + GitHub webhook wiring — host install step (Plan 06).

## Threat Surface
Addresses the plan's threat register:
- **T-10-05-01** (unauthenticated webhook → RCE) — HMAC-SHA256 constant-time verify + branch allowlist before exec; receiver bound to 127.0.0.1:9000; unit-tested (8 cases).
- **T-10-05-02** (deploy of forged/unverified ref) — non-`refs/heads/main` pushes are a 200 no-op; only a verified main push runs deploy.sh.
- **T-10-05-03** (deploy logs leaking secrets) — deploy.sh sources (never cat/echo/print) `/opt/rentular/.env`; receiver never logs the secret or raw body; systemd unit loads it via `EnvironmentFile`.
- **T-10-05-04** (insecure cookies behind proxy) — nginx forwards `X-Forwarded-Proto https` + Host.
- **T-10-05-05** (broken release flipped live) — `pnpm build` gate precedes the symlink flip; a build failure leaves `current` unchanged; rollback documented.
- **T-10-05-SC** (no new deps) — receiver + test use Node built-ins only; no npm installs, no legitimacy gate needed.

No new trust boundaries beyond the plan's threat model.

## Self-Check: PASSED
All six created files exist on disk; all three task commits (`5d2549c`, `340d82a`, `2eb08e1`) are present in git history.
