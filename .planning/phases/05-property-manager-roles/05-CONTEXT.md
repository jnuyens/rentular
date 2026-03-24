# Phase 5: Property Manager Roles - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Property owners can delegate management of their properties to other users with role-based permissions. Includes: invitation flow, role-based access control on all property-scoped API endpoints, scoped dashboard views, and access management (revoke, role change).

</domain>

<decisions>
## Implementation Decisions

### Invitation Flow
- **D-01:** Invitations work for anyone — invitee does not need an existing Rentular account. If they don't have one, they register first, then the invitation auto-accepts via the token.
- **D-02:** Token-based URL in email. Email contains a unique link like `/invite/accept?token=abc123`. Clicking it accepts the invitation (after login/register). Uses existing `queueEmail` infrastructure.
- **D-03:** Invitations expire after 90 days. After expiry, the owner must re-invite.

### Permission Enforcement
- **D-04:** Centralized middleware pattern — a `requirePropertyAccess(role[])` middleware checks the `propertyManagers` table before the route handler runs. Routes declare what role level they need. `propertyId` must be extractable from every request (param, query, or body).
- **D-05:** Role-based permissions only — co_owner can do everything (except remove original owner), manager can manage but not billing settings, accountant sees payments/costs only, viewer is read-only. No per-action permission matrix.
- **D-06:** Managers see only assigned properties. A manager assigned to 3 of 10 properties sees only those 3. Tenants, leases, payments, costs, communications are all scoped to accessible properties.

### Dashboard Experience
- **D-07:** Same dashboard with role badge — manager sees the exact same UI as an owner, but with a role indicator (e.g., "Managing as accountant") on each property. Only assigned properties appear.
- **D-08:** Unified view for users who are both owner and manager — a user who owns 5 properties and manages 3 others sees all 8 in one dashboard. Owned properties show "Owner", managed ones show their role.
- **D-09:** Filtered sidebar by role — only show nav items the role has access to. For example, a viewer doesn't see Settings, an accountant doesn't see lease management.

### Revocation and Role Changes
- **D-10:** Revocation takes effect immediately on next API call. The middleware checks `propertyManagers` on every request — no caching of access state.
- **D-11:** Email notification on revoke or role change. Manager receives an email via `queueEmail` when their access is revoked or their role changes.
- **D-12:** New invitation to an existing manager overwrites/upgrades the existing role in place. No need to revoke first, then re-invite.

### Claude's Discretion
- Exact permission matrix mapping (which roles can access which routes) — derive from the role hierarchy described above
- Middleware implementation details (how propertyId is extracted from different request types)
- Token generation approach (crypto.randomUUID or similar)
- Database schema changes needed for invitation tokens (expiry column, token column, status)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Schema and Routes
- `packages/db/src/schema/propertyManagers.ts` — Existing table definition with roles (owner, co_owner, manager, accountant, viewer), unique constraint on userId+propertyId
- `apps/api/src/routes/propertyManagers.ts` — Stub endpoints: list, my-properties, invite, accept, update role, remove (all return placeholder data)
- `packages/shared/src/types/index.ts` — `PropertyManagerRole` type definition and `PropertyManager` interface

### Auth and Middleware
- `apps/api/src/lib/routeAuth.ts` — Current `requireAuth` middleware and `getRequiredUserId` helper (must be extended for property-scoped access)
- `apps/api/src/middleware/authMiddleware.ts` — JWT validation middleware that sets `userId` on Hono context

### Routes Requiring Retrofit
- `apps/api/src/routes/properties.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/leases.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/tenants.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/payments.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/costs.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/maintenance.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/communications.ts` — Currently filters by `ownerId`
- `apps/api/src/routes/settings.ts` — Owner-only (not property-scoped)
- `apps/api/src/routes/indexation.ts` — Currently filters by `ownerId`

### Email Infrastructure
- `apps/api/src/jobs/emailQueueWorker.ts` — `queueEmail` with `CommunicationMeta` for invitation and notification emails

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `propertyManagers` table schema — fully defined with roles, foreign keys, unique constraint, timestamps
- `PropertyManagerRole` type and `PropertyManager` interface in shared package
- `propertyManagersRouter` — stub routes with correct Zod validation already in place
- `queueEmail` with `CommunicationMeta` — ready for invitation and notification emails
- `requireAuth` middleware — can be extended or composed with property-access middleware

### Established Patterns
- All routes use `getRequiredUserId(c)` to get the current user, then filter by `eq(table.ownerId, userId)` — this is the pattern that needs retrofitting
- Hono middleware pattern via `createMiddleware` from `hono/factory`
- Zod validation on route inputs via `@hono/zod-validator`
- Database operations via `getDb()` + Drizzle ORM queries

### Integration Points
- `apps/api/src/index.ts` — `propertyManagersRouter` already mounted
- Dashboard sidebar in `apps/web/app/(dashboard)/layout.tsx` — nav items need role-based filtering
- All property-scoped routes — need middleware added and query filter changes

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches based on the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-property-manager-roles*
*Context gathered: 2026-03-24*
