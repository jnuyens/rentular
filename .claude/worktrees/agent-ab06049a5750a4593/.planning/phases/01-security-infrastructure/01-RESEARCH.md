# Phase 1: Security & Infrastructure Foundation - Research

**Researched:** 2026-03-22
**Domain:** Backend hardening, type-safe database access, CSRF protection, database indexing, TODO cleanup
**Confidence:** HIGH

## Summary

Phase 1 transforms the Rentular API from a prototype with in-memory fallbacks and loose typing into a production-hardened backend. The codebase has five files importing `memoryStore` (properties, tenants, leases, bankAccounts, maintenance), three files using the `let db: any` dynamic import pattern (properties, tenants, bankAccounts -- plus authMiddleware), and 62 TODO comments across 15 route files. The database schema already defines all needed tables except `maintenance`, and the existing Drizzle schema pattern (with the object-return callback format) provides a clear template for adding indexes.

Hono ships a built-in `csrf()` middleware that validates `Origin` and `Sec-Fetch-Site` headers -- exactly matching decision D-01's Origin/Referer validation approach. The installed Hono version (4.12.7) includes the fix for CVE-2024-48913 (Content-Type bypass), so no version upgrade is needed. The CSRF middleware can be applied globally in `index.ts` alongside the existing middleware chain.

**Primary recommendation:** Execute in this order: (1) add `maintenance` table + `heatingType` column to schema, (2) replace all dynamic `require()` imports with static typed imports, (3) remove memoryStore and all fallback logic, (4) wire TODO-stub routes to real DB queries, (5) add CSRF middleware, (6) add database indexes, (7) enhance health check endpoint, (8) relabel remaining TODOs as phase markers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use Origin/Referer header validation against an environment variable allowlist (`ALLOWED_ORIGINS`)
- **D-02:** No frontend changes required -- validation happens server-side in Hono middleware
- **D-03:** Allowlist supports multiple origins (production, staging, localhost for development)
- **D-04:** API key authentication is deferred -- not in Phase 1 scope
- **D-05:** Replace TODO stubs with explicit phase markers (e.g., `// Phase 2: implement payment persistence`) -- do not delete the route scaffolding
- **D-06:** Stubs in webhooks.ts and gocardless.ts are marked as Phase 2
- **D-07:** Stubs in propertyManagers.ts are marked as Phase 5
- **D-08:** Route structure and handler signatures are preserved for downstream phases to build on
- **D-09:** Remove ALL in-memory store fallbacks from every route -- API returns 500 if DB is down
- **D-10:** Delete `memoryStore.ts` entirely -- no dead code
- **D-11:** Convert all route files to static typed Drizzle imports in a single sweep (eliminates all `any` typing on DB imports)
- **D-12:** Add `GET /health` endpoint that checks DB + Redis connectivity (not SMTP -- email failures are handled by the queue)
- **D-13:** Wire costs, rent adjustments, communications, and maintenance routes to real database queries (replacing in-memory store usage)
- **D-14:** Add `maintenance` table to the Drizzle schema for persisting auto-generated and custom maintenance tasks
- **D-15:** Maintenance tasks are stored in DB after auto-generation (not recalculated on-the-fly)
- **D-16:** Add indexes for common query patterns: payments by lease+status, properties by owner, tenants by owner, leases by owner+property
- **D-17:** Verify index usage via EXPLAIN on key queries
- **D-18:** Schema already supports residential (short/long/lifetime), student, and commercial lease types -- no changes needed
- **D-19:** Regional enum (flanders/wallonia/brussels) already in place -- no changes needed
- **D-20:** Current auto-generated task set is complete for v1: fire alarm inspection, heating maintenance, chimney sweep
- **D-21:** Tasks track: type, name, intervalMonths, nextDue, status, autoEmail, lastCompleted

### Claude's Discretion
- CSRF middleware implementation details (exact Hono middleware structure)
- Maintenance table schema column types and defaults
- Index selection beyond the explicitly listed query patterns
- Health check response format
- Error response format when DB/Redis is down

### Deferred Ideas (OUT OF SCOPE)
- API key authentication for non-browser clients -- future phase when mobile/integrations needed
- SMTP health monitoring -- not needed since email delivery is async via BullMQ
- Memory store as optional dev utility -- decided against, use a real local DB instead
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | All state-changing API endpoints have CSRF protection via Hono middleware | Hono built-in `csrf()` middleware with `origin` option for allowlist validation. Applied globally in `index.ts`. |
| SEC-02 | Database imports use proper TypeScript types (no `any` typing) | Replace dynamic `require("@rentular/db")` with static `import { getDb, properties, tenants, ... } from "@rentular/db"`. Eliminates all `any` casts on db/schema/eq/and. |
| INF-01 | All remaining TODO stubs in API routes are implemented or explicitly removed | 62 TODOs catalogued: costs (5), rentAdjustments (8), communications (5), settings (6), maintenance (in-memory, no TODOs but needs DB wiring). Remaining TODOs get phase markers per D-05/D-06/D-07. |
| INF-02 | Cost tracking endpoints are functional | Wire `costs.ts` CRUD to `costs` table via typed Drizzle queries. Schema already exists in `packages/db/src/schema/costs.ts`. |
| INF-03 | Rent adjustment endpoints are functional | Wire `rentAdjustments.ts` to `rentFreePeriods` and `rentDeductions` tables. Both schemas exist. |
| INF-04 | Communication logging endpoints are functional | Wire `communications.ts` to `communications` table. Schema exists. Add ownerId filtering. |
| INF-05 | Database indexes exist for common query patterns | Add composite indexes via Drizzle schema callback: payments(lease_id, status), properties(owner_id), tenants(owner_id), leases(owner_id, property_id). |
| LSE-01 | System supports both residential and commercial lease types | Already supported in schema -- `leases.type` enum includes residential_short/long/lifetime, student, commercial. Verified no code changes needed. |
| LSE-02 | Basic auto-generated maintenance reminders based on property/lease type | Wire `maintenance.ts` to new `maintenanceTasks` DB table. Current auto-generation logic (fire alarm, heating, chimney) preserved. Requires adding `heatingType` column to properties schema. |
</phase_requirements>

## Standard Stack

### Core (already in project -- no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.7 (installed) | HTTP framework + CSRF middleware | Built-in `csrf()` middleware, no extra packages needed |
| Drizzle ORM | 0.36.0 (pinned) | Type-safe database access + index definitions | Already the ORM; static imports give full type safety |
| drizzle-kit | 0.31.9 (pinned) | Schema migrations | `db:generate` + `db:push` for schema changes |
| ioredis | 5.4.0 (installed) | Redis client for health check | Already used by BullMQ; reuse for health check ping |
| mysql2 | 3.11.0 (installed) | MySQL driver | Already the DB driver; pool.query for health check |

### No New Dependencies Required

This phase requires zero new npm packages. All functionality is covered by existing dependencies:
- CSRF: `hono/csrf` (built-in middleware)
- DB typing: static imports from `@rentular/db` (already a workspace dependency)
- Indexes: Drizzle ORM `index()` from `drizzle-orm/mysql-core` (already available)
- Health check: direct pool ping via `mysql2` + `ioredis` (already installed)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `hono/csrf` built-in | Custom Origin check middleware | Custom is more work; built-in covers Origin + Sec-Fetch-Site and is maintained |
| Drizzle `index()` in schema | Raw SQL `CREATE INDEX` in migration | Raw SQL works but loses schema-as-code benefit; Drizzle index is declarative |
| Static imports | Dependency injection container | DI is over-engineered for this codebase size; static imports are idiomatic |

## Architecture Patterns

### Pattern 1: Static Typed Database Imports (replaces `let db: any` pattern)

**What:** Replace all dynamic `require()` + try-catch import patterns with static ES module imports.
**When to use:** Every route file that currently uses the `let db: any = null; try { const dbMod = require(...) } catch {}` pattern.
**Current anti-pattern (properties.ts lines 7-20):**
```typescript
// BAD: dynamic require with any typing
let db: any = null;
let dbSchema: any = null;
let eq: any = null;
let and: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  dbSchema = dbMod.properties;
  eq = require("drizzle-orm").eq;
  and = require("drizzle-orm").and;
} catch {
  console.log("[Properties] Database unavailable, using in-memory store");
}
```

**Correct pattern (following auth.ts as the model):**
```typescript
// GOOD: static typed imports -- auth.ts already does this correctly
import { and, eq } from "drizzle-orm";
import { getDb, properties } from "@rentular/db";

const db = getDb();
```

**Key insight:** `auth.ts` already uses this exact pattern (line 6-8). It is the proven reference implementation in this codebase. All other route files should follow this pattern.

### Pattern 2: CSRF Middleware with Environment-Based Origin Allowlist

**What:** Hono's built-in `csrf()` middleware configured with `ALLOWED_ORIGINS` environment variable.
**When to use:** Applied globally in `index.ts` before route mounting.

```typescript
// Source: https://hono.dev/docs/middleware/builtin/csrf
import { csrf } from "hono/csrf";

// Parse ALLOWED_ORIGINS env var (comma-separated)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.WEB_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  csrf({
    origin: (origin) => allowedOrigins.includes(origin),
  })
);
```

**Important:** The `csrf()` middleware only activates on "unsafe" methods (POST, PUT, DELETE, PATCH) with form-compatible content types. It checks both `Origin` header and `Sec-Fetch-Site` header -- a request is allowed if EITHER check passes. This is the same approach used by SvelteKit.

**Webhook exception:** Stripe and GoCardless webhooks send POST requests from external origins. These routes must be excluded from CSRF protection or handled by placing the CSRF middleware only on routes that need it. The simplest approach: apply CSRF middleware to all routes, then use a skip pattern for webhook paths.

### Pattern 3: Database Health Check

**What:** Health endpoint that verifies DB and Redis connectivity with timeout.
**When to use:** `GET /api/v1/health` endpoint.

```typescript
import { getDb } from "@rentular/db";
import Redis from "ioredis";

app.get("/health", async (c) => {
  const checks: Record<string, string> = {};

  // Database check
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // Redis check
  try {
    const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    await redis.ping();
    await redis.quit();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return c.json(
    { status: allOk ? "healthy" : "degraded", checks, version: "0.1.0" },
    allOk ? 200 : 503
  );
});
```

### Pattern 4: Drizzle Schema Index Definition

**What:** Composite indexes defined in Drizzle schema using the callback parameter.
**When to use:** Adding indexes to existing tables.

```typescript
// Source: https://orm.drizzle.team/docs/indexes-constraints
import { index, mysqlTable, varchar, mysqlEnum } from "drizzle-orm/mysql-core";

// Use the object-return format (consistent with existing propertyManagers.ts)
export const payments = mysqlTable("payments", {
  // ... columns ...
}, (table) => ({
  leaseStatusIdx: index("payments_lease_status_idx").on(table.leaseId, table.status),
}));
```

**Consistency note:** The existing `propertyManagers.ts` uses the object-return callback format `(table) => ({...})`. The newer Drizzle docs show an array-return format `(table) => [...]`. Both work. Use the object-return format for consistency with existing code.

### Pattern 5: Route Error Handling (no fallback)

**What:** When DB is unavailable, routes fail with 500 instead of falling back to memory store.
**When to use:** All routes after memoryStore removal.

```typescript
// With static imports, if the DB module fails to load,
// the entire API server fails to start -- which is correct behavior.
// At runtime, individual query failures are caught per-handler:

propertiesRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db
    .select()
    .from(properties)
    .where(eq(properties.ownerId, ownerId));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});
// If db.select() throws, it propagates to Hono's global onError handler -> 500
```

### Anti-Patterns to Avoid
- **Dynamic `require()` with try-catch for DB imports:** Loses all TypeScript type checking. Replace with static `import`.
- **In-memory fallback on DB error:** Silently loses data on restart. Fail fast with 500 instead.
- **`any` casts on Drizzle schema references:** The whole point of Drizzle ORM is type safety. Static imports solve this entirely.
- **Applying CSRF middleware inside each route handler:** Apply once globally in `index.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSRF protection | Custom Origin header checking middleware | `hono/csrf` built-in middleware | Handles Origin + Sec-Fetch-Site, maintained by Hono team, CVE-patched |
| Database health check | Custom TCP socket check | `db.execute(sql\`SELECT 1\`)` + `redis.ping()` | Standard liveness patterns, handles connection pool state |
| Index verification | Manual `EXPLAIN` parsing | `drizzle-kit push` + manual `EXPLAIN` spot-check | Drizzle generates correct DDL; EXPLAIN is verification, not implementation |

## Common Pitfalls

### Pitfall 1: CSRF Blocks Webhook Endpoints
**What goes wrong:** GoCardless and Stripe POST webhooks from external origins are blocked by CSRF middleware.
**Why it happens:** CSRF middleware rejects all POST requests from non-allowlisted origins.
**How to avoid:** Exclude webhook paths from CSRF middleware. Two approaches: (a) apply CSRF middleware only to specific route prefixes (not webhooks/stripe), or (b) apply globally but with a path-based skip. Option (a) is cleaner.
**Warning signs:** GoCardless/Stripe webhook test calls return 403 after CSRF is enabled.

### Pitfall 2: Static Import Causes Startup Crash When DB Is Down
**What goes wrong:** Converting from dynamic `require()` with try-catch to static `import` means the API server won't start if the DB module fails to initialize.
**Why it happens:** `getDb()` creates a connection pool on first call. If `getDb()` is called at import time (module scope), a DB outage prevents server startup.
**How to avoid:** Call `getDb()` at module scope (this is correct and desired per D-09 -- the API should not run without a DB). But ensure the MySQL connection pool is lazy (it is -- `mysql2.createPool()` doesn't actually connect until first query). So `const db = getDb()` at module scope is safe; the actual connection happens on first request.
**Warning signs:** API crashes on import before any request is handled.

### Pitfall 3: Missing `heatingType` Column in Properties Schema
**What goes wrong:** After wiring maintenance to the database and querying properties from DB (not memoryStore), `prop.heatingType` is `undefined` because the column doesn't exist in the schema.
**Why it happens:** The properties Zod schema accepts `heatingType` but the DB schema (`packages/db/src/schema/properties.ts`) has no `heatingType` column. Currently this "works" only because properties come from the in-memory store where the Zod-parsed object (which includes `heatingType`) is stored directly.
**How to avoid:** Add `heatingType` column to the properties DB schema before removing the memoryStore. Also update the `db.insert(properties).values(...)` call in `properties.ts` to include `heatingType`.
**Warning signs:** Maintenance auto-generation creates no heating/chimney tasks after migration.

### Pitfall 4: Object Return vs Array Return in Drizzle Schema Callbacks
**What goes wrong:** Mixing `(table) => ({...})` and `(table) => [...]` formats in different schema files causes confusion and potential issues with `drizzle-kit generate`.
**Why it happens:** Drizzle ORM docs switched to array-return format at some point, but both work.
**How to avoid:** Use the object-return format `(table) => ({...})` consistently, matching the existing `propertyManagers.ts` pattern.
**Warning signs:** `drizzle-kit generate` produces unexpected migration output.

### Pitfall 5: Settings Routes Need DB Wiring Too
**What goes wrong:** Settings routes (`settings.ts`) have 6 TODOs for reading/writing `paymentFollowUpSettings`. If not wired, saved settings are lost.
**Why it happens:** Settings routes currently return hardcoded defaults and don't persist changes.
**How to avoid:** Include settings.ts in the "wire to DB" sweep. The `paymentFollowUpSettings` table already exists in schema.
**Warning signs:** User saves payment follow-up settings, refreshes page, settings revert to defaults.

### Pitfall 6: CORS Origin Mismatch with CSRF Origin
**What goes wrong:** CORS is currently configured with `origin: process.env.WEB_URL || "http://localhost:3000"` (single origin). CSRF allowlist uses `ALLOWED_ORIGINS`. If these diverge, requests may pass CORS but fail CSRF or vice versa.
**Why it happens:** Two separate origin configurations that must stay synchronized.
**How to avoid:** Have CSRF middleware read from the same `ALLOWED_ORIGINS` env var and update CORS to also use it. Or simply ensure documentation links both configs.
**Warning signs:** Requests succeed from one origin but fail from another.

### Pitfall 7: Leases Route Is Fully Memory-Store-Based (No DB Code At All)
**What goes wrong:** `leases.ts` uses ONLY memoryStore -- it has no `require("@rentular/db")` pattern at all. This means it must be fully rewritten to use DB queries, not just "remove fallback."
**Why it happens:** Leases route was written purely against the in-memory store, unlike properties/tenants which have partial DB wiring.
**How to avoid:** Recognize that `leases.ts` is a full rewrite to DB, not a fallback removal. Same for `maintenance.ts`. Plan accordingly.
**Warning signs:** After removing memoryStore, leases endpoints return 500 because there's no DB code to fall back to.

## Code Examples

### Example 1: Converting properties.ts from dynamic to static imports

```typescript
// BEFORE (current code)
import * as mem from "../lib/memoryStore";
let db: any = null;
let dbSchema: any = null;
let eq: any = null;
let and: any = null;
try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  dbSchema = dbMod.properties;
  eq = require("drizzle-orm").eq;
  and = require("drizzle-orm").and;
} catch {
  console.log("[Properties] Database unavailable, using in-memory store");
}

// AFTER (target code)
import { eq, and } from "drizzle-orm";
import { getDb, properties } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

const db = getDb();
```

### Example 2: Adding composite indexes to payments schema

```typescript
// packages/db/src/schema/payments.ts -- add callback parameter
import { index } from "drizzle-orm/mysql-core";

export const payments = mysqlTable("payments", {
  // ... existing columns unchanged ...
}, (table) => ({
  leaseStatusIdx: index("payments_lease_status_idx").on(table.leaseId, table.status),
  leaseIdIdx: index("payments_lease_id_idx").on(table.leaseId),
}));
```

### Example 3: Maintenance table schema (new)

```typescript
// packages/db/src/schema/maintenance.ts (new file)
import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  int,
  boolean,
  mysqlEnum,
  index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { properties } from "./properties";
import { leases } from "./leases";

export const maintenanceTasks = mysqlTable("maintenance_tasks", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  propertyId: varchar("property_id", { length: 36 })
    .notNull()
    .references(() => properties.id),
  leaseId: varchar("lease_id", { length: 36 })
    .references(() => leases.id),
  type: varchar("type", { length: 50 }).notNull(), // fire_alarm, heating_maintenance, chimney_sweep, custom
  name: varchar("name", { length: 255 }).notNull(),
  intervalMonths: int("interval_months").notNull().default(12),
  lastCompleted: date("last_completed"),
  nextDue: date("next_due").notNull(),
  autoEmail: boolean("auto_email").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("maintenance_owner_idx").on(table.ownerId),
  propertyIdx: index("maintenance_property_idx").on(table.propertyId),
  nextDueIdx: index("maintenance_next_due_idx").on(table.nextDue),
}));
```

### Example 4: CSRF middleware with webhook exclusion

```typescript
// apps/api/src/index.ts -- add CSRF after CORS, before route mounting
import { csrf } from "hono/csrf";

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.WEB_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

// Apply CSRF to all routes EXCEPT webhooks (which have their own signature verification)
app.use("*", async (c, next) => {
  const path = c.req.path;
  // Skip CSRF for webhook endpoints (they use signature verification instead)
  if (path.includes("/webhooks/") || path.includes("/stripe/webhook")) {
    return next();
  }
  return csrf({ origin: (origin) => allowedOrigins.includes(origin) })(c, next);
});
```

### Example 5: Wiring costs.ts to database

```typescript
// apps/api/src/routes/costs.ts -- AFTER wiring
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getDb, costs } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";

const db = getDb();
export const costsRouter = new Hono();

costsRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  const propertyId = c.req.query("propertyId");
  // Build conditions array
  const conditions = [eq(costs.ownerId, ownerId)];
  if (propertyId) conditions.push(eq(costs.propertyId, propertyId));
  // ... etc
  const result = await db.select().from(costs).where(and(...conditions));
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 20 } });
});
```

## Detailed TODO Inventory and Disposition

### Routes to WIRE to DB (Phase 1 scope -- implement working logic)

| File | TODOs | Action |
|------|-------|--------|
| `costs.ts` | 5 TODOs (CRUD + summary) | Wire to `costs` table |
| `rentAdjustments.ts` | 8 TODOs (free periods CRUD + deductions CRUD) | Wire to `rentFreePeriods` and `rentDeductions` tables |
| `communications.ts` | 5 TODOs (list, get, resend, send, stats) | Wire to `communications` table |
| `settings.ts` | 6 TODOs (locale, payment follow-up CRUD, landlord report) | Wire to `users.locale` and `paymentFollowUpSettings` table |
| `maintenance.ts` | 0 explicit TODOs, but uses memoryStore entirely | Wire to new `maintenanceTasks` table |
| `leases.ts` | 0 explicit TODOs, but uses memoryStore entirely | Wire to `leases` + `leaseTenants` tables |

### Routes to RELABEL as phase markers (do NOT implement)

| File | TODOs | Phase Marker |
|------|-------|-------------|
| `webhooks.ts` | 12 TODOs (payment/mandate state updates) | `// Phase 2: implement payment persistence` |
| `gocardless.ts` | 4 TODOs (tenant/lease record updates) | `// Phase 2: implement GoCardless data persistence` |
| `payments.ts` | All 10 endpoints return 501 | `// Phase 2: implement payment CRUD` |
| `propertyManagers.ts` | 6 TODOs (all CRUD) | `// Phase 5: implement property manager roles` |
| `stripe.ts` | 5 TODOs (subscription management) | `// Phase 2: implement subscription persistence` |
| `indexation.ts` | 5 TODOs (health index, calculation, apply) | `// Phase 3: implement rent indexation` |
| `support.ts` | 3 TODOs (auth user, chat history, SSE) | `// Phase 7: implement support chat persistence` |

### Routes to REMOVE memoryStore fallback (already have partial DB wiring)

| File | Current State | Action |
|------|---------------|--------|
| `properties.ts` | Has DB code + memoryStore fallback | Remove fallback, convert to static imports |
| `tenants.ts` | Has DB code + memoryStore fallback | Remove fallback, convert to static imports |
| `bankAccounts.ts` | Has DB code + memoryStore fallback | Remove fallback, convert to static imports |

### Middleware to FIX

| File | Current State | Action |
|------|---------------|--------|
| `authMiddleware.ts` | Uses `let db: any` + dynamic require | Convert to static imports |

### Files that already use static imports correctly (NO CHANGES)

| File | Notes |
|------|-------|
| `auth.ts` | Already uses `import { getDb, users, passwordResetTokens } from "@rentular/db"` |
| `routeAuth.ts` | No DB imports needed |

## Schema Changes Required

### New Table: `maintenanceTasks`
- Columns: id, ownerId, propertyId, leaseId, type, name, intervalMonths, lastCompleted, nextDue, autoEmail, notes, createdAt, updatedAt
- Indexes: ownerId, propertyId, nextDue
- Export from `packages/db/src/schema/index.ts`

### New Column: `properties.heatingType`
- Add `heatingType` to `packages/db/src/schema/properties.ts`
- Type: `mysqlEnum("heating_type", ["gas", "oil", "electric", "heat_pump", "wood", "pellet", "none"])`
- Default: null (nullable)
- Update the `db.insert(properties).values(...)` call in `properties.ts` to include `heatingType`

### New Indexes (added via schema callback)

| Table | Index Name | Columns | Query Pattern |
|-------|-----------|---------|---------------|
| `payments` | `payments_lease_status_idx` | (lease_id, status) | Payments by lease + status |
| `payments` | `payments_lease_id_idx` | (lease_id) | All payments for a lease |
| `properties` | `properties_owner_idx` | (owner_id) | Properties by owner |
| `tenants` | `tenants_owner_idx` | (owner_id) | Tenants by owner |
| `leases` | `leases_owner_property_idx` | (owner_id, property_id) | Leases by owner + property |
| `leases` | `leases_owner_idx` | (owner_id) | Leases by owner |
| `costs` | `costs_owner_idx` | (owner_id) | Costs by owner |
| `costs` | `costs_property_idx` | (owner_id, property_id) | Costs by owner + property |
| `communications` | `communications_owner_idx` | (owner_id) | Communications by owner |
| `communications` | `communications_lease_idx` | (lease_id) | Communications by lease |

### Migration Approach
- Use `pnpm --filter @rentular/db db:generate` to generate migration files
- Use `pnpm --filter @rentular/db db:push` to push schema changes to development DB
- Migration files go to `packages/db/drizzle/` (directory does not exist yet -- first migration)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dynamic `require()` with `any` | Static `import` with types | Drizzle ORM has always supported this | Full type safety, IDE autocomplete |
| In-memory fallback for DB errors | Fail-fast with 500 | Standard practice | Data integrity, honest error reporting |
| No CSRF protection | Origin-based CSRF via `hono/csrf` | Hono 3.12.0+ (built-in) | Prevents cross-site state mutations |
| No database indexes | Schema-defined indexes | Drizzle ORM supports since early versions | Sub-100ms list queries at scale |

**Deprecated/outdated:**
- Hono CSRF before 4.6.5 had a Content-Type bypass (CVE-2024-48913). Current installed version 4.12.7 is patched.
- The old Drizzle index callback format using objects `(t) => ({...})` still works but newer docs show array format `(t) => [...]`. Both are valid in 0.36.0.

## Open Questions

1. **CORS multi-origin support**
   - What we know: CORS is currently set to a single origin via `process.env.WEB_URL`. Decision D-03 requires multiple origins.
   - What's unclear: Whether to update CORS to also use `ALLOWED_ORIGINS` or keep CORS and CSRF origins separate.
   - Recommendation: Update CORS `origin` option to use the same `ALLOWED_ORIGINS` list for consistency.

2. **Leases tenant relationship when wiring to DB**
   - What we know: `leases.ts` stores `tenantIds` as an array in the in-memory store. The DB schema uses a `leaseTenants` junction table (many-to-many).
   - What's unclear: How the frontend sends/expects tenant associations.
   - Recommendation: On lease creation, accept `tenantIds` array and insert into `leaseTenants` junction table. On lease GET, join `leaseTenants` to return tenant IDs.

3. **Existing data in memoryStore**
   - What we know: Any data currently in memoryStore will be lost when it's removed.
   - What's unclear: Whether there's production data in memoryStore.
   - Recommendation: This is a dev-only platform (not yet launched). No data migration needed -- just remove the store.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test framework is configured |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | CSRF blocks cross-origin POST | manual-only | Manual: `curl -X POST -H "Origin: https://evil.com"` against API | N/A |
| SEC-02 | No `any` casts on DB imports | manual-only | `grep -rn "any" apps/api/src/routes/ --include="*.ts"` should find zero DB-related `any` | N/A |
| INF-01 | No TODO stubs remain (or are phase-marked) | manual-only | `grep -rn "TODO" apps/api/src/ --include="*.ts"` -- all should have phase markers | N/A |
| INF-02 | Costs endpoints return data | manual-only | `curl /api/v1/costs` returns JSON with data array | N/A |
| INF-03 | Rent adjustment endpoints return data | manual-only | `curl /api/v1/rent-adjustments/free-periods` returns JSON | N/A |
| INF-04 | Communications endpoints return data | manual-only | `curl /api/v1/communications` returns JSON with data array | N/A |
| INF-05 | Indexes exist on key columns | manual-only | `EXPLAIN SELECT * FROM payments WHERE lease_id = ? AND status = ?` shows index usage | N/A |
| LSE-01 | Lease types supported | manual-only | Verified via schema inspection -- enum already includes all types | N/A |
| LSE-02 | Maintenance tasks persist in DB | manual-only | `POST /api/v1/maintenance` -> `GET /api/v1/maintenance` returns persisted task | N/A |

### Sampling Rate
- **Per task commit:** Manual smoke test of affected endpoints
- **Per wave merge:** Full endpoint smoke test (all routes return non-500)
- **Phase gate:** `grep` for remaining `any` casts and unresolved TODOs; `EXPLAIN` on indexed queries

### Wave 0 Gaps
- No test framework is configured. Testing is manual for this phase.
- Recommendation: Do NOT add a test framework in Phase 1. The scope is already large (infrastructure hardening). Test framework can be introduced in a later phase if desired.

## Sources

### Primary (HIGH confidence)
- [Hono CSRF middleware docs](https://hono.dev/docs/middleware/builtin/csrf) - Built-in CSRF middleware API, usage, options
- [Hono CSRF bypass CVE-2024-48913](https://github.com/honojs/hono/security/advisories/GHSA-2234-fmw7-43wr) - Security advisory, fixed in 4.6.5
- [Drizzle ORM indexes docs](https://orm.drizzle.team/docs/indexes-constraints) - Index definition syntax for mysqlTable
- Codebase direct inspection - All route files, schema files, middleware, memoryStore

### Secondary (MEDIUM confidence)
- [Drizzle ORM MySQL getting started](https://orm.drizzle.team/docs/get-started/mysql-new) - Schema definition patterns
- npm registry (`npm view hono version` = 4.12.8, `npm view drizzle-orm version` = 0.45.1) - Current versions confirmed

### Tertiary (LOW confidence)
- None -- all findings verified against code or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and verified in lockfile
- Architecture: HIGH - patterns derived from existing `auth.ts` reference implementation in codebase
- Pitfalls: HIGH - identified by direct code inspection of all affected files
- Schema changes: HIGH - verified against existing schema files and route code

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, no fast-moving dependencies)
