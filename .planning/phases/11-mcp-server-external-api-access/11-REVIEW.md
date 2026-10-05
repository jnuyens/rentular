---
phase: 11-mcp-server-external-api-access
reviewed: 2026-10-05T17:50:32Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - apps/api/src/index.ts
  - apps/api/src/jobs/paymentCheckWorker.ts
  - apps/api/src/lib/apiTokenGuards.ts
  - apps/api/src/lib/apiTokens.ts
  - apps/api/src/lib/authMiddleware.ts
  - apps/api/src/lib/csrfPolicy.ts
  - apps/api/src/lib/routeAuth.ts
  - apps/api/src/routes/apiTokens.ts
  - apps/api/src/routes/ledger.ts
  - apps/api/src/routes/payments.ts
  - apps/api/src/services/manualReminder.ts
  - apps/api/src/services/reminderChannel.ts
  - apps/api/src/types/hono.d.ts
  - apps/mcp-server/README.md
  - apps/mcp-server/package.json
  - apps/mcp-server/src/httpClient.ts
  - apps/mcp-server/src/index.ts
  - apps/mcp-server/src/tools/read.ts
  - apps/mcp-server/src/tools/types.ts
  - apps/mcp-server/src/tools/write.ts
  - apps/mcp-server/tsconfig.json
  - apps/mcp-server/tsup.config.ts
  - apps/mcp-server/vitest.config.ts
  - apps/web/app/(dashboard)/settings/page.tsx
  - apps/web/components/ApiTokensCard.tsx
  - apps/web/messages/de/common.json
  - apps/web/messages/en/common.json
  - apps/web/messages/fr/common.json
  - apps/web/messages/nl/common.json
  - packages/db/src/schema/apiTokens.ts
  - packages/db/src/schema/apiToolCalls.ts
  - packages/db/src/schema/index.ts
  - packages/shared/src/constants/index.ts
  - packages/shared/src/types/index.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-10-05T17:50:32Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Reviewed the full diff from `04aeb70` to `HEAD` for the new Personal Access Token (PAT) authentication surface: token minting/hashing/verification (`apiTokens.ts`), the exclusive Bearer branch in `authMiddleware.ts`, rate limiting and audit logging (`apiTokenGuards.ts`), the CSRF exemption (`csrfPolicy.ts`), manager+ hardening on `ledger.ts`/`payments.ts`, the new `apps/mcp-server` stdio server, and the supporting schema/web/shared changes.

The core cryptographic and fail-closed design is solid: tokens are high-entropy (256-bit random, `rtl_` prefix), hashed with a mandatory, lazily-validated pepper (`requireApiTokenPepper`, min 16 chars), verified via an indexed exact-match lookup plus a defensive `timingSafeEqual`, and the plaintext is never persisted or logged. The Bearer branch in `authMiddleware` is correctly exclusive (it never falls through to the cookie path) and fails closed on any error, including a missing pepper. The two role-hardening diffs (`ledger.ts` record-payment, `payments.ts` send-reminder) are correct, minimal, and match the stated intent (manager+ required). i18n keys for the new settings tab are complete and consistent across en/nl/fr/de.

One finding undermines a stated goal of this phase and is classified as a blocker: the `api_tool_calls` audit log's `tool` column is populated entirely from the client-supplied `X-Rentular-Tool` header, and the actual HTTP method/path of the request is never persisted anywhere in the row. A holder of a valid PAT (not just the bundled MCP server) can call any endpoint while sending an arbitrary `X-Rentular-Tool` value, producing an audit trail that misrepresents what actually happened. For a financial platform whose main justification for this audit table is incident forensics on a leaked token, a spoofable action label defeats that purpose.

Several warnings cover scope-enforcement gaps and defensive gaps that don't rise to "exploitable today" but materially weaken the new attack surface: `requireWriteScope` (the read-only-PAT guarantee) is not wired into the Stripe checkout/subscription or support-chat routes, so a leaked **read-scoped** PAT can still hit those state-changing endpoints; the MCP server interpolates caller-controlled identifiers into URL paths without `encodeURIComponent`, which can corrupt the resulting path/query for crafted input; and `redactAuditArgs` silently collapses multiple distinct non-exact sensitive keys at the same object depth into one `"[redacted]"` key, dropping information from the audit row instead of just masking it.

## Critical Issues

### CR-01: Audit log `tool` field is fully client-controlled; the real endpoint is never recorded

**File:** `apps/api/src/lib/apiTokenGuards.ts:104-113, 156-165`
**Issue:**
`resolveTool()` uses the caller-supplied `X-Rentular-Tool` header verbatim (after charset sanitization) as the audit log's `tool` value whenever the header is present, and the fallback (`` `${method} ${path}` ``) is used *only* when the header is absent:

```ts
function resolveTool(c: Context): string {
  const header = c.req.header("X-Rentular-Tool");
  if (header) {
    const cleaned = header.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 80);
    if (cleaned.length > 0) return cleaned;
  }
  return `${c.req.method} ${c.req.path}`;
}
```

The `api_tool_calls` row written in `bearerAuditLog` (`packages/db/src/schema/apiToolCalls.ts`) has no column for the actual HTTP method or path — `tool` is the *only* place any endpoint information is recorded, and it is attacker-controlled. The bundled MCP server always sends this header honestly (confirmed in `apps/mcp-server/README.md`: "recorded in the Rentular audit log with the tool name (sent as the `X-Rentular-Tool` header)"), but nothing requires that: a PAT is a bearer credential usable from any HTTP client (`curl`, Postman, a compromised third-party integration), and the header is attacker-settable on every request.

Concretely: an attacker holding a leaked write-scoped PAT can `DELETE /api-tokens/<victim-token-id>` (not possible here since the route is session-only, but applies to any real write endpoint such as `POST /payments/collect` or `POST /indexation/apply/:id`) while sending `X-Rentular-Tool: list_properties`, and the resulting audit row will read `tool: list_properties, status: ok`, hiding the real action from anyone reviewing the log after an incident. This directly undermines the phase's own stated goal (T-11-05: "a PAT call is never unaccounted for") — the call *is* accounted for, but mislabeled, which for forensic/audit purposes is arguably worse than an obvious gap.

**Fix:** Persist the real request metadata unconditionally and independently of the client hint — add a non-nullable column (e.g. `endpoint`) populated from `` `${c.req.method} ${c.req.path}` `` on every row, and keep `X-Rentular-Tool` as a separate, clearly-labeled *hint* column rather than overwriting the authoritative field:

```ts
const row = {
  id: randomUUID(),
  userId,
  tokenId,
  endpoint: `${method} ${c.req.path}`,     // authoritative, never client-controlled
  toolHint: resolveTool(c),                 // client-supplied label, informational only
  args,
  status,
  httpStatus: String(httpStatus),
  errorMessage,
};
```
Update `apiToolCalls` schema accordingly and backfill any consumers (dashboards, alerts) to key off `endpoint` for security-relevant decisions.

## Warnings

### WR-01: Read-only PAT scope is not enforced on Stripe checkout/subscription or support-chat routes

**File:** `apps/api/src/index.ts:56-128`
**Issue:** `requireWriteScope` — the middleware that turns a state-changing request from a `scope: "read"` PAT into a 403 — is applied only to the prefixes listed in `protectedPrefixes`. `/stripe/checkout`, `/stripe/subscription`, and `/support/chat` are gated with `requireAuth` only (lines 125-128), and are not in `protectedPrefixes`. Since `authMiddleware` sets `userId` for a valid PAT of either scope, a **read-scoped** PAT (the one Settings explicitly frames as safe to hand to read-only integrations) can still `POST /api/v1/stripe/checkout` (creates a real Stripe subscription checkout session for the account) or `POST /api/v1/support/chat`. This is a write action reachable by a token the UI and docs describe as read-only, and it was not in scope for the `protectedPrefixes` loop added in this phase.
**Fix:** Add `/stripe` and `/support` (or at minimum `/stripe/checkout`, `/stripe/subscription`, `/support/chat`) to `protectedPrefixes`, or apply `requireWriteScope` to them explicitly next to the existing `requireAuth` calls:
```ts
app.use("/stripe/checkout", requireAuth, requireWriteScope);
app.use("/stripe/subscription", requireAuth, requireWriteScope);
app.use("/support/chat", requireAuth, requireWriteScope);
app.use("/support/chat/*", requireAuth, requireWriteScope);
```

### WR-02: MCP tool handlers interpolate unencoded, caller-controlled identifiers into URL paths

**File:** `apps/mcp-server/src/tools/read.ts:23-24,57-61,68-71`, `apps/mcp-server/src/tools/write.ts:79-85`, `apps/mcp-server/src/httpClient.ts:31-51`
**Issue:** `leaseId`/`propertyId` are validated only as `z.string().min(1)` (not a UUID shape) and are spliced directly into the request path, e.g. `` `/properties/${args.propertyId}` `` or `` `/ledger/${args.leaseId}/record-payment` ``, with no `encodeURIComponent`. `buildUrl()` then concatenates this into a plain string handed to `fetch()`. A value containing `?` truncates everything after it into the query string (silently dropping the intended `/record-payment` suffix and hitting a different, possibly non-existent, route instead of failing loudly), and a value containing `/` or `..` segments changes which path segments the WHATWG URL normalizer resolves to before the request is sent. Since an MCP tool's arguments are ultimately model-generated/LLM-controlled input, this is exactly the kind of untrusted-input boundary that should not be trusted to be well-formed.
**Fix:** URL-encode every interpolated path segment, and prefer rejecting non-UUID-shaped identifiers in the zod schema where the API is known to expect a UUID:
```ts
handler: async (args, api) =>
  textResult(await api.get(`/properties/${encodeURIComponent(args.propertyId)}`, "get_property")),
```
and tighten `leaseId: z.string().min(1)` to `z.string().uuid()` where the corresponding API route expects a UUID.

### WR-03: `redactAuditArgs` collapses distinct sensitive keys into one, losing information

**File:** `apps/api/src/lib/apiTokenGuards.ts:87-98`
**Issue:** For a key that merely *contains* a sensitive word but isn't an exact match (e.g. `ibanNumber`, `secretCode`), the code writes to a fixed literal key:
```ts
} else if (SENSITIVE_KEY.test(key)) {
  out["[redacted]"] = "[redacted]";
}
```
If an object has two or more such keys at the same depth (e.g. `{ ibanNumber: "...", secretCode: "..." }`), every one of them overwrites the same `out["[redacted]"]` property, so the audit row ends up with a single `"[redacted]": "[redacted]"` entry instead of reflecting that two distinct fields were present. This doesn't leak anything, but it silently destroys information from the stored audit row (you can no longer tell how many sensitive fields a call carried, which matters when reconstructing what a tool call actually did).
**Fix:** Use a counter or array-based key to avoid collisions, e.g. `out[`[redacted:${key}]`] = "[redacted]"`, or keep the matched key name but mask only the value (consistent with the `SENSITIVE_KEY_EXACT` branch) since the stated intent ("the field name cannot leak embedded context") can be achieved without colliding keys:
```ts
} else if (SENSITIVE_KEY.test(key)) {
  out[`[redacted:${key.length}]`] = "[redacted]"; // or any collision-free scheme
}
```

### WR-04: CSRF webhook/Bearer exemption uses substring matching rather than an anchored prefix check

**File:** `apps/api/src/lib/csrfPolicy.ts:12-18`
**Issue:** `shouldSkipCsrf` (newly introduced this phase, and documented as "Single source of truth for which requests bypass the Origin-based CSRF check") uses `path.includes("/webhooks/")` and `path.includes("/stripe/webhook")`. `includes` matches the substring anywhere in the path, not just as the intended route prefix. No current route happens to collide, but because this function is now the single, explicitly-trusted gate for a security control (CSRF bypass), it should be defensive against a future route that happens to contain that substring (e.g. a nested resource literally named `webhooks`) rather than relying on today's route table staying substring-collision-free.
**Fix:**
```ts
if (path.startsWith("/api/v1/webhooks/") || path.startsWith("/api/v1/stripe/webhook")) {
  return true;
}
```
(or match against the un-prefixed route path Hono exposes, if available, instead of the full request path).

## Info

### IN-01: `apiToolCalls.userId` has no `onDelete` behavior while `apiTokens.userId` cascades

**File:** `packages/db/src/schema/apiToolCalls.ts:19-21` vs `packages/db/src/schema/apiTokens.ts:20-22`
**Issue:** `apiTokens.userId` is declared `.references(() => users.id, { onDelete: "cascade" })`, but `apiToolCalls.userId` is declared `.references(() => users.id)` with no `onDelete`, defaulting to `RESTRICT` (or the DB's default FK behavior). Deleting a user who previously made Bearer-authenticated calls would fail (or need a separate cleanup step) even though their tokens cascade-delete cleanly.
**Fix:** Decide intentionally whether audit history should outlive the user (common for audit logs) and either set `onDelete: "set null"` (if `userId` were nullable) or document/implement the required deletion order; at minimum make the choice explicit rather than inheriting the FK default silently.

### IN-02: `touchLastUsed`'s internal `.catch` makes the caller's redundant `.catch(() => {})` dead code

**File:** `apps/api/src/lib/apiTokens.ts:206-223` and `apps/api/src/lib/authMiddleware.ts:120`
**Issue:** `touchLastUsed` already swallows all errors internally (`.catch((err) => { console.error(...) })`) and its returned promise never rejects. The call site in `authMiddleware.ts` (`touchLastUsed(row.id).catch(() => {})`) adds a second, unreachable `.catch`. Harmless, but reads as if the author wasn't certain the service function was already safe, which is a minor signal worth cleaning up for clarity.
**Fix:** Drop the redundant `.catch(() => {})` at the call site, or remove the internal catch and make the contract "caller must handle rejection" — pick one layer of responsibility, not both.

---

_Reviewed: 2026-10-05T17:50:32Z_
_Reviewer: Claude (bm-code-reviewer)_
_Depth: standard_
