---
phase: 11-mcp-server-external-api-access
fixed_at: 2026-10-06T18:48:38Z
review_path: .planning/phases/11-mcp-server-external-api-access/11-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-10-06T18:48:38Z
**Source review:** .planning/phases/11-mcp-server-external-api-access/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 critical, 4 warning, 1 info acted on, 1 info intentionally skipped)
- Fixed: 5
- Skipped: 1 (IN-01, deferred by instruction: needs a prod migration)

All verification gates are green after the fixes:
- `pnpm --filter @rentular/api test`: 31 files, 174 tests passed
- `pnpm --filter @rentular/api lint` (tsc --noEmit): passed
- `pnpm --filter @rentular/mcp-server test`: 1 file, 21 tests passed
- `pnpm --filter @rentular/mcp-server build` (tsup): build success
- `pnpm --filter @rentular/web lint` (tsc --noEmit): passed

## Fixed Issues

### CR-01: Audit log `tool` field is fully client-controlled

**Files modified:** `apps/api/src/lib/apiTokenGuards.ts`, `apps/api/src/lib/__tests__/apiTokenGuards.test.ts`
**Commit:** 8efc9fd
**Applied fix:** Did not change the `api_tool_calls` schema (the table is live in production; no migration). Reworked `resolveTool()` so the `tool` column always starts with the server-derived, unspoofable `METHOD path`. When the client sends a valid `X-Rentular-Tool` header, the sanitized value (lowercased, `[a-z0-9_]` only) is appended in parentheses as a claimed label: `` `${real} (${cleaned})` ``. The whole string is capped with `.slice(0, 80)` to fit `varchar(80)`, keeping the authoritative `METHOD path` prefix first. The client header can no longer replace the real method/path. Updated the two T-11-05 `bearerAuditLog` test cases: the header case now asserts `"POST /payments/mark-month-paid (mark_rent_paid)"` (real METHOD PATH present, client hint appended), and the no-header case still asserts `"POST /payments/mark-month-paid"`.

### WR-01: Read-only PAT not blocked from Stripe/support write routes

**Files modified:** `apps/api/src/index.ts`
**Commit:** f1b8f5c
**Applied fix:** Added `requireWriteScope` alongside the existing `requireAuth` on `/support/chat`, `/support/chat/*`, `/stripe/checkout`, and `/stripe/subscription`, matching how `requireWriteScope` is wired onto the `protectedPrefixes` routers. A read-scoped PAT now gets 403 on the state-changing calls (`POST /stripe/checkout`, `POST /support/chat`). Cookie sessions (`tokenScope` null) and write PATs pass unchanged. `/stripe/subscription` is a GET, for which `requireWriteScope` is a no-op, so behaviour there is unchanged. The `/stripe/webhook` and `/support/signal-webhook` endpoints were left untouched: they carry their own auth and are not reachable by a read PAT via these mounts.

### WR-02: Unencoded path params in MCP tools

**Files modified:** `apps/mcp-server/src/tools/read.ts`, `apps/mcp-server/src/tools/write.ts`
**Commit:** 2eae050
**Applied fix:** Wrapped every dynamic path segment in `encodeURIComponent`: `get_property` (`propertyId`), `lease_ledger` and `indexation_status` (`leaseId`) in read.ts; `record_ledger_payment` and `apply_indexation` (`leaseId`) in write.ts. A crafted identifier containing `?`, `/`, or `..` can no longer corrupt the path or silently reroute the request. I deliberately kept the zod schemas at `z.string().min(1)` rather than tightening to `z.string().uuid()` (the review offered this only as an optional preference): `tools.test.ts` exercises the handlers with non-UUID ids like `p1`/`l1`, which are still correct API identifiers in tests, and encoding alone closes the injection boundary. The MCP test expectations needed no change because `p1`/`l1` encode to themselves.

### WR-03: `redactAuditArgs` collapses distinct sensitive keys

**Files modified:** `apps/api/src/lib/apiTokenGuards.ts`
**Commit:** 4ad182d
**Applied fix:** The compound-key branch (a key that embeds a sensitive word but is not an exact match) previously wrote every match to the single literal property `out["[redacted]"]`, so multiple such keys at one depth overwrote each other. Replaced it with a per-object counter producing a collision-free placeholder `` `[redacted:${redactedCount}]` ``. Each distinct sensitive field now yields a distinct entry, preserving how many sensitive fields a call carried, while still masking the field name (so embedded context cannot leak). Non-sensitive keys and structure are untouched. Existing redaction tests stay green: the exact-match keys (`token`, `password`, `iban`) are unaffected, and the `secretThing` audit assertion still sees `[redacted]` and no `secret` substring.

### WR-04: CSRF skip uses `path.includes()`

**Files modified:** `apps/api/src/lib/csrfPolicy.ts`
**Commit:** 523efb5
**Applied fix:** Replaced the substring checks with anchored prefix matches: `path.startsWith("/api/v1/webhooks/") || path.startsWith("/api/v1/stripe/webhook")`. `c.req.path` includes the `/api/v1` basePath, so these match the real mount prefixes. A future nested route that merely contains those substrings can no longer smuggle itself into the CSRF exemption. The `Bearer rtl_` exemption and the cookie-flow Origin check are unchanged; the authMiddleware CSRF tests remain green.

### IN-02: Dead `.catch()` at the `touchLastUsed` call site

**Files modified:** `apps/api/src/lib/authMiddleware.ts`
**Commit:** f40f2d2
**Applied fix:** `touchLastUsed` already swallows all errors internally and returns a promise that never rejects, so the call-site `.catch(() => {})` was unreachable. Replaced it with `void touchLastUsed(row.id);` to keep the fire-and-forget intent explicit (one layer of error responsibility, inside the service). Confirmed unreachable before removing by re-reading `touchLastUsed` in `apiTokens.ts`.

## Skipped Issues

### IN-01: `apiToolCalls.userId` has no `onDelete` behavior while `apiTokens.userId` cascades

**File:** `packages/db/src/schema/apiToolCalls.ts:19-21`
**Reason:** Skipped intentionally per the task instruction. Correcting the FK `onDelete` inconsistency would require altering the `api_tool_calls` table, which is already live in production and would need a new migration. That is explicitly out of scope for this fix pass. Noted here for a future, deliberate decision: audit history for a Bearer-authenticated user currently cannot be removed by a plain user delete (the FK defaults to RESTRICT), while that user's tokens cascade-delete. A future migration should decide whether audit rows outlive the user (common for audit logs) and set the behaviour explicitly.
**Original issue:** `apiTokens.userId` is declared with `onDelete: "cascade"` but `apiToolCalls.userId` has no `onDelete`, so deleting a user who made Bearer calls would fail or need a separate cleanup step.

---

_Fixed: 2026-10-06T18:48:38Z_
_Fixer: Claude (bm-code-fixer)_
_Iteration: 1_
