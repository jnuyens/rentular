# Phase 11: MCP Server & External API Access - Pattern Map

**Mapped:** 2026-10-05
**Files analyzed:** 13 (9 new, 4 modified)
**Analogs found:** 13 / 13 (every file has an in-repo analog; MCP transport is new-to-repo but the HTTP-client + standalone-service shape has an analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/db/src/schema/apiTokens.ts` (new) | model/schema | CRUD | `packages/db/src/schema/propertyManagers.ts` | exact (role+flow) |
| `packages/db/src/schema/apiToolCalls.ts` (new) | model/schema | event-driven (audit) | `packages/db/src/schema/communications.ts` | exact (role+flow) |
| `packages/db/src/schema/index.ts` (edit) | config/barrel | N/A | existing `export *` list | exact |
| `apps/api/src/lib/apiTokens.ts` (new) | service/util | transform (crypto) + CRUD | `apps/api/src/lib/authSecret.ts` + `propertyAccess.ts` query shape | role-match |
| `apps/api/src/lib/authMiddleware.ts` (edit) | middleware | request-response | itself (extend the seam at :99) | exact |
| `apps/api/src/index.ts` (edit, CSRF) | config/middleware wiring | request-response | the webhook skip at :95-101 | exact |
| `apps/api/src/lib/routeAuth.ts` (edit, `requireWriteScope`) | middleware | request-response | `requireAuth` at :15-21 | exact |
| `apps/api/src/routes/apiTokens.ts` (new) | route/controller | CRUD | `apps/api/src/routes/bankAccounts.ts` | exact (owner-scoped CRUD) |
| `apps/api/src/routes/ledger.ts` (edit, harden record-payment) | route/controller | request-response | `payments.ts:666` mark-month-paid (correct gate) | exact |
| `apps/api/src/routes/payments.ts` (edit, harden send-reminder) | route/controller | request-response | `payments.ts:666` mark-month-paid (correct gate) | exact |
| `apps/web/app/(dashboard)/settings/page.tsx` (edit) + token tab | component | CRUD | the Tabs + Card + AlertDialog structure already in this file | exact |
| `apps/web/messages/{en,nl,fr,de}/common.json` (edit) | config/i18n | N/A | existing `settings` / `bankConnections` key blocks | exact |
| `apps/mcp-server/` (new package) | service (standalone process) | request-response (HTTP client) | `apps/api/src/lib/whatsapp.ts` (standalone HTTP client) + `apps/api` build setup | role-match |

## Pattern Assignments

### `packages/db/src/schema/apiTokens.ts` (schema, CRUD)

**Analog:** `packages/db/src/schema/propertyManagers.ts` (varchar(36) PK + `references(() => users.id, { onDelete: "cascade" })` + `uniqueIndex`/`index` in the second table-arg).

**Column + id conventions to copy** (propertyManagers.ts:12-54):
```typescript
import { mysqlTable, varchar, timestamp, mysqlEnum, uniqueIndex } from "drizzle-orm/mysql-core";
import { users } from "./users";

export const propertyManagers = mysqlTable("property_managers", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["owner", "co_owner", ...]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueUserProperty: uniqueIndex("unique_user_property").on(table.propertyId, table.userId),
}));
```
Note: `users.id` is `varchar(length: 255)` (users.ts:16), so FK columns referencing it MUST be `varchar(255)`, not 36. The RESEARCH.md draft schema (lines 376-389) already matches these conventions; use it, with `char("token_hash", { length: 64 })` UNIQUE-indexed for the O(1) lookup and `scope` as `mysqlEnum("scope", ["read", "write"]).notNull().default("read")`.

**Barrel export** (index.ts): append `export * from "./apiTokens";` after line 18 (same one-line `export *` style as every other table).

---

### `packages/db/src/schema/apiToolCalls.ts` (schema, event-driven audit)

**Analog:** `packages/db/src/schema/communications.ts` - the "insert a log row, index by owner" pattern.

**Pattern to mirror** (communications.ts:14-67): varchar(36) id, `ownerId`/`userId` referencing `users.id`, a `mysqlEnum` status, a `json("metadata")` column for structured payload, `createdAt` default-now, and a trailing index block:
```typescript
}, (table) => ({
  ownerIdx: index("communications_owner_idx").on(table.ownerId),
  leaseIdx: index("communications_lease_idx").on(table.leaseId),
}));
```
The `communications` enums (`channel: email/sms/letter`, the reminder `type` list) do NOT fit generic tool-call logging - reuse the *pattern*, not the table. RESEARCH.md lines 401-411 gives the fit-for-purpose `api_tool_calls` shape (`tool`, `args` json, `status` enum ok/error/forbidden, `httpStatus`, `errorMessage`, `userIdx`). Remember the barrel export line.

**Note (A2):** existing write tools that send mail (`apply_indexation` → `queueEmail`) keep logging via the existing `CommunicationMeta` path in `emailQueueWorker.ts:103` - no change there. `api_tool_calls` is additive audit, not a replacement.

---

### `apps/api/src/lib/apiTokens.ts` (service, crypto transform + CRUD)

**Analog A - fail-closed secret accessor:** `apps/api/src/lib/authSecret.ts:15-23`. Mirror this EXACTLY for the pepper:
```typescript
const MIN_LENGTH = 16;
export function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length < MIN_LENGTH) {
    throw new Error(`AUTH_SECRET must be set and at least ${MIN_LENGTH} characters; refusing to start with a weak or empty secret.`);
  }
  return secret;
}
```
`API_TOKEN_PEPPER` must fail closed the same way (or be derived from `AUTH_SECRET` via `@panva/hkdf`, already a dep - authMiddleware.ts:16-24 shows the exact `hkdf("sha256", secret, salt, info, 64)` call to copy if deriving).

**Analog B - crypto + token design:** RESEARCH.md Pattern 1 (lines 178-192) - `randomBytes(32).toString("base64url")` with `rtl_` prefix, `createHash("sha256").update(PEPPER).update(raw).digest("hex")`, `timingSafeEqual` on the final compare.

**Analog C - db query/insert shape:** the lightweight accessor + `and(eq(...), isNotNull(...))` pattern in `propertyAccess.ts:103-117` (list-my-rows) and bankAccounts insert at `bankAccounts.ts:82-91`. `crypto.randomUUID()` for the row id is the repo norm (bankAccounts.ts:75). Throttled `lastUsedAt` update: RESEARCH.md Pattern 3 (lines 221-224), fire-and-forget `.catch(() => {})`.

---

### `apps/api/src/lib/authMiddleware.ts` (middleware, request-response) - EDIT

**The seam:** `authMiddleware` starts at line 99; the cookie read is lines 100-113 and the `if (!c.get("userId")) c.set("userId", null)` fallback is lines 116-118.

**Edit:** insert a Bearer branch at the very top of the function body (before `getCookie`), resolving `Authorization: Bearer rtl_…` **exclusively** and returning `next()` without touching the cookie path (fail-closed - RESEARCH.md Pattern 2, lines 199-214). On a valid token `c.set("userId", row.userId)` + `c.set("tokenScope", row.scope)`; on invalid `c.set("userId", null)` then `return next()`. Leave lines 100-120 (the cookie path) byte-for-byte unchanged. Existing `requireAuth` (routeAuth.ts:15-21) already 401s on null userId, so no per-route auth change is needed.

**Context-key style to match:** the file already does `c.set("userId", ...)`, `c.set("userEmail", ...)` - add `c.set("tokenScope", ...)` the same way. (Hono context typing lives in `hono.d.ts` per CLAUDE.md - add `tokenScope` there.)

---

### `apps/api/src/index.ts` (CSRF wiring, request-response) - EDIT

**Analog = the existing skip, same file:** lines 95-101 already short-circuit CSRF for webhooks:
```typescript
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path.includes("/webhooks/") || path.includes("/stripe/webhook")) {
    return next();
  }
  return csrf({ origin: (origin) => allowedOrigins.includes(origin) })(c, next);
});
```
**Edit:** add one line inside this same callback, mirroring the webhook skip shape (RESEARCH.md Pitfall 1, lines 334-339):
```typescript
if (c.req.header("Authorization")?.startsWith("Bearer rtl_")) return next();
```
If `/api-tokens` is a protected prefix, also add it to `protectedPrefixes` (index.ts:53-72) and `app.route("/api-tokens", apiTokensRouter)` with the rest (index.ts:154-177).

---

### `apps/api/src/lib/routeAuth.ts` (middleware, request-response) - EDIT

**Analog = `requireAuth`, same file:** lines 15-21 is the `createMiddleware(async (c, next) => {...})` template to copy verbatim:
```typescript
export const requireAuth = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  await next();
});
```
**Edit:** add `requireWriteScope` in the same style (RESEARCH.md Pattern 4, lines 231-236): read `c.get("tokenScope")`; `if (scope === "read") return c.json({ error: "Token is read-only" }, 403);` else `await next()`. Cookie sessions have no `tokenScope` (undefined) → full access, browser flow untouched.

---

### `apps/api/src/routes/apiTokens.ts` (route, CRUD) - NEW, mount `/api-tokens`

**Analog:** `apps/api/src/routes/bankAccounts.ts` - the canonical owner-scoped CRUD router.

**Router + import conventions** (bankAccounts.ts:1-9):
```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, bankAccounts } from "@rentular/db";
const db = getDb();
export const bankAccountsRouter = new Hono();
```

**List-mine (owner-scoped)** (bankAccounts.ts:42-52): read `c.get("userId")`, 401 if absent, `db.select().from(...).where(and(eq(table.ownerId, ownerId), ...))`, return `c.json({ data: result })`. NEVER return `tokenHash` in the list response.

**Create + show-once** (bankAccounts.ts:69-106): `zValidator("json", schema)`, `c.req.valid("json")`, `crypto.randomUUID()` for id, `db.insert(...).values({...})`, `return c.json({ data: record, message: "..." }, 201)`. The mint response is the ONLY place the plaintext `rtl_…` is returned - it is shown once and never stored.

**Revoke:** model on the PATCH/DELETE handlers lower in bankAccounts.ts (owner-scoped `where(and(eq(id), eq(ownerId)))`); set `revokedAt` rather than hard-delete.

**Route test analog:** `apps/api/src/routes/__tests__/bankAccounts.test.ts:14-70` - spy-based `eq`/`and`, a fake `getDb()`, and `buildApp(userId)` injecting `c.set("userId", ...)`. The new `apiTokens.test.ts` (and the authMiddleware/scope tests) follow this exact mock-the-db, assert-the-conditions style (RESEARCH.md lines 510, 530-534).

---

### `apps/api/src/routes/ledger.ts` (harden `record-payment`) - EDIT

**Gap:** `POST /:leaseId/record-payment` (ledger.ts:63-92) authorizes via `authorizeLease` (ledger.ts:19-33) which only checks `getAccessiblePropertyIds` - a `viewer` passes.

**Correct-gate analog (copy this):** `payments.ts:685-688` inside mark-month-paid:
```typescript
const role = await getUserPropertyRole(userId, lease.propertyId);
if (!role || !hasMinimumRole(role, "manager")) {
  return c.json({ error: "Insufficient permissions" }, 403);
}
```
**Edit:** after the existing `authorizeLease` check in the record-payment handler, resolve the lease's `propertyId` and add the `getUserPropertyRole` + `hasMinimumRole(role, "manager")` gate. Import both from `../lib/propertyAccess` (ledger.ts already imports `getAccessiblePropertyIds` from there, line 7).

---

### `apps/api/src/routes/payments.ts` (harden `send-reminder`) - EDIT

**Gap:** `POST /send-reminder` (payments.ts:958-993) checks only `getAccessiblePropertyIds` (lines 979-982) - a `viewer` passes.

**Edit:** replace the access-only check with the same `getUserPropertyRole` + `hasMinimumRole(role, "manager")` block shown above (both helpers are already imported in payments.ts - see mark-month-paid at :685). Keep the existing 404 lease lookup and the try/catch around `sendManualReminder`.

**Channel-awareness caveat (Pitfall 3):** `send_reminder` is email-only today (`manualReminder.ts:184` hard-codes `channel: "email"`). Ship email-only with an explicit tool description; do not promise SMS/WhatsApp. (Open Question 1 - planner to confirm.)

---

### `apps/web/app/(dashboard)/settings/page.tsx` + API-tokens tab (component, CRUD) - EDIT

**Analog = this file's own structure.** It is a `"use client"` page using `useTranslations` (next-intl), shadcn `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Card*`, `AlertDialog*`, `toast` from sonner, and lucide icons.

**Add a tab** (page.tsx:794-800 is the `TabsList`; 803+ are the `TabsContent` blocks):
```tsx
<TabsList className="grid w-full grid-cols-2 md:grid-cols-5 mb-6">
  <TabsTrigger value="follow-up">{t("paymentFollowUp")}</TabsTrigger>
  ...
  <TabsTrigger value="profile">{t("profileTab")}</TabsTrigger>
</TabsList>
...
<TabsContent value="follow-up">...</TabsContent>
```
Add an `<TabsTrigger value="api-tokens">{t("apiTokensTab")}</TabsTrigger>` and a matching `<TabsContent value="api-tokens">` (bump the `grid-cols-5` to `6`). Build the token list + create form inside a `Card`. **Show-once:** reveal the minted `rtl_…` plaintext in an `AlertDialog` with a copy button, and never re-fetch it. **Revoke:** use the `AlertDialog` confirm pattern already imported (page.tsx:48-58). Data fetching: the file already does `useCallback`+`useEffect` fetches against the API; mirror it. All user-visible strings go through `t(...)` - no hardcoded copy.

---

### `apps/web/messages/{en,nl,fr,de}/common.json` (i18n) - EDIT

**Analog:** the existing top-level key blocks (`settings` at common.json:394, `bankConnections` at 1029, `managers` at 849). Add the new token-UI strings under the `settings` block (or a sibling `apiTokens` block) in ALL FOUR locales (en, nl, fr, de) - CLAUDE.md requires parity across locales. Keep keys camelCase (e.g. `apiTokensTab`, `createToken`, `tokenShownOnce`, `revoke`).

---

### `apps/mcp-server/` (new standalone package)

**Analog A - standalone HTTP client over a bearer token:** `apps/api/src/lib/whatsapp.ts:20-61`. It reads config from env, builds a `fetch` with `Authorization: Bearer ${token}` + `Content-Type: application/json`, uses an `AbortController` timeout, and throws descriptive errors on non-ok. The MCP `httpClient.ts` mirrors this exactly, with `RENTULAR_API_URL` + `RENTULAR_PAT` env vars (RESEARCH.md Pattern 5, lines 246-250).

**Analog B - build/toolchain + package.json scripts:** `apps/api/package.json` - `"build": "tsup"`, `"dev": "tsx watch ..."`, `"test": "vitest run"`, devDeps `tsup/tsx/typescript/@types/node/vitest`. Mirror these. CRITICAL deviations for this package (RESEARCH.md lines 13, 56, 358-361):
- `"type": "module"` (SDK is ESM-only) - the API package is CJS-ish; this one is NOT.
- Declare its OWN `zod@^3.25` (SDK peer is `^3.25 || ^4.0`; repo pins 3.24). Do NOT import `@rentular/shared` zod into it.
- Add `@modelcontextprotocol/sdk@1.32.0` and a `bin` entry.

**Tool registration shape** (RESEARCH.md Pattern 5, lines 240-281): `server.registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a Zod **raw shape** `{ leaseId: z.string() }`, NOT `z.object(...)`. `StdioServerTransport`. Keep tool handlers in `tools/read.ts` + `tools/write.ts`, transport only in `index.ts` (transport-agnostic for the future remote follow-on). Tools are thin HTTP clients - NO DB access, NO re-implemented authz (the API enforces roles). Tool→endpoint mapping is RESEARCH.md lines 419-438.

**Deployment note:** the stdio MCP server runs on the *user's* machine (Claude Desktop spawns it) - distributed as a package + a `claude_desktop_config.json` snippet, NOT deployed to m1. The WhatsApp-bridge systemd/Tailscale shape (`/opt/rentular-wa-bridge` on muncher) is the analog only for the *future remote* Streamable HTTP server, which is out of scope here.

## Shared Patterns

### Fail-closed secret access
**Source:** `apps/api/src/lib/authSecret.ts:15-23`
**Apply to:** `apps/api/src/lib/apiTokens.ts` (the `API_TOKEN_PEPPER` accessor). Throw on unset/weak; never fall back to `""`.

### Role authorization (reuse verbatim - do not re-implement)
**Source:** `apps/api/src/lib/propertyAccess.ts` - `getAccessiblePropertyIds` (:103), `getUserPropertyRole` (:145), `hasMinimumRole` (:23), `ROLE_LEVEL` (:7). Every membership query filters `isNotNull(propertyManagers.acceptedAt)` (Pitfall 5).
**Apply to:** the two route-hardening edits, and implicitly to every MCP tool (scoping is automatic once the PAT resolves to a `userId`).

### Owner/caller scoping on queries
**Source:** `bankAccounts.ts:42-66` - `const ownerId = c.get("userId"); ... where(and(eq(table.ownerId, ownerId), ...))`.
**Apply to:** all `apiTokens.ts` route queries (list/revoke scoped to the caller).

### Route handler + validation shape
**Source:** `bankAccounts.ts:69-106`, `ledger.ts:63-92` - `zValidator("json", schema)`, `c.req.valid("json")`, `getRequiredUserId(c)` (routeAuth.ts:24-30), `c.json({ data }, 201)` on create, `c.json({ error }, 4xx)` on failure.
**Apply to:** `apiTokens.ts` and the hardened write routes.

### Audit logging (insert-a-row, index-by-owner)
**Source:** `communications.ts` schema + the existing `CommunicationMeta` insert path.
**Apply to:** `api_tool_calls` inserts from write tools (redact token plaintext and secret args before insert - Security Domain, RESEARCH.md line 559).

### `no-store` + CSRF discipline (do not weaken)
**Source:** `index.ts:80-85` (no-store default) and `:95-101` (CSRF skip). Bearer requests get the CSRF skip; cookie requests keep full CSRF. Keep the no-store header behavior.

## Conventions

Derived from `apps/api/src` (shared `gsd-tools.cjs verify conventions --derive`). All four axes are **named contracts** (dominance >= 70%): match them.

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| file-name casing | camelCase | 97% | 0.181 | named contract |
| identifier casing | camelCase | 99% | 0.073 | named contract |
| export style | ESM (`export`) | 100% | 0.000 | named contract |
| import style | ESM (`import`) | 99% | 0.112 | named contract |

Concretely for this phase: new API files (`lib/apiTokens.ts`, `routes/apiTokens.ts`) and DB schema files use camelCase filenames, camelCase identifiers, and ESM `import`/`export` - matching every analog cited above. React components stay PascalCase filenames (project CLAUDE.md), route *directory* segments stay kebab-case (`/api-tokens`).

**Contested hotspots (author's choice):** none within `apps/api/src` - this subtree is internally consistent ESM. Repo-wide, Rentular has the prototype **CJS↔SDK dual resolver** split: the new `apps/mcp-server/**` is ESM-only (`"type": "module"`, `export`/`import`, its own `zod@^3.25`) because the MCP SDK demands it, while it talks to an API package on an older toolchain. Treat the two packages as independently consistent: match the *local* package's style, do not cross-import zod or module conventions between them (RESEARCH.md Pitfall 4).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| MCP stdio transport wiring (`apps/mcp-server/src/index.ts` transport layer) | service | stdio | No MCP/stdio server exists in-repo yet. Use the verified SDK 1.32.0 shape in RESEARCH.md Pattern 5 (lines 240-281); the HTTP-client half has the `whatsapp.ts` analog. |

## Metadata

**Analog search scope:** `packages/db/src/schema/`, `apps/api/src/{lib,routes,routes/__tests__}/`, `apps/web/app/(dashboard)/settings/`, `apps/web/messages/`.
**Files scanned:** ~14 read in full/targeted + directory listings.
**Pattern extraction date:** 2026-10-05
