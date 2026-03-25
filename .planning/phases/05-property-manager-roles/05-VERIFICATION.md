---
phase: 05-property-manager-roles
verified: 2026-03-25T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: null
gaps: []
human_verification:
  - test: "Send a real invitation email and verify it arrives with the correct accept URL"
    expected: "Email received with token-based accept URL, inviter name, property name, and role"
    why_human: "Cannot verify SMTP delivery, email formatting, or token URL correctness without live environment"
  - test: "Log in as an accountant manager and verify blocked nav items are hidden"
    expected: "Tenants, Leases, Indexation, and Maintenance are absent from sidebar; Settings not visible"
    why_human: "Sidebar filtering is server-rendered based on API response; requires a live session with accountant role"
  - test: "Accept invitation via token link from a browser where user is not yet logged in"
    expected: "Redirected to login with returnUrl, then after login the accept page shows invitation details"
    why_human: "Next.js redirect flow with session check requires live browser interaction"
---

# Phase 5: Property Manager Roles Verification Report

**Phase Goal:** Property owners can delegate management of their properties to other users with appropriate role-based permissions
**Verified:** 2026-03-25
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (From ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner can invite a property manager by email with a role; invitee receives email with accept/decline options | VERIFIED | POST /invite in propertyManagers.ts generates UUID token, calls queueEmail with accept URL, inserts row with invitationToken and 90-day expiry |
| 2 | Accepted property manager sees only their assigned properties in the dashboard | VERIFIED | GET /properties uses getAccessiblePropertyIds scoped by propertyManagers table; all 9 downstream routes retrofitted with same pattern |
| 3 | Property manager permissions are enforced on all API endpoints | VERIFIED | All 11 route files (properties, propertyManagers, leases, tenants, payments, costs, maintenance, communications, indexation, rentAdjustments, gocardless) import from propertyAccess.ts; no remaining eq(table.ownerId, ownerId) auth checks in list handlers |
| 4 | Owner can revoke access or change a manager's role at any time, with immediate effect | VERIFIED | PATCH /:id updates role and sends D-11 notification email; DELETE /:id removes record and sends revocation email; both check co_owner+ role; owner role is protected from modification |

**Score:** 4/4 truths verified

---

## Required Artifacts

### Plan 01: Schema Foundation and Access Middleware

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/propertyManagers.ts` | Extended schema with invitation fields and nullable userId | VERIFIED | Contains invitationToken, invitationExpiresAt, invitationEmail; userId has no .notNull(); three unique indexes present |
| `apps/api/src/lib/propertyAccess.ts` | Role hierarchy, requirePropertyAccess, getAccessiblePropertyIds, getUserPropertyRole | VERIFIED | Exports ROLE_LEVEL, hasMinimumRole, canAccessDomain, requirePropertyAccess, getAccessiblePropertyIds, getAccessiblePropertyIdsForRole, getUserPropertyRole |
| `apps/api/src/lib/routeAuth.ts` | Re-exports from propertyAccess for convenience | VERIFIED | Re-exports all 7 functions from propertyAccess.ts |
| `apps/api/src/types/hono.d.ts` | Extended Hono context with propertyRole and propertyId | VERIFIED | Contains `propertyRole: string | null` and `propertyId: string | null` |
| `apps/api/src/routes/properties.ts` | Owner auto-register on property creation | VERIFIED | POST / inserts into propertyManagers with role "owner" and acceptedAt after property insert |

### Plan 02: Invitation Flow API

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/routes/propertyManagers.ts` | Full CRUD: invite, accept, decline, list, update, remove, invitation details | VERIFIED | All 8 endpoints implemented with real DB logic; queueEmail used for invitation/role-change/revocation notifications; D-01 auto-accept, D-03 90-day expiry, D-12 overwrite enforced |
| `apps/api/src/routes/properties.ts` | Properties list includes userRole per property | VERIFIED | GET / attaches userRole via roleMap from propertyManagers; GET /:id returns getUserPropertyRole result |

### Plan 03: Route Retrofit (9 files)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/routes/leases.ts` | Scoped via propertyManagers | VERIFIED | getAccessiblePropertyIds + canAccessDomain accountant block; getUserPropertyRole for mutations |
| `apps/api/src/routes/tenants.ts` | Scoped via join chain | VERIFIED | getAccessiblePropertyIds + join chain via leaseTenants |
| `apps/api/src/routes/payments.ts` | Scoped via accessible properties | VERIFIED | getAccessiblePropertyIds; no remaining leases.ownerId auth filter |
| `apps/api/src/routes/costs.ts` | Scoped via accessible properties | VERIFIED | getAccessiblePropertyIds present |
| `apps/api/src/routes/maintenance.ts` | Scoped via accessible properties with accountant block | VERIFIED | getAccessiblePropertyIds + canAccessDomain |
| `apps/api/src/routes/communications.ts` | Scoped via accessible properties | VERIFIED | getAccessiblePropertyIds present |
| `apps/api/src/routes/indexation.ts` | Scoped with accountant block | VERIFIED | getAccessiblePropertyIds + getUserPropertyRole; accountant domain block |
| `apps/api/src/routes/rentAdjustments.ts` | Scoped via lease property | VERIFIED | getAccessiblePropertyIds + getUserPropertyRole present |
| `apps/api/src/routes/gocardless.ts` | Role-checked via lease property | VERIFIED | getUserPropertyRole present on mandate setup/complete |
| `apps/api/src/routes/settings.ts` | Deliberately excluded | VERIFIED | No getAccessiblePropertyIds import — owner-only by design |

### Plan 04: Frontend

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/components/RoleBadge.tsx` | Colored pill badge for roles | VERIFIED | Five role-specific colors; uses next-intl for labels |
| `apps/web/app/(dashboard)/properties/[id]/managers/page.tsx` | Managers list with invite modal | VERIFIED | Fetches from /api/v1/property-managers; invite modal with email + role; PATCH/DELETE for role change and revoke |
| `apps/web/app/(auth)/invite/accept/page.tsx` | Token-based accept/decline page (server) | VERIFIED | Reads token from searchParams; redirects unauthenticated users to login with returnUrl |
| `apps/web/app/(auth)/invite/accept/InvitationAcceptClient.tsx` | Accept/decline client component | VERIFIED | Fetches invitation details via GET /invitation; POST accept and decline endpoints wired; error states for expired/invalid/already-accepted tokens |
| `apps/web/app/(dashboard)/layout.tsx` | Role-filtered sidebar navigation | VERIFIED | Fetches /api/v1/properties server-side; derives highestRole from userRole fields; NAV_VISIBILITY map hides settings for non-owners, hides tenants/leases/indexation/maintenance for accountants |
| `apps/web/app/(dashboard)/properties/page.tsx` | Role badges on property cards | VERIFIED | Renders RoleBadge with p.userRole; "Property Managers" link shown for owner/co_owner only; edit/delete buttons conditionally shown by role |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/api/src/lib/propertyAccess.ts` | `packages/db/src/schema/propertyManagers.ts` | Drizzle queries against propertyManagers table | VERIFIED | from(propertyManagers) in getAccessiblePropertyIds, getUserPropertyRole, requirePropertyAccess |
| `apps/api/src/routes/properties.ts` | `apps/api/src/lib/propertyAccess.ts` | Import getAccessiblePropertyIds | VERIFIED | Import confirmed at line 8; used in GET / handler |
| `apps/api/src/routes/propertyManagers.ts` | `apps/api/src/lib/propertyAccess.ts` | Import hasMinimumRole, getUserPropertyRole, getAccessiblePropertyIds | VERIFIED | All three functions imported and used |
| `apps/api/src/routes/propertyManagers.ts` | `apps/api/src/jobs/emailQueueWorker.ts` | queueEmail for invitation/notification emails | VERIFIED | queueEmail called in /invite, PATCH /:id, DELETE /:id |
| `apps/web/app/(dashboard)/properties/[id]/managers/page.tsx` | `/api/v1/property-managers` | fetch calls to API endpoints | VERIFIED | GET ?propertyId=, POST /invite, PATCH /:id, DELETE /:id all wired |
| `apps/web/app/(auth)/invite/accept/InvitationAcceptClient.tsx` | `/api/v1/property-managers/accept` | fetch POST with token | VERIFIED | POST to /property-managers/accept with { token } in handleAccept |
| `apps/web/app/(dashboard)/layout.tsx` | `/api/v1/properties` | fetch to get properties with userRole for sidebar filtering | VERIFIED | Server-side fetch to /api/v1/properties; reads prop.userRole for highestRole calculation |
| `apps/api/src/index.ts` | `apps/api/src/routes/propertyManagers.ts` | Router mounted at /property-managers | VERIFIED | app.route("/property-managers", propertyManagersRouter) at line 135 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PM-01 | 05-02, 05-04 | Owner can invite a property manager by email with a specified role | SATISFIED | POST /invite creates token, sends email; frontend invite modal wired |
| PM-02 | 05-02, 05-04 | Invited property manager receives email and can accept/decline | SATISFIED | queueEmail called on invite; GET /invitation + POST /accept + POST /decline endpoints; accept page frontend |
| PM-03 | 05-03 | Property manager sees only their assigned properties | SATISFIED | All 9 route files use getAccessiblePropertyIds scoped by propertyManagers; no ownerId-only auth remaining |
| PM-04 | 05-01, 05-03 | Property manager permissions enforced on all property-scoped API endpoints | SATISFIED | getUserPropertyRole + hasMinimumRole checks on all mutations; canAccessDomain blocks accountant from leases/tenants/indexation/maintenance |
| PM-05 | 05-02, 05-04 | Owner can revoke a property manager's access | SATISFIED | DELETE /:id with co_owner+ check; owner record protected; revocation email sent; frontend Revoke button |
| PM-06 | 05-02, 05-04 | Owner can change a property manager's role | SATISFIED | PATCH /:id with co_owner+ check; owner role protected; notification email sent; frontend role dropdown |

All 6 requirements fully satisfied with implementation evidence. No orphaned requirements.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api/src/lib/propertyAccess.ts` | 47-58 | Custom `db()` wrapper with `as any` cast to work around Drizzle union type | Info | Type safety workaround; does not affect runtime behavior; db queries execute correctly |
| `apps/web/app/(dashboard)/properties/[id]/managers/page.tsx` | 274 | Status badge "Active" is a hardcoded English string (not translated) | Warning | Only affects the active badge label; pending is translated; minor i18n gap |
| `apps/web/app/(auth)/invite/accept/InvitationAcceptClient.tsx` | 122-124 | "Go to dashboard" and "Retry" strings are hardcoded English | Warning | Error/success state link text not translated; minor i18n gap |

No blockers found. The anti-patterns are informational/cosmetic and do not prevent goal achievement.

---

## Human Verification Required

### 1. Invitation Email Delivery

**Test:** Create a test property, invite a new email address as "manager", check the inbox.
**Expected:** Email arrives with subject "[inviter name] invited you to manage a property on Rentular", body text with accept link containing a UUID token, 90-day expiry notice.
**Why human:** SMTP delivery and email formatting cannot be verified by code inspection alone.

### 2. Accountant Role Sidebar Filtering

**Test:** Log in as a user with accountant role on exactly one property (no other properties where they have higher roles). Observe the sidebar.
**Expected:** Sidebar shows only: Properties, Payments, Communications. Missing: Tenants, Leases, Indexation, Maintenance, Settings.
**Why human:** Sidebar logic is server-rendered with live API data; requires an actual session with accountant role configured in the database.

### 3. Invitation Accept Flow for Unauthenticated User

**Test:** Open the invitation accept link in a fresh browser session (not logged in).
**Expected:** Redirected to `/login?returnUrl=/invite/accept?token=...`; after login, the accept page loads and shows property name, inviter name, and role badge.
**Why human:** Next.js authentication redirect with returnUrl and session creation requires live browser testing.

---

## Gaps Summary

No gaps found. All 4 success criteria are verified with substantive implementation evidence. All 6 requirements (PM-01 through PM-06) are satisfied. The 3 human verification items are behavioral/visual tests that cannot be confirmed by static code inspection but are unlikely to fail based on the wiring evidence.

---

*Verified: 2026-03-25*
*Verifier: Claude (gsd-verifier)*
