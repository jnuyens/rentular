# Phase 11: MCP Server & External API Access - Research

**Researched:** 2026-10-04
**Domain:** Machine authentication (Personal Access Tokens) for an existing Hono API + a standalone stdio MCP server
**Confidence:** HIGH (codebase facts verified by reading source; MCP SDK API verified against the published 1.32.0 package)

## Summary

Phase 11 adds two things on top of a mature, already-authorized API: (1) Personal Access Tokens so non-browser callers can authenticate the existing Hono API, and (2) a standalone MCP server that holds a PAT and calls that API over HTTP. The hard work of authorization already exists and must be reused unchanged: `getAccessiblePropertyIds`, `getUserPropertyRole`, `hasMinimumRole`, and the `owner/co_owner/manager/accountant/viewer` model in `apps/api/src/lib/propertyAccess.ts`. The PAT path's only job is to resolve a `Bearer rtl_…` token to the **same `userId`** that the NextAuth cookie path resolves to, after which every existing route check applies automatically.

The single most important design decision is token hashing. bcrypt (used for passwords) is the wrong tool for an API auth path because it is salted per-row and therefore cannot be looked up by value, forcing a full-table scan + a 50-100ms hash per candidate on every request. The correct, industry-standard choice (GitHub, GitLab, Stripe-style keys) is a fast keyed digest: **SHA-256 of `token + server pepper`, stored in a UNIQUE-indexed column**, giving an O(1) indexed lookup. High-entropy (256-bit) random tokens make the "fast hash is brute-forceable" concern that justifies bcrypt irrelevant here.

The MCP SDK is healthy and current: `@modelcontextprotocol/sdk@1.32.0`, published 2026-10-02, ~75M downloads/week, official `github.com/modelcontextprotocol/typescript-sdk`. It is ESM-only (`"type": "module"`, Node >=18) and its tool API is `server.registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a Zod **raw shape** (`{ leaseId: z.string() }`), not `z.object(...)`. One compatibility snag: the SDK's zod peer range is `^3.25 || ^4.0`, but the repo pins `zod@^3.24.0`. The MCP server package must declare its own `zod@^3.25` and avoid importing `@rentular/shared`'s older zod.

Two correctness gaps surfaced while mapping tools to endpoints, both worth a hardening task (details in Don't Hand-Roll / Common Pitfalls): several "write" endpoints (`/ledger/:leaseId/record-payment`, `/payments/send-reminder`) currently gate on *any* accepted role via `getAccessiblePropertyIds` rather than `manager+`, so a `viewer` can call them; and the CSRF middleware will reject Bearer-authenticated POSTs unless the PAT path is exempted.

**Primary recommendation:** Add an `api_tokens` table (SHA-256+pepper hash, UNIQUE-indexed), extend `authMiddleware` to resolve `Bearer rtl_…` **before** the cookie and fail closed, exempt Bearer requests from CSRF, build the MCP server as a new ESM `apps/mcp-server` package that only speaks HTTP to the API, and enforce `manager+` for write tools at the tool boundary while also hardening the two under-gated write endpoints.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **PAT is the phase-1 machine-auth mechanism.** No OAuth server in this phase.
- **Token format:** prefix `rtl_`; store only a hash (never plaintext) plus `userId`, `scopes`, `expiry`, `lastUsedAt`.
- **`authMiddleware` accepts `Authorization: Bearer rtl_…`** and resolves it to the **same** `userId` + per-property role checks as the NextAuth session cookie. Revoked/expired tokens are rejected (fail closed).
- **The browser session flow** (NextAuth encrypted JWT cookie, decoded with `AUTH_SECRET`) is left untouched and must keep working exactly as today.
- **Token scoping:** at least read vs write; optionally by property. Writes require `manager+`.
- **MCP server is standalone**, using `@modelcontextprotocol/sdk`, calling the Rentular HTTP API with a PAT. The Hono API is NOT modified to embed MCP in-process. Deploys independently.
- **Transport: stdio first** (PAT in an env var). Remote Streamable HTTP + OAuth is the documented follow-on. SSE transport is deprecated — do not use it.
- **Tools — Read:** `list_properties`, `get_property`, `list_leases`, `list_tenants`, `payment_overview` (dashboard), `lease_ledger`, `indexation_status`.
- **Tools — Write (manager+):** `mark_rent_paid`, `send_reminder` (channel-aware), `record_ledger_payment`, `apply_indexation`. Read tools gate before write; all scoped to the token's user + accessible properties.
- **Security:** reuse per-tool role checks (writes require `manager+`); hashed tokens with expiry + revoke; rate-limit; log tool calls (reuse the `communications` logging pattern); keep the `no-store` headers. Never weaken the cookie flow.

### Claude's Discretion
- Exact `api_tokens` Drizzle schema column types and index choices.
- Hashing choice for tokens (reuse bcrypt vs a faster SHA-256-with-pepper) — researcher to recommend.
- Rate-limiting mechanism (reuse Redis/ioredis already present).
- MCP server repo layout (in-monorepo package vs standalone like the WA bridge).
- Settings UI component structure and i18n keys (EN/NL/FR/DE required).

### Deferred Ideas (OUT OF SCOPE — document only, do not build)
- OAuth2 / OIDC authorization server + consent + refresh.
- Remote MCP over Streamable HTTP, fronted by Caddy/nginx on m1.
- OpenAPI spec generation (`zod-openapi`) and public API docs.
- Service accounts layered on PATs for backend automations.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | `api_tokens` store (hashed token, userId, scopes, expiry, lastUsedAt) + mint/revoke | Schema modelled on `propertyManagers.ts`/`users.ts` (see Standard Stack + Architecture); SHA-256+pepper hashing recommendation; throttled `lastUsedAt` write pattern |
| API-02 | `authMiddleware` accepts `Bearer rtl_…`, resolves to same userId + per-property checks, rejects expired/revoked | Exact change to `apps/api/src/lib/authMiddleware.ts` documented (Pattern 2); fail-closed rules; CSRF-exemption pitfall flagged |
| API-03 | Token management UI in Settings (create, name, scope read/write, revoke, show once) | Settings page uses shadcn `Tabs`; add a "Developer"/"API Tokens" tab; i18n in 4 locales; show-once modal pattern |
| MCP-01 | Standalone MCP server (`@modelcontextprotocol/sdk`) authenticating with a PAT, stdio transport | Verified SDK 1.32.0 API (`registerTool`, `StdioServerTransport`); `apps/mcp-server` ESM package layout; PAT + API_URL from env |
| MCP-02 | Scoped read tools (properties, leases, tenants, payment overview, ledger, indexation status) | Each mapped to an existing GET endpoint (Tool→Endpoint Map); scoping is automatic via PAT→userId |
| MCP-03 | Guarded write tools (mark paid, send reminder, record ledger payment, apply indexation) requiring manager+, logged | Each mapped to an existing POST endpoint; two endpoints need role hardening; audit-log table recommendation |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token minting / hashing / storage | API / Backend | Database | Secret generation + hashing must happen server-side; plaintext shown once in the HTTP response and never stored |
| Bearer token verification | API / Backend (`authMiddleware`) | Database | Must resolve to the same `userId` the cookie path produces, inside the existing middleware |
| Per-property / role authorization | API / Backend (`propertyAccess.ts`) | — | Already centralized; PAT path reuses it verbatim — no new authz logic |
| Token management UI (create/name/scope/revoke) | Frontend Server (Next 15) | API | Settings page + API calls; show-once secret handling is a client concern |
| MCP tool orchestration | Standalone MCP process | API (over HTTP) | Decoupled from the API lifecycle per locked decision; tools are thin HTTP clients |
| Rate limiting | API / Backend | Redis | Enforced at the API boundary so it protects both PAT and (future) OAuth callers; Redis already present |
| Tool-call / token-usage audit | API / Backend | Database | Audit belongs where the authenticated action happens, not in the MCP client the user controls |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `1.32.0` | MCP server (stdio transport, tool registration) | Official MCP TypeScript SDK (`github.com/modelcontextprotocol/typescript-sdk`), ~75M downloads/week [VERIFIED: npm registry — slopcheck [OK] on npm ecosystem] |
| `node:crypto` (built-in) | Node 20.19 | `randomBytes` for token secret, `createHash('sha256')` for the keyed digest, `timingSafeEqual` | No dependency; standard for high-entropy token hashing [CITED: nodejs.org/api/crypto.html] |
| `drizzle-orm` | `^0.36.0` (in repo) | `api_tokens` table + queries | Already the project ORM [VERIFIED: apps/api/package.json] |
| `hono` | `^4.6.0` (in repo) | Bearer parsing in `authMiddleware` | Already the API framework [VERIFIED: apps/api/package.json] |
| `zod` | `^3.25` (MCP pkg only) | MCP tool `inputSchema` raw shapes | SDK peer range is `^3.25 \|\| ^4.0`; repo pins `3.24.0`, so the MCP package needs its own newer zod [VERIFIED: npm — SDK package.json peerDependencies] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ioredis` | `^5.4.0` (in repo) | Rate-limit counter (`INCR`+`EXPIRE` fixed window) keyed by token id | Reuse existing Redis — no new dep for a simple limiter [VERIFIED: apps/api/package.json] |
| `rate-limiter-flexible` | latest | Sliding-window / token-bucket on top of ioredis, if the simple fixed-window proves too coarse | Only if INCR+EXPIRE is insufficient — adds a dep [ASSUMED — not verified this session] |
| `tsup` / `tsx` | `^8.3.0` / `^4.19.0` (in repo) | Build / dev-run the MCP server (same toolchain as the API) | Mirror `apps/api` build setup [VERIFIED: apps/api/package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SHA-256 + pepper | bcrypt (reuse `bcrypt@^5.1.0`) | bcrypt is salted per-row → cannot index/look up by hash → full scan + slow hash per request. Wrong for a per-request API path. Only correct for low-entropy passwords. |
| SHA-256 + pepper | lookup-id + hashed-secret split (`rtl_<id>_<secret>`) | Equivalent security; the id lets you avoid even an indexed-hash scan and makes targeted revocation trivial. Slightly more token-parsing code. Acceptable alternative — see Pattern 1 note. |
| Standalone HTTP-calling MCP server | Embed MCP endpoint in the Hono API | Locked decision is standalone; embedding couples MCP lifecycle to the API (rejected in the decision doc). |
| stdio transport | SSE transport | SSE is deprecated in MCP; stdio now, Streamable HTTP later. |

**Installation (MCP server package only):**
```bash
pnpm --filter @rentular/mcp-server add @modelcontextprotocol/sdk zod@^3.25
pnpm --filter @rentular/mcp-server add -D tsup tsx typescript @types/node
```
No new dependency is required in `apps/api` (token hashing uses `node:crypto`; rate limiting reuses `ioredis`).

**Version verification (performed this session):**
- `npm view @modelcontextprotocol/sdk version` → `1.32.0` (dist-tag `latest`), `time.modified = 2026-10-02` [VERIFIED].
- SDK `engines.node` = `>=18`; `"type": "module"` (ESM-only); zod peer `^3.25 || ^4.0` [VERIFIED by unpacking the 1.32.0 tarball].
- last-week npm downloads: 74,981,440 [VERIFIED: api.npmjs.org].

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@modelcontextprotocol/sdk` | npm | mature (v1.x, actively released) | ~75M/wk | github.com/modelcontextprotocol/typescript-sdk | [OK] (npm ecosystem) | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> Note: slopcheck auto-detected PyPI first and returned a false [SLOP] (`does not exist on pypi`). Re-running with `--ecosystem npm` returned `[OK]`. This is exactly the cross-ecosystem confusion the protocol warns about — the package is an npm scoped package, verified clean on npm with ~75M weekly downloads and an official Anthropic-maintained repo. `rate-limiter-flexible` is listed only as an optional upgrade and is tagged `[ASSUMED]`; if the planner chooses it, gate it behind a `checkpoint:human-verify`.

## Architecture Patterns

### System Architecture Diagram

```
  Claude Desktop / Claude Code (user's machine)
        │  spawns + stdio
        ▼
  ┌──────────────────────────────┐
  │  @rentular/mcp-server (stdio) │   env: RENTULAR_API_URL, RENTULAR_PAT (rtl_…)
  │  registerTool(read + write)   │
  └──────────────┬───────────────┘
                 │  HTTPS  Authorization: Bearer rtl_…
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Hono API  (apps/api, /api/v1)                             │
  │                                                            │
  │  no-store ─▶ CORS ─▶ CSRF* ─▶ authMiddleware ─▶ requireAuth │
  │                        │            │                       │
  │             (*skip when Bearer rtl_)│                       │
  │                                     ▼                       │
  │                  ┌─ Bearer rtl_? ──▶ hash(SHA-256+pepper)   │
  │                  │                   lookup api_tokens       │
  │                  │                   check !revoked,!expired │
  │                  │                   set userId, tokenScope  │
  │                  │                   (fire-and-forget         │
  │                  │                    lastUsedAt throttle)    │
  │                  └─ else ──────────▶ decode NextAuth cookie   │
  │                                                            │
  │   route handlers ─▶ getUserPropertyRole / hasMinimumRole   │
  │                     getAccessiblePropertyIds  (UNCHANGED)   │
  │                     rate-limit (ioredis INCR+EXPIRE)        │
  │                     audit insert (api_tool_calls)           │
  └───────────────────────────┬────────────────────────────────┘
                              ▼
                         MariaDB (rentular)   +   Redis
```

### Component Responsibilities
| Component | File (new or existing) | Responsibility |
|-----------|------------------------|----------------|
| `api_tokens` schema | `packages/db/src/schema/apiTokens.ts` (new) + add to `schema/index.ts` | Store hash, userId, scope, expiry, lastUsedAt, revokedAt |
| Token service | `apps/api/src/lib/apiTokens.ts` (new) | `mintToken`, `hashToken`, `verifyToken`, `revokeToken`, throttled `touchLastUsed` |
| Bearer resolution | `apps/api/src/lib/authMiddleware.ts` (edit) | Parse `Bearer rtl_…` before cookie; set `userId` + `tokenScope`; fail closed |
| CSRF exemption | `apps/api/src/index.ts` (edit) | Skip `csrf()` when `Authorization: Bearer rtl_` present |
| Token routes | `apps/api/src/routes/apiTokens.ts` (new) → mount `/api-tokens` | List, create (show-once), revoke |
| Scope guard helper | `apps/api/src/lib/routeAuth.ts` (edit) | `requireWriteScope` — 403 if `tokenScope === "read"` |
| Audit table | `packages/db/src/schema/apiToolCalls.ts` (new) | Record tool/endpoint, tokenId, userId, status, timestamp |
| MCP server | `apps/mcp-server/` (new package) | stdio server, thin HTTP client, read+write tools |
| Settings UI | `apps/web/app/(dashboard)/settings/page.tsx` (edit) + new tab component | Mint/name/scope/revoke, show-once modal, i18n |

### Pattern 1: SHA-256 + server pepper, UNIQUE-indexed hash (RECOMMENDED token design)
**What:** Generate `rtl_` + 32 random bytes (base64url). Store `tokenHash = sha256(pepper + rawToken)` in a `UNIQUE`-indexed `char(64)` column. On each request, hash the presented token the same way and look it up by the indexed hash.
**When to use:** Any per-request API-key verification with high-entropy secrets.
**Why not bcrypt:** bcrypt salts per row, so you cannot `WHERE hash = ?`; you would scan every token and bcrypt-compare (50-100ms each). SHA-256 is ~microseconds and the 256-bit entropy makes "fast hash" brute force a non-issue. This is the GitHub/GitLab PAT model.
**Pepper:** a server-only secret (new `API_TOKEN_PEPPER` env, or derive from `AUTH_SECRET` via HKDF like `authMiddleware` already does). It ensures a stolen DB dump alone cannot be used to verify guessed tokens. Keep it out of the DB.
```typescript
// Source: node:crypto — nodejs.org/api/crypto.html  [CITED]
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const PEPPER = process.env.API_TOKEN_PEPPER!; // fail closed if unset (mirror authSecret.ts)

export function mintRawToken(): string {
  return "rtl_" + randomBytes(32).toString("base64url"); // ~43 chars after prefix
}
export function hashToken(raw: string): string {
  return createHash("sha256").update(PEPPER).update(raw).digest("hex"); // 64 hex chars
}
// Lookup is by the UNIQUE indexed hash column; timingSafeEqual guards the final compare.
```
**Optional variant (lookup-id + secret):** issue `rtl_<id>_<secret>`, store `id` plaintext (indexed) + `sha256(pepper+secret)`. Lets you `WHERE id = ?` then constant-time compare the secret, and makes targeted revoke/display trivial. Equivalent security; choose if you want to avoid an indexed-hash column. Either is acceptable per Claude's Discretion.

### Pattern 2: Bearer-before-cookie in `authMiddleware`, fail closed
**What:** At the top of `authMiddleware` (`apps/api/src/lib/authMiddleware.ts:99`), inspect `Authorization`. If it starts with `Bearer rtl_`, resolve it **exclusively** (do not fall through to the cookie on failure). Only if there is no Bearer token do you run the existing cookie logic unchanged.
**Why exclusive:** a present-but-invalid/expired/revoked token must 401, never silently retry the cookie. Falling through would violate "fail closed."
```typescript
// edit apps/api/src/lib/authMiddleware.ts
export async function authMiddleware(c: Context, next: Next) {
  const authz = c.req.header("Authorization");
  if (authz?.startsWith("Bearer rtl_")) {
    const raw = authz.slice("Bearer ".length);
    const row = await lookupActiveToken(hashToken(raw)); // not revoked AND (expiry null OR expiry > now)
    if (row) {
      c.set("userId", row.userId);
      c.set("tokenScope", row.scope);       // "read" | "write"
      touchLastUsed(row.id).catch(() => {}); // fire-and-forget, throttled (see Pattern 3)
    } else {
      c.set("userId", null);                // invalid/expired/revoked → requireAuth 401s
    }
    return next();                           // do NOT try the cookie
  }
  // …existing cookie logic unchanged…
}
```
Existing `requireAuth` (`routeAuth.ts:15`) already 401s on `userId === null`, so no per-route change is needed for authentication. **Scope** enforcement is a separate guard (Pattern 4).

### Pattern 3: Throttled, non-blocking `lastUsedAt`
**What:** Do not write `lastUsedAt` on every request. Update it only when the stored value is null or older than a threshold (e.g. 1 hour), and never `await` it in the request path.
**Why:** a hot token would otherwise cause one write per request. Throttling bounds it to ~1 write/token/hour.
```typescript
// UPDATE api_tokens SET last_used_at = NOW()
//   WHERE id = ? AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL 1 HOUR)
```
Issue it fire-and-forget (`.catch(() => {})`); a failed timestamp write must never fail the request.

### Pattern 4: Write-scope guard composed with the existing role check
**What:** Writes require BOTH `tokenScope === "write"` AND the existing `manager+` property role. Add a tiny guard that only checks scope; the route's existing `hasMinimumRole(role, "manager")` check stays.
```typescript
// apps/api/src/lib/routeAuth.ts
export const requireWriteScope = createMiddleware(async (c, next) => {
  const scope = c.get("tokenScope"); // undefined for cookie sessions = full access
  if (scope === "read") return c.json({ error: "Token is read-only" }, 403);
  await next();
});
```
Cookie sessions have no `tokenScope` → treated as full access (browser flow unchanged). Read PATs can still call GET routes; write PATs plus `manager+` role can call POST routes.

### Pattern 5: MCP tool registration (verified SDK 1.32.0 shape)
```typescript
// Source: @modelcontextprotocol/sdk@1.32.0 (ESM) — verified from the package's server/mcp.d.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const api = (path: string, init?: RequestInit) =>
  fetch(new URL(path, process.env.RENTULAR_API_URL), {
    ...init,
    headers: { Authorization: `Bearer ${process.env.RENTULAR_PAT}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

const server = new McpServer({ name: "rentular", version: "0.1.0" });

// inputSchema is a Zod RAW SHAPE (plain object of validators), NOT z.object(...)
server.registerTool(
  "list_properties",
  { description: "List all properties the token can access", inputSchema: {} },
  async () => {
    const res = await api("/api/v1/properties");
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.registerTool(
  "apply_indexation",
  {
    description: "Apply rent indexation to a lease and notify the tenant (requires manager+)",
    inputSchema: { leaseId: z.string(), newRent: z.number().positive(), subject: z.string(), body: z.string() },
  },
  async ({ leaseId, newRent, subject, body }) => {
    const res = await api(`/api/v1/indexation/apply/${leaseId}`, {
      method: "POST",
      body: JSON.stringify({ newRent, subject, body, sendNotification: true }),
    });
    return { content: [{ type: "text", text: await res.text() }], isError: !res.ok };
  },
);

await server.connect(new StdioServerTransport());
```
Note: `server.tool(...)` still exists but is **deprecated** in favour of `registerTool`. Use `registerTool`.

### Recommended Project Structure (MCP server)
```
apps/mcp-server/
├── package.json        # "type": "module", bin entry, own zod ^3.25
├── tsup.config.ts      # bundle to dist/index.js (single file)
├── src/
│   ├── index.ts        # McpServer + StdioServerTransport, main()
│   ├── httpClient.ts   # fetch wrapper (base URL + Bearer PAT from env)
│   ├── tools/read.ts   # list_properties, get_property, list_leases, …
│   └── tools/write.ts  # mark_rent_paid, send_reminder, record_ledger_payment, apply_indexation
└── README.md           # claude_desktop_config.json snippet (command/args/env)
```

### Anti-Patterns to Avoid
- **bcrypt for per-request token verification** — unindexable + slow (see Pattern 1 rationale).
- **Letting an invalid Bearer fall through to the cookie** — breaks fail-closed.
- **Re-implementing authorization in the MCP server** — tools must call the HTTP API and let the API enforce roles. The MCP client runs on the user's machine and cannot be trusted to self-enforce.
- **Writing `lastUsedAt` synchronously every request** — turns reads into writes.
- **Embedding MCP in the Hono process** — contradicts the locked standalone decision.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token verification | A bespoke slow-hash loop over all tokens | SHA-256+pepper with a UNIQUE index (Pattern 1) | O(1) indexed lookup; avoids the bcrypt scan trap |
| Per-property authorization | New authz checks in routes or the MCP server | Existing `getUserPropertyRole` / `hasMinimumRole` / `getAccessiblePropertyIds` (`propertyAccess.ts`) | Already battle-tested and the locked requirement; PAT→userId makes it automatic |
| MCP protocol plumbing | Hand-rolled JSON-RPC over stdio | `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport` | Official SDK handles framing, capabilities, tool schemas |
| Tool→data access | MCP server talking to MariaDB directly | MCP tools call the HTTP API with the PAT | Keeps one authorization path; remote transport later changes only the token source, not tool logic |
| Rate limiting | A custom in-memory counter | ioredis `INCR`+`EXPIRE` fixed window keyed by token id | Redis already present; survives multi-process; simple and correct |

**Key insight:** Almost every security-sensitive decision in this phase already has a correct implementation elsewhere in the repo. The failure mode here is *re-inventing* authorization or hashing rather than threading the PAT into the existing `userId` resolution.

## Runtime State Inventory

> This is an additive feature phase (new tables, new package, a middleware edit), not a rename/refactor/migration. A full Runtime State Inventory is not applicable. For completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — new `api_tokens` / `api_tool_calls` tables only; no existing data is renamed or re-keyed | drizzle-kit push for the two new tables |
| Live service config | New env vars only: `API_TOKEN_PEPPER` (API), `RENTULAR_API_URL` + `RENTULAR_PAT` (MCP client). None stored outside git-tracked `.env.example` | Add to `.env.example`; set the pepper on m1 before enabling PAT auth |
| OS-registered state | None for stdio (Claude Desktop spawns the MCP process on the user's machine). The future remote server would add a systemd unit (WA-bridge shape) | None this phase |
| Secrets/env vars | `API_TOKEN_PEPPER` must fail closed if unset (mirror `authSecret.ts`); PAT plaintext exists only in the mint response and the user's MCP config | Implement fail-closed pepper guard |
| Build artifacts | New `apps/mcp-server` build output (`dist/`) | tsup build; add to `.gitignore` if not covered |

## Common Pitfalls

### Pitfall 1: CSRF middleware rejects Bearer-authenticated POSTs
**What goes wrong:** `apps/api/src/index.ts:95-101` applies `csrf({ origin: … })` to every non-webhook path. The Hono CSRF middleware validates the `Origin` header on state-changing requests. A PAT/MCP client sends no browser `Origin`, so every write tool (`mark_rent_paid`, `apply_indexation`, …) would be blocked.
**Why it happens:** CSRF protection is only meaningful for cookie/ambient-credential auth. Bearer tokens are immune to CSRF by construction.
**How to avoid:** In the CSRF wrapper, skip `csrf()` when `Authorization: Bearer rtl_` is present (same shape as the existing webhook skip):
```typescript
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path.includes("/webhooks/") || path.includes("/stripe/webhook")) return next();
  if (c.req.header("Authorization")?.startsWith("Bearer rtl_")) return next(); // PAT: not cookie-based, CSRF N/A
  return csrf({ origin: (origin) => allowedOrigins.includes(origin) })(c, next);
});
```
**Warning signs:** MCP write tools return 403 with a CSRF error while reads work fine.

### Pitfall 2: Two write endpoints gate on access, not `manager+`
**What goes wrong:** `MCP-03` and CONTEXT require write tools to require `manager+`. But:
- `POST /ledger/:leaseId/record-payment` (`apps/api/src/routes/ledger.ts:63`) authorizes via `authorizeLease` → `getAccessiblePropertyIds` only. A **viewer** passes.
- `POST /payments/send-reminder` (`apps/api/src/routes/payments.ts:958`) checks only `getAccessiblePropertyIds`. A **viewer** passes.
Contrast with the correctly-gated `POST /indexation/apply/:leaseId` (`:1176` checks `hasMinimumRole(role, "manager")`), `POST /payments/mark-month-paid` (`:685` manager+), and `POST /payments/record` (`:579` accountant+).
**Why it happens:** these endpoints predate the MCP "writes = manager+" rule and only enforced "can see the property."
**How to avoid:** Harden both endpoints to require `manager+` (use `getUserPropertyRole` + `hasMinimumRole(role, "manager")`), AND independently enforce `manager+`/`requireWriteScope` at the MCP write-tool boundary. Belt and suspenders: the API is the source of truth, the MCP layer fails fast.
**Warning signs:** a read-only token or a viewer successfully records a payment or sends a reminder.

### Pitfall 3: `send_reminder` is not actually channel-aware
**What goes wrong:** CONTEXT calls `send_reminder` "channel-aware," but `manualReminder.ts:184` hard-codes `channel: "email"` and the service sends email only. Per-tenant preferred-channel routing lives in the automated worker path, not this manual endpoint.
**Why it happens:** the manual reminder endpoint was built email-first.
**How to avoid:** Decide explicitly during planning: either (a) expose `send_reminder` as email-only for v1 and document the limitation, or (b) extend `sendManualReminder` to honour the tenant's preferred channel (email/sms/whatsapp) first. Do not imply channel-awareness the endpoint does not have.
**Warning signs:** tool description promises SMS/WhatsApp but only email is ever sent.

### Pitfall 4: zod version skew between the SDK and the repo
**What goes wrong:** `@modelcontextprotocol/sdk@1.32.0` peer-depends on `zod@^3.25 || ^4.0`; the repo pins `zod@^3.24.0`. If the MCP package imports `@rentular/shared` (zod 3.24) or hoisting dedupes to 3.24, tool schema types can mis-resolve.
**How to avoid:** Give `apps/mcp-server` its own `zod@^3.25` dependency and keep it HTTP-only — do not import `@rentular/shared` zod schemas into it. (pnpm isolates per-package versions, so this is safe without bumping the API's zod.)
**Warning signs:** TypeScript errors on `inputSchema`, or runtime "invalid schema" from the SDK.

### Pitfall 5: `getAccessiblePropertyIds` returns `null`-userId access rows
**What goes wrong:** `propertyManagers.userId` is nullable (invitations for not-yet-registered users; `propertyManagers.ts:19`). The PAT always resolves to a concrete `userId`, so this is fine — but any new query must filter `isNotNull(acceptedAt)` exactly as the existing helpers do. Do not write a new membership query that forgets the `acceptedAt` guard.
**How to avoid:** Reuse the existing helpers verbatim; never re-query `propertyManagers` ad hoc in the token path.

## Code Examples

### Modelling `api_tokens` on existing tables
```typescript
// packages/db/src/schema/apiTokens.ts  — mirrors users.ts/propertyManagers.ts conventions
// Source: existing schema patterns in packages/db/src/schema/  [VERIFIED: repo]
import { mysqlTable, varchar, timestamp, mysqlEnum, index, uniqueIndex, char } from "drizzle-orm/mysql-core";
import { users } from "./users";

export const apiTokens = mysqlTable("api_tokens", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),          // user-chosen label
  tokenHash: char("token_hash", { length: 64 }).notNull(),    // sha256 hex
  scope: mysqlEnum("scope", ["read", "write"]).notNull().default("read"),
  expiresAt: timestamp("expires_at"),                         // null = no expiry
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenHashIdx: uniqueIndex("api_tokens_hash_idx").on(t.tokenHash), // O(1) verification lookup
  userIdx: index("api_tokens_user_idx").on(t.userId),               // list-my-tokens
}));
```
Remember to add `export * from "./apiTokens";` to `packages/db/src/schema/index.ts`.

### Audit-log table (tool-call logging, modelled on the communications insert pattern)
```typescript
// packages/db/src/schema/apiToolCalls.ts
// The communications table's enum (email/sms/letter + reminder types) does not fit generic
// tool-call logging. Reuse the *pattern* (insert a row, index by owner) with a fit-for-purpose table.
import { mysqlTable, varchar, text, timestamp, mysqlEnum, json, index } from "drizzle-orm/mysql-core";
import { users } from "./users";

export const apiToolCalls = mysqlTable("api_tool_calls", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  tokenId: varchar("token_id", { length: 36 }),           // nullable: cookie-session calls too, if ever
  tool: varchar("tool", { length: 80 }).notNull(),         // e.g. "apply_indexation"
  args: json("args"),                                      // redact secrets before storing
  status: mysqlEnum("status", ["ok", "error", "forbidden"]).notNull(),
  httpStatus: varchar("http_status", { length: 3 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ userIdx: index("api_tool_calls_user_idx").on(t.userId) }));
```
Where write tools already send communications (`apply_indexation` → `queueEmail` with `type: "indexation_notification"`, `send_reminder` → email), that logging continues via the existing `CommunicationMeta` path in `emailQueueWorker.ts:103` — no change needed there.

## Tool → Endpoint Map

All endpoints are under `/api/v1`. Scoping is automatic: the PAT resolves to `userId`, and each handler already calls `getAccessiblePropertyIds` / `getUserPropertyRole`.

### Read tools (MCP-02)
| Tool | Method + Endpoint | Handler (file:line) | Current gate | Notes |
|------|-------------------|---------------------|--------------|-------|
| `list_properties` | GET `/properties` | properties.ts:34 | access (all accepted roles) | returns `userRole` per property |
| `get_property` | GET `/properties/:id` | properties.ts:75 | access | 404 if not accessible |
| `list_leases` | GET `/leases` | leases.ts:89 | access, accountant filtered out (D-05) | includes `tenantIds` |
| `list_tenants` | GET `/tenants` | tenants.ts:121 | access via `getAccessibleTenantIds` | includes bank accounts |
| `payment_overview` | GET `/payments/dashboard` | payments.ts:301 | access | current-month cash flow + overdue + warranty. Alt: GET `/payments/overview` (date-ranged, payments.ts:74) |
| `lease_ledger` | GET `/ledger/:leaseId` | ledger.ts:36 | access | periods, payments, allocations |
| `indexation_status` | GET `/indexation/calculate/:leaseId` | indexation.ts:636 | access, accountant blocked | per-lease. Portfolio variant: GET `/indexation/raise-summary` (indexation.ts:787) |

### Write tools (MCP-03, require manager+)
| Tool | Method + Endpoint | Handler (file:line) | Current gate | Gap / action |
|------|-------------------|---------------------|--------------|--------------|
| `mark_rent_paid` | POST `/payments/mark-month-paid` | payments.ts:666 | **manager+** ✓ | Good fit (leaseId + month). `/payments/:id/mark-paid` (:608, manager+) is the by-id variant |
| `send_reminder` | POST `/payments/send-reminder` | payments.ts:958 | **access only** ✗ | Harden to manager+; email-only today (Pitfall 3) |
| `record_ledger_payment` | POST `/ledger/:leaseId/record-payment` | ledger.ts:63 | **access only** ✗ | Harden to manager+ |
| `apply_indexation` | POST `/indexation/apply/:leaseId` | indexation.ts:1156 | **manager+** ✓ | Already correct; also EPC-caps the rent |

**No endpoint is missing** for any of the seven read tools or four write tools — every tool maps to existing code. The only work on the API side is the two role-hardening edits (`send-reminder`, `record-payment`) plus the auth/CSRF/scope wiring.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MCP SSE transport | stdio (local) + Streamable HTTP (remote) | SSE deprecated during 2025 MCP spec updates | Do not build SSE; stdio now, Streamable HTTP for the remote follow-on |
| `server.tool(name, shape, cb)` | `server.registerTool(name, { description, inputSchema }, cb)` | SDK 1.x | `tool()` is deprecated but still present; use `registerTool` |
| bcrypt for API keys | SHA-256 (+pepper) of high-entropy tokens, indexed | Long-standing industry practice (GitHub/GitLab/Stripe) | Fast, indexable verification |

**Deprecated/outdated:**
- MCP SSE transport — replaced by Streamable HTTP.
- `McpServer.prototype.tool()` — replaced by `registerTool()`.

## Remote (Streamable HTTP + OAuth) — design-now notes (DO NOT BUILD)

Only the decisions that avoid painting us into a corner:
1. **Keep tool logic transport-agnostic.** Put all tool handlers in `tools/*.ts` and only the transport in `index.ts`. Swapping `StdioServerTransport` for the Streamable HTTP transport later must not touch tool code.
2. **Tools call the HTTP API, never the DB.** Remote vs local then differs only in where the bearer token comes from (env var vs OAuth access token), not in tool logic.
3. **Model scopes as a typed set now** (`read`/`write`, optional `propertyId`) so OAuth scopes map cleanly onto PAT scopes later.
4. **Add a `type`-style discriminator on `api_tokens` only if cheap** (e.g. keep room for `oauth` alongside `pat`); otherwise a later additive migration is fine. Not required this phase.
5. **The Bearer resolution in `authMiddleware` is already the reusable seam** — a future OAuth access token can be resolved in the same place without disturbing the cookie path.
6. **Deployment shape for the future remote server** mirrors the WhatsApp Baileys bridge (`sendWhatsApp` in `apps/api/src/lib/whatsapp.ts`): a standalone process reached over Tailscale, fronted by the m1 reverse proxy. The **stdio** server, by contrast, runs on the *user's* machine (Claude Desktop spawns it) and reaches the public API over HTTPS — so it is distributed as a package + a `claude_desktop_config.json` snippet, not deployed to m1.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `rate-limiter-flexible` is the right upgrade if fixed-window INCR proves too coarse | Standard Stack (Supporting) | Low — only an optional path; the INCR+EXPIRE primary needs no new dep. Gate behind human-verify if chosen. |
| A2 | A new `api_tool_calls` audit table is preferable to overloading `communications` | Code Examples | Low — `communications` enums genuinely don't fit; if the planner prefers a `communications` "other" row, that also works |
| A3 | `payment_overview` should map to `/payments/dashboard` rather than `/payments/overview` | Tool→Endpoint Map | Low — CONTEXT says "(dashboard)"; both endpoints exist, easy to switch |
| A4 | Deriving the pepper from `AUTH_SECRET` via HKDF is acceptable vs a separate `API_TOKEN_PEPPER` | Pattern 1 | Low — either is secure; a dedicated env is cleaner for rotation |

## Open Questions

1. **Is `send_reminder` email-only acceptable for v1, or must it honour the tenant's preferred channel?**
   - What we know: `sendManualReminder` hard-codes `channel: "email"` (manualReminder.ts:184); channel routing exists only in the automated worker path.
   - What's unclear: whether "channel-aware" in CONTEXT is a hard v1 requirement.
   - Recommendation: ship email-only with an explicit tool description, and file channel-awareness as follow-on, unless the user insists.

2. **Where does the pepper live, and how is it set on m1?**
   - What we know: the API does not load `.env` itself in prod (MEMORY: env injected via PM2/compose); `authSecret.ts` already fails closed on a weak `AUTH_SECRET`.
   - Recommendation: add `API_TOKEN_PEPPER` to the m1 process env and fail closed if unset; or derive via HKDF from `AUTH_SECRET` to avoid a new secret entirely (A4).

3. **Token expiry default?** CONTEXT requires an `expiry` column but not a default. Recommendation: allow "no expiry" (null) with an optional user-chosen expiry in the Settings UI; show `lastUsedAt` so stale tokens are easy to spot and revoke.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | MCP server (SDK needs >=18) | ✓ | 20.19.0 (volta) | — |
| pnpm workspace | new `apps/mcp-server` package | ✓ | 9.15.0 | — |
| Redis / ioredis | rate limiting | ✓ | ioredis ^5.4.0, Redis on m1 | in-memory counter (single-process only; not recommended) |
| MariaDB | `api_tokens`, `api_tool_calls` | ✓ | `rentular` DB on m1 | — |
| `@modelcontextprotocol/sdk` | MCP server | ✓ (installs clean) | 1.32.0 | — |
| Claude Desktop / Claude Code | runs the stdio MCP server (user machine) | user-side | — | any MCP-capable client |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none material — all core infra already runs.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` → this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.2` |
| Config file | `apps/api/vitest.config.ts` (include `src/**/__tests__/**/*.test.ts`, node env, globals) |
| Quick run command | `pnpm --filter @rentular/api test` (alias `vitest run`) |
| Full suite command | `pnpm --filter @rentular/api test && pnpm --filter @rentular/mcp-server test` |

Existing tests mock `@rentular/db` with spy-based `eq`/`and` and a fake db (see `apps/api/src/routes/__tests__/bankAccounts.test.ts`) — the new auth/token tests should follow the same mock-the-db, assert-the-conditions style.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | mint → hash is sha256(pepper+raw); plaintext returned once; stored row has correct scope/expiry | unit | `pnpm --filter @rentular/api test -- apiTokens` | ❌ Wave 0 (`lib/__tests__/apiTokens.test.ts`) |
| API-02 | valid Bearer sets userId; expired/revoked/invalid → userId null (401); no cookie fall-through | unit | `pnpm --filter @rentular/api test -- authMiddleware` | ❌ Wave 0 (`lib/__tests__/authMiddleware.test.ts`) |
| API-02 | Bearer POST bypasses CSRF; cookie POST still CSRF-checked | unit | same | ❌ Wave 0 |
| API-02 | read token → 403 on write routes (`requireWriteScope`); write token + manager+ → allowed | unit | `pnpm --filter @rentular/api test -- scope` | ❌ Wave 0 |
| API-03 | create/list/revoke token routes scoped to the caller's userId | unit | `pnpm --filter @rentular/api test -- apiTokens.route` | ❌ Wave 0 (`routes/__tests__/apiTokens.test.ts`) |
| MCP-02 | each read tool calls the correct endpoint with the Bearer header | unit | `pnpm --filter @rentular/mcp-server test` | ❌ Wave 0 |
| MCP-03 | write tools require manager+ (hardened endpoints reject viewer/read-token) | unit | `pnpm --filter @rentular/api test -- ledger && … payments` | ❌ Wave 0 (extend ledger/payments tests) |
| MCP-03 | tool calls are audited (row inserted with tool, userId, status) | unit | `pnpm --filter @rentular/api test -- audit` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the targeted file's vitest run (e.g. `… test -- apiTokens`).
- **Per wave merge:** `pnpm --filter @rentular/api test`.
- **Phase gate:** full API + MCP suites green, plus `pnpm --filter @rentular/db db:push` applied for the two new tables, before `/bm:verify-work`.

### Wave 0 Gaps
- [ ] `apps/api/src/lib/__tests__/apiTokens.test.ts` — API-01 hashing/mint/verify/revoke
- [ ] `apps/api/src/lib/__tests__/authMiddleware.test.ts` — API-02 Bearer resolution + fail-closed + no cookie fall-through
- [ ] `apps/api/src/routes/__tests__/apiTokens.test.ts` — API-03 route ownership scoping
- [ ] Extend `apps/api/src/routes/__tests__/` for `ledger`/`payments` manager+ hardening (MCP-03)
- [ ] `apps/mcp-server/src/__tests__/tools.test.ts` + a vitest config for the new package (framework install: `pnpm --filter @rentular/mcp-server add -D vitest`)

## Security Domain

> `security_enforcement` is not disabled in config → this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | PAT = bearer credential; SHA-256+pepper hashed at rest; expiry + revoke; fail closed on invalid |
| V3 Session Management | yes | PATs are long-lived non-session credentials — must be revocable and show `lastUsedAt`; cookie session flow untouched |
| V4 Access Control | yes | Reuse `getUserPropertyRole`/`hasMinimumRole`/`getAccessiblePropertyIds`; writes require `manager+` + write scope |
| V5 Input Validation | yes | `@hono/zod-validator` on API routes; zod `inputSchema` on MCP tools |
| V6 Cryptography | yes | `node:crypto` `randomBytes` (token), `createHash('sha256')` (keyed digest), `timingSafeEqual`; never hand-roll |
| V7 Logging | yes | Audit tool/endpoint calls (`api_tool_calls`); redact token plaintext and secret args |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stolen DB dump used to forge/verify tokens | Information Disclosure | Server-side pepper not in the DB; tokens are 256-bit random |
| Read token performs a write | Elevation of Privilege | `requireWriteScope` + `manager+` role check at the route; harden the two under-gated endpoints |
| CSRF on cookie flow | Tampering | Keep existing `csrf()` for cookie requests; only Bearer requests are exempt |
| Cross-landlord IDOR via a tool | Information Disclosure | Every handler already filters by accessible properties; PAT only supplies the userId |
| Timing attack on token compare | Information Disclosure | `timingSafeEqual` on the final secret compare; lookup is by indexed hash |
| Token never expires / leaks silently | Repudiation | Optional expiry, revoke, `lastUsedAt`, and tool-call audit |
| Leaked PAT in logs | Information Disclosure | Never log `Authorization`; redact args before audit insert |

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk@1.32.0` package (unpacked tarball: `package.json` exports/engines/peerDeps, `dist/esm/server/mcp.d.ts` `registerTool` signature) — tool API, ESM, Node/zod requirements.
- npm registry: `npm view @modelcontextprotocol/sdk` (version 1.32.0, modified 2026-10-02); `api.npmjs.org` downloads (74.98M/wk).
- slopcheck 0.6.1 `install … --ecosystem npm` → `[OK]`.
- Repo source (verified by reading): `apps/api/src/lib/authMiddleware.ts`, `lib/propertyAccess.ts`, `lib/routeAuth.ts`, `lib/authSecret.ts`, `src/index.ts`, `routes/{properties,leases,tenants,payments,ledger,indexation,communications}.ts`, `jobs/emailQueueWorker.ts`, `services/manualReminder.ts`, `lib/whatsapp.ts`; `packages/db/src/schema/{index,users,communications,propertyManagers}.ts`; `apps/api/vitest.config.ts`, `apps/api/package.json`, root `package.json`, `.planning/config.json`.
- `node:crypto` documentation (nodejs.org/api/crypto.html) — `randomBytes`, `createHash`, `timingSafeEqual`.

### Secondary (MEDIUM confidence)
- MCP transport guidance (stdio current, SSE deprecated, Streamable HTTP for remote) — from the decision doc and corroborated by the SDK's current export surface.

### Tertiary (LOW confidence)
- `rate-limiter-flexible` as the sliding-window upgrade — [ASSUMED], not verified this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDK API and versions verified against the published package; repo deps read directly.
- Architecture / token design: HIGH — SHA-256+pepper vs bcrypt is well-established; the auth seam and role model were read in source.
- Tool→endpoint mapping: HIGH — every endpoint and its current role gate was read directly (file:line cited).
- Pitfalls (CSRF, under-gated writes, channel-awareness, zod skew): HIGH — each confirmed in source.
- Rate-limiter-flexible upgrade: LOW — not verified.

**Research date:** 2026-10-04
**Valid until:** ~2026-11-03 for the MCP SDK (fast-moving — re-check `registerTool`/transport before building); ~2026-12 for the repo facts (stable).
