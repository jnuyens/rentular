---
phase: 01-security-infrastructure
plan: 01
subsystem: database
tags: [drizzle-orm, mysql, schema, indexes, maintenance]

# Dependency graph
requires: []
provides:
  - maintenanceTasks table schema with owner/property/nextDue indexes
  - heatingType column on properties table
  - Composite indexes on payments, tenants, leases, costs, communications tables
  - ALLOWED_ORIGINS env variable in .env.example
affects: [01-02, 01-03, 01-04, 01-05, 02-payments-webhooks, 04-maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns: [object-return callback for mysqlTable indexes]

key-files:
  created:
    - packages/db/src/schema/maintenance.ts
  modified:
    - packages/db/src/schema/properties.ts
    - packages/db/src/schema/payments.ts
    - packages/db/src/schema/tenants.ts
    - packages/db/src/schema/leases.ts
    - packages/db/src/schema/costs.ts
    - packages/db/src/schema/communications.ts
    - packages/db/src/schema/index.ts
    - .env.example

key-decisions:
  - "Used object-return callback format for index definitions matching existing propertyManagers.ts convention"
  - "heatingType column left nullable (no .notNull()) since not all properties require heating type"

patterns-established:
  - "Index callback pattern: (table) => ({ indexName: index('table_column_idx').on(table.column) })"

requirements-completed: [INF-05, LSE-01, LSE-02]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 01 Plan 01: Schema Foundation Summary

**maintenanceTasks table, heatingType column, and 13 composite indexes across 6 Drizzle schema files for query performance**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T10:40:19Z
- **Completed:** 2026-03-22T10:43:44Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Created maintenanceTasks table with all D-21 columns (id, ownerId, propertyId, leaseId, type, name, intervalMonths, lastCompleted, nextDue, autoEmail, notes, timestamps) plus 3 indexes
- Added heatingType mysqlEnum column to properties (gas, oil, electric, heat_pump, wood, pellet, none) and properties_owner_idx index
- Added 10 composite indexes across payments (2), tenants (1), leases (2), costs (2), communications (2), and properties (1) tables
- Added ALLOWED_ORIGINS env variable to .env.example for Plan 02 CORS/CSRF setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create maintenanceTasks table schema and add heatingType to properties** - `8211370` (feat)
2. **Task 2: Add composite indexes to payments, tenants, leases, costs, and communications schemas** - `252887f` (feat)

## Files Created/Modified
- `packages/db/src/schema/maintenance.ts` - New maintenanceTasks table with owner/property/nextDue indexes
- `packages/db/src/schema/properties.ts` - Added heatingType column and properties_owner_idx index
- `packages/db/src/schema/payments.ts` - Added payments_lease_status_idx and payments_lease_id_idx indexes
- `packages/db/src/schema/tenants.ts` - Added tenants_owner_idx index
- `packages/db/src/schema/leases.ts` - Added leases_owner_property_idx and leases_owner_idx indexes
- `packages/db/src/schema/costs.ts` - Added costs_owner_idx and costs_owner_property_idx indexes
- `packages/db/src/schema/communications.ts` - Added communications_owner_idx and communications_lease_idx indexes
- `packages/db/src/schema/index.ts` - Added maintenance module re-export
- `.env.example` - Added ALLOWED_ORIGINS variable

## Decisions Made
- Used object-return callback format for index definitions matching existing propertyManagers.ts convention
- heatingType column left nullable since not all properties require heating type specification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema foundation complete with all indexes for query performance
- maintenanceTasks table ready for route wiring in Plan 04 (maintenance routes)
- heatingType column ready for property forms and maintenance auto-generation
- ALLOWED_ORIGINS env variable ready for Plan 02 CORS/CSRF middleware

## Self-Check: PASSED

All 9 files verified present. Both task commits (8211370, 252887f) verified in git log.

---
*Phase: 01-security-infrastructure*
*Completed: 2026-03-22*
