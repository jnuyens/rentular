# Phase 11: MCP Server & External API Access - Context

**Gathered:** 2026-10-04
**Status:** Ready for planning
**Source:** Decision doc (`.planning/specs/mcp-and-api-access.md`) synthesized into context (yolo mode, no discuss-phase run)

<domain>
## Phase Boundary

This phase makes Rentular reachable by agents and integrations without weakening
the existing browser session flow. It delivers, cheapest-first:

1. **Personal Access Tokens (PAT)** , machine auth for the existing Hono API.
2. **A standalone MCP server over stdio** , so Claude (Desktop/Code) can read and
   act on a landlord's rentals via a PAT.

Remote MCP (Streamable HTTP + OAuth) and an OpenAPI spec are **documented as the
follow-on**, not built here. Every endpoint and tool stays scoped to the caller's
accessible properties and role, reusing `getAccessiblePropertyIds` + the existing
owner / co_owner / manager / accountant / viewer model.

In scope:
- `api_tokens` store (hashed token, userId, scopes, expiry, lastUsedAt) + mint/revoke.
- `authMiddleware` accepting `Authorization: Bearer rtl_…` alongside the session cookie.
- Settings UI to create (show-once), name, scope (read/write), and revoke tokens.
- Standalone MCP server (`@modelcontextprotocol/sdk`, stdio) authenticating with a PAT.
- Scoped read tools + guarded write tools (manager+), with tool-call logging.

Out of scope (deferred, documented only):
- OAuth2 / OIDC authorization server, remote Streamable HTTP MCP transport.
- OpenAPI/`zod-openapi` generation and public API docs.
- Service accounts.
</domain>

<decisions>
## Implementation Decisions

### Authentication (machine)
- Personal Access Tokens are the chosen phase-1 mechanism. No OAuth server in this phase.
- Token format prefix `rtl_`; store only a hash (never the plaintext) plus userId,
  scopes, expiry, lastUsedAt.
- `authMiddleware` accepts `Authorization: Bearer rtl_…` and resolves it to the **same**
  userId + per-property role checks as the NextAuth session cookie. Revoked/expired
  tokens are rejected (fail closed).
- The browser session flow (NextAuth encrypted JWT cookie, decoded with `AUTH_SECRET`)
  is left untouched and must keep working exactly as today.

### Token scoping
- Scope at least by read vs write; optionally by property. Writes require manager+.

### MCP server shape
- **Standalone** MCP server using `@modelcontextprotocol/sdk`, calling the Rentular HTTP
  API with a PAT. The Hono API is NOT modified to embed MCP in-process.
- Deploys independently (own process on m1, or a muncher container over Tailscale like
  the WhatsApp bridge).
- Transport: **stdio** first (PAT in an env var). Remote Streamable HTTP + OAuth is the
  documented follow-on (SSE transport is deprecated, do not use it).

### Tools to expose
- Read: `list_properties`, `get_property`, `list_leases`, `list_tenants`,
  `payment_overview` (dashboard), `lease_ledger`, `indexation_status`.
- Write (manager+): `mark_rent_paid`, `send_reminder` (channel-aware),
  `record_ledger_payment`, `apply_indexation`.
- Read tools gate before write; all scoped to the token's user + accessible properties.

### Security
- Reuse per-tool role checks (writes require manager+); hashed tokens with expiry + revoke;
  rate-limit; log tool calls (reuse the `communications` logging pattern); keep the
  `no-store` headers. Never weaken the cookie flow.

### Claude's Discretion
- Exact `api_tokens` Drizzle schema column types and index choices.
- Hashing choice for tokens (reuse existing bcrypt vs a faster SHA-256-with-pepper for
  per-request verification , researcher to recommend; per-request bcrypt may be too slow).
- Rate-limiting mechanism (reuse Redis/ioredis already present).
- MCP server repo layout (in-monorepo package vs standalone like the WA bridge).
- Settings UI component structure and i18n keys (EN/NL/FR/DE required).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Decision & scope
- `.planning/specs/mcp-and-api-access.md` , the full decision doc (options tables, tool list, phased effort).
- `.planning/ROADMAP.md` , Phase 11 section (goal, success criteria, dependencies on Phase 5 + 10).
- `.planning/REQUIREMENTS.md` , API-01..03 / MCP-01..03 definitions.

### Existing auth to reuse / extend
- `apps/api/src/middleware/` , the `authMiddleware` that decodes the NextAuth JWT and sets userId on the Hono context (extend here to also accept Bearer PATs).
- The access/role helper (`getAccessiblePropertyIds` + role checks) used across routes , reuse unchanged for PAT-authed requests.

### Patterns to mirror
- `packages/db/src/schema/` , Drizzle table definitions (model `api_tokens` after these).
- A standalone-service analog: the WhatsApp Baileys bridge (`/opt/rentular-wa-bridge` on muncher, systemd + Tailscale) , the MCP server can follow the same deployment shape.
- The `communications` logging used by reminders , reuse the pattern to log MCP tool calls.
</canonical_refs>

<specifics>
## Specific Ideas

- Token prefix `rtl_`; "show once" on creation in the Settings UI.
- Read-then-write tool ordering; writes manager+.
- stdio MCP server reads its PAT from an env var, calls `NEXT_PUBLIC_API_URL`/`API_URL` with `Authorization: Bearer`.
- Rate-limit + audit log are first-class, not afterthoughts.
</specifics>

<deferred>
## Deferred Ideas

- OAuth2 / OIDC authorization server + consent + refresh.
- Remote MCP over Streamable HTTP, fronted by Caddy on m1.
- OpenAPI spec generation (`zod-openapi`) and public API docs.
- Service accounts layered on PATs for backend automations.
</deferred>

---

*Phase: 11-mcp-server-external-api-access*
*Context synthesized: 2026-10-04 from the decision doc (no discuss-phase)*
