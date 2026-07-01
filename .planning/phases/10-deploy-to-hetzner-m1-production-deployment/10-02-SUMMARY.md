---
phase: 10-deploy-to-hetzner-m1-production-deployment
plan: 02
subsystem: infra
tags: [bootstrap, drizzle-kit, bcrypt, tsx, deployment, seed]

# Dependency graph
requires:
  - phase: 10-01
    provides: Stripe boot-guard + next.config standalone (crash-safe API boot)
  - phase: 01
    provides: users table + auth register logic (bcrypt rounds 12, randomUUID)
provides:
  - Idempotent first-run bootstrap (drizzle-kit push + owner account creation)
  - createOwnerIfMissing() reusable owner-seed helper (unit-tested against a stub db)
  - pnpm --filter @rentular/api bootstrap script for deploy build tree
affects: [deploy.sh, docker, first-run, 09-HUMAN-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable db handle (passed as param) for unit-testable DB logic"
    - "import.meta.url entrypoint guard so a CLI script is safely importable by tests"
    - "Shell out to drizzle-kit push via spawnSync inheriting container DB_* env"

key-files:
  created:
    - apps/api/src/scripts/bootstrap.ts
    - apps/api/src/scripts/__tests__/bootstrap.test.ts
  modified:
    - apps/api/package.json

key-decisions:
  - "Owner seeded with name='Owner' + onboardingComplete=true (no role column exists in users schema; owner lands directly in dashboard)"
  - "Entrypoint detected via fileURLToPath(import.meta.url) === process.argv[1] so test import triggers no schema push / DB connection"
  - "Schema push shells out to 'pnpm --filter @rentular/db exec drizzle-kit push' rather than importing drizzle-kit (devDep, only present in build tree)"

patterns-established:
  - "Injectable-db unit testing: pass the Drizzle handle so a fake select/insert chain proves idempotency without MySQL"
  - "CLI-script entrypoint guard: main() runs only when the module is process.argv[1]"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-07-01
---

# Phase 10 Plan 02: First-run Bootstrap Summary

**Idempotent `pnpm bootstrap` that runs drizzle-kit push then seeds the initial owner from ADMIN_EMAIL/ADMIN_PASSWORD (bcrypt rounds 12), unit-tested against a stub db and a no-op on re-run.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-01T00:45:05Z
- **Completed:** 2026-07-01T00:47:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `createOwnerIfMissing(db, {email, password})`: normalizes email, select-first, no-op when owner exists, else bcrypt-hashes password with a crypto.randomUUID id — never persists/logs plaintext (T-10-02-01/02/03 mitigated).
- Guarded `main()` orchestrates `drizzle-kit push` then owner creation from `process.env.ADMIN_*`, exits 0; safe to re-run on every deploy.
- `bootstrap` script wired into apps/api/package.json (`tsx src/scripts/bootstrap.ts`); runs from the deploy build tree where devDeps (tsx, drizzle-kit) exist.
- 3 unit tests (skip-when-exists / hashed-insert-when-missing / throws-on-missing-env) — full API suite green (73/73).

## Task Commits

Each task was committed atomically:

1. **Task 1: Idempotent createOwnerIfMissing() with unit test** (TDD)
   - `cf08c48` (test — RED)
   - `49c245c` (feat — GREEN)
2. **Task 2: Bootstrap entrypoint (schema push + owner) and pnpm script** - `70331fd` (feat)

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified
- `apps/api/src/scripts/bootstrap.ts` - createOwnerIfMissing helper + guarded main() (schema push + owner seed)
- `apps/api/src/scripts/__tests__/bootstrap.test.ts` - 3 tests over a fake Drizzle handle
- `apps/api/package.json` - adds `"bootstrap": "tsx src/scripts/bootstrap.ts"`

## Decisions Made
- The `users` schema has no role/ownership column, so the "owner" is a plain user seeded with `name="Owner"` and `onboardingComplete=true` (skips onboarding, lands in dashboard). Mirrors auth.ts insert shape (id, email, name, passwordHash).
- Entrypoint guard uses `fileURLToPath(import.meta.url) === process.argv[1]` (robust under tsx) so importing the module in tests never runs `main()` — no schema push, no DB connect.
- Schema push shells out (`spawnSync pnpm --filter @rentular/db exec drizzle-kit push`, `stdio: inherit`, inheriting DB_* env) instead of importing drizzle-kit, which is a devDep present only in the build tree (10-RESEARCH Pitfall 5).

## Deviations from Plan
None - plan executed exactly as written.

## TDD Gate Compliance
Task 1 (`tdd="true"`) followed RED → GREEN: `cf08c48` (test, verified failing on missing module) then `49c245c` (feat, 3/3 green). No refactor commit — implementation was clean. Gate satisfied.

## Threat Surface
No new threat surface beyond the plan's `<threat_model>`. All three mitigations verified: password bcrypt-hashed (rounds 12, asserted via bcrypt.compare in test), re-run is select-first no-op (asserted), and `[Bootstrap]` logs emit status only — never the password value.

## Issues Encountered
None.

## User Setup Required
None in-code. At deploy time (Plan 06), `/opt/rentular/.env` must define `ADMIN_EMAIL` and `ADMIN_PASSWORD`; bootstrap reads them from the container environment. Full DB idempotency is verified live in Plan 06 (no MySQL in sandbox — STATE blocker).

## Next Phase Readiness
- Bootstrap is ready to be invoked from `deploy.sh` / the Docker build tree (Plans 03-06).
- Verify-note: run `pnpm --filter @rentular/api bootstrap` once after first `docker compose up` against real MySQL to confirm "already present" no-op on second run.

## Self-Check: PASSED
- FOUND: apps/api/src/scripts/bootstrap.ts
- FOUND: apps/api/src/scripts/__tests__/bootstrap.test.ts
- FOUND: apps/api/package.json (bootstrap script)
- FOUND commits: cf08c48, 49c245c, 70331fd

---
*Phase: 10-deploy-to-hetzner-m1-production-deployment*
*Completed: 2026-07-01*
