---
quick_id: 261108-shd
type: quick
autonomous: true
---

# Quick Task 261108-shd: Self-hosting documentation that is current, plus public repo clean-up

## Why

A prospective user (Jeroen) wants to self-host Rentular from the public AGPLv3 repo https://github.com/jnuyens/rentular. The repo is current but the docs are not: a self-hoster can start the dev stack but gets stuck on production.

## Audit findings to fix (from a read-only audit, 2026-11-08)

- README.md: wrong clone URL (`rentular/rentular`, must be `jnuyens/rentular`); links to `.nvmrc`/`.node-version` are absolute local paths (/Users/jnuyens/...) and those files do not exist (use the Volta pin and `packageManager` in package.json, or add `.nvmrc` with 20.19.0); lists packages that do not exist (indexation, payments, notifications): list the real ones from the workspace; promises contributing guidelines that do not exist; no production section; does not link infra/cloudflare/inbound-email/README.md, android-app/README.md, apps/mcp-server/README.md.
- .env.example and .env.production.example miss many variables the code reads. Regenerate both from the code (grep process.env across apps/api/src, apps/web, packages, apps/mcp-server, infra): group by area (core URLs and secrets, DB, Redis, auth/OAuth, email, SMS providers, WhatsApp bridge, Signal, Ponto, GoCardless, Stripe, timezone, inbound reply address INBOUND_*, API tokens/MCP, admin bootstrap ADMIN_EMAIL/ADMIN_PASSWORD, test/feature flags). Each with a one-line comment, required vs optional, safe placeholders only, never real values. Remove or mark variables that are listed but never read (SMTP_USER, SMTP_PASSWORD, SMTP_FROM). For SMTP: check apps/api/src/lib/email.ts; if the transport ignores auth, add support for SMTP_USER/SMTP_PASSWORD (and SMTP_SECURE) to the transport (small code change with a unit test), because a self-hoster usually needs an authenticated relay. Keep behaviour unchanged when unset.
- New SELF-HOSTING.md at the repo root, practical and in plain English, covering: requirements (Linux host, Docker or Node 20.19 + pnpm 9.15, MySQL/MariaDB, Redis, SMTP relay, a domain with TLS); two routes: (a) docker-compose.prod.yml with the Dockerfiles (note NEXT_PUBLIC_API_URL is a build arg, ports bind to 127.0.0.1, you need a reverse proxy: give a Caddy example and an nginx example, both routing /api/v1/* to the API and the rest to web), (b) bare Node with PM2 (what rentular.com runs: build web, run API with tsx or the tsup build; give an ecosystem example that loads .env); database: create DB and user, `pnpm db:push` on a fresh DB, warning never to use db:generate/db:migrate (the 0000 baseline is stale), drizzle.config needs DB_PASSWORD; first admin: apps/api/src/scripts/bootstrap.ts with ADMIN_EMAIL/ADMIN_PASSWORD, exact command; background jobs: BullMQ workers run inside the API process, Redis is required, the crons and their schedule timezone (APP_TIMEZONE, default Europe/Brussels); webhooks and redirect URLs to configure at GoCardless, Stripe, Ponto (with mTLS certificate notes), OAuth providers; optional channels (SMS providers, WhatsApp bridge, Signal); the inbound reply address (link the worker README, other mail providers: any inbound route that POSTs the raw message to /api/v1/inbound/email with the X-Inbound-Secret header works); the Android app: it can connect to a self-hosted server but requires the server to run the same RENTULAR_VERSION as rentular.com, and it checks rentular.com, so keep your server updated to the latest release; updating (git pull, pnpm install --frozen-lockfile, db:push only for additive schema changes after reading the release notes, rebuild, restart; back up first); backups (mysqldump example); security notes (AUTH_SECRET and ENCRYPTION key must be strong and stable, never rotate the encryption key without re-encrypting, bind DB/Redis locally). Verify every command and path against the repo; do not invent scripts. Note what is optional for a small landlord running it alone.
- deploy/deploy.sh hardcodes /opt/rentular and describes a compose deploy: either make it configurable via env (RENTULAR_DIR) with a header comment, or document it in SELF-HOSTING.md as an example. Do not touch the m1 prod setup.
- Add a short CONTRIBUTING.md (how to run, tests with vitest, typecheck, Prettier, commit style, AGPL note, the four UI languages EN/NL/FR/DE are required for UI strings).
- Repo hygiene: `git rm -r --cached .claude/worktrees/` (a stray full copy of the repo was committed under .claude/worktrees/agent-ab06049a5750a4593/) and add `.claude/worktrees/` to .gitignore. Do NOT remove .planning/ (the owner decides that separately); do not rewrite history.
- Grep the tracked tree for secrets one more time (report paths only).

## Checks

- api vitest green; apps/api `npx tsc --noEmit -p .`; markdown links in README/SELF-HOSTING/CONTRIBUTING resolve to files that exist (relative links only, no absolute local paths); `docker compose -f docker-compose.prod.yml config` parses if docker is available (skip with a note otherwise).
- No em-dashes or en-dashes anywhere; human tone, no marketing words; no Co-Authored-By lines. Never deploy, never touch prod.
