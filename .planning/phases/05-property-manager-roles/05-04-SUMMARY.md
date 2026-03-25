---
phase: 05-property-manager-roles
plan: 04
subsystem: web
tags: [react, next-intl, tailwind, rbac, invitation-ui, i18n]

# Dependency graph
requires:
  - phase: 05-02
    provides: "Property manager API endpoints (invite, accept, decline, list, update, remove)"
  - phase: 05-03
    provides: "Properties API returns userRole per property"
provides:
  - "RoleBadge component for role display"
  - "Property managers list page with invite modal"
  - "Invitation accept/decline page"
  - "Role-filtered sidebar navigation"
  - "i18n translations for all manager UI in EN/NL/FR/DE"

key-files:
  created:
    - apps/web/components/RoleBadge.tsx
    - apps/web/app/(dashboard)/properties/[id]/managers/page.tsx
    - apps/web/app/(auth)/invite/accept/page.tsx
    - apps/web/app/(auth)/invite/accept/InvitationAcceptClient.tsx
  modified:
    - apps/web/app/(dashboard)/layout.tsx
    - apps/web/app/(dashboard)/properties/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
---

## What was built

Frontend for property manager roles:

1. **RoleBadge component** — Colored pill badge with role-specific colors (blue/owner, purple/co_owner, green/manager, amber/accountant, gray/viewer) using i18n labels.

2. **Property managers page** (`/properties/[id]/managers`) — Lists managers with name, email, role badge, status. Invite modal with email input, role dropdown. Edit role and remove manager actions for co_owner+.

3. **Invitation accept page** (`/invite/accept?token=...`) — Shows invitation details (property name, role, inviter) fetched via token. Accept/Decline buttons. Handles expired, already-accepted, and invalid token states.

4. **Role badges on property cards** — Properties page shows userRole badge on each card. "Property Managers" link visible for owner/co_owner.

5. **Sidebar role filtering** — Navigation items filtered by user's most permissive role. Accountant sees only properties, payments, communications. Settings hidden for non-owners.

6. **i18n translations** — All manager-related UI text translated in EN, NL, FR, DE.

## Verification

Human visual verification passed. All UI elements render correctly.

## Self-Check: PASSED
