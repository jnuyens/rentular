# Phase 10: Deploy to Hetzner (m1) — Research

**Researched:** 2026-07-01
**Domain:** Production deployment — Docker multi-stage builds (Next.js 15 standalone + Hono/tsup ESM), pnpm/Turbo monorepo, nginx reverse proxy behind Let's Encrypt, git-push→webhook atomic-release deploy, first-run bootstrap
**Confidence:** HIGH for codebase facts and Docker/Next.js patterns; MEDIUM for the atomic-release↔docker-compose reconciliation (design choice, not a single canonical answer)

## Summary

This phase containerizes an existing, production-shaped monorepo and ships it to a single Ubuntu 24.04 box (`m1`) that already runs nginx + Let's Encrypt for sibling domains. The apps are already build-ready: `apps/api` produces an ESM bundle (`tsup` → `node dist/index.js`) and `apps/web` uses stock `next build`/`next start`. The genuine work is (1) writing two multi-stage Dockerfiles that survive the well-known **pnpm-symlink + Next.js standalone** trap in a Turbo monorepo, (2) extending the existing infra-only `docker-compose.yml` with `web` + `api` services, (3) an nginx server block + DNS, (4) a secured GitHub-webhook → `deploy.sh` that builds on the box and flips a `current` symlink, and (5) an idempotent bootstrap (schema push + owner creation). Two small code fixes are folded in: a Stripe boot-guard and confirming the API reads only `process.env`.

The single highest-risk item is **`NEXT_PUBLIC_API_URL`**: it is inlined into the JS bundle at `next build` time (Next.js statically replaces every `process.env.NEXT_PUBLIC_*` reference — in **both** server and client components). It is referenced in 30+ files across the web app. It must therefore be passed as a **Docker build ARG** (not a runtime `env_file` var) with the production value `https://rentular.com/api/v1`. A runtime-only injection will silently leave the browser calling `http://localhost:4000`. This is the pitfall most likely to produce a "deploys green, app broken" outcome.

**Primary recommendation:** Two multi-stage Dockerfiles using `output: 'standalone'` + `outputFileTracingRoot` set to the monorepo root; `turbo prune --docker` to trim each app's dependency closure; bind web/api container ports to `127.0.0.1` only (nginx proxies locally); pass `NEXT_PUBLIC_API_URL` as a build ARG; run `drizzle-kit push` + owner bootstrap as a one-shot compose step inside `deploy.sh` before restarting services; gate the deploy on `pnpm build` (never `pnpm lint`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TLS termination | nginx (host) | — | Existing LE automation on m1; containers stay plain HTTP behind it |
| Public routing (`/` vs `/api/v1`) | nginx (host) | — | Reverse proxy splits SSR traffic (web:3000) from API (api:4000) |
| SSR + browser UI | Frontend server (web container) | Browser | Next.js standalone server renders + hydrates; browser makes XHR to the API |
| Business logic / REST | API (api container) | — | Hono app on :4000, mounted at `/api/v1` |
| Background jobs (email/SMS/cron) | API (api container) | — | BullMQ workers auto-start on import of `apps/api/src/index.ts` — same process as the API |
| Persistence | Database (mariadb container) | — | Existing compose service + named volume |
| Queue backend | Redis (redis container) | — | Existing compose service |
| Secrets injection | Host (`/opt/rentular/.env`) | compose `env_file`/`build.args` | Root-owned 600 file; runtime env for API, build ARG for NEXT_PUBLIC_* |
| Deploy orchestration | Host (`deploy.sh` + webhook) | Docker Compose | Build-on-box, atomic release dir, symlink flip, `compose up -d` |

## Standard Stack

This phase adds **no new npm dependencies**. It adds infrastructure artifacts (Dockerfiles, `.dockerignore`, an nginx server block, `deploy.sh`, a webhook receiver) and reuses tools already in the tree.

### Core (already present — versions verified in package.json)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Node.js | 20.19.0 (`volta`, engines `>=20`) | Runtime + Docker base image tag | Matches project pin; use `node:20-slim` or `node:20-alpine` base [CITED: package.json] |
| pnpm | 9.15.0 | Monorepo install in builder stage | `packageManager` pin — Corepack-activatable in Docker [CITED: package.json] |
| Turbo | 2.3.0 | `turbo prune --docker` to trim per-app dep closure | Official Turborepo Docker workflow [CITED: turbo.build/repo/docs/guides/tools/docker] |
| Next.js | 15.1.0 | `output: 'standalone'` build | Standalone is the self-host-in-Docker path [CITED: nextjs.org] |
| tsup | 8.3.0 | API ESM bundle → `dist/index.js` | Already the API build; `node dist/index.js` runs it [CITED: apps/api/package.json] |
| drizzle-kit | 0.31.9 | `db:push` for first-run schema | Already the db package's migration tool [CITED: packages/db/package.json] |
| bcrypt | 5.1.0 | Owner-password hash in bootstrap | Mirrors `apps/api/src/routes/auth.ts` register logic [CITED: apps/api/src/routes/auth.ts] |

### Supporting (infrastructure — host-level, choose during planning)
| Component | Recommendation | Purpose | When to Use |
|-----------|---------------|---------|-------------|
| Webhook receiver | Small Node/PHP endpoint OR `webhook` (adnanh/webhook) binary | Receive GitHub push, verify HMAC, exec `deploy.sh` | modulejail uses a PHP receiver; match host conventions [ASSUMED] |
| Base image | `node:20-slim` (Debian) | bcrypt/native modules build cleanly | Alpine (musl) can require extra build deps for bcrypt/`node-gyp` [ASSUMED] |
| Compose | Docker Compose v2 (`docker compose`) | Orchestrate 5 services | Already the project's model (`docker-compose.yml`) [VERIFIED: docker-compose.yml] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bcrypt (native) | bcryptjs (pure JS) | Avoids native-build friction in Alpine, but changes a dependency; not needed with `node:20-slim` |
| Build on box | External registry + CI build | CONTEXT D-07 locks build-on-box (single host, no registry); revisit at go-live |
| `next start` standalone | `next start` (non-standalone) | Non-standalone requires copying full `node_modules` into the runner — larger image, slower; standalone is the recommended path |
| Separate worker container | Workers inside api container | CONTEXT leaves this to discretion — see Pitfall 4 |

**Installation:** No `npm install` of new packages. Docker/Compose assumed present on m1 (verify — see Environment Availability).

## Package Legitimacy Audit

No external npm packages are added by this phase. All tooling (Docker, Compose, pnpm, Turbo, drizzle-kit, bcrypt) is already pinned in the repo or is host-level infrastructure. **Package Legitimacy Gate: N/A — no new registry installs.** If the planner decides to add a dedicated webhook library (e.g. `adnanh/webhook`, a Go binary — not npm) or `bcryptjs`, run slopcheck on that single package before adoption.

## Architecture Patterns

### System Architecture Diagram

```
                          Internet (https://rentular.com)
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │  nginx (host m1)                │
                    │  - LE TLS termination           │
                    │  - X-Forwarded-Proto: https     │
                    └───────┬───────────────┬─────────┘
                       /    │               │ /api/v1/*
                            ▼               ▼
                 127.0.0.1:3000        127.0.0.1:4000
              ┌──────────────────┐  ┌──────────────────────────┐
              │ web (Next 15     │  │ api (Hono :4000)          │
              │ standalone SSR)  │  │  - REST /api/v1/*         │
              │  browser bundle  │  │  - BullMQ workers (import)│
              │  baked NEXT_     │  │    email/sms/cron         │
              │  PUBLIC_API_URL  │  └───────┬───────────┬───────┘
              └──────────────────┘          │           │
                                            ▼           ▼
                                     mariadb:3306   redis:6379
                                     (named vol)    (named vol)
                                            │
                                            ▼  (SMTP :1025)
                                      mailpit (capture, :8025 UI)

  Browser XHR ──► https://rentular.com/api/v1 ──► nginx ──► api
  SSR fetch  ──► (baked) https://rentular.com/api/v1 ──► nginx ──► api  (hairpin — see Pitfall 2)

  Deploy: git push ─► GitHub webhook (HMAC) ─► receiver on m1 ─► deploy.sh
          ─► git fetch into releases/<ts> ─► symlink current ─► docker compose build+up -d
          ─► one-shot: drizzle-kit push + owner bootstrap
```

### Recommended Layout (new artifacts)
```
apps/web/Dockerfile          # multi-stage: prune → deps → build (standalone) → runner
apps/api/Dockerfile          # multi-stage: prune → deps → tsup build → runner (node dist)
.dockerignore                # exclude node_modules, .next, .git, .planning, .env
docker-compose.yml           # EXTEND: add web + api services (bind 127.0.0.1)
apps/api/src/scripts/bootstrap.ts   # idempotent: schema push trigger + owner create
deploy/deploy.sh             # build-on-box, releases/<ts>, symlink flip, compose up
deploy/webhook-receiver.*    # HMAC-verified GitHub push receiver
deploy/nginx/rentular.conf   # server block (reference; installed on host)
```

### Pattern 1: Next.js standalone in a pnpm/Turbo monorepo
**What:** Set `output: 'standalone'` and `outputFileTracingRoot` to the workspace root so Next's file-tracer pulls in the `@rentular/db` and `@rentular/shared` workspace packages. Build with `turbo prune --docker` to produce a minimal dependency closure.
**When to use:** Always for this deployment.
**Example:**
```ts
// apps/web/next.config.ts — Source: nextjs.org output-file-tracing + vercel/next.js#78446
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./lib/i18n.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo root so NFT traces workspace deps (@rentular/db, @rentular/shared)
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@rentular/db", "@rentular/shared"],
};

export default withNextIntl(nextConfig);
```
```dockerfile
# apps/web/Dockerfile (sketch) — Source: turbo.build docker guide + dev.to pnpm-standalone
FROM node:20-slim AS base
RUN corepack enable
# --- prune ---
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.3.0 prune @rentular/web --docker
# --- deps + build ---
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG NEXT_PUBLIC_API_URL          # <-- baked at build time (see Pitfall 1)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @rentular/web build
# --- runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
# standalone server path is nested under apps/web in a monorepo build
CMD ["node", "apps/web/server.js"]
```
Note the **deep `server.js` path** (`apps/web/server.js`, not `server.js`) — a documented Turborepo standalone gotcha [CITED: github.com/vercel/next.js/issues/78446].

### Pattern 2: Hono/tsup API image
**What:** Build the ESM bundle in a builder stage, run `node dist/index.js` in a slim runner. Because tsup bundles, the runner needs only production `node_modules` for un-bundled native deps (bcrypt, mysql2, ioredis). Use `turbo prune @rentular/api --docker` + `pnpm install --prod` in the runner, or copy the pruned install.
**When to use:** Always.
**Key detail:** The API's BullMQ workers start on import of `index.ts` — running the container runs the workers. No separate command needed unless splitting workers out (Pitfall 4).

### Pattern 3: Compose service wiring (extend existing file)
```yaml
# docker-compose.yml additions (sketch) — bind to loopback, use internal network names
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file: /opt/rentular/.env
    environment:
      DB_HOST: mariadb          # internal service name, not localhost
      REDIS_URL: redis://redis:6379
    ports:
      - "127.0.0.1:4000:4000"   # nginx proxies locally; NOT public
    depends_on:
      mariadb: { condition: service_healthy }
      redis:   { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}   # build-time bake
    restart: unless-stopped
    env_file: /opt/rentular/.env
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      api: { condition: service_started }
```
The API's existing `/api/v1/health` endpoint checks DB + Redis and returns 200/503 — reuse it as the container healthcheck AND the deploy smoke test [VERIFIED: apps/api/src/index.ts lines 104-135].

### Anti-Patterns to Avoid
- **Injecting `NEXT_PUBLIC_API_URL` via `env_file` only** — it is inlined at build; runtime injection is ignored by the browser bundle. Must be a `build.args`.
- **Publishing web/api on `0.0.0.0`** — exposes the app-tier directly, bypassing nginx/TLS. Bind `127.0.0.1`. Also re-scope the existing mariadb `0.0.0.0:3306` publish for prod (Pitfall 6).
- **Gating deploy on `pnpm lint`** — ~57 pre-existing `tsc --noEmit` errors would fail every deploy (D-06). Gate on `pnpm build`.
- **`localhost` inside containers for cross-service calls** — use compose service names (`mariadb`, `redis`).
- **Alpine base for a bcrypt-carrying image without build deps** — musl + native build friction; prefer `node:20-slim`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monorepo dep pruning for Docker | Manual copy of node_modules | `turbo prune --docker` | Correctly resolves the workspace dep closure + lockfile |
| Standalone tracing | Hand-copying workspace packages | `output: 'standalone'` + `outputFileTracingRoot` | NFT computes the exact runtime file set |
| Webhook auth | Compare a plaintext `?token=` | GitHub HMAC-SHA256 `X-Hub-Signature-256` verify | Constant-time signature check; standard GitHub scheme |
| TLS | New certbot config | Existing LE automation on m1 | Sibling domains already automated; just add server block |
| Schema apply | Hand-written SQL | `drizzle-kit push` | Already the project's migration path |
| Owner creation | Ad-hoc SQL insert | Reuse register logic (crypto.randomUUID + bcrypt.hash) | Matches `apps/api/src/routes/auth.ts` exactly |

**Key insight:** Every hard part here already has a first-party tool in the repo. The failure mode is not "missing library" — it is misconfiguration (build-time vs runtime env, symlink tracing, loopback binding).

## Common Pitfalls

### Pitfall 1: `NEXT_PUBLIC_API_URL` baked at build, referenced in 30+ files
**What goes wrong:** App deploys, homepage renders, but every API call goes to `http://localhost:4000` (the `.env.example` fallback). Browser sees connection refused / CORS failures.
**Why it happens:** Next.js statically inlines `process.env.NEXT_PUBLIC_*` at `next build` in both server and client code. `env_file` (runtime) injection does not reach the already-compiled bundle.
**How to avoid:** Pass `NEXT_PUBLIC_API_URL=https://rentular.com/api/v1` as a Docker **build ARG** (compose `build.args`), sourced from the host env at build time. Because there is exactly one environment (prod), build-time baking is correct and simplest — no `next-runtime-env` needed.
**Warning signs:** DevTools Network tab shows requests to `localhost:4000`; `grep -r localhost:4000 apps/web/.next` after build.
[VERIFIED: apps/web codebase — 30+ files reference `process.env.NEXT_PUBLIC_API_URL`; CITED: nextjs.org env guide]

### Pitfall 1b: Inconsistent fallback defaults for the API URL
**What goes wrong:** Different files default differently — some to `http://localhost:4000` and some to `http://localhost:4000/api/v1`. If the prod value's `/api/v1` suffix convention doesn't match what a caller appends, you get `/api/v1/api/v1/...` or a missing prefix.
**How to avoid:** Set the prod value to match the established `.env.example` convention: `NEXT_PUBLIC_API_URL=https://rentular.com/api/v1` (includes `/api/v1`). Verification must check **actual network calls**, not just that the var is set.
[VERIFIED: grep of apps/web shows both `:4000` and `:4000/api/v1` fallbacks]

### Pitfall 2: SSR hairpin through the public hostname
**What goes wrong:** Because the single baked `NEXT_PUBLIC_API_URL` is also read in server components (e.g. `app/(dashboard)/layout.tsx`), SSR fetches go container→`rentular.com`→nginx→api container (a "hairpin"). If the web container can't resolve public DNS, or nginx blocks it, SSR pages fail while client calls work (or vice-versa).
**Why it happens:** One env var serves both browser and SSR contexts.
**How to avoid:** Simplest: ensure the web container has outbound DNS/HTTP to `rentular.com` (default bridge network allows this). If hairpin latency/DNS is a concern, add a compose `extra_hosts: ["rentular.com:<host-ip>"]` or split into an internal SSR URL — but only if a problem surfaces. Document the hairpin so the verifier tests **both** an SSR-rendered page and a client XHR.
[VERIFIED: `app/(dashboard)/layout.tsx` reads the var server-side]

### Pitfall 3: pnpm symlinks break in the standalone runner
**What goes wrong:** `Cannot find module` at container start. pnpm's symlinked `node_modules` are copied as dangling links into `.next/standalone`; targets don't exist in the runner stage.
**How to avoid:** Use `turbo prune --docker` + `output: 'standalone'` + `outputFileTracingRoot` at the monorepo root; copy `.next/standalone`, `.next/static`, and `public` with the correct nested paths. Verify the standalone `server.js` path is `apps/web/server.js`.
[CITED: dev.to/kochan pnpm-nextjs-standalone; github.com/vercel/next.js/issues/78446]

### Pitfall 4: BullMQ workers — same container vs separate
**What goes wrong:** Running multiple api replicas would run duplicate cron schedulers (double emails). Conversely, splitting workers into their own container means they don't import the HTTP routes but must still import the queue/worker modules.
**Why it happens:** Workers auto-start on import of `apps/api/src/index.ts`; cron schedules (`setupPaymentCheckSchedule`, etc.) register repeatable jobs.
**How to avoid (recommendation):** For a single-box pre-release, run **one api container** (workers in-process) — simplest, matches current design. Do **not** scale the api service to >1 replica without first extracting workers to a dedicated single-instance container. Document this constraint.
[VERIFIED: apps/api/src/index.ts lines 158-179]

### Pitfall 5: Bootstrap needs drizzle-kit + bcrypt, which the pruned runtime image may lack
**What goes wrong:** `drizzle-kit` is a devDependency of `@rentular/db`; a `--prod` runner image won't have it. `db:push` fails.
**How to avoid:** Run the bootstrap as a **one-shot step in `deploy.sh` using the build tree** (the `releases/<ts>` checkout already has a full `pnpm install` from the build), OR `docker compose run --rm` a short-lived container built from a stage that retains devDeps. Command: `pnpm --filter @rentular/db exec drizzle-kit push` against the mariadb service, then run `apps/api/src/scripts/bootstrap.ts` via `tsx`. Make it idempotent: `SELECT` the owner email first, no-op if present. Owner creation must mirror `auth.ts`: `crypto.randomUUID()` id + `bcrypt.hash(password, ROUNDS)` into `users`.
[VERIFIED: packages/db/package.json devDeps; apps/api/src/routes/auth.ts:50-57]

### Pitfall 6: Existing compose publishes DB/Redis on all interfaces + default passwords
**What goes wrong:** Current `docker-compose.yml` publishes `mariadb:3306` and `redis:6379` to the host (default `0.0.0.0`) with fallback passwords (`rootpassword`, `rentular`). On a public VPS this is exposed.
**How to avoid:** In prod, bind these to `127.0.0.1` or drop the `ports:` publish entirely (containers reach each other on the compose network). Require strong `DB_ROOT_PASSWORD`/`DB_PASSWORD` from `/opt/rentular/.env` — no compose defaults in prod (matches CONTEXT "Claude's Discretion" on DB).
[VERIFIED: docker-compose.yml lines 13-14, 27-28, 9-12]

### Pitfall 7: nginx must forward `X-Forwarded-Proto: https` for NextAuth
**What goes wrong:** NextAuth v5 behind a proxy issues insecure cookies / wrong callback URLs if the proto header is missing.
**How to avoid:** Standard proxy headers in the server block. Good news: `apps/web/lib/auth.ts` already sets `trustHost: true` (line 87), so with correct headers NextAuth honours the forwarded host. Ensure `AUTH_URL=https://rentular.com` and `AUTH_SECRET` are set in `/opt/rentular/.env`.
[VERIFIED: apps/web/lib/auth.ts:87 `trustHost: true`]

### Pitfall 8: "Atomic symlink" semantics differ for a container app
**What goes wrong:** For static rsync (modulejail), flipping `current` instantly swaps served files. For Docker, the *running containers* are the live artifact, not the file tree — flipping the symlink alone changes nothing until `docker compose up -d --build` recreates containers, which has a brief recreate gap (not truly zero-downtime with plain compose).
**How to avoid:** Treat `releases/<ts>` + `current` as the **source-of-record + rollback mechanism**: check out to `releases/<ts>`, flip `current`, run `docker compose -f current/docker-compose.yml build && up -d`. Rollback = flip symlink to previous release + `up -d --build`. Accept the sub-second recreate gap for pre-release; if true zero-downtime is later required, adopt `docker-rollout` or blue-green. Prune old `releases/` beyond a retention count (e.g. keep 5).
[CITED: launchdeck.io atomic-git; github.com/wowu/docker-rollout — MEDIUM confidence, design choice]

## Code Examples

### Stripe boot-guard (D-09) — mirror isGoCardlessConfigured
The API currently does `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "")` at **module top-level** in `apps/api/src/routes/stripe.ts:4`. This router is imported by `index.ts`, so it executes at boot. An empty key can throw depending on SDK version. Mirror the gocardless guard:
```ts
// apps/api/src/lib/gocardless.ts (existing pattern) — Source: repo
export function isGoCardlessConfigured(): boolean {
  return !!process.env.GOCARDLESS_ACCESS_TOKEN;
}
export function getGoCardlessClient(): GoCardlessClient {
  const accessToken = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!accessToken) throw new Error("GOCARDLESS_ACCESS_TOKEN is not set. Configure it in your environment.");
  // ...lazy init
}
```
Apply the same shape to Stripe: add `isStripeConfigured()`, make the client **lazily constructed** inside handlers instead of at module load, so an unset `STRIPE_SECRET_KEY` never runs `new Stripe()` at import. The `/plans` handler already guards on `!process.env.STRIPE_SECRET_KEY` (returns static fallback) — extend that lazy pattern to checkout/subscription handlers.
[VERIFIED: apps/api/src/routes/stripe.ts:4,24-25; apps/api/src/lib/gocardless.ts:47-67]

### API env loading (D-10) — confirmed no `.env` dependency
`apps/api/src/index.ts` reads config exclusively via `process.env.*` (ALLOWED_ORIGINS, WEB_URL, REDIS_URL, API_PORT, EMAIL_RATE_LIMIT, etc.). There is **no `dotenv`/`dotenv/config` import** anywhere in the entrypoint or its imports. **Confirmed: the API does not require a `.env` file** — container-injected env is sufficient. The fix is therefore verification + ensuring compose `env_file` injects the full surface, not a code change. (Note: the API is not started with `--env-file` today; that's fine — compose provides the env.)
[VERIFIED: grep of apps/api/src/index.ts — no dotenv; all config via process.env]

### GitHub webhook HMAC verification (receiver)
```
# Verify X-Hub-Signature-256 against a shared secret (constant-time)
# expected = "sha256=" + HMAC_SHA256(secret, raw_request_body)
# Reject if header missing or mismatch; only then exec deploy.sh on the deploy branch.
```
Match the modulejail model (`deploy-webhook.php` used a shared secret). Store the webhook secret in `/opt/rentular/.env`, verify the full raw body, and restrict the branch to the deploy branch.
[CITED: docs.github.com/webhooks/securing — ASSUMED exact modulejail impl not read]

### deploy.sh gate (D-06)
```bash
set -euo pipefail
# ... checkout into releases/$TS, flip current symlink ...
pnpm install --frozen-lockfile
pnpm build            # tsup + next build — the deploy GATE. NOT pnpm lint.
docker compose -f current/docker-compose.yml build
docker compose -f current/docker-compose.yml up -d
# one-shot bootstrap (idempotent): drizzle-kit push + owner create
```
[VERIFIED: root package.json build=turbo build; CONTEXT D-06]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copy whole `node_modules` into runner | `output: 'standalone'` + NFT tracing | Next.js 12+ | Smaller images; the standard self-host path |
| Manual monorepo dep copy | `turbo prune --docker` | Turbo 1.x+ | Reproducible minimal builds |
| Runtime NEXT_PUBLIC via envsubst hacks | Build-time ARG (single env) or `next-runtime-env` (multi env) | ongoing | For one prod env, build ARG is correct and simplest |

**Deprecated/outdated:** `version: "3.8"` top key in `docker-compose.yml` is obsolete in Compose v2 (ignored, harmless). Can drop it when editing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `node:20-slim` builds bcrypt/mysql2 without extra apt deps | Standard Stack | Build fails; add `python3 make g++` to builder stage or use bcryptjs |
| A2 | modulejail's webhook receiver is PHP with a shared secret (not read this session) | Don't Hand-Roll / Code Examples | Receiver impl differs; verify by reading `~/src/modulejail-website` deploy files during planning |
| A3 | Docker + Compose v2 are installed on m1 | Environment Availability | Deploy blocked until installed (apt) |
| A4 | Build-time `NEXT_PUBLIC_API_URL` bake is acceptable (single prod env) | Pitfall 1 | If multiple envs later needed, adopt `next-runtime-env` |
| A5 | Web container has outbound DNS to `rentular.com` for SSR hairpin | Pitfall 2 | SSR pages fail; add `extra_hosts` or internal SSR URL |
| A6 | `new Stripe("")` at import can throw at boot in stripe@20 | Code Examples (D-09) | If it never throws, the guard is still correct hygiene, no harm |
| A7 | The deploy branch is `main` (git status shows current branch main) | deploy.sh | Wrong branch auto-deploys; confirm deploy branch with user |

**These `[ASSUMED]` items should be confirmed before or during planning.**

## Open Questions (RESOLVED)

1. **Webhook receiver technology on m1**
   - RESOLVED: Use a small self-contained Node listener (`deploy/webhook-receiver.mjs`) rather than PHP-FPM, so the receiver is independent of host PHP state and ships in-repo. Nginx proxies a dedicated location to it; HMAC-verified. (Plan 10-05 Task 2.)
   - What we know: modulejail uses a PHP receiver behind nginx with a shared secret.

2. **Which git branch triggers deploy**
   - RESOLVED: `main` (Plan 10-05 Task 1 + Plan 10-06 Task 1; operator confirms A7 on the box). Deploy on push to `main` only.

3. **`releases/` retention count**
   - RESOLVED: Keep the newest 5; `deploy.sh` prunes older releases (Plan 10-05 Task 1).

4. **DB backup approach (Claude's discretion in CONTEXT)**
   - RESOLVED: Nightly `mariadb-dump` cron to a host path for pre-release; formal restore automation deferred (CONTEXT § Claude's Discretion).

## Environment Availability

> This phase depends on host tooling on m1. Verify on the box during planning/execution.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | Container runtime | ? (verify on m1) | — | Install via apt (`docker-ce`) |
| Docker Compose v2 | Orchestration | ? (verify on m1) | — | `docker-compose-plugin` |
| nginx | Reverse proxy | ✓ (existing, sibling domains) | — | — |
| Let's Encrypt automation | TLS | ✓ (existing) | — | certbot for rentular.com |
| Node/pnpm on box | build-on-box (`deploy.sh`) | ? (Corepack/pnpm) | — | Build inside a Docker builder stage (no host Node needed) |
| DNS control for rentular.com | Public reachability | ? (verify A record) | — | Point A record → m1 IP |
| GitHub webhook reachability | Auto-deploy | needs public endpoint on m1 | — | Manual `deploy.sh` run |

**Missing dependencies with no fallback:** rentular.com A record → m1 (must be set for TLS issuance + reachability).
**Missing dependencies with fallback:** Host Node/pnpm (can build entirely inside Docker); manual deploy trigger if webhook not yet wired.

*Local (macOS dev) probing is not meaningful here — these must be verified on the m1 host. Treat availability as unknown until checked on the box.*

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (api), plus deployment smoke checks (curl-based) |
| Config file | `apps/api` has vitest; deployment has no test config yet |
| Quick run command | `pnpm --filter @rentular/api test` (unit) |
| Full suite command | `pnpm build` (the deploy gate) + smoke checks below |

**Note:** This is an infrastructure phase — the primary validation is **observable deployment signals**, not new unit tests. The existing 67 vitest tests + `pnpm build` green are prerequisites; the deploy proof is HTTP-observable.

### Phase Requirements → Test Map (derived from goal + CONTEXT)
| Req (derived) | Behavior | Test Type | Automated Command | Exists? |
|---------------|----------|-----------|-------------------|---------|
| D-goal | Site reachable over HTTPS | smoke | `curl -sSf -o /dev/null -w '%{http_code}' https://rentular.com` → 200 | ❌ Wave 0 |
| D-goal | Valid TLS cert (LE) | smoke | `echo \| openssl s_client -connect rentular.com:443 -servername rentular.com 2>/dev/null \| openssl x509 -noout -dates` | ❌ Wave 0 |
| D-goal | API healthy (DB+Redis) | smoke | `curl -sSf https://rentular.com/api/v1/health` → `status:healthy` 200 | ✅ endpoint exists |
| D-goal | Browser calls hit prod API (not localhost) | smoke | `curl -s https://rentular.com \| grep -c 'localhost:4000'` → 0 | ❌ Wave 0 |
| D-08 | Owner login works | smoke/e2e | POST credentials → session cookie set | ❌ Wave 0 |
| D-08 | Bootstrap is idempotent | integration | Run bootstrap twice → second run no-op, exit 0 | ❌ Wave 0 |
| D-09 | API boots with STRIPE_SECRET_KEY unset | unit/smoke | Container starts, `/health` 200 with no Stripe key | ❌ Wave 0 |
| D-01 | Outgoing mail captured in Mailpit | manual | Trigger email → visible at :8025 | manual (matches 09 UAT) |
| Compose | web/api healthchecks pass | smoke | `docker compose ps` → all `healthy`/`running` | ❌ Wave 0 |
| Deploy | Push → webhook → new release live | smoke | push → new `releases/<ts>`, `current` flipped, containers recreated | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm build` (build gate) + `pnpm --filter @rentular/api test`
- **Per wave merge:** Full `pnpm build` + container `docker compose config` lint
- **Phase gate:** All smoke checks green against the live m1 deployment before `/gsd:verify-work`; unblocks `09-HUMAN-UAT.md`.

### Wave 0 Gaps
- [ ] A deploy smoke-check script (`deploy/smoke.sh`) — HTTPS 200, `/api/v1/health` healthy, TLS dates, no-`localhost:4000` in HTML
- [ ] Stripe boot-guard unit/smoke (D-09) proving unset-key boot
- [ ] Bootstrap idempotency check (run-twice)
- [ ] No new test *framework* install needed (vitest present)

## Security Domain

> `security_enforcement` not set in config.json → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | App tier bound to 127.0.0.1; nginx sole public ingress; secrets in root-600 file |
| V2 Authentication | yes | Owner bootstrap uses bcrypt (existing rounds); AUTH_SECRET set; NextAuth `trustHost` |
| V6 Cryptography | yes | TLS via LE (never self-signed); webhook HMAC-SHA256 constant-time compare |
| V7 Error/Logging | partial | Don't leak secrets in deploy logs; avoid echoing `/opt/rentular/.env` |
| V8 Data Protection | yes | `/opt/rentular/.env` chmod 600 root-owned; DB volume on-box; strong DB passwords |
| V9 Communications | yes | HTTP only behind nginx; HSTS optional; secure cookies via X-Forwarded-Proto |
| V13 API/Webhook | yes | GitHub webhook signature verification; GoCardless/Stripe webhook secrets already in code |
| V14 Configuration | yes | No default DB passwords in prod; least-exposed ports; `.dockerignore` excludes `.env`/`.git` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Publicly exposed DB/Redis (0.0.0.0 publish) | Info Disclosure / Tampering | Bind 127.0.0.1 or drop `ports:`; strong passwords (Pitfall 6) |
| Unauthenticated deploy webhook → RCE | Elevation of Privilege | HMAC-SHA256 signature verify + branch allowlist |
| Secrets baked into image layers | Info Disclosure | `.dockerignore` excludes `.env`; use runtime `env_file`; only NEXT_PUBLIC_* (non-secret) as build ARG |
| Insecure auth cookies behind proxy | Spoofing | Forward `X-Forwarded-Proto: https`; `trustHost` + `AUTH_URL=https://rentular.com` |
| Default/weak MariaDB root password | Elevation of Privilege | Require strong `DB_ROOT_PASSWORD` from secrets file; no compose default in prod |
| Deploy logs leaking env | Info Disclosure | Never `cat`/`echo` the secrets file in `deploy.sh` |

## Sources

### Primary (HIGH confidence)
- Repo files (VERIFIED this session): `docker-compose.yml`, `.env.example`, `apps/api/src/index.ts`, `apps/api/src/routes/stripe.ts`, `apps/api/src/lib/gocardless.ts`, `apps/api/src/routes/auth.ts`, `apps/web/next.config.ts`, `apps/web/lib/auth.ts`, `apps/web/package.json`, `apps/api/package.json`, `packages/db/*`, root `package.json`, CONTEXT.md, ROADMAP Phase 10, 09 deferred-items.md
- Next.js docs — Environment Variables guide, output file tracing / standalone (nextjs.org)
- Turborepo Docker guide — `turbo prune --docker` (turbo.build)

### Secondary (MEDIUM confidence)
- github.com/vercel/next.js/issues/78446 — standalone `server.js` deep path in Turborepo
- dev.to/kochan — "pnpm + Next.js Standalone + Docker: 5 Failures" (symlink trap)
- launchdeck.io / github.com/wowu/docker-rollout — atomic git deploy + zero-downtime compose patterns
- github.com/vercel/next.js/discussions/44628, #17641 — NEXT_PUBLIC build-time inlining

### Tertiary (LOW confidence — flagged for validation)
- Exact modulejail webhook receiver implementation (not read this session — see A2)
- m1 host tooling availability (must verify on box)

## Metadata

**Confidence breakdown:**
- Codebase facts (env loading, Stripe location, workers, NEXT_PUBLIC usage, health endpoint): HIGH — read directly
- Next.js standalone + pnpm/Turbo Docker pattern: HIGH — official docs + corroborating community sources
- Atomic-release ↔ docker-compose reconciliation: MEDIUM — design choice, multiple valid patterns
- Webhook receiver specifics + host environment: LOW — must confirm on m1 / in modulejail repo

**Research date:** 2026-07-01
**Valid until:** ~2026-07-31 (Next.js/Turbo/Docker patterns are stable; verify m1 host state at execution)
