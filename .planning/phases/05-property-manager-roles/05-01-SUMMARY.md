---
phase: 05-property-manager-roles
plan: 01
subsystem: api
tags: [drizzle, schema, rbac, middleware, property-access]

# Dependency graph
requires: []
provides:
  - "Extended propertyManagers schema with invitation fields and nullable userId"
  - "propertyAccess.ts library with role hierarchy, middleware, and access helpers"
  - "Owner auto-registration on property creation"
  - "Migration endpoint for existing properties"

key-files:
  created:
    - packages/db/src/schema/propertyManagers.ts
    - apps/api/src/lib/propertyAccess.ts
    - apps/api/src/types/hono.d.ts
  modified:
    - apps/api/src/routes/properties.ts
    - apps/api/src/routes/propertyManagers.ts
    - apps/api/src/lib/routeAuth.ts
    - packages/shared/src/types/index.ts
---

## What was built

Foundation layer for property manager roles:

1. **Schema extension** — Added invitationToken, invitationExpiresAt, invitationEmail columns to propertyManagers table. Made userId nullable for pre-registration invitations. Added unique indexes on invitationToken and (propertyId, invitationEmail).

2. **propertyAccess.ts library** — Centralized role hierarchy (ROLE_LEVEL), hasMinimumRole comparison, canAccessDomain for accountant blocking, requirePropertyAccess middleware factory, getAccessiblePropertyIds, getAccessiblePropertyIdsForRole, and getUserPropertyRole helpers.

3. **Owner auto-registration** — Property creation (POST /properties) now auto-inserts an owner record in propertyManagers with acceptedAt set.

4. **Migration endpoint** — POST /property-managers/migrate-owners backfills existing properties with owner records.

5. **Hono type extensions** — Added propertyRole and propertyId to ContextVariableMap.

## Self-Check: PASSED

All acceptance criteria met. TypeScript compilation passes (no new errors in plan-specific files).
