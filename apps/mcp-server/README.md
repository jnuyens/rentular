# @rentular/mcp-server

## What it is

A standalone [MCP](https://modelcontextprotocol.io) server that lets Claude (Desktop or Code) read and act on a landlord's Rentular data. It is a small Node process that runs on your own machine. Claude spawns it over stdio, and it calls the Rentular HTTP API with a Personal Access Token (PAT).

It never talks to the database and it never decides who may do what. All authorization happens in the Rentular API: the PAT resolves to one user, and every endpoint already filters by the properties that user can access and by role (owner, co_owner, manager, accountant, viewer). The server only forwards requests and relays the API's answer.

## Prerequisites

- A Rentular account.
- A Personal Access Token created in Settings > API tokens. Use a read token for the read tools, and a read and write token for the write tools.
- Node 18 or newer.

## Install and build

From the repo root:

```bash
pnpm install
pnpm --filter @rentular/mcp-server build
```

This produces `apps/mcp-server/dist/index.js`, the `rentular-mcp` bin.

## Configure Claude Desktop

Add the server to `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "rentular": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mcp-server/dist/index.js"],
      "env": {
        "RENTULAR_API_URL": "https://www.rentular.com",
        "RENTULAR_PAT": "rtl_your_token_here"
      }
    }
  }
}
```

`RENTULAR_API_URL` is your Rentular base URL, with or without a trailing `/api/v1` (the server adds it). `RENTULAR_TIMEOUT_MS` is optional and defaults to 20000.

## Configure Claude Code

```bash
claude mcp add rentular \
  -e RENTULAR_API_URL=https://www.rentular.com \
  -e RENTULAR_PAT=rtl_your_token_here \
  -- node /absolute/path/to/apps/mcp-server/dist/index.js
```

## Tools

Every write tool needs a write-scoped token plus manager or higher on the property. Every call is rate limited per token and recorded in the Rentular audit log with the tool name (sent as the `X-Rentular-Tool` header). Read tools need only a read-scoped token. All results are limited to the data the token owner can access.

### Read tools

| Tool | Inputs | API endpoint |
| --- | --- | --- |
| `list_properties` | none | `GET /properties` |
| `get_property` | `propertyId` | `GET /properties/:id` |
| `list_leases` | none | `GET /leases` |
| `list_tenants` | none | `GET /tenants` |
| `payment_overview` | none | `GET /payments/dashboard` |
| `lease_ledger` | `leaseId`, `months?` | `GET /ledger/:leaseId` |
| `indexation_status` | `leaseId` | `GET /indexation/calculate/:leaseId` |

### Write tools (manager or higher)

| Tool | Inputs | API endpoint |
| --- | --- | --- |
| `mark_rent_paid` | `leaseId`, `month` (YYYY-MM), `method?`, `date?` | `POST /payments/mark-month-paid` |
| `send_reminder` | `leaseId`, `month`, `level` (friendly, formal, final) | `POST /payments/send-reminder` |
| `record_ledger_payment` | `leaseId`, `periodMonth`, `amount`, `method?`, `date?` | `POST /ledger/:leaseId/record-payment` |
| `apply_indexation` | `leaseId`, `newRent`, `subject`, `body`, `sendNotification?` | `POST /indexation/apply/:leaseId` |

`send_reminder` delivers over the tenant's preferred channel (email, SMS or WhatsApp, as set on the tenant record). It falls back to email when that channel is not configured or the tenant has no phone number. The response reports the channel actually used and the address or number it went to.

A write tool called with a viewer role or a read-scoped token gets a 403 from the API, which the server surfaces as an error with a clear refusal message rather than retrying.

## Security notes

- Tokens are shown once when created and stored only as a hash. Revoke a token from Settings > API tokens to cut its access immediately.
- Never commit the PAT. Keep it in the client config file on your machine.
- The server logs only to stderr (stdout is the MCP protocol channel) and never logs the token.

## Out of scope / follow-on

This package is the stdio-first step. The following are intentionally deferred:

- Remote MCP over Streamable HTTP with OAuth, so Claude can connect to a hosted server (fronted by the m1 reverse proxy, in the style of the WhatsApp bridge). The bearer token would come from OAuth instead of an env var. The older SSE transport is deprecated and will not be used.
- OpenAPI generation (zod-openapi) and public API documentation.
- Service accounts for backend automations layered on top of PATs.

Tool logic is transport-agnostic (`src/tools/*.ts`), so adding the remote transport changes only `src/index.ts`; the tools stay as they are.

## Development

```bash
pnpm --filter @rentular/mcp-server dev    # run from source with tsx
pnpm --filter @rentular/mcp-server test   # vitest
pnpm --filter @rentular/mcp-server lint   # tsc --noEmit
```
