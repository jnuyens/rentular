---
phase: "08"
plan: "02"
status: complete
started: 2026-04-04T00:00:00.000Z
completed: 2026-04-04T00:00:00.000Z
---

# Plan 08-02 Summary

## What was built
Mandates management page and sidebar navigation update for SEPA mandate management.

## Tasks completed
1. Added "Mandates" to sidebar navigation between Payments and Indexation with FileSignature icon
2. Created dedicated Mandates page at /dashboard/mandates with desktop table, mobile cards, status filter, search, empty state, and mandate actions

## Key files
### Created
- apps/web/app/(dashboard)/mandates/page.tsx

### Modified
- apps/web/app/(dashboard)/layout.tsx (added mandates nav item)
- apps/web/components/DashboardSidebar.tsx (added FileSignature icon)
- apps/web/components/MobileNav.tsx (added FileSignature icon)
- apps/web/messages/{en,nl,fr,de}/common.json (added nav.mandates key)

## Decisions
- Mandates visible to all roles (not added to NAV_VISIBILITY restriction map)
- Search debounced at 300ms to avoid excessive API calls

## Issues
None

## Self-Check: PASSED
