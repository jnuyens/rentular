---
phase: 11-mcp-server-external-api-access
plan: 01
subsystem: testing
tags: [api-tokens, bearer-auth, csrf, vitest, tdd, reminder-channel, personal-access-token]

# Dependency graph
requires:
  - phase: 05-property-managers
    provides: propertyAccess role model (ROLE_LEVEL, hasMinimumRole, getUserPropertyRole)
  - phase: 04-notifications
    provides: paymentFollowUp sendReminder, queueSms/queueEmail workers, DEFAULT_SMS_TEMPLATES
provides:
  - "@rentular/shared API token contracts: ApiTokenScope, API_TOKEN_PREFIX, ApiTokenPublic"
  - "Hono ContextVariableMap tokenScope + tokenId for the Bearer auth path"
  - "Eight Wave 0 RED vitest files pinning the secure behaviors for Plans 02, 03, 04"
affects: [11-02 token-service-and-routes, 11-03 write-hardening-and-channel, 11-04 guards-and-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-literal dynamic import specifier (const spec: string = ...) so tsc stays green while a test references a module a later plan creates"
    - "Proxy-based chainable fake db that resolves a queued read result on await and records insert values"
    - "RED-first contract tests: behaviors asserted before any implementation, turned green by downstream plans"

key-files:
  created:
    - apps/api/src/lib/__tests__/apiTokens.test.ts
    - apps/api/src/lib/__tests__/authMiddleware.test.ts
    - apps/api/src/lib/__tests__/tokenScope.test.ts
    - apps/api/src/lib/__tests__/apiTokenGuards.test.ts
    - apps/api/src/routes/__tests__/apiTokens.test.ts
    - apps/api/src/routes/__tests__/writeGuards.test.ts
    - apps/api/src/services/__tests__/reminderChannel.test.ts
    - apps/api/src/services/__tests__/manualReminder.test.ts
  modified:
    - packages/shared/src/types/index.ts
    - apps/api/src/types/hono.d.ts

key-decisions:
  - "Not-yet-existing modules are loaded via non-literal import specifiers so tsc --noEmit stays green while the tests run RED at runtime"
  - "requirements-completed left empty: these behaviors are only tested (RED) here, not implemented, so API-01/02/03 and MCP-03 are not satisfied until Plans 02/03/04"

patterns-established:
  - "Non-literal dynamic import keeps the type-check green for forward-referenced modules"
  - "Queued-result Proxy chainable models Drizzle fluent queries without a real database"

requirements-completed: []

# Metrics
duration: 16min
completed: 2026-10-05
---

# Phase 11 Plan 01: API Contracts and Wave 0 Red Tests Summary

**Shared API-token type contracts and Bearer context typing, plus eight RED vitest files that pin token hashing, fail-closed Bearer resolution, CSRF exemption, write scope, rate-limit and audit, route ownership, manager+ hardening, and preferred-channel reminder dispatch.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-10-05T03:24:00Z
- **Completed:** 2026-10-05T03:40:20Z
- **Tasks:** 3
- **Files modified:** 10 (2 modified, 8 created)

## Accomplishments
- Added the public API-token contracts to `@rentular/shared` (ApiTokenScope, API_TOKEN_PREFIX, ApiTokenPublic) with tokenHash deliberately excluded from the serializable shape.
- Declared `tokenScope` and `tokenId` on the Hono ContextVariableMap so the Bearer branch and guards compile under strict TypeScript.
- Wrote eight Wave 0 RED test files encoding the exact secure behaviors from 11-VALIDATION.md; each threat T-11-01..08 and T-11-22 has at least one test that fails until its mitigation ships.
- Kept `pnpm --filter @rentular/api lint` (tsc --noEmit) and `build` (tsup) green and left all 23 pre-existing test files passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared token contracts and Hono context typing** - `7a1a1fe` (feat)
2. **Task 2: Wave 0 lib tests (token service, Bearer middleware, write scope, guards)** - `46014c0` (test)
3. **Task 3: Wave 0 route and service tests (token routes, write hardening, channel dispatch)** - `8b7c6fd` (test)

**Plan metadata:** committed with this summary (docs: complete plan)

## Files Created/Modified
- `packages/shared/src/types/index.ts` - Added ApiTokenScope, API_TOKEN_PREFIX, ApiTokenPublic (no tokenHash).
- `apps/api/src/types/hono.d.ts` - Added tokenScope and tokenId context variables for the Bearer path.
- `apps/api/src/lib/__tests__/apiTokens.test.ts` - Token mint/hash/pepper, hash-only persistence, lookup/revoke/touch scoping (API-01, T-11-01).
- `apps/api/src/lib/__tests__/authMiddleware.test.ts` - Bearer accept/reject, no cookie fall-through, CSRF exemption (API-02, T-11-02, T-11-06).
- `apps/api/src/lib/__tests__/tokenScope.test.ts` - requireWriteScope read/write + PAT still property-scoped (API-02, T-11-03).
- `apps/api/src/lib/__tests__/apiTokenGuards.test.ts` - rate-limit 429, audit row insert, arg redaction (T-11-05, T-11-07).
- `apps/api/src/routes/__tests__/apiTokens.test.ts` - Ownership-scoped listing/create/delete, no tokenHash leak, session-only (PAT 403) (API-03, T-11-08).
- `apps/api/src/routes/__tests__/writeGuards.test.ts` - Manager+ hardening on ledger record-payment and payments send-reminder (MCP-03, T-11-04).
- `apps/api/src/services/__tests__/reminderChannel.test.ts` - Preferred-channel dispatch with email fallback (MCP-03, T-11-22).
- `apps/api/src/services/__tests__/manualReminder.test.ts` - Routes on tenants.preferredChannel and records the channel used (MCP-03, T-11-22).

## Decisions Made
- **Non-literal import specifiers for forward-referenced modules.** `apps/api/tsconfig.json` type-checks `src/**/__tests__/**`, and this plan tests modules that Plans 02/03/04 create (`../apiTokens`, `../apiTokenGuards`, `../csrfPolicy`, `../reminderChannel`, plus `requireWriteScope` from `../routeAuth`). A literal `import("../apiTokens")` would make `tsc --noEmit` fail with TS2307, breaking the lint gate. Loading these through a `const spec: string = "..."` variable makes TypeScript treat the dynamic import as `any` (no resolution), so lint stays green while the import rejects at runtime and the test runs RED. This is exactly the correct RED state for a foundation plan.
- **requirements-completed left empty.** The plan lists API-01, API-02, API-03, MCP-03 in frontmatter, but this Wave 0 plan only writes failing tests; the behaviors are implemented in Plans 02/03/04. Marking the requirements complete now would be false, so they were not checked off.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Neutralised the pre-Plan-03 email path in manualReminder.test.ts**
- **Found during:** Task 3 (service tests)
- **Issue:** `manualReminder.ts` today still calls the real `sendReminder`, which imports the BullMQ-backed `emailQueueWorker`/`smsQueueWorker`. Running the test as-specified (mock only `../reminderChannel` + `@rentular/db`) would hit a real queue/Redis, hanging the test until the 10s timeout rather than failing fast for the right reason.
- **Fix:** Added `vi.mock("../../jobs/emailQueueWorker")` and `vi.mock("../../jobs/smsQueueWorker")` with no-op `queueEmail`/`queueSms`. After Plan 03 rewires `manualReminder` onto `reminderChannel`, these mocks are inert.
- **Files modified:** apps/api/src/services/__tests__/manualReminder.test.ts
- **Verification:** The four tests complete in ~600ms (no timeout), and the two dispatch tests fail for the intended reason (no `channel` field / dispatch not called).
- **Committed in:** 8b7c6fd (Task 3 commit)

**2. [Rule 3 - Blocking] vitest v4 typing fixes on new test files**
- **Found during:** Tasks 2 and 3 (lint gate)
- **Issue:** Three tsc errors unrelated to module resolution: a spread into a zero-arg `sqlMock`, `vi.fn<[], Promise<...>>()` producing a `never` arg under vitest 4, and indexing `.mock.calls[0][0]` on a no-arg mock (empty tuple).
- **Fix:** Widened `sqlMock` to `(...args: unknown[])`, dropped the `vi.fn` generic in favour of a plain `vi.fn()`, and cast `.mock.calls[0]` to `any[]` before indexing.
- **Files modified:** apps/api/src/lib/__tests__/apiTokens.test.ts, apps/api/src/routes/__tests__/writeGuards.test.ts, apps/api/src/services/__tests__/reminderChannel.test.ts
- **Verification:** `pnpm --filter @rentular/api lint` exits 0.
- **Committed in:** 46014c0 (apiTokens) and 8b7c6fd (writeGuards, reminderChannel)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both keep the Wave 0 gate meaningful (lint green, tests fast and RED for the right reason). No change to the asserted behaviors. No scope creep.

## Assumption Drift (advisory)

**Short reminder body for level "formal" / lang "nl".** The plan asserts the short body for `formal`/`nl` contains both the amount and the dd/mm/yyyy due date. The existing `DEFAULT_SMS_TEMPLATES.nl.formal` string contains `{{amount}}` and `{{daysPastDue}}` but no `{{dueDate}}` (only the `friendly` template carries the due date). The assertion is encoded as the plan specifies; if Plan 03's `reminderChannel` reuses the current `formal` template verbatim, Plan 03 must either include the due date in the `formal` short body or adjust that single sub-assertion. Recorded as advisory only; the test is RED now regardless.

## Issues Encountered
None beyond the deviations above. `vi.mock` of a not-yet-existing module with a factory does not throw at collection in vitest v4, so `manualReminder.test.ts` and `authMiddleware.test.ts` collect and fail on their assertions rather than on module resolution.

## User Setup Required
None - no external service configuration required. (Plan 02 will introduce the `API_TOKEN_PEPPER` env var; this plan only sets a test value in-process.)

## Next Phase Readiness
- Contracts are fixed: Plan 02 implements `apps/api/src/lib/apiTokens.ts` and the `/api-tokens` router against ApiTokenPublic and the service surface in the plan's interfaces block; Plan 03 extracts `reminderChannel.ts` and rewires `manualReminder`; Plan 04 adds `requireWriteScope`, `apiTokenGuards`, and `csrfPolicy`.
- Verification is now automated: downstream plans turn these eight RED files green rather than relying on code reading.
- Expected-RED baseline this plan leaves: 8 test files failing (47 failing assertions), 23 pre-existing files green (115 pre-existing tests). `lint` and `build` green.

## Self-Check: PASSED

All 8 created test files, the SUMMARY, and the 2 modified source files are present on disk; all three task commits (7a1a1fe, 46014c0, 8b7c6fd) exist in git history.

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
