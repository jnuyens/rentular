# 10-06 SUMMARY — Live deployment to m1 (production)

**Status:** Complete (deployed 2026-07-01)
**Self-Check: PASSED**

## What actually happened (deviation from plan)

The Phase-10 plans assumed a **greenfield Docker/compose** deploy (ports 3000/4000, `/opt/rentular/.env`, `deploy.sh`, webhook). On inspection, **m1 already runs a live Rentular production deployment** with a different model, so I deployed via the real mechanism instead of the planned Docker one. The Docker/compose/deploy.sh artifacts from plans 10-03..10-05 remain in the repo but are **not** the production deploy path.

### Actual production model on m1 (discovered + used)
- **PM2**, not Docker: `rentular-web` = `next start --port 3100`; `rentular-api` = `tsx src/index.ts` on port **4100** (`/var/www/rentular.com/ecosystem.config.cjs`, which parses `/var/www/rentular.com/.env` and injects into PM2 env).
- **Host MariaDB** (shared box), DB `rentular`; **host Redis** localhost:6379.
- **nginx** `www.rentular.com` → `/api/v1/` :4100, `/` :3100; **TLS already issued** (certbot). Canonical host `https://www.rentular.com`.

## Deployment steps executed (scoped strictly to rentular; other sites untouched)
1. `git push origin main` — 66 commits (Phase 9 + 10), fast-forward `47f017b..e49df84`.
2. **Backup:** `mysqldump rentular` → `~/backups/rentular-predeploy-20260701-113805.sql` (25 tables).
3. Box `git pull --ff-only` → `e49df84`; `pnpm install --frozen-lockfile` (added MSW etc.).
4. **Schema:** `drizzle-kit push` FAILED — drizzle-kit 0.31.9 can't introspect **MariaDB** (`TypeError: reading 'checkConstraint'`). Applied the **additive** change as hand-written idempotent DDL matching the schema files: +8 columns on `bank_connections` (encrypted-token fields, `provider_metadata`, `country`) and `CREATE TABLE bank_statements` (22 cols, FKs to bank_connections/payments, utf8mb4_unicode_ci to match). `bank_connections` had 0 rows → safe.
5. `pnpm --filter @rentular/web build` (env sourced → `NEXT_PUBLIC_API_URL=https://www.rentular.com` baked).
6. `pm2 restart rentular-api rentular-web` — both online, clean boot (all Phase 9 workers up: bank monitoring Phase B/C, `[BankStatementRetention]` weekly cron).

## Smoke results (all pass)
- `https://rentular.com/` + `https://www.rentular.com/` → 200, valid TLS.
- `GET /api/v1/health` → `{"status":"healthy","checks":{"database":"ok","redis":"ok"},"version":"0.1.0"}`.
- Served HTML contains **0** `localhost:4x00` leaks (baked API URL correct).
- `/terms` + `/privacy` → 200 with Phase-9 Ibanity/PSD2 clauses; `/login` → 200.
- `/dashboard/bank-connections` → 307 (auth gate, not 500).
- Sibling sites linuxbe.com / modulejail.com / opensource-enterprise.com → 200 (no collateral damage).

## Still pending (blocks full 09-HUMAN-UAT, needs operator config — not code)
- **Ponto sandbox creds** not in box `.env` (`PONTO_CLIENT_ID/SECRET`, `BANK_DATA_PROVIDER`, `BANK_CONNECTION_REDIRECT_URL`) — bank-connection E2E can't be exercised until added.
- **SMTP** not configured on box (commented out) — renewal/reminder emails won't actually deliver until `SMTP_*` set.
- Rollback if needed: `git reset --hard 47f017b` + `pm2 restart` + restore the mysqldump.
