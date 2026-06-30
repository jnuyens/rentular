# Phase 10: Deploy to Hetzner (m1) - Discussion Log

> **Audit trail only.** Not consumed by planning/research/execution agents. Decisions live in 10-CONTEXT.md.

**Date:** 2026-07-01
**Phase:** 10-deploy-to-hetzner-m1-production-deployment
**Mode:** discuss (default)
**Areas discussed:** Production email delivery, Secrets injection, Deploy trigger, First-run bootstrap

## Gray Areas Presented

User selected all 4 offered areas to discuss.

## Decisions

### Production email delivery
- Options: Mailpit now / SMTP later · Real SMTP from day one · Both env-switchable
- **Chosen:** Mailpit now, SMTP later — keep Mailpit on m1 (capture-only, inspect in :8025 UI), `SMTP_*` env-driven so a real provider is a later config flip. Matches Phase 9 email UAT.

### Secrets injection
- Options: root-owned .env + compose env_file · systemd EnvironmentFile · Docker secrets
- **Chosen:** Root-owned `/opt/rentular/.env` (chmod 600) injected via compose `env_file:`. Rotation = edit file + `compose up -d`. Workaround for API not reading `.env` itself.

### Deploy trigger
- Options: Manual SSH script · Auto git-push→webhook · GitHub Actions → SSH
- **Chosen:** Auto git-push→GitHub-webhook→`deploy.sh` (modulejail model), atomic `releases/<ts>` + `current` symlink.
- **Derived constraint:** `deploy.sh` gates on `pnpm build` (green), NOT `pnpm lint` (~57 pre-existing errors). Build on the box (no external registry). Secure the webhook with a shared secret.

### First-run bootstrap
- Options: One-off CLI script · Env-seeded admin on boot · Manual push + SQL
- **Chosen:** Idempotent `pnpm bootstrap` CLI — `drizzle-kit push` + create owner (`ADMIN_EMAIL` + bcrypt password), re-runnable. Net-new (no seed script today).

## Claude's Discretion (locked defaults, not asked)
- Containerized MariaDB on m1 (existing compose service + volume); strong prod passwords, note backups.
- Dockerfile structure, healthchecks, nginx server-block specifics, `releases/` retention.
- Whether BullMQ workers run in-api-process or as a separate container.

## Prerequisite bug fixes folded in (per ROADMAP)
- Stripe boot-guard (mirror `isGoCardlessConfigured`).
- Reliable API env loading from container environment (no `.env` file dependency).

## Deferred Ideas
- Real SMTP + SPF/DKIM at go-live; production Ponto mTLS/request-signing; clearing lint debt; GitHub Actions gating; managed DB + backup automation.

## No corrections — all decisions captured in one pass.
