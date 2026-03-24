---
phase: 05-property-manager-roles
plan: 02
subsystem: api
tags: [hono, drizzle, invitation-flow, rbac, email-queue, property-managers]

# Dependency graph
requires:
  - phase: 05-01
    provides: "propertyManagers schema with invitation columns, propertyAccess utilities, owner auto-registration"
provides:
  - "Full property manager invitation CRUD: invite by email, accept/decline via token, list, update role, remove"
  - "Invitation details GET endpoint for frontend accept page (read-only, does not consume token)"
  - "Properties list with userRole attached per property (D-07, D-08)"
  - "Role-based access control on properties GET/PATCH/DELETE"
  - "Email notifications for invitations, role changes, and access revocations"
affects: [05-03, 05-04]

# Tech tracking
tech-stack:
  added: []
  patterns: ["invitation token flow with 90-day expiry", "role-based property access replacing ownerId checks", "auto-accept all pending invitations on first token accept (D-01)"]

key-files:
  created: []
  modified:
    - apps/api/src/routes/propertyManagers.ts
    - apps/api/src/routes/properties.ts

key-decisions:
  - "queueEmail uses body field (plain text) for invitation emails rather than html, matching existing EmailOptions interface"
  - "Properties PATCH requires manager+ role, DELETE requires co_owner+ role for graduated access control"
  - "D-01 implemented as auto-accept (sets acceptedAt + clears token) rather than just auto-link (userId only)"
  - "Removed memoryStore fallback from properties.ts in favor of fail-fast typed DB imports"

patterns-established:
  - "Invitation flow: token generated on invite, validated on accept/decline, cleared after use"
  - "Role-based property access: getAccessiblePropertyIds + getUserPropertyRole replace ownerId filtering"

requirements-completed: [PM-01, PM-02, PM-05, PM-06]

# Metrics
duration: 3min
completed: 2026-03-24
---

# Phase 05 Plan 02: Property Manager Invitation Flow and Management API Summary

**Full invitation CRUD (invite/accept/decline/list/update/remove) with token-based flow, email notifications, and role-based property access replacing ownerId filtering**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-24T12:19:57Z
- **Completed:** 2026-03-24T12:23:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented complete property manager invitation flow: invite by email, accept/decline via token, list managers, update role, remove access
- GET /invitation endpoint returns invitation details (property name, role, inviter name) without consuming the token for the frontend accept page
- D-01: Accept endpoint auto-accepts ALL pending invitations for the user's email across all properties
- D-03: Invitations expire after 90 days
- D-11: Email notifications sent on role change and access revocation
- D-12: Re-inviting an existing manager overwrites their role in place
- Properties list now uses role-based access (getAccessiblePropertyIds) and attaches userRole per property (D-07, D-08)
- PATCH/DELETE on properties use role-based access checks instead of ownerId filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement propertyManagers full CRUD** - `74d2ec7` (feat)
2. **Task 2: Retrofit properties list with role-based access** - `79063ab` (feat)

## Files Created/Modified
- `apps/api/src/routes/propertyManagers.ts` - Full invitation flow and management CRUD with email notifications
- `apps/api/src/routes/properties.ts` - Role-based access control with userRole per property

## Decisions Made
- Used plain text body for invitation emails matching existing EmailOptions interface (not HTML)
- Properties PATCH requires manager+ role, DELETE requires co_owner+ role for graduated access control
- D-01 interpreted as full auto-accept (sets userId + acceptedAt + clears token) rather than just auto-linking userId
- Removed memoryStore fallback from properties.ts -- fail fast on DB errors with typed imports

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Drizzle type mismatch in properties PATCH handler**
- **Found during:** Task 2 (Properties retrofit)
- **Issue:** Zod partial schema output type not assignable to Drizzle .set() parameter (heatingType enum mismatch)
- **Fix:** Cast update data as Record<string, unknown> for Drizzle compatibility
- **Files modified:** apps/api/src/routes/properties.ts
- **Verification:** TypeScript compilation passes
- **Committed in:** 79063ab (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type cast needed for existing Zod/Drizzle interop. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Invitation flow API complete, ready for frontend implementation (Plan 03)
- Properties endpoint returns userRole for dashboard role badges
- All endpoints use role-based access control via propertyAccess utilities

---
*Phase: 05-property-manager-roles*
*Completed: 2026-03-24*
