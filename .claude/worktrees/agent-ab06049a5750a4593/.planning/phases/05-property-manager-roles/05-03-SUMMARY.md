---
phase: 05-property-manager-roles
plan: 03
subsystem: api
tags: [rbac, drizzle, hono, property-access, permission-matrix]

# Dependency graph
requires:
  - phase: 05-01
    provides: propertyAccess.ts with getAccessiblePropertyIds, getUserPropertyRole, canAccessDomain, hasMinimumRole
provides:
  - All 9 property-scoped route files retrofitted with propertyManagers-based access control
  - Role-based permission enforcement per the permission matrix on all CRUD operations
  - Accountant domain blocking on leases, tenants, indexation, and maintenance
  - Property-scoped visibility for managers assigned to specific properties
affects: [05-04, frontend-dashboard, property-manager-views]

# Tech tracking
tech-stack:
  added: []
  patterns: [propertyManagers-based access pattern replacing ownerId filtering, join chain for tenant visibility via leaseTenants]

key-files:
  modified:
    - apps/api/src/routes/leases.ts
    - apps/api/src/routes/tenants.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/routes/costs.ts
    - apps/api/src/routes/maintenance.ts
    - apps/api/src/routes/communications.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/routes/rentAdjustments.ts
    - apps/api/src/routes/gocardless.ts

key-decisions:
  - "Lease ownerId on creation set to property owner (not current user) so managers can create leases that belong to the property owner"
  - "Communications use OR filter (accessible leases OR ownerId = user) for backwards compatibility with pre-existing communications"
  - "Costs with no propertyId remain accessible only to the ownerId user (general costs not tied to a property)"
  - "Tenant POST does not require property check since tenants are linked via leases"

patterns-established:
  - "getAccessiblePropertyIds + inArray for all list queries replacing ownerId filtering"
  - "getUserPropertyRole + hasMinimumRole for all mutation endpoints"
  - "canAccessDomain for accountant domain blocking on leases, tenants, indexation, maintenance"
  - "Join chain (leases -> leaseTenants -> tenants) for tenant visibility scoping"
  - "Lease property owner lookup for ownerId on creation (property.ownerId, not userId)"

requirements-completed: [PM-03, PM-04]

# Metrics
duration: 10min
completed: 2026-03-24
---

# Phase 05 Plan 03: Route Access Control Retrofit Summary

**All 9 property-scoped API routes retrofitted from ownerId filtering to propertyManagers-based RBAC with role-level enforcement and accountant domain blocking**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-24T12:26:51Z
- **Completed:** 2026-03-24T12:37:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- All property-scoped list endpoints now use getAccessiblePropertyIds + inArray instead of ownerId filtering
- All mutation endpoints (POST/PUT/PATCH/DELETE) check getUserPropertyRole with minimum role enforcement per the permission matrix
- Accountant role is blocked from leases, tenants, indexation, and maintenance domains (D-05)
- Tenants visibility uses join chain through leaseTenants for accurate property scoping
- settings.ts deliberately excluded (owner-only by design, per D-09)

## Task Commits

Each task was committed atomically:

1. **Task 1: Retrofit leases, tenants, payments, costs, and maintenance routes** - `eb6e458` (feat)
2. **Task 2: Retrofit communications, indexation, rentAdjustments, and gocardless routes** - `09e42f7` (feat)

## Files Created/Modified
- `apps/api/src/routes/leases.ts` - Property-scoped lease list, role checks on CRUD, accountant domain block
- `apps/api/src/routes/tenants.ts` - Join chain via leaseTenants for tenant visibility, role checks on mutations
- `apps/api/src/routes/payments.ts` - Accessible property IDs via lease join, accountant+ for record, manager+ for collect
- `apps/api/src/routes/costs.ts` - Property-scoped costs with general cost fallback for owner, accountant+ writes
- `apps/api/src/routes/maintenance.ts` - Property-scoped tasks, accountant domain block, manager+ for mutations
- `apps/api/src/routes/communications.ts` - Accessible lease IDs with owner fallback, manager+ for send/resend
- `apps/api/src/routes/indexation.ts` - calculateLeaseIndexation uses getUserPropertyRole, accountant domain block, manager+ for apply
- `apps/api/src/routes/rentAdjustments.ts` - Lease-based property role checks on all CRUD operations
- `apps/api/src/routes/gocardless.ts` - Manager+ role check on mandate setup/complete via lease property

## Decisions Made
- Lease ownerId on creation set to property's actual owner (not the current user creating the lease) so managers can create leases that correctly belong to the property owner
- Communications use OR filter (accessible leases OR ownerId equals user) for backwards compatibility with pre-existing owner-created communications
- Costs with no propertyId remain accessible only to the ownerId user (general costs not tied to a property)
- Tenant POST does not require property check since tenants are linked to properties via leases, not directly
- GoCardless mandate cancel does not check role because it operates on the mandate itself (infrastructure operation triggered by webhook or admin)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all endpoints are fully wired with property-based access control.

## Next Phase Readiness
- All backend routes now enforce property-manager-based access control
- Frontend can rely on API to return only data the logged-in user has access to
- Ready for Plan 04 (frontend property manager UI if applicable)

## Self-Check: PASSED

All 9 modified route files exist. Both task commits (eb6e458, 09e42f7) verified in git log. SUMMARY.md created.

---
*Phase: 05-property-manager-roles*
*Completed: 2026-03-24*
