---
phase: 11-mcp-server-external-api-access
plan: 02
subsystem: api
tags: [api-tokens, personal-access-token, sha256, pepper, drizzle, hono, bearer-auth]

# Dependency graph
requires:
  - phase: 11-mcp-server-external-api-access
    plan: 01
    provides: "@rentular/shared API token contracts (ApiTokenScope, API_TOKEN_PREFIX, ApiTokenPublic), Hono tokenScope/tokenId context typing, RED tests for the token service and routes"
provides:
  - "api_tokens and api_tool_calls Drizzle tables exported from @rentular/db"
  - "apps/api/src/lib/apiTokens.ts token service: requireApiTokenPepper, mintRawToken, hashToken, mintToken, findActiveTokenByHash, listTokens, revokeToken, touchLastUsed"
  - "apps/api/src/routes/apiTokens.ts owner-scoped, session-only /api-tokens router (GET, POST, DELETE)"
affects: [11-04 guards-and-mcp, 11-05 settings-ui, 11-07 migrations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Peppered SHA-256 token hashing with node:crypto (no bcrypt): fast O(1) verification on a UNIQUE hash index with a constant-time final compare"
    - "Fail-closed env accessor (requireApiTokenPepper) evaluated lazily per call, mirroring requireAuthSecret, so the API still boots when PATs are unused"
    - "Fire-and-forget throttled timestamp write (touchLastUsed) that swallows errors so a failed write never fails the request"

key-files:
  created:
    - packages/db/src/schema/apiTokens.ts
    - packages/db/src/schema/apiToolCalls.ts
    - apps/api/src/lib/apiTokens.ts
    - apps/api/src/routes/apiTokens.ts
  modified:
    - packages/db/src/schema/index.ts
    - .env.example

key-decisions:
  - "Dedicated API_TOKEN_PEPPER env var (not HKDF from AUTH_SECRET) so the token pepper rotates independently of session encryption (RESEARCH Open Question 2)"
  - "Peppered SHA-256 over 256-bit random tokens instead of bcrypt: brute force is infeasible on high-entropy input and the Bearer path needs a single indexed lookup"
  - "Router is session-only: a PAT caller (tokenId set) is refused 403 so a leaked token cannot mint or revoke tokens (T-11-08)"
  - "Router re-projects to ApiTokenPublic on every response so a future service change can never leak the stored hash (T-11-10)"

requirements-completed: [API-01, API-03]

# Metrics
duration: 6min
completed: 2026-10-05
---

# Phase 11 Plan 02: Token Store, Service, and Management Routes Summary

**The api_tokens store (hash-only, UNIQUE-indexed) plus a peppered SHA-256 token service (mint/hash/lookup/list/revoke/throttled touch) and an owner-scoped, session-only /api-tokens router that returns the plaintext rtl_ token exactly once.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-05T03:45:46Z
- **Completed:** 2026-10-05T03:51:32Z
- **Tasks:** 3
- **Files modified:** 6 (2 modified, 4 created)

## Accomplishments
- Added the `api_tokens` Drizzle table (hash-only, `UNIQUE api_tokens_hash_idx`, scope enum, expiry/last-used/revoked timestamps) and the `api_tool_calls` audit table, both exported from `@rentular/db`.
- Implemented the token service against the Plan 01 RED tests: 256-bit `rtl_` tokens, peppered SHA-256 hashing, fail-closed pepper accessor, hash-only persistence, revoked/expired-filtered lookup with a constant-time compare, owner-scoped revoke, and a throttled fire-and-forget `touchLastUsed`.
- Built the owner-scoped `/api-tokens` router: 401 without a session, 403 for a PAT caller, show-once create, owner-scoped delete, and explicit `ApiTokenPublic` projection on every response.
- Documented `API_TOKEN_PEPPER` and `API_TOKEN_RATE_LIMIT_PER_MINUTE` in `.env.example`.

## Task Commits

Each task was committed atomically:

1. **Task 1: api_tokens and api_tool_calls Drizzle tables** - `c6bf9c1` (feat)
2. **Task 2: peppered token service + env docs** - `e8c0bcc` (feat)
3. **Task 3: owner-scoped session-only /api-tokens router** - `e83699a` (feat)

**Plan metadata:** committed with this summary (docs: complete plan)

## Files Created/Modified
- `packages/db/src/schema/apiTokens.ts` - `api_tokens` table; stores only the SHA-256+pepper hash, UNIQUE hash index for O(1) Bearer lookup.
- `packages/db/src/schema/apiToolCalls.ts` - `api_tool_calls` audit table for Bearer-authenticated calls (consumed by Plan 04).
- `packages/db/src/schema/index.ts` - exports both new modules from the schema barrel.
- `apps/api/src/lib/apiTokens.ts` - the token service (8 exports matching the Plan 01 interface block).
- `apps/api/src/routes/apiTokens.ts` - `apiTokensRouter` (GET/POST/DELETE), session-only and owner-scoped.
- `.env.example` - documents `API_TOKEN_PEPPER` (required, min 16) and `API_TOKEN_RATE_LIMIT_PER_MINUTE`.

## Verification Results
- `pnpm --filter @rentular/api test -- lib/__tests__/apiTokens`: 8/8 passed (observed).
- `pnpm --filter @rentular/api test -- routes/__tests__/apiTokens`: 6/6 passed (observed).
- `pnpm --filter @rentular/api lint` (tsc --noEmit): exit 0 (observed).
- `pnpm --filter @rentular/api build` (tsup ESM + DTS): build success (observed).
- Full suite: 141 passed, 33 failed across 6 files. The 6 failing files are exactly the Plan 01 RED files owned by later plans: `reminderChannel`, `manualReminder` (Plan 03) and `authMiddleware`, `tokenScope`, `apiTokenGuards`, `writeGuards` (Plan 04). Both `apiTokens` test files (this plan's responsibility) are now green and no pre-existing test regressed.

## Decisions Made
- **Dedicated `API_TOKEN_PEPPER`, not derived from `AUTH_SECRET`.** A standalone env var lets the token pepper rotate without touching session encryption (RESEARCH Open Question 2). The accessor fails closed below 16 chars and is evaluated lazily per call, mirroring `requireAuthSecret`, so the API still boots when PATs are unused.
- **Peppered SHA-256 over bcrypt.** Tokens are 256 bits of random entropy, so a fast hash is safe against brute force, and the Bearer path needs a single indexed lookup rather than a per-row bcrypt compare. A `timingSafeEqual` on the final compare closes the residual timing side channel (T-11-12).
- **Session-only router.** A PAT caller (context `tokenId` set) is refused 403 before any handler runs, so a leaked token can neither mint nor revoke tokens (T-11-08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Table-name verify grep vs the project formatter**
- **Found during:** Task 1
- **Issue:** The plan's inline verify used `grep "mysqlTable(\"api_tool_calls\""` (name on the same line), but Prettier (the project's enforced formatter per CLAUDE.md, `pnpm format`) wraps a 3-argument `mysqlTable(...)` call so the table name lands on its own line.
- **Fix:** Kept the Prettier-formatted output (formatter wins over the literal grep). The table is still named `api_tool_calls` and the must-haves `contains: "api_tool_calls"` check holds.
- **Files modified:** packages/db/src/schema/apiToolCalls.ts
- **Verification:** `grep -q "api_tool_calls"` passes; lint and build green.
- **Committed in:** c6bf9c1

**2. [Rule 1 - Bug] Comment mentions tripped the `grep -c "tokenHash" == 0` route check**
- **Found during:** Task 3
- **Issue:** Two explanatory comments in the router used the literal word `tokenHash`, which made the acceptance check `grep -c "tokenHash" == 0` report 2 even though the router never selects or emits a hash field.
- **Fix:** Reworded the two comments to "the stored hash"; the router still emits no hash field and the route test asserting no `tokenHash`/`LEAK` in the response passes.
- **Files modified:** apps/api/src/routes/apiTokens.ts
- **Verification:** `grep -c "tokenHash"` returns 0; 6/6 route tests green.
- **Committed in:** e83699a

---

**Total deviations:** 2 auto-fixed (both minor, verify-string alignment only). No behavior change, no scope creep.

## Threat Surface
All files map to mitigations already in the plan's threat register (T-11-01, T-11-01b, T-11-08, T-11-10, T-11-11, T-11-12). The `api_tool_calls` table is created here but populated in Plan 04; no new unregistered surface was introduced. No new network endpoint is reachable yet because the router is not mounted until Plan 04 (per plan, to avoid an index.ts conflict).

## Known Stubs
None. `api_tool_calls` is an audit table consumed by Plan 04; it is a schema artifact, not a UI-facing stub.

## User Setup Required
- Before any `rtl_` token can be minted or verified in a running environment, `API_TOKEN_PEPPER` must be set to at least 16 characters (documented in `.env.example`). Until Plan 07 generates and applies the migration, the two new tables do not exist in the live DB; the service will error against a real DB without them.

## Next Phase Readiness
- Plan 04 mounts `apiTokensRouter` at `/api-tokens` in `apps/api/src/index.ts` (plus the protected-prefix entry), resolves Bearer tokens via `findActiveTokenByHash`, and consumes `api_tool_calls` for audit.
- Plan 05 (Settings UI) consumes the router's GET/POST/DELETE contract.
- Plan 07 generates and applies the migration for `api_tokens` and `api_tool_calls` (no drizzle-kit was run here, per plan).

## Self-Check: PASSED

All 4 created files and 2 modified files are present on disk; all three task commits (c6bf9c1, e8c0bcc, e83699a) exist in git history.

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
