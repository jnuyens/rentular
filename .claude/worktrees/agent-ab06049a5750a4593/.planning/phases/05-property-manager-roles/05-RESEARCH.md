# Phase 5: Property Manager Roles - Research

**Researched:** 2026-03-24
**Domain:** Role-based access control (RBAC), invitation flow, property-scoped middleware, query refactoring
**Confidence:** HIGH

## Summary

Phase 5 adds multi-user property management to Rentular. Owners can invite other users (by email) to manage specific properties with one of four roles (co_owner, manager, accountant, viewer). The implementation touches three distinct areas: (1) the invitation/acceptance flow with token-based email links, (2) a centralized `requirePropertyAccess` middleware that enforces role-based permissions on every property-scoped API route, and (3) retrofitting all existing routes to query accessible properties via the `propertyManagers` table instead of filtering by `ownerId` alone.

The existing codebase is well-prepared: a `propertyManagers` schema table already exists with the correct role enum and unique constraint, stub routes with Zod validation are mounted, and the `PropertyManagerRole` type is defined in the shared package. The `queueEmail` infrastructure from Phase 4 is ready for invitation and notification emails. The primary complexity lies in the systematic retrofit of 9+ route files that currently filter by `eq(table.ownerId, userId)` to instead check the `propertyManagers` join table, and in building the middleware that extracts `propertyId` from varying request locations (params, query, body, or via related entities like leases).

A new `invitations` table (or extension of the `propertyManagers` table) is needed to store invitation tokens, expiry timestamps, and status for the token-based email flow. The schema already has `invitedBy` and `invitedAt` columns but lacks `token`, `expiresAt`, and `status` columns needed for the invitation workflow.

**Primary recommendation:** Build the middleware and helper functions first, then retrofit routes incrementally. Use a `getAccessiblePropertyIds(userId)` helper for list endpoints and a `requirePropertyAccess(minRole)` middleware for single-property endpoints.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Invitations work for anyone -- invitee does not need an existing Rentular account. If they don't have one, they register first, then the invitation auto-accepts via the token.
- **D-02:** Token-based URL in email. Email contains a unique link like `/invite/accept?token=abc123`. Clicking it accepts the invitation (after login/register). Uses existing `queueEmail` infrastructure.
- **D-03:** Invitations expire after 90 days. After expiry, the owner must re-invite.
- **D-04:** Centralized middleware pattern -- a `requirePropertyAccess(role[])` middleware checks the `propertyManagers` table before the route handler runs. Routes declare what role level they need. `propertyId` must be extractable from every request (param, query, or body).
- **D-05:** Role-based permissions only -- co_owner can do everything (except remove original owner), manager can manage but not billing settings, accountant sees payments/costs only, viewer is read-only. No per-action permission matrix.
- **D-06:** Managers see only assigned properties. A manager assigned to 3 of 10 properties sees only those 3. Tenants, leases, payments, costs, communications are all scoped to accessible properties.
- **D-07:** Same dashboard with role badge -- manager sees the exact same UI as an owner, but with a role indicator (e.g., "Managing as accountant") on each property. Only assigned properties appear.
- **D-08:** Unified view for users who are both owner and manager -- a user who owns 5 properties and manages 3 others sees all 8 in one dashboard. Owned properties show "Owner", managed ones show their role.
- **D-09:** Filtered sidebar by role -- only show nav items the role has access to. For example, a viewer doesn't see Settings, an accountant doesn't see lease management.
- **D-10:** Revocation takes effect immediately on next API call. The middleware checks `propertyManagers` on every request -- no caching of access state.
- **D-11:** Email notification on revoke or role change. Manager receives an email via `queueEmail` when their access is revoked or their role changes.
- **D-12:** New invitation to an existing manager overwrites/upgrades the existing role in place. No need to revoke first, then re-invite.

### Claude's Discretion
- Exact permission matrix mapping (which roles can access which routes) -- derive from the role hierarchy described above
- Middleware implementation details (how propertyId is extracted from different request types)
- Token generation approach (crypto.randomUUID or similar)
- Database schema changes needed for invitation tokens (expiry column, token column, status)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PM-01 | Owner can invite a property manager by email with a specified role (co_owner, manager, accountant, viewer) | Invitation schema design, token generation, queueEmail integration, invite endpoint implementation |
| PM-02 | Invited property manager receives email invitation and can accept/decline | Token-based accept flow, auto-accept after register, invitation email template, accept endpoint |
| PM-03 | Property manager sees only their assigned properties in the dashboard | `getAccessiblePropertyIds()` helper, query refactoring pattern, unified owner+manager view |
| PM-04 | Property manager permissions are enforced on all property-scoped API endpoints | `requirePropertyAccess` middleware, role hierarchy, route retrofit catalog |
| PM-05 | Owner can revoke a property manager's access | Delete endpoint on propertyManagers, immediate effect via middleware, notification email |
| PM-06 | Owner can change a property manager's role | Patch endpoint on propertyManagers, D-12 overwrite behavior, notification email |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.6.0 | Middleware and route framework | Already in use, `createMiddleware` from `hono/factory` is the pattern |
| Drizzle ORM | 0.36.0 | Database queries with joins | Already in use, supports the `inArray` / join patterns needed |
| Zod | 3.24.0 | Request validation | Already in use for all route inputs |
| crypto (Node.js built-in) | N/A | Token generation via `crypto.randomUUID()` | Already used throughout codebase for ID generation |
| BullMQ | 5.25.0 | Email queue for invitations/notifications | Already in use via `queueEmail` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm operators | 0.36.0 | `inArray`, `or`, `eq`, `and`, `isNull` for multi-condition queries | Every retrofitted route query |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom RBAC middleware | CASL / casbin | Overkill for 5 roles with simple hierarchy; custom is clearer for this use case |
| Invitation tokens in DB | JWT-based tokens | DB tokens are simpler, allow revocation, and fit the existing pattern (passwordResetTokens) |
| Per-route permission decorators | Centralized middleware | Centralized middleware chosen per D-04; less code, single enforcement point |

**Installation:**
No new packages needed. Everything required is already in the dependency tree.

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
  lib/
    routeAuth.ts           # Extended: add requirePropertyAccess, getAccessiblePropertyIds
    propertyAccess.ts      # NEW: permission matrix, role hierarchy helpers
  routes/
    propertyManagers.ts    # Implement stub routes (invite, accept, update, remove, list)
    properties.ts          # Retrofit: use accessible properties query
    leases.ts              # Retrofit: join through properties
    tenants.ts             # Retrofit: join through leases->properties
    payments.ts            # Retrofit: join through leases->properties
    costs.ts               # Retrofit: filter by accessible properties
    maintenance.ts         # Retrofit: filter by accessible properties
    communications.ts      # Retrofit: filter by accessible properties
    indexation.ts          # Retrofit: filter by accessible properties
    settings.ts            # Owner-only (no property scoping needed)
    rentAdjustments.ts     # Retrofit: join through leases->properties
packages/db/src/schema/
  propertyManagers.ts      # Extended: add invitation fields (token, expiresAt, status)
apps/web/app/(dashboard)/
  layout.tsx               # Retrofit: role-based sidebar filtering
```

### Pattern 1: Role Hierarchy as Numeric Levels
**What:** Map roles to numeric levels for easy comparison. Higher number = more permissions.
**When to use:** Every middleware check, permission comparison.
**Example:**
```typescript
// apps/api/src/lib/propertyAccess.ts
const ROLE_LEVEL: Record<string, number> = {
  viewer: 1,
  accountant: 2,
  manager: 3,
  co_owner: 4,
  owner: 5,
};

export function hasMinimumRole(
  userRole: string,
  requiredRole: string
): boolean {
  return (ROLE_LEVEL[userRole] ?? 0) >= (ROLE_LEVEL[requiredRole] ?? Infinity);
}
```

### Pattern 2: Centralized Property Access Middleware
**What:** A middleware factory that takes a minimum role and extracts propertyId from the request.
**When to use:** Applied to all property-scoped routes.
**Example:**
```typescript
// apps/api/src/lib/routeAuth.ts
import { createMiddleware } from "hono/factory";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, propertyManagers } from "@rentular/db";

export function requirePropertyAccess(minRole: string) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Authentication required" }, 401);

    // Extract propertyId from multiple sources
    const propertyId =
      c.req.param("propertyId") ||
      c.req.query("propertyId") ||
      (c.req.method !== "GET" ? (await c.req.json().catch(() => ({}))).propertyId : null);

    if (!propertyId) return c.json({ error: "Property ID required" }, 400);

    const db = getDb();
    const access = await db
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, propertyId),
          eq(propertyManagers.userId, userId),
          // Only accepted invitations (acceptedAt is not null) or owner records
        )
      );

    if (!access[0] || !hasMinimumRole(access[0].role, minRole)) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    c.set("propertyRole", access[0].role);
    c.set("propertyId", propertyId);
    await next();
  });
}
```

### Pattern 3: Accessible Properties Helper for List Endpoints
**What:** A reusable function that returns all property IDs a user can access (owned + managed).
**When to use:** All list endpoints (GET /properties, GET /leases, etc.) that need to show data across multiple properties.
**Example:**
```typescript
// apps/api/src/lib/propertyAccess.ts
export async function getAccessiblePropertyIds(userId: string): Promise<string[]> {
  const db = getDb();

  // Get properties where user is in propertyManagers with an accepted invitation
  const managed = await db
    .select({ propertyId: propertyManagers.propertyId })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        // acceptedAt is not null (or role is owner -- owner records are auto-accepted)
      )
    );

  return managed.map((m) => m.propertyId);
}
```

### Pattern 4: Invitation Token Schema Extension
**What:** Extend the existing `propertyManagers` table with invitation fields rather than creating a separate invitations table.
**When to use:** For the invitation flow -- pending invitations have `acceptedAt = null` and carry token/expiry data.
**Example:**
```typescript
// Schema extension needed on propertyManagers table:
invitationToken: varchar("invitation_token", { length: 36 }),
invitationExpiresAt: timestamp("invitation_expires_at"),
invitationEmail: varchar("invitation_email", { length: 255 }),
// Status is implicit: acceptedAt null = pending, acceptedAt set = accepted
// Declined = row deleted
```

### Pattern 5: Route Retrofit Pattern (ownerId -> propertyManagers join)
**What:** Systematic transformation of every `eq(table.ownerId, userId)` query to use accessible property IDs.
**When to use:** Every existing route that currently filters by ownerId.
**Example (before):**
```typescript
// Current pattern in properties.ts:
const result = await db
  .select()
  .from(properties)
  .where(eq(properties.ownerId, ownerId));
```
**Example (after):**
```typescript
// New pattern:
const accessibleIds = await getAccessiblePropertyIds(userId);
if (accessibleIds.length === 0) {
  return c.json({ data: [], meta: { total: 0 } });
}
const result = await db
  .select()
  .from(properties)
  .where(inArray(properties.id, accessibleIds));
```

### Pattern 6: Owner Auto-Registration on Property Creation
**What:** When a property is created, automatically insert a `propertyManagers` record with role "owner" for the creator.
**When to use:** POST /properties endpoint.
**Example:**
```typescript
// After inserting the property:
await db.insert(propertyManagers).values({
  id: crypto.randomUUID(),
  propertyId: id,
  userId: ownerId,
  role: "owner",
  invitedBy: null,
  acceptedAt: new Date(),
});
```

### Anti-Patterns to Avoid
- **Caching property access:** D-10 explicitly requires checking the database on every request. Do not cache the user's accessible properties in a session or in-memory store.
- **Checking ownerId in route handlers:** After retrofit, routes should not reference `ownerId` for authorization. All authorization goes through `propertyManagers`.
- **Separate invitations table:** Keeping invitations in the same table as accepted managers simplifies the accept flow (just update `acceptedAt`) and D-12 (overwrite existing role).
- **Parsing request body in middleware for GET requests:** GET requests never have a body. The middleware must handle propertyId extraction differently per HTTP method.

## Permission Matrix

Derived from D-05 role hierarchy. This is the exact mapping the middleware and frontend sidebar will use.

| Route / Action | owner | co_owner | manager | accountant | viewer |
|----------------|-------|----------|---------|------------|--------|
| **Properties** |
| View properties list | Y | Y | Y | Y | Y |
| View property details | Y | Y | Y | Y | Y |
| Create property | Y (auto) | N | N | N | N |
| Edit property | Y | Y | Y | N | N |
| Delete/archive property | Y | Y | N | N | N |
| **Leases** |
| View leases | Y | Y | Y | N | Y |
| Create lease | Y | Y | Y | N | N |
| Edit lease | Y | Y | Y | N | N |
| Delete lease | Y | Y | N | N | N |
| **Tenants** |
| View tenants | Y | Y | Y | N | Y |
| Create tenant | Y | Y | Y | N | N |
| Edit tenant | Y | Y | Y | N | N |
| Delete tenant | Y | Y | N | N | N |
| **Payments** |
| View payments | Y | Y | Y | Y | Y |
| Record manual payment | Y | Y | Y | Y | N |
| Trigger GoCardless payment | Y | Y | Y | N | N |
| Retry/cancel payment | Y | Y | Y | N | N |
| View payment overview | Y | Y | Y | Y | Y |
| **Costs** |
| View costs | Y | Y | Y | Y | Y |
| Add cost | Y | Y | Y | Y | N |
| Edit cost | Y | Y | Y | Y | N |
| Delete cost | Y | Y | N | N | N |
| **Indexation** |
| View/calculate indexation | Y | Y | Y | N | Y |
| Apply indexation | Y | Y | Y | N | N |
| **Communications** |
| View communications | Y | Y | Y | Y | Y |
| Send communication | Y | Y | Y | N | N |
| Resend failed | Y | Y | Y | N | N |
| **Maintenance** |
| View tasks | Y | Y | Y | N | Y |
| Create/edit tasks | Y | Y | Y | N | N |
| Delete tasks | Y | Y | N | N | N |
| **Settings** |
| View/edit payment follow-up | Y | Y | N | N | N |
| View/edit SMTP settings | Y | Y | N | N | N |
| View/edit landlord report | Y | Y | N | N | N |
| **Property Managers** |
| View managers for property | Y | Y | N | N | N |
| Invite manager | Y | Y | N | N | N |
| Revoke access | Y | Y* | N | N | N |
| Change role | Y | Y* | N | N | N |

*co_owner cannot remove or change the original owner's role.

### Simplified Role-to-Route Mapping

For the middleware, translate the above into minimum required roles per HTTP method:

| Route Pattern | GET min | POST min | PATCH/PUT min | DELETE min |
|---------------|---------|----------|---------------|------------|
| /properties | viewer | owner (creates property) | manager | co_owner |
| /leases | viewer | manager | manager | co_owner |
| /tenants | viewer | manager | manager | co_owner |
| /payments | viewer | accountant (record) / manager (GC) | N/A | N/A |
| /costs | viewer | accountant | accountant | co_owner |
| /indexation | viewer | manager (apply) | N/A | N/A |
| /communications | viewer | manager | N/A | N/A |
| /maintenance | viewer | manager | manager | co_owner |
| /settings/* | co_owner | co_owner | co_owner | co_owner |
| /property-managers | co_owner | co_owner (invite) | co_owner (role change) | co_owner (revoke) |

**Note:** The accountant role is a special case -- it can view everything but can only write to payments and costs. The middleware should handle this by checking the specific route, not just the HTTP method.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID token generation | Custom token format | `crypto.randomUUID()` | Already used everywhere in codebase, cryptographically secure, 36-char format |
| Email sending | Direct SMTP calls | `queueEmail` from `emailQueueWorker.ts` | Handles rate limiting, retries, per-landlord SMTP, communication logging |
| Password hashing for tokens | Hashed tokens | Plain UUID in DB + HTTPS | Invitation tokens are single-use, short-lived (90 days), and tied to a specific record. The security model relies on HTTPS transport and token secrecy, not hashing. |
| Complex permission engine | CASL, casbin, custom DSL | Simple role level comparison function | 5 fixed roles in a strict hierarchy -- a 10-line function is clearer than a library |

**Key insight:** This is a simple, fixed role hierarchy (not a dynamic permission system). The roles are hardcoded in the schema enum. A role level map with numeric comparison is the right abstraction -- anything more is over-engineering.

## Common Pitfalls

### Pitfall 1: Forgetting to Auto-Register Owner in propertyManagers
**What goes wrong:** Existing properties have no row in `propertyManagers`. After retrofit, `getAccessiblePropertyIds` returns empty for owners, and they lose access to their own properties.
**Why it happens:** The `propertyManagers` table exists but was never populated because it was a Phase 5 stub.
**How to avoid:** Include a data migration step that inserts `role: "owner"` records into `propertyManagers` for every existing property, using `properties.ownerId` as the source.
**Warning signs:** After deploying, owners see zero properties in their dashboard.

### Pitfall 2: propertyId Not Always in Request
**What goes wrong:** The middleware cannot find `propertyId` for routes that operate on entities that are indirectly related to a property (e.g., `GET /payments/:id` has a payment ID, not a property ID).
**Why it happens:** Some routes identify resources by their own ID, not by property ID. The property connection is through a join (payment -> lease -> property).
**How to avoid:** For routes where propertyId is not directly available, the middleware (or a pre-handler) must resolve the entity's property relationship first. Two strategies: (A) require propertyId as a query param, or (B) look up the entity and resolve its property in the handler, then check access.
**Warning signs:** 400 errors on routes that worked before because middleware demands `propertyId`.

### Pitfall 3: Breaking the Owner Experience During Retrofit
**What goes wrong:** An owner who has NOT been migrated to `propertyManagers` gets 403 errors on all their routes.
**Why it happens:** The retrofit is deployed before the migration runs, or the migration is partial.
**How to avoid:** The migration script must run BEFORE any route starts using the new middleware. Include a fallback: if the `propertyManagers` table check fails AND the user is the `properties.ownerId`, grant owner access. Remove the fallback after confirming migration completeness.
**Warning signs:** Existing owners reporting access denied.

### Pitfall 4: Invitation Token Collision with Accept Flow
**What goes wrong:** User receives invitation email, clicks the link, but they are not logged in. After registering/logging in, the token context is lost.
**Why it happens:** The redirect after registration does not preserve the invitation token query parameter.
**How to avoid:** Store the invitation token in a session/cookie before redirecting to login/register. After authentication completes, redirect back to the accept URL with the token. Alternatively, use the web app's URL to handle the flow: `/invite/accept?token=X` checks auth, redirects to login with returnUrl, then processes the token after login.
**Warning signs:** New users who register via invitation never get their access because the token was lost during the auth redirect.

### Pitfall 5: Accountant Access Scope Confusion
**What goes wrong:** Accountants can see leases, tenants, and other data they should not have access to (per D-05, accountant sees payments/costs only).
**Why it happens:** The `viewer` minimum role on GET endpoints like `/leases` and `/tenants` is set lower than `accountant`, so accountants pass the role check.
**How to avoid:** The accountant role needs special handling. Even though accountant (level 2) > viewer (level 1), the accountant should NOT see lease management or tenant details. Implement route-specific role allowlists rather than a pure hierarchy for certain routes. The permission matrix above documents the exact access: accountant has NO access to leases/tenants views.
**Warning signs:** Accountants seeing full lease details and tenant personal information.

### Pitfall 6: Settings Not Property-Scoped
**What goes wrong:** Settings (payment follow-up, SMTP, landlord report) are per-owner, not per-property. A manager/co_owner might try to change settings that affect all the owner's properties.
**Why it happens:** Settings are scoped to `ownerId`, not `propertyId`. The current decision (D-05) says managers cannot change billing settings.
**How to avoid:** Settings routes should only be accessible to the actual account owner (the user who owns the properties), not to co_owners or managers. The settings middleware should use the existing `getRequiredUserId(c)` + check that the user is actually the settings owner. Settings are NOT property-scoped.
**Warning signs:** A co_owner changing SMTP settings affects the original owner's email delivery.

## Code Examples

### Example 1: Data Migration for Existing Properties
```typescript
// Migration: insert owner records into propertyManagers for all existing properties
import { getDb, properties, propertyManagers } from "@rentular/db";
import { eq, sql } from "drizzle-orm";

async function migrateExistingOwners() {
  const db = getDb();

  // Find properties that don't have an owner record in propertyManagers
  const allProperties = await db.select().from(properties);

  for (const prop of allProperties) {
    // Check if owner record already exists
    const existing = await db
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, prop.id),
          eq(propertyManagers.userId, prop.ownerId),
          eq(propertyManagers.role, "owner")
        )
      );

    if (existing.length === 0) {
      await db.insert(propertyManagers).values({
        id: crypto.randomUUID(),
        propertyId: prop.id,
        userId: prop.ownerId,
        role: "owner",
        invitedBy: null,
        acceptedAt: new Date(),
        invitedAt: new Date(),
      });
    }
  }
}
```

### Example 2: Invitation Endpoint
```typescript
// POST /property-managers/invite
// Source: Existing propertyManagersRouter stub + decisions D-01, D-02, D-03, D-12
async function handleInvite(c: Context) {
  const userId = getRequiredUserId(c);
  const { propertyId, email, role } = c.req.valid("json");

  // Verify caller has co_owner+ access to the property
  // ... (middleware handles this)

  const db = getDb();

  // Look up the invitee by email
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90); // D-03: 90-day expiry

  // D-12: If manager already exists for this property, update role
  if (existingUser[0]) {
    const existingManager = await db
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, propertyId),
          eq(propertyManagers.userId, existingUser[0].id)
        )
      );

    if (existingManager[0]) {
      // Overwrite existing role
      await db
        .update(propertyManagers)
        .set({ role, invitedBy: userId, invitedAt: new Date() })
        .where(eq(propertyManagers.id, existingManager[0].id));

      // Send notification of role change
      await queueEmail({ to: email, subject: "...", body: "..." });
      return c.json({ message: "Role updated" });
    }
  }

  // Create new invitation record
  const id = crypto.randomUUID();
  await db.insert(propertyManagers).values({
    id,
    propertyId,
    userId: existingUser[0]?.id || id, // Temp ID if user doesn't exist yet
    role,
    invitedBy: userId,
    invitedAt: new Date(),
    acceptedAt: null,
    invitationToken: token,
    invitationExpiresAt: expiresAt,
    invitationEmail: email,
  });

  // Send invitation email via queueEmail (D-02)
  const acceptUrl = `${process.env.WEB_URL}/invite/accept?token=${token}`;
  await queueEmail({
    to: email,
    subject: "You've been invited to manage a property on Rentular",
    body: `Click here to accept: ${acceptUrl}`,
  });

  return c.json({ message: "Invitation sent", id }, 201);
}
```

### Example 3: Retrofitted Properties List Endpoint
```typescript
// GET /properties -- after retrofit
import { inArray } from "drizzle-orm";
import { getAccessiblePropertyIds } from "../lib/propertyAccess";

propertiesRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const accessibleIds = await getAccessiblePropertyIds(userId);

  if (accessibleIds.length === 0) {
    return c.json({ data: [], meta: { total: 0, page: 1, perPage: 100 } });
  }

  const result = await db
    .select()
    .from(properties)
    .where(inArray(properties.id, accessibleIds));

  // D-07, D-08: Attach role info to each property
  const propertyRoles = await db
    .select()
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        inArray(propertyManagers.propertyId, accessibleIds)
      )
    );

  const roleMap = new Map(propertyRoles.map((r) => [r.propertyId, r.role]));

  const data = result.map((prop) => ({
    ...prop,
    userRole: roleMap.get(prop.id) || "viewer",
  }));

  return c.json({ data, meta: { total: data.length, page: 1, perPage: 100 } });
});
```

## Route Retrofit Catalog

Complete inventory of routes that need changes, with the specific pattern transformation required.

### Direct ownerId Filter Routes
These routes directly filter by `eq(table.ownerId, userId)`:

| File | Route | Current Pattern | New Pattern |
|------|-------|----------------|-------------|
| `properties.ts` | GET / | `eq(properties.ownerId, ownerId)` | `inArray(properties.id, accessibleIds)` |
| `properties.ts` | GET /:id | `and(eq(properties.id, id), eq(properties.ownerId, ownerId))` | Check `propertyManagers` for access |
| `properties.ts` | POST / | Sets `ownerId` on insert | Keep + auto-register in `propertyManagers` |
| `properties.ts` | PATCH /:id | Filters by ownerId | Check `propertyManagers` for manager+ access |
| `properties.ts` | DELETE /:id | Filters by ownerId | Check `propertyManagers` for co_owner+ access |
| `leases.ts` | GET / | `eq(leases.ownerId, ownerId)` | Join through properties -> propertyManagers |
| `leases.ts` | GET /:id | `and(eq(leases.id, id), eq(leases.ownerId, ownerId))` | Join through property -> propertyManagers |
| `leases.ts` | POST / | Sets ownerId | Verify access to propertyId, keep ownerId as property owner |
| `leases.ts` | PUT /:id | Filters by ownerId | Check access via property |
| `leases.ts` | DELETE /:id | Filters by ownerId | Check access via property |
| `tenants.ts` | all routes | `eq(tenants.ownerId, ownerId)` | Join through leaseTenants -> leases -> properties |
| `costs.ts` | all routes | `eq(costs.ownerId, ownerId)` | Filter by accessible property IDs |
| `maintenance.ts` | all routes | `eq(maintenanceTasks.ownerId, ownerId)` | Filter by accessible property IDs |
| `communications.ts` | all routes | `eq(communications.ownerId, ownerId)` | Filter by accessible property IDs (via leases) |

### Join-Through-Lease Routes
These routes filter by joining payments/etc to leases and checking `leases.ownerId`:

| File | Route | Current Join | New Join |
|------|-------|-------------|----------|
| `payments.ts` | GET / | `innerJoin(leases) + eq(leases.ownerId)` | `innerJoin(leases) + inArray(leases.propertyId, accessibleIds)` |
| `payments.ts` | GET /overview | `eq(leases.ownerId, ownerId)` | `inArray(leases.propertyId, accessibleIds)` |
| `payments.ts` | GET /:id | `and(eq(payments.id, id), eq(leases.ownerId, ownerId))` | Resolve lease -> property, check access |
| `payments.ts` | POST /record | `eq(leases.ownerId, ownerId)` | Check access to lease's property |
| `payments.ts` | POST /collect | `eq(leases.ownerId, ownerId)` | Check access to lease's property |

### Non-Property-Scoped Routes (NO changes needed)
| File | Reason |
|------|--------|
| `settings.ts` | Per-account (ownerId), not property-scoped. D-05: Only account owner accesses. |
| `auth.ts` | Authentication, not property-scoped |
| `webhooks.ts` | External webhook processing, uses signature verification |
| `stripe.ts` | Subscription billing, not property-scoped |
| `support.ts` | Customer support chat, not property-scoped |
| `bankAccounts.ts` | Per-account, not property-scoped (bank accounts belong to the owner) |
| `gocardless.ts` | Operates on leases, needs property access check -- YES needs retrofit |

### Special Cases
| File | Route | Issue | Solution |
|------|-------|-------|----------|
| `indexation.ts` | calculateLeaseIndexation() | Internal helper checks `leases.ownerId` | Must also accept users with propertyManagers access |
| `rentAdjustments.ts` | all routes | Currently only checks auth, not ownership | Add property access check via leaseId -> propertyId |
| `gocardless.ts` | mandate setup | Checks `leases.ownerId` | Must check propertyManagers access for the lease's property |

## Schema Changes Required

### Option A: Extend propertyManagers table (RECOMMENDED)
Add columns to the existing table:

```sql
ALTER TABLE property_managers
  ADD COLUMN invitation_token VARCHAR(36) NULL,
  ADD COLUMN invitation_expires_at TIMESTAMP NULL,
  ADD COLUMN invitation_email VARCHAR(255) NULL;
-- Index for token lookup
CREATE UNIQUE INDEX idx_invitation_token ON property_managers(invitation_token);
```

**Drizzle schema update:**
```typescript
// packages/db/src/schema/propertyManagers.ts -- additions
invitationToken: varchar("invitation_token", { length: 36 }),
invitationExpiresAt: timestamp("invitation_expires_at"),
invitationEmail: varchar("invitation_email", { length: 255 }),
```

**Why this approach:**
- The `acceptedAt` column already serves as the pending/accepted flag (null = pending)
- D-12 (overwrite existing role) is simpler when there is one record per user-property pair
- The unique constraint on (userId, propertyId) prevents duplicate invitations
- When invitee does not have an account yet (D-01), `userId` will be null initially and `invitationEmail` is used instead

**Schema consideration:** The current schema has `userId` as NOT NULL with a unique index on (propertyId, userId). For invitations to unregistered users, either: (A) make `userId` nullable and use `invitationEmail` as the lookup key, or (B) create a temporary placeholder user. Option A is cleaner.

### Required Schema Adjustments
1. Make `userId` nullable on `propertyManagers` (for pending invitations to non-users)
2. Add `invitationToken` (varchar 36, nullable, unique index)
3. Add `invitationExpiresAt` (timestamp, nullable)
4. Add `invitationEmail` (varchar 255, nullable) -- used to match invitation to user on accept
5. Update unique index: change from (propertyId, userId) to allow pending invitations with null userId but unique (propertyId, invitationEmail)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `eq(table.ownerId, userId)` in every route | `inArray(table.id, accessibleIds)` via propertyManagers join | Phase 5 | All data queries go through access control |
| No multi-user access | Role-based property sharing | Phase 5 | Core feature enabling delegation |
| Direct ownerId column as authorization | Centralized middleware + propertyManagers table | Phase 5 | Single enforcement point |

## Open Questions

1. **Tenant ownership model after retrofit**
   - What we know: Tenants currently have an `ownerId` column. After retrofit, a tenant may be associated with a lease on a property managed by someone other than the tenant's `ownerId`.
   - What's unclear: Should tenants be scoped through leases only (tenant belongs to properties via lease junction), or should `tenants.ownerId` be kept as the "creator" while visibility comes from lease associations?
   - Recommendation: Keep `tenants.ownerId` as the creator/owner, but derive visibility from lease associations. A manager who has access to a property should see tenants on that property's leases.

2. **propertyManagers userId for unregistered invitees**
   - What we know: D-01 says invitees don't need an existing account. The current schema has `userId` as NOT NULL.
   - What's unclear: Whether to make `userId` nullable or use a separate invitations table.
   - Recommendation: Make `userId` nullable and use `invitationEmail` for matching. On accept, update `userId` with the actual user ID. This avoids a separate table and keeps D-12 (overwrite) simple.

3. **Background job workers and ownerId**
   - What we know: `paymentCheckWorker`, `landlordReportWorker` iterate over owners to process payments and send reports.
   - What's unclear: Should these workers also operate on behalf of property managers?
   - Recommendation: No changes needed. Background workers operate on properties owned by an owner. Managers don't independently trigger background jobs -- they work within the owner's context. Reports go to the owner, not to managers.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test infrastructure in the project |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PM-01 | Owner invites manager by email | manual-only | Manual: create invitation via API, verify email received | N/A |
| PM-02 | Manager receives and accepts invitation | manual-only | Manual: click invitation link, verify access granted | N/A |
| PM-03 | Manager sees only assigned properties | manual-only | Manual: log in as manager, verify property list | N/A |
| PM-04 | Permissions enforced on all endpoints | manual-only | Manual: try unauthorized actions as each role | N/A |
| PM-05 | Owner revokes access | manual-only | Manual: revoke via API, verify access removed | N/A |
| PM-06 | Owner changes role | manual-only | Manual: change role via API, verify permissions update | N/A |

**Justification for manual-only:** No test framework is configured in this project. The project has no test files, no test runner config, and no test scripts in package.json. Setting up a test framework is out of scope for this phase (it would be a separate infrastructure task).

### Sampling Rate
- **Per task commit:** Manual verification via API calls (curl/Postman)
- **Per wave merge:** Manual end-to-end flow test
- **Phase gate:** Full manual UAT checklist before /gsd:verify-work

### Wave 0 Gaps
- No test infrastructure exists
- Framework setup out of scope for Phase 5 (per established project pattern -- Phases 1-4 completed without tests)

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/db/src/schema/propertyManagers.ts` -- existing table with role enum
- Codebase inspection: `apps/api/src/routes/propertyManagers.ts` -- existing stubs with Zod validation
- Codebase inspection: `apps/api/src/lib/routeAuth.ts` -- existing `requireAuth` and `getRequiredUserId`
- Codebase inspection: `apps/api/src/lib/authMiddleware.ts` -- JWT middleware pattern
- Codebase inspection: All 9 route files listed in CONTEXT.md canonical refs
- Codebase inspection: `packages/shared/src/types/index.ts` -- `PropertyManagerRole` type
- Codebase inspection: `apps/web/app/(dashboard)/layout.tsx` -- sidebar navigation structure

### Secondary (MEDIUM confidence)
- Hono documentation: `createMiddleware` from `hono/factory` for custom middleware
- Drizzle ORM: `inArray`, `or`, join patterns for multi-condition queries

### Tertiary (LOW confidence)
- None -- all findings are based on direct codebase inspection and established patterns from Phases 1-4

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in codebase
- Architecture: HIGH -- middleware pattern is standard Hono, retrofit pattern is mechanical
- Permission matrix: MEDIUM -- derived from D-05 descriptions, may need refinement during implementation
- Schema changes: MEDIUM -- userId nullable change needs careful migration, unique index redesign
- Pitfalls: HIGH -- identified from actual codebase patterns and data model

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable -- no external dependencies or evolving APIs)
