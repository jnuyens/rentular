---
phase: 11-mcp-server-external-api-access
plan: 04
subsystem: api
tags: [api-tokens, bearer-auth, csrf, rate-limit, audit-log, hono, redis, drizzle]

# Dependency graph
requires:
  - phase: 11-mcp-server-external-api-access
    plan: 02
    provides: "apiTokens service (hashToken, findActiveTokenByHash, touchLastUsed), api_tool_calls table, session-only apiTokensRouter"
  - phase: 11-mcp-server-external-api-access
    plan: 01
    provides: "RED tests for authMiddleware Bearer branch, requireWriteScope, and the rate-limit/audit/redaction guards; Hono tokenScope/tokenId context typing"
provides:
  - "authMiddleware exclusive fail-closed Bearer branch resolving rtl_ PATs before the cookie path"
  - "routeAuth.requireWriteScope: 403 for read-scoped PATs on state-changing methods"
  - "lib/csrfPolicy.shouldSkipCsrf shared by index.ts and tests"
  - "lib/apiTokenGuards: bearerRateLimit, bearerAuditLog, redactAuditArgs, getRedis"
  - "mounted /api-tokens router and the full PAT request pipeline wired in index.ts"
affects: [11-06 mcp-server, 11-07 migrations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exclusive fail-closed auth branch: any Authorization: Bearer header is resolved or rejected at the top of authMiddleware and returns early, so a malformed or foreign Bearer never falls through to the cookie path"
    - "Lazily constructed module-level ioredis client (getRedis) mirroring the health-check construction, mockable in tests"
    - "Fire-and-forget audit insert after the handler so audit latency never blocks the response; rate limit fails open on Redis errors"

key-files:
  created:
    - apps/api/src/lib/csrfPolicy.ts
    - apps/api/src/lib/apiTokenGuards.ts
  modified:
    - apps/api/src/lib/authMiddleware.ts
    - apps/api/src/lib/routeAuth.ts
    - apps/api/src/index.ts

key-decisions:
  - "Bearer branch is exclusive and fail-closed: a non-rtl or unresolved Bearer sets userId null and returns before the cookie logic, never reading cookies (T-11-02, T-11-14)"
  - "CSRF exemption is narrower than the auth branch (rtl_ only) so a non-rtl Bearer gains no CSRF skip and is still rejected by auth (T-11-06)"
  - "requireWriteScope applied at both prefix and prefix/* for every protected prefix; cookie sessions (tokenScope null) and write PATs pass (T-11-03)"
  - "redactAuditArgs keeps exact sensitive field names (value masked) for readability but masks compound keys that merely embed a sensitive word, so no field name leaks embedded context (T-11-09)"

requirements-completed: [API-02, MCP-03]

# Metrics
duration: 7min
completed: 2026-10-05
---

# Phase 11 Plan 04: Guards and PAT Pipeline Wiring Summary

**Personal Access Tokens are now wired into the request pipeline: an exclusive fail-closed Bearer branch at the top of authMiddleware, a CSRF exemption limited to Bearer rtl_ requests, a requireWriteScope guard, a per-token Redis rate limit, an api_tool_calls audit insert, and the mounted /api-tokens router. The cookie path is byte-for-byte unchanged.**

## Performance

- **Duration:** ~7 min
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Added the exclusive, fail-closed Bearer branch to `authMiddleware`: a valid `rtl_` token sets `userId`/`tokenScope`/`tokenId`, fires `touchLastUsed` unawaited, and returns before any cookie read; revoked/expired/unknown/non-rtl/pepper-missing all set `userId` null (401 via requireAuth) and never fall through to cookies.
- Added `requireWriteScope` to `routeAuth`: 403 `Token is read-only` for read-scoped PATs on non-GET/HEAD/OPTIONS; cookie sessions and write PATs pass.
- Created `csrfPolicy.shouldSkipCsrf` centralizing the webhook skip and the `Bearer rtl_` exemption; cookie requests keep the full Origin check.
- Created `apiTokenGuards` with `bearerRateLimit` (INCR+EXPIRE per token per minute, 429 + Retry-After, fail open on Redis errors), `bearerAuditLog` (one `api_tool_calls` row per Bearer request including denied ones, fire-and-forget), and `redactAuditArgs`.
- Wired the pipeline in `index.ts`: mounted `/api-tokens`, added it to `protectedPrefixes`, replaced the inline webhook CSRF skip with `shouldSkipCsrf(c)`, registered `bearerRateLimit` then `bearerAuditLog` after `authMiddleware`, and applied `requireWriteScope` to every protected prefix.

## Task Commits

1. **Task 1: Bearer branch + requireWriteScope** - `74f08ed` (feat)
2. **Task 2: csrfPolicy helper + rate-limit/audit guards** - `aa5b73e` (feat)
3. **Task 3: wire the PAT pipeline in index.ts** - `520dcc6` (feat)

**Plan metadata:** committed with this summary (docs: complete plan)

## Files Created/Modified
- `apps/api/src/lib/authMiddleware.ts` - exclusive fail-closed Bearer branch before the cookie path; imports `hashToken`/`findActiveTokenByHash`/`touchLastUsed`; never awaits `touchLastUsed`; no token or hash is ever logged.
- `apps/api/src/lib/routeAuth.ts` - new `requireWriteScope` middleware.
- `apps/api/src/lib/csrfPolicy.ts` - `shouldSkipCsrf(c)` shared by `index.ts` and the CSRF test block.
- `apps/api/src/lib/apiTokenGuards.ts` - `getRedis`, `bearerRateLimit`, `bearerAuditLog`, `redactAuditArgs`.
- `apps/api/src/index.ts` - mounts the router and registers the guards/write-scope and CSRF policy.

## Verification Results
- `pnpm --filter @rentular/api test -- --run lib/__tests__/authMiddleware`: 9/9 passed (observed), including the 6 Bearer-branch cases and the 3 CSRF-exemption cases.
- `pnpm --filter @rentular/api test -- --run tokenScope`: 6/6 passed (observed).
- `pnpm --filter @rentular/api test -- --run apiTokenGuards`: 9/9 passed (observed).
- `pnpm --filter @rentular/api test -- --run` (full suite): 174 passed across 31 files (observed), up from 154 passing / 20 failing at the start of this plan. No pre-existing test regressed.
- `pnpm --filter @rentular/api lint` (tsc --noEmit): exit 0 (observed).
- `pnpm --filter @rentular/api build` (tsup ESM + DTS): build success (observed).

## Decisions Made
- **Bearer branch is exclusive and fail-closed.** Any `Authorization: Bearer` header is resolved or rejected at the top of `authMiddleware` and returns early; cookies are never read for a Bearer request. A non-rtl Bearer is treated as a rejected PAT attempt, not a fall-through (T-11-02, T-11-14). The `getCookie` spy is asserted uncalled in every Bearer test.
- **CSRF exemption narrower than the auth branch.** `shouldSkipCsrf` exempts only `Bearer rtl_` (plus the existing webhook paths); a non-rtl Bearer gets no CSRF skip and is rejected by auth anyway (T-11-06). Cookie requests keep the full Origin check.
- **requireWriteScope at both prefix and prefix/\*.** Applied for every protected prefix so a read PAT is 403 on any state-changing method; cookie sessions have `tokenScope` null and are unaffected, and the route's own role check still applies (T-11-03).
- **redactAuditArgs masks compound keys, not just values.** The dedicated `redactAuditArgs` test keeps exact sensitive field names (`token`, `password`, `iban`) with their values masked for audit readability, while the audit test's serialized args must contain no `secret` substring even though the body key is `secretThing`. A value-only mask cannot satisfy both, so exact sensitive field names are preserved (value masked) and compound keys that merely embed a sensitive word are themselves masked. This is strictly safer (redacts more) and leaks no field-name context (T-11-09). See Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] redactAuditArgs needed compound-key masking, not value-only masking**
- **Found during:** Task 2
- **Issue:** The plan's `redactAuditArgs` description ("deep-replaces values of keys matching the regex with [redacted]") keeps the key and masks only the value. That passes the dedicated `redactAuditArgs` unit test (`out.token === "[redacted]"`), but the `bearerAuditLog` test sends a body with key `secretThing` and asserts `JSON.stringify(row.args)` does **not** contain `"secret"`. A value-only mask leaves `{"secretThing":"[redacted]"}`, whose key still contains `secret`, so that assertion fails. No single value-only function satisfies both RED tests.
- **Fix:** Exact sensitive field names (`/^(token|secret|password|iban|authorization)$/i`) keep their name with the value masked (satisfies the unit test and keeps audit rows readable); a key that only embeds a sensitive word (e.g. `secretThing`) is itself replaced with `[redacted]` (satisfies the audit test and leaks no embedded context). Strictly safer than the planned behavior.
- **Files modified:** apps/api/src/lib/apiTokenGuards.ts
- **Verification:** both `redactAuditArgs` cases and the full `apiTokenGuards` suite (9/9) pass.
- **Committed in:** aa5b73e

**2. [Rule 3 - Blocking] Insert row types widened to the table's column types**
- **Found during:** Task 2
- **Issue:** `tsc --noEmit` rejected the `api_tool_calls` insert because `status` inferred as `string` (not the `"ok" | "error" | "forbidden"` enum) and `userId` inferred as `string | null` (the column is NOT NULL).
- **Fix:** Annotated `status` with the enum union and coalesced `userId` to `""` (tokenId is set only when `authMiddleware` resolved a PAT, which also sets a non-null userId, so the fallback is never reached at runtime).
- **Files modified:** apps/api/src/lib/apiTokenGuards.ts
- **Verification:** `pnpm --filter @rentular/api lint` exit 0.
- **Committed in:** aa5b73e

---

**Total deviations:** 2 auto-fixed. One reconciles two mutually-inconsistent RED expectations with the stricter, safer behavior; one is a type annotation. No scope creep; the cookie flow and webhook CSRF skip are behaviorally unchanged.

## Threat Surface
All files map to mitigations already in the plan's threat register: T-11-02 and T-11-14 (fail-closed Bearer branch, no cookie fall-through), T-11-03 (requireWriteScope + preserved property/role checks), T-11-06 (narrow CSRF exemption), T-11-05 (per-request audit including denied calls), T-11-07 (per-token rate limit) with T-11-07b (fail open on Redis outage, accepted), and T-11-09 (no token/hash logged; redacted audit args). No new unregistered surface was introduced.

## Known Stubs
None. The `api_tool_calls` rows depend on the Plan 07 migration existing in the live DB; the fire-and-forget insert logs and swallows errors until then, so the API is unaffected.

## User Setup Required
- `API_TOKEN_PEPPER` (min 16 chars) must be set before any `rtl_` token can be verified in a running environment (documented in `.env.example`).
- The `api_tokens` and `api_tool_calls` tables do not exist in the live DB until the Plan 07 migration is generated and applied.

## Next Phase Readiness
- Plan 06 (MCP server) can authenticate against the live API with a `Bearer rtl_` token and send `X-Rentular-Tool` for per-tool audit rows.
- Plan 07 generates and applies the migration for `api_tokens` and `api_tool_calls`.
- Manual spot check (recorded in VALIDATION): after the Plan 07 migration, `curl -H "Authorization: Bearer <token>" $API_URL/api/v1/properties` returns the owner's properties; after `DELETE /api-tokens/:id` the same curl returns 401.

## Self-Check: PASSED

Both created files and all three modified files are present on disk; all three task commits (74f08ed, aa5b73e, 520dcc6) exist in git history.

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
