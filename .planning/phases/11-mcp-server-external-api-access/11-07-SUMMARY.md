---
phase: 11-mcp-server-external-api-access
plan: 07
subsystem: db-migration-deploy
tags: [drizzle, mariadb, production-deploy, pat, bearer-auth, m1, pm2]
status: complete

# Dependency graph
requires:
  - phase: 11-mcp-server-external-api-access
    plan: 04
    provides: "Bearer rtl_ pipeline, requireWriteScope, rate limit, api_tool_calls audit insert"
  - phase: 11-mcp-server-external-api-access
    plan: 05
    provides: "Settings API tokens UI"
  - phase: 11-mcp-server-external-api-access
    plan: 06
    provides: "@rentular/mcp-server package"
provides:
  - "api_tokens and api_tool_calls tables live in the production MariaDB rentular database on m1"
  - "API_TOKEN_PEPPER and API_TOKEN_RATE_LIMIT_PER_MINUTE set in the m1 PM2 environment"
  - "Phase 11 code deployed and running on m1 (api via tsx, web via next start), Bearer pipeline verified fail-closed"
affects: []

tech-stack:
  - drizzle-kit generate (inspection only, not committed)
  - MariaDB 10.11 (production)
  - PM2 (ecosystem.config.cjs, env from .env)
---

## Outcome

Plan 11-07 (BLOCKING checkpoint) is resolved: the two Phase 11 tables are live in the production database on m1, the token secrets are set, and the full Phase 11 code is deployed and serving.

Because this is a human-action / production-access gate, the automatable part (migration generation + inspection) ran as a subagent and the production apply + deploy were carried out directly against m1 after an explicit user decision at the checkpoint.

## Decision at the checkpoint (user-approved)

The plan assumed a committable additive `0001_api_tokens.sql` applied with `drizzle-kit migrate`. That is not safe in this repo: the `0000` Drizzle snapshot is stale (phases 2-9 maintained the production schema with `db:push`, not migration files), so `drizzle-kit generate` replays a large non-additive backlog (8 CREATE TABLE for tables that already exist in prod, 20+ ALTER TABLE). Running that through `db:migrate` would fail or corrupt production.

User chose **Option A** (db:push-style, no committed migration file). The tables were applied by extracting only the two-table statements from the freshly generated (then reverted) `0001` and applying them directly, which is byte-identical to what `db:push` would create against the live DB, and fully reversible (`DROP TABLE api_tokens, api_tool_calls`).

## What was done on production (m1)

1. Verified SSH access and read-only recon (PM2 app at /var/www/rentular.com, MariaDB `rentular` @ localhost:3306, 28 tables, zero `api_` tables).
2. Confirmed `users.id` is `varchar(255) utf8mb4_unicode_ci` and DB default collation matches, so the FKs to `users(id)` are valid.
3. Applied the verified DDL (both CREATE TABLE, both FKs, three indexes). Verified: both tables exist, `api_tokens_hash_idx` unique (non_unique=0), both FKs present, all indexes present.
4. Pushed local `main` to origin (31 commits, fast-forward, 04aeb70..7044195), pulled on m1 (rollback ref 04aeb70 recorded).
5. Added `API_TOKEN_PEPPER` (openssl rand -base64 32) and `API_TOKEN_RATE_LIMIT_PER_MINUTE=120` to m1 `.env` (backed up first).
6. `pnpm install --frozen-lockfile`, then `pnpm build` (deploy gate, 3/3 tasks green including web next build and the rebuilt `/settings`).
7. `pm2 restart ecosystem.config.cjs --update-env` (re-reads `.env`). Both processes online, single clean restart each, no crashloop.
8. Removed temp files holding the DB password and pepper from m1.

## Verification (observed on production)

- api boot log clean: "Rentular API running on http://localhost:4100", all workers and schedulers started, no pepper/DB errors.
- `GET /api/v1/health`: 200 local and public (https://www.rentular.com).
- Bearer fail-closed, all correct:
  - bogus `rtl_` token -> 401 (not 500: proves pepper loaded and `api_tokens` is queried without error)
  - non-`rtl_` Bearer -> 401 (no cookie fallthrough)
  - no auth -> 401
- Existing app healthy (dashboard endpoints 200).

## Deviations

1. **No committed migration file (Rule 4 / user decision).** The plan's declared artifacts `packages/db/drizzle/0001_api_tokens.sql`, the `_journal.json` idx 1 entry, and `0001_snapshot.json` were intentionally NOT committed, because a generated migration is non-additive here. The migration "truth" (both tables live, unique hash index, pepper set) is satisfied in production. This is the chosen trade-off of Option A, not a defect.

## Known follow-on (noted, not filed as backlog per user)

- The `0000` Drizzle snapshot is stale versus production. The next phase that wants a committable migration will hit the same wall until the baseline is re-based (re-baseline `0000` to current prod, then additive migrations work via `db:migrate`).
- Final human end-to-end smoke still worth doing in a browser: Settings -> API tokens -> create a read token -> curl with it (expect 200) -> revoke (expect 401) -> confirm `api_tool_calls` gains rows.

## Self-Check: PASSED
Production goal met (tables live, pepper set, Bearer pipeline verified). The only unmet item is the committed-migration-file artifact, deliberately skipped per the approved Option A.
