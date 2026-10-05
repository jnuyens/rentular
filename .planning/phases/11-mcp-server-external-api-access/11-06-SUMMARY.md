---
phase: 11-mcp-server-external-api-access
plan: 06
subsystem: mcp-server
tags: [mcp, stdio, pat, bearer-auth, http-client, zod, vitest, esm]

# Dependency graph
requires:
  - phase: 11-mcp-server-external-api-access
    plan: 04
    provides: "authMiddleware Bearer rtl_ branch, requireWriteScope, per-token rate limit, X-Rentular-Tool audit"
provides:
  - "@rentular/mcp-server ESM workspace package with a rentular-mcp bin (dist/index.js)"
  - "createApiClient + readEnvConfig: Bearer PAT + X-Rentular-Tool HTTP client modeled on lib/whatsapp.ts"
  - "7 read tools + 4 write tools mapped to existing /api/v1 endpoints, scoped by the API"
  - "README documenting stdio setup and the remote (Streamable HTTP + OAuth) / OpenAPI follow-on as out of scope"
affects: []

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@1.32.0 (mcp-server package only)"
    - "zod@3.25.76 (mcp-server package only, isolated from the repo-wide 3.24 pin)"
  patterns:
    - "Transport-agnostic tools: tools/*.ts hold the endpoint map; only index.ts wires StdioServerTransport, so a future remote transport swaps without touching tools"
    - "Fail-soft HTTP client: network errors resolve to { ok:false, status:0 } so a tool always produces a result instead of throwing"
    - "zod RAW SHAPES (plain validator objects) as MCP inputSchema, never wrapped objects, per SDK 1.32.0"

key-files:
  created:
    - apps/mcp-server/package.json
    - apps/mcp-server/tsconfig.json
    - apps/mcp-server/tsup.config.ts
    - apps/mcp-server/vitest.config.ts
    - apps/mcp-server/src/httpClient.ts
    - apps/mcp-server/src/tools/types.ts
    - apps/mcp-server/src/tools/read.ts
    - apps/mcp-server/src/tools/write.ts
    - apps/mcp-server/src/index.ts
    - apps/mcp-server/src/__tests__/tools.test.ts
    - apps/mcp-server/README.md
  modified:
    - pnpm-lock.yaml
    - .planning/specs/mcp-and-api-access.md

key-decisions:
  - "send_reminder is described (and behaves, via the Plan 03 channel-aware endpoint) as preferred-channel with email fallback, not email-only"
  - "The write handler defaults apply_indexation.sendNotification to true itself rather than relying on zod parsing, so the default holds regardless of how args arrive"
  - "403 responses are prefixed with an explicit refusal message so the model explains the denial instead of retrying"

requirements-completed: [MCP-01, MCP-02, MCP-03]

# Metrics
duration: 5min
completed: 2026-10-05
---

# Phase 11 Plan 06: Standalone stdio MCP server Summary

**A new ESM workspace package, @rentular/mcp-server, holds a Personal Access Token and calls the hardened Rentular HTTP API over a thin fetch client: seven scoped read tools and four manager+ write tools, each carrying Bearer rtl_ plus X-Rentular-Tool, with a README that documents local setup and scopes the remote and OpenAPI transports as follow-on.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 3
- **Files created:** 11 (plus pnpm-lock.yaml and the spec status line modified)

## Accomplishments

- Scaffolded `apps/mcp-server` as an ESM package (`"type": "module"`, `rentular-mcp` bin, own `zod ^3.25` and `@modelcontextprotocol/sdk ^1.32.0`, no `@rentular/*` dependency), mirroring the API's tsup/tsconfig/vitest toolchain. `pnpm install` registered the workspace and updated `pnpm-lock.yaml` (SDK resolved to `1.32.0(zod@3.25.76)`).
- `createApiClient` builds `Authorization: Bearer <PAT>`, `Accept`, `X-Rentular-Tool` headers, normalizes the base URL (strips a trailing slash and a trailing `/api/v1`, then prefixes `/api/v1` once), appends defined query params, uses an AbortController timeout, and returns a fail-soft `{ ok:false, status:0 }` on network error instead of throwing. `readEnvConfig` throws a clear error naming `RENTULAR_API_URL` / `RENTULAR_PAT` and rejects a token without the `rtl_` prefix.
- Implemented the 7 read tools (`list_properties`, `get_property`, `list_leases`, `list_tenants`, `payment_overview`, `lease_ledger`, `indexation_status`) and the 4 write tools (`mark_rent_paid`, `send_reminder`, `record_ledger_payment`, `apply_indexation`) against the exact `/api/v1` endpoints and bodies, with raw-shape zod schemas and a 403-to-refusal prefix on writes.
- Wired `index.ts`: `McpServer` + `StdioServerTransport`, `registerTool` per `ToolDef`, fail-closed on missing env, stderr-only logging, transport confined to `index.ts`.
- Wrote the README (what it is, prerequisites, install/build, Claude Desktop JSON + Claude Code `claude mcp add`, read/write tool tables, security notes, out-of-scope follow-on, development) and flipped the spec status to Accepted.

## Task Commits

1. **Task 1: scaffold package, HTTP client, contracts, Wave 0 tests** - `d0e5b3a` (feat)
2. **Task 2: implement 7 read + 4 write tools and stdio entrypoint** - `7f8c8e1` (feat)
3. **Task 3: README + spec status** - `c17f044` (docs)

**Plan metadata:** committed with this summary.

## Verification Results

- `pnpm --filter @rentular/mcp-server test`: 21/21 passed across 1 file (observed), covering the 7+4 tool names, each method/path/tool-header, the `lease_ledger` `months` query, path-param vs body split for `record_ledger_payment`, `apply_indexation` `sendNotification` default true, 403 -> isError for reads and all writes, the `manager` / `preferred channel` description assertions, `createApiClient` header + URL-normalization + fail-soft, and `readEnvConfig` rejecting a non-`rtl_` token.
- `pnpm --filter @rentular/mcp-server lint` (tsc --noEmit): exit 0 (observed).
- `pnpm --filter @rentular/mcp-server build` (tsup ESM): `dist/index.js` emitted; `head -c 21` shows the `#!/usr/bin/env node` shebang (observed).
- Fail-closed boot: `RENTULAR_API_URL=http://localhost:4000 node dist/index.js` with `RENTULAR_PAT` unset exits 1 with the env error on stderr (observed).
- Acceptance greps (observed): `registerTool` count 1, `z.object(` count 0 across `tools/*.ts`, `server.tool(` count 0, `console.log` count 0, `preferred channel` present and `email only` absent in `write.ts` and `README.md`, no em/en-dash in `README.md`, spec diff is one line.
- Regression: `pnpm --filter @rentular/api lint` exit 0 and `pnpm --filter @rentular/api test` 174/174 passed across 31 files (observed), unchanged from Plan 04. The `pnpm-lock.yaml` diff touches only the new `apps/mcp-server` importer; the `apps/api` and `apps/web` importer entries are unchanged, so neither existing app's resolution moved.

## Decisions Made

- **send_reminder is channel-aware, not email-only.** The tool description matches the Plan 03 endpoint behavior (preferred channel of email, SMS or WhatsApp with email fallback; the response names the channel used). This resolves RESEARCH Pitfall 3 / Open Question 1 in favor of option (b), consistent with CONTEXT.
- **The handler defaults sendNotification to true.** See Deviations: relying on zod's `.default(true)` only applies when the SDK parses the args; the handler now coalesces so the default holds even when args arrive unvalidated.
- **403 responses are prefixed** with "Refused by Rentular (insufficient role or read-only token): " so the model surfaces the denial clearly (T-11-03).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `??` and `||` cannot be mixed without parentheses**
- **Found during:** Task 1
- **Issue:** `opts.timeoutMs ?? Number(process.env.RENTULAR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS` is a parse error under the vitest oxc transform (and is invalid TS): logical and nullish-coalescing operators cannot be combined unparenthesized.
- **Fix:** Parenthesized the fallback: `opts.timeoutMs ?? (Number(...) || DEFAULT_TIMEOUT_MS)`.
- **Files modified:** apps/mcp-server/src/httpClient.ts
- **Verification:** the suite then imported and the RED failure became the intended missing-module error; all tests green after Task 2.
- **Committed in:** d0e5b3a

**2. [Rule 1 - Bug] apply_indexation default applied in the handler, not via zod**
- **Found during:** Task 2
- **Issue:** The plan test asserts `apply_indexation` forwards `sendNotification: true` when the caller omits it. zod's `.default(true)` only fills in during `.parse()`, which does not run when the handler is called with raw args (as the test does, and as could happen if a caller bypasses SDK validation). The forwarded body had `sendNotification: undefined`.
- **Fix:** The handler forwards `args.sendNotification ?? true`.
- **Files modified:** apps/mcp-server/src/tools/write.ts
- **Verification:** the `apply_indexation` case and the full 21-test suite pass.
- **Committed in:** 7f8c8e1

**3. [Rule 3 - Blocking] Comment text tripped the raw-shape acceptance grep**
- **Found during:** Task 2
- **Issue:** Explanatory comments in `read.ts`, `write.ts` and `types.ts` literally contained the string `z.object(`, which the acceptance check (`grep -c "z.object(" tools/*.ts` must be 0) flags even though no code uses a wrapped object schema.
- **Fix:** Reworded the comments to "not a wrapped object" without the literal token.
- **Files modified:** apps/mcp-server/src/tools/read.ts, write.ts, types.ts
- **Verification:** `grep -rc "z.object(" apps/mcp-server/src/tools/` returns 0; tests and lint still pass.
- **Committed in:** 7f8c8e1 (types.ts was first created in d0e5b3a; the comment reword rode with Task 2)

---

**Total deviations:** 3 auto-fixed (two blocking syntax/grep issues, one correctness default). No scope creep; no architectural changes.

## Threat Surface

All work maps to mitigations already in the plan's threat register: T-11-03 (write tools never self-authorize; 403 surfaced as an explicit refusal), T-11-05 (every request carries `X-Rentular-Tool`), T-11-09 (no token logged; stderr-only), T-11-17 (zod raw shapes with regex/enum/positive-number validators), T-11-18 (API rate-limit 429 surfaced as isError via the same non-ok path), T-11-19 (no DB access; the PAT resolves to one userId in the API), T-11-22 (send_reminder description matches the channel-aware endpoint), T-11-SC (only the audited `@modelcontextprotocol/sdk` and the already-in-repo `zod` installed; lockfile committed). No new unregistered surface was introduced.

## Known Stubs

None. The server is fully wired; live use additionally depends on the Plan 07 migration (so the API's audit insert has a table) and a prod PAT, which the plan's verification notes as manual-only.

## Self-Check: PASSED

All 11 created files and the README are present on disk; the three task commits (d0e5b3a, 7f8c8e1, c17f044) exist in git history; `pnpm-lock.yaml` and the spec status line are modified.

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
