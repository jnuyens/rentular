# Decision: MCP server & external API access

*Status: Accepted (Phase 11: PAT + stdio MCP built; remote + OpenAPI deferred) · 2026-10-04 · Owner: Jasper*

## Context

Rentular's API (Hono) authenticates **only** via the NextAuth encrypted JWT
session cookie (`__Secure-authjs.session-token`, decoded with `AUTH_SECRET`).
There is **no token/API-key auth** , the only "api key" code in the repo is for
third parties (GoCardless, Ponto, SMS). Access is already scoped per property via
`getAccessiblePropertyIds` + roles (owner / co_owner / manager / accountant /
viewer). There is no OpenAPI spec (routes use `@hono/zod-validator`).

We want (a) **external/programmatic API access** and (b) an **MCP server** so
Claude (and other agents) can read and act on a landlord's rentals. (a) is the
prerequisite for (b): an MCP server can't ride a browser cookie.

## Decision

Build it in three phases, cheapest-first, reusing the existing per-property
authorization throughout:

1. **Personal Access Tokens (PAT)** , the foundation.
2. **Standalone MCP server over stdio** , immediately usable in Claude.
3. **Remote MCP (Streamable HTTP + OAuth) and OpenAPI** , when needed.

## Options considered

### API access (machine auth)
| Option | Verdict |
| --- | --- |
| **Personal Access Tokens** (`api_tokens` table: hashed token, userId, scopes, expiry, lastUsedAt; `authMiddleware` also accepts `Authorization: Bearer rtl_…`) | **Chosen for phase 1.** Low effort, reuses all existing role/property checks, scope by read/write and optionally property. |
| OAuth2 / OIDC | Deferred. Proper for third-party apps and native remote-MCP auth, but needs an auth server + consent + refresh. Overkill until external developers are involved. |
| Service accounts | Later, layered on PATs, for backend automations. |

### MCP server shape
| Option | Verdict |
| --- | --- |
| **Standalone MCP server** (`@modelcontextprotocol/sdk`, calls the Rentular HTTP API with a PAT) | **Chosen.** Keeps the API untouched, deploys independently (own process on m1, or a muncher container over Tailscale like the WhatsApp bridge). |
| Embedded in the Hono API (MCP endpoint in-process) | Deferred. One deployment + shared auth, but couples MCP lifecycle to the API. |
| Auto-generate from OpenAPI | Only if we also want public API docs; adds `zod-openapi` + a shim. |

### Transport
- **stdio** for local use in Claude Desktop/Code (PAT in an env var) , trivial start.
- **Streamable HTTP + OAuth** for a hosted server Claude connects to remotely, fronted by Caddy on m1. (SSE transport is deprecated.)

## Tools to expose first
All scoped to the token's user + accessible properties; read before write.
- **Read:** `list_properties`, `get_property`, `list_leases`, `list_tenants`,
  `payment_overview` (dashboard), `lease_ledger`, `indexation_status`.
- **Write (manager+):** `mark_rent_paid`, `send_reminder` (channel-aware),
  `record_ledger_payment`, `apply_indexation`.

## Security
Reuse role checks per tool (writes require manager+); hashed tokens with expiry +
revoke; rate-limit; log tool calls (reuse the `communications` pattern); keep the
`no-store` headers. Remote MCP uses OAuth + short-lived tokens.

## Consequences
- + Opens Rentular to agents and integrations without weakening the browser flow.
- + PATs reuse existing authorization; small, contained change.
- − New surface area: token storage, revocation UX, rate-limiting, audit.
- − Unofficial/low-effort transports (stdio) need local setup; remote needs OAuth.

## Rough effort
Phase 1 (PAT + Settings UI) ~1 day · Phase 2 (stdio MCP, read + safe writes) ~1 day ·
Phase 3 (remote HTTP + OAuth, OpenAPI) larger, OAuth-dependent.
