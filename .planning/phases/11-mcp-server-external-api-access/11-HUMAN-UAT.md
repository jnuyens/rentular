---
status: partial
phase: 11-mcp-server-external-api-access
source: [11-VERIFICATION.md]
started: 2026-10-05T20:10:00Z
updated: 2026-10-05T20:10:00Z
---

## Current Test

Live MCP client connection from Claude Desktop / Claude Code (awaiting human).

## Tests

### 1. Production positive-path PAT smoke
expected: A valid read PAT returns the owner's properties (200); after revoke the same token returns 401; an api_tool_calls audit row is written for the authorized call.
result: PASSED (verified live on m1 2026-10-05). Minted a read token via the app's own mintToken for the owner account, GET /api/v1/properties returned 200 with {data, meta}, api_tool_calls recorded tool=phase11_smoke status=ok http_status=200, revoke returned 401, then the test token and its audit row were deleted (both tables back to 0 rows).

### 2. Live MCP client connection
expected: Add apps/mcp-server/dist/index.js to Claude Desktop or Claude Code with a real RENTULAR_API_URL + RENTULAR_PAT, run list_properties and see only the token owner's properties; call a write tool (e.g. mark_rent_paid) with a read-scoped token and confirm the tool surfaces the "Refused by Rentular (insufficient role or read-only token)" text instead of retrying; a status=forbidden row appears in api_tool_calls.
result: [pending] — requires a real Claude client on the user's machine. The mcp-server has 21 passing unit tests for the tool-to-endpoint map, fails closed without RENTULAR_PAT, and the HTTP API it calls is verified live (test 1), so this is an interactive confirmation, not a code-correctness gate.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
