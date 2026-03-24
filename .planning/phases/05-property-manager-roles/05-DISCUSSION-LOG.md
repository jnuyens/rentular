# Phase 5: Property Manager Roles - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-24
**Phase:** 05-property-manager-roles
**Areas discussed:** Invitation flow, Permission enforcement, Dashboard scoping, Revocation behavior

---

## Invitation Flow

### Q1: Does the invitee need an existing Rentular account?

| Option | Description | Selected |
|--------|-------------|----------|
| No — invite works for anyone | Register first if no account, then auto-accept | ✓ |
| Yes — account required first | Owner can only invite existing users | |
| You decide | Claude's discretion | |

**User's choice:** No — invite works for anyone
**Notes:** Lower friction, standard SaaS pattern

### Q2: How does the invitation link work?

| Option | Description | Selected |
|--------|-------------|----------|
| Token in URL | Email contains unique link `/invite/accept?token=abc123` | ✓ |
| Dashboard notification | Invitee sees pending invitation after login | |

**User's choice:** Token in URL

### Q3: Invitation expiry?

| Option | Description | Selected |
|--------|-------------|----------|
| 7 days | Standard SaaS | |
| 30 days | Relaxed, fits landlord pace | |
| 90 days | Extended validity | ✓ |
| No expiry | Until revoked | |
| You decide | Claude's discretion | |

**User's choice:** 90 days

---

## Permission Enforcement

### Q1: Enforcement pattern?

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized middleware | `requirePropertyAccess(role[])` checks before handler | ✓ |
| Helper function per route | `getAccessiblePropertyIds(userId)` returns accessible IDs | |
| You decide | Claude's discretion | |

**User's choice:** Centralized middleware

### Q2: Permission granularity?

| Option | Description | Selected |
|--------|-------------|----------|
| Role-based only | Permissions derived from role hierarchy | ✓ |
| Per-action permissions | Explicit permission matrix per action | |

**User's choice:** Role-based only

### Q3: Owner data isolation?

| Option | Description | Selected |
|--------|-------------|----------|
| Managers see only assigned properties | Strict scoping to assigned properties | ✓ |
| Managers see all owner properties | Simpler but less granular | |

**User's choice:** Managers see only assigned properties

---

## Dashboard Scoping

### Q1: Dashboard experience for managers?

| Option | Description | Selected |
|--------|-------------|----------|
| Same dashboard, filtered | Same UI, only assigned properties appear | |
| Same dashboard with role badge | Same UI with role indicator per property | ✓ |
| Separate manager view | Different layout for managers | |

**User's choice:** Same dashboard with role badge

### Q2: Can a user be both owner and manager?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — unified view | All properties in one dashboard, role labels | ✓ |
| Yes — separate sections | "My Properties" and "Managed Properties" sections | |
| No | One role per user globally | |

**User's choice:** Yes — unified view

### Q3: Sidebar visibility?

| Option | Description | Selected |
|--------|-------------|----------|
| Full sidebar, restricted actions | All nav visible, restricted content shows "no access" | |
| Filtered sidebar | Only show nav items the role can access | ✓ |

**User's choice:** Filtered sidebar

---

## Revocation Behavior

### Q1: When does revocation take effect?

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately — next API call | Middleware checks on every request | ✓ |
| At next login | Less secure, avoids mid-session disruption | |

**User's choice:** Immediately

### Q2: Notification on access changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Email on revoke/role change | Uses existing queueEmail infrastructure | ✓ |
| No notification | Simpler, manager discovers on next access attempt | |
| You decide | Claude's discretion | |

**User's choice:** Email on revoke/role change

### Q3: Duplicate invitation handling?

| Option | Description | Selected |
|--------|-------------|----------|
| Block duplicate | Return error, must revoke first | |
| Upgrade/change in place | New invitation overwrites existing role | ✓ |
| You decide | Claude's discretion | |

**User's choice:** Upgrade/change in place

---

## Claude's Discretion

- Exact permission matrix mapping (roles → routes)
- Middleware implementation details (propertyId extraction)
- Token generation approach
- Schema changes for invitation tokens

## Deferred Ideas

None — discussion stayed within phase scope.
