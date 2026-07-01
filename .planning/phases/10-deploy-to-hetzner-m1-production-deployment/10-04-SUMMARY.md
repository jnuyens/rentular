---
phase: 10-deploy-to-hetzner-m1-production-deployment
plan: 04
subsystem: infra
tags: [docker, compose, production, hardening, secrets, env, mariadb, redis, mailpit, loopback]

# Dependency graph
requires:
  - phase: 10-03
    provides: apps/api + apps/web Dockerfiles (dist/index.mjs runner; web bakes NEXT_PUBLIC_API_URL build ARG)
provides:
  - docker-compose.prod.yml — hardened full-stack prod compose (mariadb, redis, mailpit, api, web); loopback-only publishes; no default DB passwords; secrets via env_file
  - .env.production.example — full ~37-key prod env template with internal service hostnames + CHANGE_ME secret placeholders
affects: [10-05 deploy.sh (up -d --build; host-shell bootstrap via 127.0.0.1:3306), 10-06 on-box build + smoke (authoritative docker compose config/build)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Loopback-only port publishing (127.0.0.1:PORT:PORT) for every service; host nginx is the sole public ingress"
    - "No default DB passwords in prod compose via ${VAR:?err} required-var form (compose aborts if unset)"
    - "Secrets injected into api/web via env_file: /opt/rentular/.env (root:600, git-ignored)"
    - "node global fetch as container healthcheck (node:20-slim has no curl/wget)"

key-files:
  created:
    - docker-compose.prod.yml
    - .env.production.example
  modified: []

key-decisions:
  - "mariadb/redis loopback-published (127.0.0.1:3306 / :6379) rather than dropped, so deploy.sh's host-shell bootstrap (Plan 05) reaches MariaDB via DB_HOST=127.0.0.1 while the DB stays off the public interface"
  - "DB_ROOT_PASSWORD/DB_PASSWORD/DB_NAME/DB_USER required via ${VAR:?err} — no ${VAR:-default} fallbacks, no literal default passwords"
  - "api container-network env overrides (DB_HOST=mariadb, REDIS_URL=redis://redis:6379, SMTP_HOST=mailpit) layered over env_file so the same /opt/rentular/.env works for both containers and the host-shell bootstrap"
  - "Single api replica only — BullMQ workers auto-start in-process; scaling would duplicate every cron worker (documented as a no-scale constraint comment)"
  - "api healthcheck targets /api/v1/health (Hono basePath), not /health — matches the on-the-wire path nginx also proxies"
  - "mailpit SMTP :1025 stays internal (expose, not ports); only the UI is loopback-published on 127.0.0.1:8025 for SSH-tunnel inspection"

patterns-established:
  - "Separate docker-compose.prod.yml keeps dev docker-compose.yml intact; deploy uses -f docker-compose.prod.yml"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-07-01
---

# Phase 10 Plan 04: Production Compose + Env Template Summary

**A hardened, VPS-safe `docker-compose.prod.yml` that runs the full stack (mariadb, redis, mailpit, api, web) with every published port bound to 127.0.0.1 loopback, no default DB passwords (required `${VAR:?}` secrets), and `env_file: /opt/rentular/.env` injection — paired with a complete `.env.production.example` template that mirrors the full ~37-key surface using internal service hostnames and CHANGE_ME secret placeholders.**

## Performance
- **Duration:** ~2 min
- **Started:** 2026-07-01T01:02:03Z
- **Completed:** 2026-07-01T01:04:26Z
- **Tasks:** 2
- **Files:** 2 (2 created, 0 modified)

## Accomplishments
- `docker-compose.prod.yml`: five services (mariadb, redis, mailpit, api, web), obsolete top-level `version:` omitted.
  - **Loopback-only ingress:** mariadb `127.0.0.1:3306:3306`, redis `127.0.0.1:6379:6379`, mailpit UI `127.0.0.1:8025:8025`, api `127.0.0.1:4000:4000`, web `127.0.0.1:3000:3000`. Nothing binds the public interface — host nginx is the sole ingress. mariadb/redis are loopback-published (not dropped) so the Plan 05 host-shell bootstrap can reach MariaDB at `127.0.0.1:3306`.
  - **No default DB passwords:** `DB_ROOT_PASSWORD`/`DB_PASSWORD`/`DB_NAME`/`DB_USER` are required via the `${VAR:?err}` form (compose aborts if unset) — no `${VAR:-default}` fallbacks and no literal `rootpassword`.
  - **Secrets via env_file:** api + web load `/opt/rentular/.env`; api layers container-network overrides (`DB_HOST=mariadb`, `REDIS_URL=redis://redis:6379`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`).
  - **Baked API URL:** web `build.args NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:?...}` (inlined at build; runtime env is ignored by the compiled bundle).
  - **Health + ordering:** api `depends_on` mariadb+redis `service_healthy`; web `depends_on` api `service_started`. Healthchecks use node global `fetch` (node:20-slim has no curl/wget); api hits `/api/v1/health` (Hono basePath). `restart: unless-stopped` on all; named volumes `mariadb_data`/`redis_data` preserved.
  - **No-scale constraint** documented in a header comment (in-process BullMQ workers).
  - mailpit SMTP `:1025` kept internal via `expose` (not published).
- `.env.production.example`: mirrors every key from `.env.example` with prod-shaped values — HTTPS URLs on rentular.com, internal service hostnames (`mariadb`/`redis`/`mailpit`, no `localhost`), Ponto + GoCardless on `sandbox`, `DB_HOST=mariadb` with a documented note that the host-shell bootstrap overrides `DB_HOST=127.0.0.1`. Adds `ADMIN_EMAIL`/`ADMIN_PASSWORD` (bootstrap) and `DEPLOY_WEBHOOK_SECRET` (deploy webhook). All secret keys are `CHANGE_ME` placeholders. Header documents the root-owned, chmod-600, git-ignored `/opt/rentular/.env` target and the rotation flow (edit + `up -d`).

## Task Commits
1. **Task 1 — docker-compose.prod.yml (hardened full stack)** — `d4ee942` (feat)
2. **Task 2 — .env.production.example (full prod env surface)** — `a4f413a` (docs)

## Files Created/Modified
- `docker-compose.prod.yml` (created) — hardened production stack, loopback-only publishes, env_file secrets, baked web API URL.
- `.env.production.example` (created) — full prod env template, internal hostnames, CHANGE_ME secrets, bootstrap + deploy-webhook keys.

## Deviations from Plan
None — plan executed exactly as written.

## Verification

### Ran locally
- **YAML parse (PyYAML, stands in for `docker compose config`):** parses cleanly; services = `[api, mailpit, mariadb, redis, web]`, volumes = `[mariadb_data, redis_data]`.
- **Loopback greps (all PASS):** `127.0.0.1:3306`, `127.0.0.1:6379`, `127.0.0.1:3000`, `127.0.0.1:4000`, `127.0.0.1:8025` all present; `api/v1/health` present; `condition: service_healthy` present; `env_file` present; `NEXT_PUBLIC_API_URL` build arg present.
- **Negative greps (all PASS):** no `0.0.0.0` anywhere in the file; no `rootpassword` / no `${DB_PASSWORD:-...}` default-fallback.
- **Env template (all PASS):** every `.env.example` key present in `.env.production.example`; the plan's five verify greps (`NEXT_PUBLIC_API_URL=https://rentular.com/api/v1`, `SMTP_HOST=mailpit`, `DB_HOST=mariadb`, `ADMIN_EMAIL`, `DEPLOY_WEBHOOK_SECRET`) all match; no `localhost`; all secret keys are `CHANGE_ME` placeholders.
- **Git hygiene:** `.env.production.example` is not git-ignored (template is committable); `.env` / `.env.*.local` patterns confirm the real `/opt/rentular/.env` is ignored.

### Deferred to the on-box build (Plan 06 on m1)
The `docker` CLI is **not installed on this build machine**, so the authoritative `docker compose -f docker-compose.prod.yml config` render (and the plan's exact `config | grep` acceptance greps against the rendered output) are deferred to the live m1 host. Substituted here with a PyYAML structural parse + raw-file greps, which cover the same assertions (loopback binds, no 0.0.0.0, no default passwords, env_file, build arg, health path). This mirrors the Plan 03 deferral (Docker unavailable locally).

## Threat Surface
Addresses the plan's threat register:
- **T-10-04-01** (public DB/Redis exposure) — mariadb/redis published on `127.0.0.1` only; inter-container traffic uses compose service DNS.
- **T-10-04-02** (default/weak DB passwords) — `${VAR:?err}` required form, no fallbacks/literals.
- **T-10-04-03** (insecure cookies behind proxy) — env template sets `AUTH_URL=https://rentular.com` (nginx X-Forwarded-Proto wiring lands in Plan 05).
- **T-10-04-04** (secrets in template) — `.env.production.example` holds `CHANGE_ME` placeholders only; real `/opt/rentular/.env` is git-ignored + chmod 600.

No new trust boundaries introduced beyond the plan's threat model.

## Self-Check: PASSED
Both created files exist on disk; both task commits (`d4ee942`, `a4f413a`) present in git history.
