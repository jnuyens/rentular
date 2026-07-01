---
phase: 10-deploy-to-hetzner-m1-production-deployment
plan: 03
subsystem: infra
tags: [docker, dockerfile, nextjs, standalone, tsup, esm, monorepo, pnpm, turbo]

# Dependency graph
requires:
  - phase: 10-01
    provides: Next.js standalone output + Stripe boot-guard (crash-safe API boot)
provides:
  - apps/api/Dockerfile — multi-stage tsup ESM runner (node dist/index.mjs; workers auto-start)
  - apps/web/Dockerfile — multi-stage Next standalone runner with NEXT_PUBLIC_API_URL baked as a build ARG
  - .dockerignore — excludes .env/.env.*, node_modules, .git, .planning, dist, .next from build context
  - Runnable API production ESM bundle (tsup bundles @rentular/* + createRequire banner) — verified by local boot
affects: [10-04 compose wiring, 10-05 deploy.sh, 10-06 on-box build + smoke]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-stage Docker: turbo prune --docker -> pnpm install --frozen-lockfile -> build -> slim runner"
    - "NEXT_PUBLIC_* baked at build time via Docker ARG->ENV before next build (single prod env)"
    - "tsup noExternal for first-party workspace packages + createRequire banner for CJS deps under ESM"

key-files:
  created:
    - apps/api/Dockerfile
    - apps/web/Dockerfile
    - .dockerignore
    - apps/api/tsup.config.ts
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml

key-decisions:
  - "tsup bundles @rentular/db + @rentular/shared (their package.json main points at raw .ts, which node cannot import at runtime); npm deps stay external and are provided by the runner node_modules"
  - "createRequire banner in tsup config so external CJS deps (gocardless-nodejs) load under the ESM output instead of throwing 'Dynamic require not supported'"
  - "mysql2 added as a direct @rentular/api dependency so the bundled db code resolves it as an external module in the runner"
  - "NEXT_PUBLIC_API_URL passed as a Docker build ARG and set as ENV before next build (runtime injection is ignored by the compiled browser bundle)"
  - "Web runner starts from the deep monorepo standalone path apps/web/server.js"

patterns-established:
  - "First-party workspace packages that ship raw .ts (no build step) must be bundled (noExternal) when producing a runnable ESM entry"
  - "ESM tsup output needs a createRequire banner to keep dynamic require() of CJS deps working"

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-07-01
---

# Phase 10 Plan 03: API + Web Dockerfiles Summary

**Two multi-stage Dockerfiles (tsup ESM API + Next.js standalone web) plus a secret-excluding .dockerignore; the web image bakes NEXT_PUBLIC_API_URL at build time and the API ESM bundle was made genuinely runnable (bundled workspace TS + createRequire banner) — proven by booting `node dist/index.mjs` locally.**

## Performance
- **Duration:** ~6 min
- **Started:** 2026-07-01T00:53:16Z
- **Completed:** 2026-07-01T00:59:xxZ
- **Tasks:** 2
- **Files:** 6 (4 created, 2 modified)

## Accomplishments
- `apps/api/Dockerfile`: multi-stage `node:20-slim` — `turbo prune @rentular/api --docker` → full install + `tsup` build → prod-only deps runner. `CMD ["node", "apps/api/dist/index.mjs"]`; BullMQ workers auto-start in-process. Reaches infra via compose service names (mariadb/redis), not localhost.
- `apps/web/Dockerfile`: multi-stage `node:20-slim` — prune → full install → `next build` (standalone) → runner. `ARG NEXT_PUBLIC_API_URL` set as `ENV` **before** the build so it is inlined into the browser bundle. Runner copies `.next/standalone`, `.next/static`, and `public` at the nested `apps/web/...` paths; `CMD ["node", "apps/web/server.js"]` (deep Turbo standalone path).
- `.dockerignore`: excludes `.env`/`.env.*`, `node_modules`, `.git`, `.planning`, `.claude`, `**/dist`, `**/.next`, `out`, logs, and OS/editor cruft — secrets and heavy dirs never enter the build context.
- Discovered and fixed a latent, previously-masked bug: the API production ESM entry could never actually run (`ERR_MODULE_NOT_FOUND` on the workspace TS packages, then `Dynamic require ... not supported` on CJS deps). The API now boots to the point of the DB/Redis connection (the only remaining failure locally) with zero module/require errors.

## Task Commits
1. **Task 1 — apps/api/Dockerfile + .dockerignore + runnable-bundle fixes** — `111f451` (feat)
2. **Task 2 — apps/web/Dockerfile (Next standalone, baked API URL)** — `06759fc` (feat)

## Files Created/Modified
- `apps/api/Dockerfile` (created) — multi-stage tsup ESM runner on :4000.
- `apps/web/Dockerfile` (created) — multi-stage Next standalone runner on :3000 with `NEXT_PUBLIC_API_URL` build ARG.
- `.dockerignore` (created) — build-context exclusions incl. `.env`.
- `apps/api/tsup.config.ts` (created) — `noExternal: [/^@rentular\//]`, `platform: node`, `createRequire` banner, esm + dts.
- `apps/api/package.json` (modified) — `build` now runs `tsup` (config-driven); `start` fixed `dist/index.js` → `dist/index.mjs`; `mysql2` added as a direct dependency.
- `pnpm-lock.yaml` (modified) — records `mysql2` as an `@rentular/api` dependency (already pinned in-tree via `packages/db`; no new package downloaded).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking / Rule 1 - Bug] API production ESM bundle was not runnable**
- **Found during:** Task 1 (writing the API Dockerfile; the plan's must-have is "a runnable image that starts with `node dist/index.*`").
- **Issue:** The existing build (`tsup src/index.ts --format esm --dts`) externalised the first-party workspace packages. Their `package.json` `main` points at raw `./src/index.ts`, so the emitted `dist/index.mjs` did `import ... from "@rentular/db"` and crashed at runtime with `ERR_MODULE_NOT_FOUND` (node cannot execute `.ts`). After bundling those, a second layer surfaced: bundled `mysql2` (CJS) and the external `gocardless-nodejs` (CJS) threw `Dynamic require of "..." is not supported` under ESM. The production entry filename was also `dist/index.mjs`, not the `dist/index.js` the `start` script and the plan assumed. In short: `node dist/index.*` had never worked; it was only masked in dev (which uses `tsx`).
- **Fix:**
  1. Added `apps/api/tsup.config.ts` with `noExternal: [/^@rentular\//]` to bundle the workspace packages (npm deps stay external).
  2. Added a `createRequire(import.meta.url)` banner so external CJS deps load under ESM.
  3. Added `mysql2` as a direct `@rentular/api` dependency (already pinned via `packages/db`) so the bundled db code resolves it as an external module in the runner.
  4. Fixed the `start` script `dist/index.js` → `dist/index.mjs`; the Dockerfile CMD uses `dist/index.mjs`.
- **Verification:** `node apps/api/dist/index.mjs` now starts all workers and prints "Rentular API running on http://localhost:4000", failing only on `ECONNREFUSED :6379` (no local Redis) — zero module/require errors. Full API suite: 73/73 pass.
- **Files modified:** `apps/api/tsup.config.ts` (new), `apps/api/package.json`, `pnpm-lock.yaml`.
- **Commit:** `111f451`.
- **Scope note:** These touch two files beyond the plan's declared `files_modified`, but they are the difference between a crash-looping and a runnable API image — the central deliverable of Task 1. The plan explicitly delegated runtime-path correctness ("adjust to the actual dist path produced").

## Verification

### Ran locally
- **API bundle boot smoke (stronger than a lint gate):** `node apps/api/dist/index.mjs` → workers start, server prints its listen line, only `ECONNREFUSED :6379` remains; 0 `ERR_MODULE_NOT_FOUND` / `Dynamic require` errors.
- **API test suite:** 73/73 pass (15 files) after the build-config change.
- **`.dockerignore` gate:** excludes `.env`, `node_modules`, `.git`, `.planning` (grep PASS).
- **Web Dockerfile inspection (acceptance greps all PASS):** declares `ARG NEXT_PUBLIC_API_URL`; `ENV` set before the `next build` RUN (line 35 < line 37); `CMD ["node", "apps/web/server.js"]`; copies `.next/standalone`, `.next/static`, `public` at nested `apps/web/...` paths. The exact standalone paths the runner copies exist in a local build (`apps/web/.next/standalone/apps/web/server.js`, `.next/static`, `public`).

### Deferred to the on-box build (Plan 06 on m1)
Docker and hadolint are **not installed on this build machine**, so the following authoritative checks are deferred to the live m1 host per the plan's "If Docker is unavailable, defer the two builds + run to Plan 06" clause:
- `docker build -f apps/api/Dockerfile -t rentular-api-test .`
- `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://rentular.com/api/v1 -t rentular-web-test .`
- `docker run --rm rentular-web-test node -e "process.exit(0)"` (pnpm-symlink trap check)
- `hadolint` on both Dockerfiles.

## Known Risks / Flags for Plan 06
- **Playwright browsers not installed in the API image.** The API Dockerfile sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to keep the image lean; the Smovin import scraper (Playwright, a beta feature) is therefore not exercised by the containerised API in this pre-release. If Smovin import must run in prod, add a browser-install step / dedicated image later.
- **pnpm cross-stage resolution + native `bcrypt` prebuilds** are validated only by inspection here; the on-box `docker build` (Plan 06) is the authoritative check. Both images use `node:20-slim` (glibc) so `bcrypt`/`mysql2` should resolve prebuilts without apt build tools (RESEARCH A1).
- **SSR hairpin (RESEARCH Pitfall 2):** the single baked `NEXT_PUBLIC_API_URL` is also read server-side; Plan 06 smoke must confirm both an SSR page and a client XHR reach `https://rentular.com/api/v1` and that served HTML contains no `localhost:4000`.

## Threat Surface
- Addresses T-10-03-01 (secrets in layers → `.dockerignore` excludes `.env`/`.env.*`/`.git`/`.planning`), T-10-03-02 (runtime-only API URL → baked via build ARG), T-10-03-03 (wrong standalone path → verified deep `apps/web/server.js`). No new trust boundaries introduced beyond the plan's threat model.

## Self-Check: PASSED
All four created files and both modified files exist on disk; both task commits present in git history.
