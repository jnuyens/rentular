---
quick_id: 261108-shd
status: complete
completed: 2026-11-08
branch: worktree-agent-a3532d16dd8628ae0
key-files:
  created:
    - SELF-HOSTING.md
    - CONTRIBUTING.md
  modified:
    - README.md
    - .env.example
    - .env.production.example
    - apps/api/src/lib/email.ts
    - apps/api/src/lib/__tests__/email.test.ts
    - docker-compose.prod.yml
    - deploy/deploy.sh
    - apps/web/Dockerfile
    - turbo.json
    - package.json
    - .gitignore
---

# Quick 261108-shd: self-hosting docs and repo clean-up

Current self-hosting guide (compose and PM2), regenerated env templates,
CONTRIBUTING.md, a fixed README, SMTP auth for the platform transport, and
three config bugs that would have stopped a self-hoster.

## Commits

| Hash | What |
| --- | --- |
| f011863 | SMTP_USER / SMTP_PASSWORD / SMTP_SECURE on the platform transport, with tests |
| 9004acb | untrack `.claude/worktrees/agent-ab06049a5750a4593/` (336 files), ignore `.claude/worktrees/` |
| 6f5f41c | turbo passes DB_* to the drizzle-kit tasks |
| 4996574 | compose: REDIS_HOST/PORT, SMTP from env file, RENTULAR_ENV_FILE; deploy.sh RENTULAR_DIR; web Dockerfile build-time DB_PASSWORD |
| 93b11c1 | `.env.example` and `.env.production.example` regenerated from the code; compose web gets DB_HOST=mariadb |
| c0925f7 | turbo `dev` passes the shell env through |
| 84e0764 | SELF-HOSTING.md, CONTRIBUTING.md, README, package.json repo URL |

The 9004acb deletions are intentional (stray copy of the repo).

## Checks (observed)

- `apps/api` vitest: 67 files, 587 tests passed.
- `apps/api` `tsc --noEmit -p .`: exit 0, no output.
- `docker compose --env-file <test env> -f docker-compose.prod.yml config`:
  exit 0 (with `RENTULAR_ENV_FILE` pointing at a throwaway env file; without
  it compose correctly fails because /opt/rentular/.env does not exist here).
- Relative markdown links in README, SELF-HOSTING, CONTRIBUTING: all 13 resolve.
  No absolute local paths.
- No em or en dashes in any new or touched file (also cleaned the existing
  ones in deploy.sh, docker-compose.prod.yml, apps/web/Dockerfile, .gitignore).
- Every `process.env.X` read in apps/api, apps/web, packages, apps/mcp-server
  appears in `.env.example`.
- `bash -n deploy/deploy.sh`: OK.
- PM2 ecosystem example from SELF-HOSTING.md loaded with node against
  `.env.production.example`: 72 vars parsed, script paths exist in the checkout.
- Secret scan of the tracked tree (paths only): only hits are placeholder or
  test values in `apps/api/src/lib/__tests__/pontoConfig.test.ts`,
  `docs/superpowers/plans/2026-08-01-ponto-production-readiness.md`,
  `.env.example`, `.env.production.example`, `.planning/codebase/TESTING.md`,
  `.planning/phases/09-.../09-02-PLAN.md`,
  `.planning/quick/261022-g4j-.../261022-g4j-PLAN.md`. No real keys, no tracked
  .pem/.key/.p12/.pfx/.keystore/.env files.

Tested locally against a throwaway MariaDB 11 container (127.0.0.1:33099,
stopped afterwards): `pnpm db:push` on a fresh DB works (after the turbo fix),
`pnpm --filter @rentular/api bootstrap` creates the owner and is idempotent.

Not verified: a full `docker compose build` and `next build` (no network for
image pulls and Google Fonts here), MySQL 8 behaviour of `db:push` (image pull
failed), PM2 itself (not installed here).

## Deviations from Plan

1. **[Rule 1 - Bug] `pnpm db:push` at the repo root never worked.** Turbo's
   strict env mode dropped DB_PASSWORD, so drizzle.config.ts threw. Added
   `passThroughEnv` for DB_* on the db tasks. Cost if wrong: none, only adds
   env to three uncached tasks. Commit 6f5f41c.
2. **[Rule 1 - Bug] `pnpm dev` hid the env from the apps** (verified with a
   scratch turbo workspace: FOO=undefined). Added `passThroughEnv: ["*"]` to
   `dev`. Cost if wrong: dev only, no caching involved. Commit c0925f7.
3. **[Rule 1 - Bug] Compose BullMQ workers would connect to localhost Redis.**
   Workers read REDIS_HOST/REDIS_PORT, compose set only REDIS_URL. Also the
   web container had no DB_HOST override, and SMTP was hard-forced to Mailpit.
   Commits 4996574, 93b11c1. Cost if wrong: compose route only; m1 does not
   use compose.
4. **[Rule 1 - Bug, unverified] web Dockerfile build without DB_PASSWORD.**
   lib/auth.ts calls getDb() at import, which throws without DB_PASSWORD (per
   the deployment notes, next build needs it). Added a build-only placeholder
   on the RUN line. Could not run the build here. Cost if wrong: harmless
   extra env var on one build command.
5. **Port 465 now implies TLS when SMTP_SECURE is unset.** Before, the platform
   transport always used `secure: false`, which cannot work on 465 anyway.
   Unset SMTP_USER keeps the exact old options (secure false, relaxed TLS) for
   every other port, so m1 (127.0.0.1:25, no auth) is unchanged.
6. deploy.sh already had DEPLOY_ROOT; added RENTULAR_DIR (preferred) and
   RENTULAR_ENV_FILE, kept DEPLOY_ROOT as fallback, and marked the script as an
   example.
7. Dropped from the env templates because nothing reads them: SMTP_FROM,
   API_URL. The m1-specific comments in `.env.production.example` were
   replaced with a generic template (rent.example.org).

## Findings worth knowing (documented in SELF-HOSTING.md)

- On MariaDB, drizzle-kit 0.31.9 `push` against a database that already has
  the tables fails with `TypeError ... 'checkConstraint'` and **exits 0**. So
  the bootstrap's "Schema applied" on a re-run is not proof, and deploy.sh's
  bootstrap step will not catch it. Possible follow-up: make bootstrap check
  drizzle-kit output, or upgrade drizzle-kit.
- `AUTH_SECRET` is the encryption key (sha256 of it), so rotating it breaks
  stored bank tokens and SMTP passwords. There is no re-encrypt tool.
- Sign-up is open to anyone reaching the site; no switch exists.
- Root `pnpm build` via turbo probably also loses DB_PASSWORD for next build
  (same strict env mode). The guide uses `pnpm --filter @rentular/web build`,
  which bypasses turbo, as m1 does. Not changed, out of scope.
- `.planning/` is still tracked; left for the owner as instructed.

## Self-Check: PASSED

All files listed exist; all 7 commits are on the branch.
