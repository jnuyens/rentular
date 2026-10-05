---
phase: 11-mcp-server-external-api-access
verified: 2026-10-05T19:50:00Z
status: passed
score: 5/5 roadmap success criteria verified at code level (6/6 requirement IDs satisfied); live positive-path PAT smoke confirmed on production post-verification
has_blocking_gaps: false
overrides_applied: 1
overrides:
  - must_have: "A Drizzle migration creating api_tokens and api_tool_calls is generated and committed (packages/db/drizzle/0001_api_tokens.sql, meta/_journal.json idx 1)"
    reason: "The 0000 Drizzle snapshot is stale against production (phases 2-9 maintained prod schema via db:push, not migration files), so drizzle-kit generate would replay a non-additive backlog (8 CREATE + 20+ ALTER) that could fail or corrupt production if committed and migrated. User approved Option A: apply the verified, additive-only CREATE TABLE/INDEX DDL for only the two new tables directly on m1 (byte-identical to what db:push would generate), fully reversible, instead of committing a misleading migration file. The underlying runtime truth (both tables live, unique hash index, pepper set, Bearer pipeline fail-closed) was verified on m1 and recorded in 11-07-SUMMARY.md."
    accepted_by: "jnuyens (via explicit instruction to this verification run)"
    accepted_at: "2026-10-05T19:42:00Z"
human_verification:
  - test: "In production, create a read-scoped PAT in Settings > API tokens, then curl -H \"Authorization: Bearer <token>\" https://www.rentular.com/api/v1/properties and confirm it returns the owner's real properties (200, not empty); revoke the token in Settings and rerun the same curl, confirming 401; then check SELECT tool, status, http_status FROM api_tool_calls ORDER BY created_at DESC LIMIT 3 shows both calls."
    expected: "First curl returns the token owner's properties JSON; second curl (after revoke) returns 401; two new api_tool_calls rows appear (status ok then the post-revoke call recorded as a 401, or absent if 401 occurs before tokenId resolves)."
    why_human: "Requires production DB/API access and a live PAT; 11-07-SUMMARY.md explicitly recorded only the fail-closed/401 path (bogus token, non-rtl Bearer, no auth) as observed on m1, and listed this positive mint -> curl 200 -> revoke -> 401 -> audit-row smoke test as a 'Known follow-on... still worth doing', i.e. not yet confirmed done."
  - test: "Add apps/mcp-server/dist/index.js to Claude Desktop or Claude Code with a real RENTULAR_API_URL and RENTULAR_PAT (per the README), run list_properties and confirm only the token owner's properties come back, then call mark_rent_paid or record_ledger_payment with a read-scoped token and confirm the tool surfaces the 403 refusal text instead of retrying."
    expected: "list_properties returns the real owner-scoped property list through a live Claude client; a write tool called with a read-scoped token returns isError true with the 'Refused by Rentular (insufficient role or read-only token)' prefix; a corresponding row with status 'forbidden' appears in api_tool_calls."
    why_human: "11-06-PLAN.md's own verification section marks this as 'Manual (VALIDATION manual-only row for MCP-01...)' requiring a real Claude client, a live production PAT, and visual/interactive confirmation that cannot be grepped or asserted from the codebase alone; no SUMMARY records this having been run."
---

# Phase 11: MCP Server & External API Access Verification Report

**Phase Goal:** Rentular is reachable by agents and integrations through token-authenticated API access and an MCP server, without weakening the browser session flow, and every tool/endpoint stays scoped to the caller's accessible properties and role.
**Verified:** 2026-10-05T19:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can mint and revoke Personal Access Tokens in Settings; tokens are stored hashed with an expiry and last-used timestamp | VERIFIED (code) | `packages/db/src/schema/apiTokens.ts` (token_hash char(64), unique index, scope enum, expires_at/last_used_at/revoked_at); `apps/api/src/lib/apiTokens.ts` mintToken/hashToken/revokeToken/touchLastUsed implemented exactly as specified; `apps/api/src/routes/apiTokens.ts` GET/POST/DELETE wired, session-only, show-once; `apps/web/components/ApiTokensCard.tsx` full list/create/show-once/revoke UI wired to `/api/v1/api-tokens` with credentials include. `pnpm --filter @rentular/api test` 174/174 green (includes 8 apiTokens lib tests + 6 route tests). Live production existence of the tables is covered by the accepted override above; the full positive mint->curl->revoke smoke test is a human-verification item (see below). |
| 2 | The API authenticates `Authorization: Bearer rtl_...` to the same userId + per-property role checks as the session cookie, and rejects revoked/expired tokens | VERIFIED | `apps/api/src/lib/authMiddleware.ts`: exclusive, fail-closed Bearer branch inserted before the cookie path; resolves via `findActiveTokenByHash(hashToken(raw))`, sets userId/tokenScope/tokenId, fires `touchLastUsed` unawaited; any unresolved/non-rtl/thrown-error Bearer sets userId null and `return next()` without touching cookies. `apps/api/src/lib/routeAuth.ts` exports `requireWriteScope` (403 "Token is read-only" on non-GET/HEAD/OPTIONS when tokenScope is "read"). Wired in `apps/api/src/index.ts` for every protected prefix. `pnpm --filter @rentular/api test` passes authMiddleware.test.ts (9/9) and tokenScope.test.ts (6/6). Live verification on m1 (per 11-07-SUMMARY.md, accepted as evidence): bogus rtl_ token -> 401, non-rtl Bearer -> 401, no auth -> 401, API boots clean with pepper loaded. |
| 3 | A standalone MCP server exposes read tools (properties, leases, tenants, payment overview, ledger, indexation status) scoped to the token's accessible properties | VERIFIED (code) | `apps/mcp-server/src/tools/read.ts` defines exactly 7 read tools (list_properties, get_property, list_leases, list_tenants, payment_overview, lease_ledger, indexation_status), each calling the HTTP API with the caller's Bearer token — no DB access, no local re-scoping (scoping happens in the already-verified API). `apps/mcp-server/src/index.ts` wires `McpServer` + `StdioServerTransport`, `registerTool` per tool. `pnpm --filter @rentular/mcp-server test` 21/21 green; `lint` (tsc) and `build` (tsup, ESM, shebang) both verified clean by this run. Fail-closed boot confirmed live: `RENTULAR_API_URL=... node dist/index.js` with no `RENTULAR_PAT` exits 1 on stderr. A live Claude Desktop/Code connection test is a human-verification item (see below). |
| 4 | The MCP server exposes guarded write tools (mark rent paid, send reminder, record ledger payment, apply indexation) that require manager+ and are logged | VERIFIED (code) | `apps/mcp-server/src/tools/write.ts` defines exactly the 4 write tools, each description stating "Requires a write-scoped token and manager or higher on the property," each POSTing with `X-Rentular-Tool` and surfacing 403 as an explicit refusal (isError). API-side gates confirmed hardened: `apps/api/src/routes/ledger.ts` (`hasMinimumRole(role, "manager")` on record-payment) and `apps/api/src/routes/payments.ts` (`hasMinimumRole(role, "manager")` on send-reminder); `mark-month-paid` and `apply/:leaseId` (indexation) were already manager+ per the plan. Audit logging: `apps/api/src/lib/apiTokenGuards.ts` `bearerAuditLog` inserts one `api_tool_calls` row per Bearer request including denied ones, with redacted args. `writeGuards.test.ts`, `apiTokenGuards.test.ts` and the mcp-server tool tests all green. Live confirmation of a real `forbidden` audit row via an actual Claude client call is a human-verification item (see below). |
| 5 | The design decision (`specs/mcp-and-api-access.md`) is reflected: standalone server, stdio first, remote (Streamable HTTP + OAuth) documented as the follow-on | VERIFIED | `apps/mcp-server/README.md` documents setup, the 11-tool table, and an explicit "out of scope / follow-on" section naming Streamable HTTP + OAuth, OpenAPI generation and service accounts, stating SSE is deprecated and unused. `.planning/specs/mcp-and-api-access.md` Status line reads "Accepted (Phase 11: PAT + stdio MCP built; remote + OpenAPI deferred)". |

**Score:** 5/5 roadmap success criteria verified at the code level; 2 production/live-integration smoke tests remain for a human to run (see Human Verification Required).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/apiTokens.ts` | api_tokens table, unique token_hash index | VERIFIED | Contains `api_tokens_hash_idx` uniqueIndex, `token_hash` char(64), scope enum, FK to users.id cascade |
| `packages/db/src/schema/apiToolCalls.ts` | api_tool_calls audit table | VERIFIED | mysqlEnum status ok/error/forbidden, json args, tool varchar(80), user/token indexes |
| `packages/db/src/schema/index.ts` | barrel exports both new tables | VERIFIED | `export * from "./apiTokens"` and `"./apiToolCalls"` present |
| `apps/api/src/lib/apiTokens.ts` | token service (8 exports) | VERIFIED | requireApiTokenPepper, mintRawToken, hashToken, mintToken, findActiveTokenByHash, listTokens, revokeToken, touchLastUsed all present, matching the Plan 01 interface exactly |
| `apps/api/src/lib/authMiddleware.ts` | exclusive fail-closed Bearer branch | VERIFIED | Inserted before cookie path; never reads cookies for a Bearer request; no token/hash logged |
| `apps/api/src/lib/routeAuth.ts` | requireWriteScope | VERIFIED | 403 "Token is read-only" on non-GET/HEAD/OPTIONS when tokenScope is read |
| `apps/api/src/lib/csrfPolicy.ts` | shouldSkipCsrf | VERIFIED | Webhook paths + "Bearer rtl_" only; cookie requests keep full Origin check |
| `apps/api/src/lib/apiTokenGuards.ts` | bearerRateLimit, bearerAuditLog, redactAuditArgs | VERIFIED | INCR+EXPIRE rate limit, fail-open on Redis error, fire-and-forget audit insert, deep redaction |
| `apps/api/src/routes/apiTokens.ts` | owner-scoped, session-only /api-tokens router | VERIFIED | 401 no session, 403 PAT caller, show-once 201, owner-scoped revoke, no tokenHash in any response |
| `apps/api/src/routes/ledger.ts` | manager+ gate on record-payment | VERIFIED | `hasMinimumRole(role, "manager")` present after `authorizeLease` |
| `apps/api/src/routes/payments.ts` | manager+ gate on send-reminder | VERIFIED | `hasMinimumRole(role, "manager")` present in the send-reminder handler |
| `apps/api/src/services/reminderChannel.ts` | sendReminderViaPreferredChannel shared dispatch | VERIFIED | whatsapp/sms/email fallback logic present, used by both the worker and manualReminder |
| `apps/api/src/services/manualReminder.ts` | channel-aware dispatch, records channel used | VERIFIED | selects `tenants.preferredChannel`, calls `sendReminderViaPreferredChannel`, inserts/returns the actual channel |
| `apps/api/src/index.ts` | full pipeline wiring | VERIFIED | authMiddleware -> bearerRateLimit -> bearerAuditLog order confirmed; requireWriteScope on every protected prefix; `/api-tokens` mounted and in protectedPrefixes; shouldSkipCsrf used in the CSRF wrapper |
| `apps/web/components/ApiTokensCard.tsx` | list/create/show-once/revoke UI | VERIFIED | All three fetches use credentials include; AlertDialog show-once bound to `newToken` state only (no localStorage/URL persistence); revoke confirmation names the token |
| `apps/web/app/(dashboard)/settings/page.tsx` | api-tokens tab | VERIFIED | `TabsTrigger value="api-tokens"`, `TabsContent` renders `<ApiTokensCard apiUrl={apiUrl} />`, grid now md:grid-cols-6 |
| `apps/web/messages/{en,nl,fr,de}/common.json` | 34 settings.apiTokens* keys, 4-way parity | VERIFIED | Parity script run in this verification: all 34 keys present in all 4 locales |
| `apps/mcp-server/package.json` | ESM package, rentular-mcp bin, no @rentular/* deps | VERIFIED | `"type": "module"`, bin `rentular-mcp`, deps limited to `@modelcontextprotocol/sdk` + `zod`, zero `@rentular/shared`/`@rentular/db` |
| `apps/mcp-server/src/httpClient.ts` | createApiClient + readEnvConfig | VERIFIED | Bearer + X-Rentular-Tool headers, AbortController timeout, fail-soft network errors, fails closed on missing/malformed env |
| `apps/mcp-server/src/tools/read.ts` | 7 read tools | VERIFIED | Exactly list_properties, get_property, list_leases, list_tenants, payment_overview, lease_ledger, indexation_status |
| `apps/mcp-server/src/tools/write.ts` | 4 write tools | VERIFIED | Exactly mark_rent_paid, send_reminder, record_ledger_payment, apply_indexation; manager+ language and preferred-channel language present |
| `apps/mcp-server/src/index.ts` | McpServer + StdioServerTransport | VERIFIED | registerTool loop, stdio connect, fail-closed on main() error, stderr-only logging |
| `apps/mcp-server/README.md` | setup, tools, follow-on | VERIFIED | Streamable HTTP + OAuth, OpenAPI, service accounts named as follow-on; claude_desktop_config and claude mcp add snippets present |
| `packages/db/drizzle/0001_api_tokens.sql` + `_journal.json` idx 1 | committed additive migration | **MISSING, OVERRIDDEN** | Deliberately not committed per user-approved Option A (see override in frontmatter); the live-DB truth was applied directly and recorded in 11-07-SUMMARY.md instead |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `authMiddleware.ts` | `apiTokens.ts` | `findActiveTokenByHash(hashToken(raw))` + `touchLastUsed` | WIRED | Confirmed by code read and green authMiddleware.test.ts |
| `index.ts` | `csrfPolicy.ts` | `shouldSkipCsrf(c)` inside the CSRF wrapper | WIRED | `grep` confirms call site; webhook path check moved out of index.ts |
| `index.ts` | `apiTokenGuards.ts` | `app.use("*", bearerRateLimit)` then `bearerAuditLog` | WIRED | Confirmed order: authMiddleware -> bearerRateLimit -> bearerAuditLog |
| `apiTokenGuards.ts` | `apiToolCalls` table | `getDb().insert(apiToolCalls).values(row)` | WIRED | Present, fire-and-forget with `.catch` |
| `ledger.ts` / `payments.ts` | `propertyAccess.ts` | `getUserPropertyRole` + `hasMinimumRole` | WIRED | Confirmed in both files at the record-payment and send-reminder handlers |
| `manualReminder.ts` | `reminderChannel.ts` | `sendReminderViaPreferredChannel` | WIRED | Confirmed call site and channel propagation into the DB insert and result |
| `apps/mcp-server/src/tools/write.ts` | Rentular API POST endpoints | `api.post(path, tool, body)` with `X-Rentular-Tool` | WIRED | All 4 write tools map to the correct paths; 403 handling prefixes the refusal text |
| `apps/mcp-server/src/index.ts` | `@modelcontextprotocol/sdk` | `server.registerTool` + `StdioServerTransport` | WIRED | Confirmed via code read, `pnpm build` success, and a manual fail-closed boot run |
| `ApiTokensCard.tsx` | `/api/v1/api-tokens` | `fetch` with `credentials: "include"` | WIRED | GET/POST/DELETE all use credentials include; confirmed by grep and code read |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `ApiTokensCard.tsx` | `tokens` (useState) | `GET /api/v1/api-tokens` -> `listTokens(userId)` -> `getDb().select()...from(apiTokens)` | Yes — real Drizzle query, not static | FLOWING |
| `apps/mcp-server` read tools | N/A (no local state) | Each tool calls the live `/api/v1/*` endpoint via `api.get`; the API performs the real DB-backed `getAccessiblePropertyIds` scoping | Yes — tool never fabricates data, relays the API's response verbatim | FLOWING |
| `apps/api` `api_tool_calls` audit rows | `row` built in `bearerAuditLog` | `getDb().insert(apiToolCalls).values(row)` with real redacted args, real tool name, real status | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| API typecheck | `pnpm --filter @rentular/api lint` | exit 0 | PASS |
| Full API test suite | `pnpm --filter @rentular/api test -- --run` | 174/174 passed, 31 files | PASS |
| MCP server test suite | `pnpm --filter @rentular/mcp-server test` | 21/21 passed, 1 file | PASS |
| MCP server typecheck | `pnpm --filter @rentular/mcp-server lint` | exit 0 | PASS |
| MCP server build | `pnpm --filter @rentular/mcp-server build` | dist/index.js emitted, 9.71 KB | PASS |
| MCP binary shebang | `head -c 21 apps/mcp-server/dist/index.js` | `#!/usr/bin/env node` | PASS |
| MCP fail-closed boot (no RENTULAR_PAT) | `RENTULAR_API_URL=http://localhost:4000 node apps/mcp-server/dist/index.js` | exit 1, stderr: "RENTULAR_PAT is not set..." | PASS |
| Web typecheck | `pnpm --filter @rentular/web lint` | exit 0 | PASS |
| i18n key parity (34 keys x 4 locales) | Python JSON parity script | all present, no missing keys | PASS |
| Debt-marker scan on 18 phase files | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` | no matches | PASS |

### Probe Execution

SKIPPED (no runnable probe scripts declared or found; Phase 11 uses vitest suites and manual production checkpoints instead of `scripts/*/tests/probe-*.sh`).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| API-01 | 11-01, 11-02, 11-07 | Personal Access Tokens: hashed store with mint/revoke | SATISFIED (code); production existence per accepted override | `apps/api/src/lib/apiTokens.ts`, `packages/db/src/schema/apiTokens.ts`, 11-07-SUMMARY.md live verification |
| API-02 | 11-01, 11-04 | Bearer auth resolves to same userId/role checks, rejects revoked/expired | SATISFIED | `authMiddleware.ts` Bearer branch, authMiddleware.test.ts green, live 401 fail-closed confirmed on m1 |
| API-03 | 11-02, 11-05 | Token management UI in Settings | SATISFIED | `apps/web/components/ApiTokensCard.tsx`, settings page tab, i18n parity confirmed |
| MCP-01 | 11-06 | Standalone MCP server authenticating with a PAT, stdio transport | SATISFIED (code); live Claude-client connection is a human-verification item | `apps/mcp-server/src/index.ts`, build/boot verified |
| MCP-02 | 11-06 | Scoped read tools | SATISFIED | `apps/mcp-server/src/tools/read.ts`, 21 passing tool tests |
| MCP-03 | 11-01, 11-03, 11-04, 11-06 | Guarded write tools requiring manager+, logged | SATISFIED (code); live forbidden-audit-row confirmation is a human-verification item | `ledger.ts`/`payments.ts` role gates, `apiTokenGuards.ts` audit log, `apps/mcp-server/src/tools/write.ts` |

No orphaned requirements: REQUIREMENTS.md lists exactly API-01, API-02, API-03, MCP-01, MCP-02, MCP-03 for Phase 11, and every one is claimed by at least one plan's frontmatter `requirements:` field.

### Anti-Patterns Found

None. Scanned all 18 files created/modified by Phase 11 plans for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER and stub-shaped patterns; no matches.

### Human Verification Required

### 1. Production end-to-end PAT smoke test (positive path)

**Test:** In production, create a read-scoped PAT via Settings > API tokens, `curl -H "Authorization: Bearer <token>" https://www.rentular.com/api/v1/properties` and confirm real data returns (200), then revoke the token in Settings and rerun the curl (expect 401), then check `SELECT tool, status, http_status FROM api_tool_calls ORDER BY created_at DESC LIMIT 3`.
**Expected:** First curl returns the owner's properties; second curl (post-revoke) returns 401; `api_tool_calls` shows rows for the calls.
**Why human:** 11-07-SUMMARY.md explicitly recorded only the fail-closed/401 path (bogus token, non-rtl Bearer, no auth) as observed on m1 and lists this exact positive smoke test as a "Known follow-on... still worth doing" — i.e., not yet run. This requires live production DB/API access this verifier cannot reach.

### 2. Live MCP client connection test

**Test:** Configure Claude Desktop or Claude Code with `apps/mcp-server/dist/index.js`, a real `RENTULAR_API_URL` and a real `RENTULAR_PAT` (per the README). Run `list_properties` and confirm only the token owner's properties return. Then call a write tool (e.g. `mark_rent_paid`) with a read-scoped token and confirm the tool surfaces the refusal text rather than retrying, and that a `status: "forbidden"` row appears in `api_tool_calls`.
**Expected:** Real owner-scoped data via a live Claude client; a clear refusal message on a 403; a matching audit row.
**Why human:** 11-06-PLAN.md's own verification section marks this "Manual (VALIDATION manual-only row for MCP-01...)" because it requires a real Claude client, a live PAT, and interactive confirmation that cannot be derived from static code analysis or the local test suite.

### Gaps Summary

No code-level gaps. All six requirement IDs (API-01, API-02, API-03, MCP-01, MCP-02, MCP-03) are implemented, tested (174 API tests + 21 MCP tests, all green), typechecked clean across api/web/mcp-server, and wired end-to-end in the codebase: the Bearer pipeline is exclusive and fail-closed, write endpoints are hardened to manager+, the reminder channel dispatch is shared and tested, the Settings UI is fully wired with 4-locale parity, and the MCP server implements exactly the 11 documented tools against the hardened API.

One artifact (the committed Drizzle migration file) is deliberately absent by an explicit, user-approved production-safety decision (Option A); this is recorded as an accepted override, not a gap, because the underlying database truth was applied and verified directly on m1 and documented in 11-07-SUMMARY.md.

Two items remain that only a human with live production/Claude-client access can close, both explicitly flagged as outstanding by the phase's own planning and summary documents rather than invented by this verification: the positive-path PAT smoke test (mint -> curl 200 -> revoke -> 401 -> audit rows) and a live MCP-client connection test. Neither blocks the phase goal at the code level, but both should be run before fully closing out Phase 11's production readiness.

---

*Verified: 2026-10-05T19:50:00Z*
*Verifier: Claude (bm-verifier)*
