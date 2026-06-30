# Phase 10: Deploy to Hetzner (m1) - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Get the full Rentular stack — Next.js 15 web (SSR, :3000), Hono API (:4000), MySQL/MariaDB, Redis, and BullMQ workers — containerized and live at https://rentular.com on the **m1** host (Hetzner Ubuntu 24.04, `m1.linuxbe.com`), behind the existing nginx + Let's Encrypt TLS. The deliverable is a reachable production deployment that enables real end-to-end UI verification and the deferred Phase 9 bank-connection + email UAT (`09-HUMAN-UAT.md`).

Fixed by ROADMAP (not re-litigated here): Docker for both apps; nginx reverse proxy (`rentular.com` → web :3000, `/api/v1` → api :4000) with existing LE TLS; atomic `releases/<ts>` + `current` symlink deploy model adapted from modulejail; infra (mariadb/redis/mailpit) running on the box; env injected by the process manager (the API does NOT read `.env` itself). Production Ponto Connect mTLS + request-signing is explicitly OUT OF SCOPE (separate work) — prod starts on Ponto **sandbox** (Basic auth).
</domain>

<decisions>
## Implementation Decisions

### Production email delivery
- **D-01:** Keep **Mailpit on m1** for the pre-release launch. The API's `SMTP_HOST` points at `mailpit:1025`; outgoing rent reminders and bank-connection renewal-warning emails are captured (not delivered) and inspected in the Mailpit web UI (:8025). This matches the Phase 9 email UAT, which reads renewal mail from Mailpit.
- **D-02:** Keep `SMTP_*` fully env-driven so switching to a real transactional provider later is a config change (edit secrets file + restart), no code change. Real provider + SPF/DKIM on rentular.com is deferred to go-live.

### Secrets injection
- **D-03:** Single **root-owned `/opt/rentular/.env`** (chmod 600, git-ignored) on the box, injected into the web + api containers via compose `env_file:`. Matches the existing compose `${VAR}` style. This is the workaround for the API not reading `.env` itself — compose puts the vars into the container environment.
- **D-04:** Secret rotation = edit `/opt/rentular/.env` + `docker compose up -d`. The file holds the full ~37-key surface (AUTH_SECRET, PONTO_*, GOCARDLESS_*, DB_*, SMTP_*, etc. — see `.env.example`).

### Deploy trigger
- **D-05:** **Auto git-push→GitHub-webhook→`deploy.sh`** on m1 (the modulejail model), producing an atomic `releases/<ts>` dir + flip of the `current` symlink. Push to the deploy branch auto-deploys.
- **D-06 (critical constraint):** `deploy.sh`'s build gate is **`pnpm build`** (tsup ESM + `next build` — currently green), NOT **`pnpm lint`** (`tsc --noEmit`, which has ~57 pre-existing errors from Phase 2/6 — see `deferred-items.md`). Gating deploy on lint would fail every deploy. Lint debt is tracked separately, not a deploy gate.
- **D-07:** Docker images are **built on the box** inside `deploy.sh` (single-host, no external registry/CI build step). The webhook receiver must be secured (shared secret) like modulejail's `deploy-webhook.php`.

### First-run bootstrap
- **D-08:** A **one-off, idempotent CLI bootstrap script** (e.g. `pnpm bootstrap`) that: (1) runs `drizzle-kit push` to apply the schema, then (2) creates the initial owner/landlord account (email from `ADMIN_EMAIL`, bcrypt password). Re-runnable safely (no-op if owner exists). No seed script exists today — this is net-new.

### Prerequisite bug fixes (fold into this phase per ROADMAP)
- **D-09:** Guard the Stripe client so the API does not crash at boot when `STRIPE_SECRET_KEY` is unset — mirror the existing `isGoCardlessConfigured` pattern. (Stripe is subscription-billing only; prod may launch without it set.)
- **D-10:** Make API env loading reliable in production. Since secrets arrive via container environment (D-03), the app must read `process.env` directly and must not depend on a `.env` file being auto-loaded. Confirm no startup path silently requires a `.env` file.

### Claude's Discretion
- DB in production: containerized MariaDB on m1 via the existing compose service (persistent volume already defined). Planner to ensure a strong `DB_ROOT_PASSWORD`/`DB_PASSWORD` (no compose defaults in prod) and note a backup approach; managed/external DB is not required for pre-release.
- Exact Dockerfile structure (multi-stage, base image, layer caching), healthchecks for web/api services, nginx server-block specifics, and `releases/` retention count.
- Whether workers run as a separate container/process or inside the api container (BullMQ workers auto-start on import in `apps/api/src/index.ts`).
</decisions>

<specifics>
## Specific Ideas

- Borrow modulejail's deploy **philosophy** (git-push webhook → atomic release dir → symlink flip), not its mechanism (modulejail is a static Astro rsync; Rentular is multi-process Docker).
- rentular.com A record must be pointed at m1; nginx + LE TLS automation already exist on the box for sibling domains.
- This deployment is what unblocks `09-HUMAN-UAT.md` (Ponto sandbox→prod E2E, encrypted statements, locale rendering, renewal-email check) — testing is done in production, not localhost.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope (the spec)
- `.planning/ROADMAP.md` § "Phase 10: Deploy to Hetzner (m1)" — fixed scope, host facts, deploy model, in/out of scope. This IS the requirements doc for this phase.

### Existing infra & config to extend
- `docker-compose.yml` — current infra-only compose (mariadb/redis/mailpit); add `web` + `api` services here. No Dockerfiles exist yet.
- `.env.example` — full ~37-key env surface that must be injected into containers.
- `apps/api/package.json` / `apps/web/package.json` — build/start scripts (`api`: `tsup` build → `node dist/index.js`; `web`: `next build` → `next start --port 3000`).

### Prerequisite bug-fix targets
- `apps/api/src/index.ts` — API entrypoint; env-loading + BullMQ worker startup; verify no hard `.env` dependency.
- `apps/api/src/lib/stripe.ts` (and the `isGoCardlessConfigured` pattern it should mirror) — Stripe boot-guard fix.

### Deploy-model reference (external, adapt — do not copy)
- `~/src/modulejail-website/` — `deploy.sh`, `deploy-webhook.php` (git-push→webhook→atomic-release pattern to adapt for the dynamic multi-process case).

### Deferred / carried debt to respect
- `.planning/phases/09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con/deferred-items.md` — pre-existing `pnpm lint` (`tsc --noEmit`) debt; do NOT gate deploy on it (D-06).
- `.planning/phases/09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con/09-HUMAN-UAT.md` — the prod UAT this deploy unblocks.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker-compose.yml`: mariadb:11, redis:7-alpine, mailpit already defined with healthchecks + named volumes — extend, don't replace.
- Build scripts already production-shaped: `apps/api` builds an ESM bundle to `dist/` and runs `node dist/index.js`; `apps/web` uses standard `next build` / `next start`.
- BullMQ workers (email, sms, paymentCheck, landlordReport, bankStatementRetention) auto-start on import of `apps/api/src/index.ts` — running the api process runs the workers.

### Established Patterns
- API reads config from `process.env` only; there is no in-app dotenv loader (confirmed limitation) — secrets MUST be injected by the container runtime.
- Optional integrations are feature-guarded (`isGoCardlessConfigured`) — Stripe should follow the same guard so unset keys don't crash boot.

### Integration Points
- nginx (already on m1) → web :3000 and `/api/v1` → api :4000, TLS via existing LE automation.
- DNS: rentular.com A record → m1.
- First-run: `drizzle-kit push` (schema) + owner bootstrap before the app is usable.
</code_context>

<deferred>
## Deferred Ideas

- Real transactional SMTP provider + SPF/DKIM on rentular.com — at go-live, not pre-release (D-01/D-02).
- Production Ponto Connect mTLS + request-signing in `pontoConnect.ts` — explicitly out of scope per ROADMAP; sandbox Basic auth for now.
- Clearing the ~57-error `pnpm lint` (`tsc --noEmit`) debt — separate cleanup, not a deploy blocker.
- GitHub Actions CI gating (lint/build/test before deploy) — reconsider once lint debt is cleared.
- Managed/external production database + formal backup/restore automation — beyond pre-release single-box scope.

</deferred>

---

*Phase: 10-deploy-to-hetzner-m1-production-deployment*
*Context gathered: 2026-07-01*
