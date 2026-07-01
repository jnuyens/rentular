---
phase: 10-deploy-to-hetzner-m1-production-deployment
plan: 01
subsystem: infra
tags: [stripe, nextjs, docker, standalone, boot-guard, vitest]

# Dependency graph
requires:
  - phase: 07-marketing-dashboard-shadcn-ui
    provides: stripe /plans, /checkout, /webhook routes now boot-guarded
provides:
  - Lazy Stripe client guard (isStripeConfigured + getStripeClient) — API boots crash-safe with STRIPE_SECRET_KEY unset
  - Next.js standalone build output (output standalone + outputFileTracingRoot at monorepo root) required by the web Dockerfile
  - Confirmation (D-10) that apps/api reads only process.env — no dotenv/.env auto-load dependency
affects: [10-02 docker images, 10-03 compose wiring, 10-04 nginx, 10-05 deploy.sh, 10-06 bootstrap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy memoized client singleton with configured-guard, mirroring gocardless.ts"
    - "Next.js standalone output with outputFileTracingRoot for pnpm/Turbo monorepo Docker"

key-files:
  created:
    - apps/api/src/lib/stripe.ts
    - apps/api/src/lib/__tests__/stripe.test.ts
  modified:
    - apps/api/src/routes/stripe.ts
    - apps/web/next.config.ts

key-decisions:
  - "Stripe client lazily constructed inside handlers (getStripeClient) instead of module top-level, mirroring the isGoCardlessConfigured/getGoCardlessClient guard"
  - "D-10 handled as verification-only: no dotenv anywhere in apps/api/src, so container-injected env is sufficient (no code change)"

patterns-established:
  - "Optional integration clients are lazy singletons guarded by isXConfigured()/getXClient() — never constructed at import"
  - "Next standalone build emits server at apps/web/server.js (nested monorepo path) for the Docker runner"

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-07-01
---

# Phase 10 Plan 01: Wave-1 Prerequisite Fixes (Stripe boot-guard + Next standalone) Summary

**Lazy Stripe client guard (isStripeConfigured/getStripeClient mirroring gocardless.ts) plus Next.js `output: 'standalone'` + outputFileTracingRoot, unblocking every downstream Docker task; D-10 confirmed (no dotenv in apps/api/src).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-01T02:39:00Z
- **Completed:** 2026-07-01T02:42:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- API process is now crash-safe at boot when `STRIPE_SECRET_KEY` is unset — Stripe is constructed lazily only inside handlers that call it (D-09).
- New `apps/api/src/lib/stripe.ts` exposes `isStripeConfigured()` and a memoized `getStripeClient()` that throws a descriptive error only when called without a key.
- `apps/web/next.config.ts` now declares `output: "standalone"` + `outputFileTracingRoot` at the monorepo root; `pnpm build` emits `apps/web/.next/standalone/apps/web/server.js`.
- D-10 confirmed: zero `dotenv` references in `apps/api/src` — container-injected `process.env` is sufficient.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing test for lazy Stripe boot-guard** - `5c95a53` (test)
2. **Task 1 (GREEN): lazy Stripe client guard + route refactor** - `89fd8d7` (feat)
3. **Task 2: enable Next.js standalone output + D-10 confirmation** - `aa245f1` (feat)

_Note: No REFACTOR commit — the GREEN implementation was already clean (mirrored the gocardless.ts shape directly)._

## Files Created/Modified
- `apps/api/src/lib/stripe.ts` (created) - Lazy memoized Stripe singleton: `isStripeConfigured()` + `getStripeClient()` guard.
- `apps/api/src/lib/__tests__/stripe.test.ts` (created) - Vitest coverage: import-without-key does not throw, configured-flag reflects env, getStripeClient throws descriptively when unset.
- `apps/api/src/routes/stripe.ts` (modified) - Removed module-top-level `new Stripe()`; call `getStripeClient()` inside /plans, /checkout, /webhook handlers; static-plans fallback preserved.
- `apps/web/next.config.ts` (modified) - Added `output: "standalone"` + `outputFileTracingRoot: path.join(__dirname, "../../")`; withNextIntl + transpilePackages preserved.

## Decisions Made
- Stripe client is memoized at module scope but only constructed on first `getStripeClient()` call, so importing the router at API boot never runs `new Stripe()` with an empty key.
- Kept the value+namespace `import Stripe from "stripe"` in the route for the `Stripe.Event`/`Stripe.Product`/`Stripe.Checkout.Session` type references while the runtime client comes solely from `getStripeClient()`.
- The webhook handler's `getStripeClient()` call sits inside the existing try/catch, so an unset key there degrades to the existing "invalid signature" 400 rather than an unhandled boot-time crash.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The plan's verify command `pnpm --filter @rentular/api test --run <file>` failed with `Unknown option: 'run'` because the api `test` script is already `vitest run`; ran `pnpm --filter @rentular/api test -- <file>` instead. No code impact.

## Verification
- New stripe test: 3/3 pass. Full api suite: **70/70 pass (14 files)**.
- Acceptance greps: no top-level `new Stripe(` in `routes/stripe.ts`; `isStripeConfigured` present in lib; `getStripeClient` present in route.
- `pnpm build`: **green** (tsup + next build, 22.7s). Standalone server emitted at `apps/web/.next/standalone/apps/web/server.js` (confirms the nested monorepo path the web Dockerfile expects).
- D-10: `! grep -rq "dotenv" apps/api/src` passes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave-1 blockers cleared: the web Dockerfile can now rely on standalone output, and the API image will boot without `STRIPE_SECRET_KEY`.
- Ready for 10-02+ (Dockerfiles, compose wiring, nginx, deploy.sh, bootstrap).
- Note (carried debt, not a blocker): `pnpm lint` remains RED with ~57 pre-existing `tsc --noEmit` errors — deploy gate is `pnpm build` per D-06.

---
*Phase: 10-deploy-to-hetzner-m1-production-deployment*
*Completed: 2026-07-01*
