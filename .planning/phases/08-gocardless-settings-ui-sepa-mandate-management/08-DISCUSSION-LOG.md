# Phase 8: GoCardless Settings UI & SEPA Mandate Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 08-gocardless-settings-ui-sepa-mandate-management
**Areas discussed:** Settings tab layout, Mandate setup flow, Mandate management view, Payment method on leases

---

## Settings Tab Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Fill 'General' tab | Replace "Coming Soon" placeholder with GoCardless config. Keeps tabs at 4 | ✓ |
| Dedicated 'GoCardless' tab | Add 5th tab specifically for GoCardless | |
| Split across tabs | Distribute GoCardless config across General and Bank Accounts tabs | |

**User's choice:** Fill 'General' tab (Recommended)
**Notes:** None

### What to show in General tab

| Option | Description | Selected |
|--------|-------------|----------|
| Connection status | GoCardless configured indicator, environment (sandbox/live), green/red status | ✓ |
| Default payment method | Dropdown for new lease default: GoCardless, Bank Transfer, Manual | ✓ |
| Creditor info display | Show creditor ID and scheme (SEPA Core) from GoCardless API | ✓ |
| Rename tab to 'GoCardless' | Since GoCardless config is the only content, rename for clarity | ✓ |

**User's choice:** All four selected
**Notes:** Tab renamed from "General" to "GoCardless"

---

## Mandate Setup Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Modal dialog | "Setup Mandate" button opens modal. Collects tenant info, calls GoCardless API, shows status | ✓ |
| Inline in lease form | Mandate setup fields appear inline when selecting GoCardless payment method | |
| Dedicated page | Separate /mandates/setup page with step-by-step wizard | |

**User's choice:** Modal dialog (Recommended)
**Notes:** Reusable modal component triggered from multiple access points

### Tenant Authorization Method

| Option | Description | Selected |
|--------|-------------|----------|
| Email link to tenant | GoCardless sends tenant email with authorization link. Webhook notifies on completion | ✓ |
| Copy link for landlord | Landlord gets authorization URL to share manually | |
| Both options | Email primary + copy link fallback | |

**User's choice:** Email link to tenant (Recommended)
**Notes:** None

### Access Points for Setup Mandate

| Option | Description | Selected |
|--------|-------------|----------|
| Lease detail page | Button when payment method is GoCardless but no mandate active | ✓ |
| Tenant profile page | Button on tenant profile for multi-lease scenarios | ✓ |
| Mandates management page | "New Mandate" button on mandates list page | ✓ |
| Onboarding wizard step 4 | During "Set up payment collection" step | ✓ |

**User's choice:** All four access points selected
**Notes:** Same modal component reused across all locations

---

## Mandate Management View

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated sidebar page | Add "Mandates" to sidebar nav between Payments and Communications | ✓ |
| Sub-section of Payments | Mandates tab within Payments page | |
| No dedicated page | Only show on lease/tenant detail pages | |

**User's choice:** Dedicated sidebar page (Recommended)
**Notes:** None

### Mandates Page Content

| Option | Description | Selected |
|--------|-------------|----------|
| Mandate list with status | Table: tenant name, lease/property ref, status, created date, next charge date | ✓ |
| Status filter & search | Filter by status + search by tenant/property | ✓ |
| Summary stats cards | Top cards: X active, Y pending, Z failed | |
| Action buttons | Per-row: View details, Cancel mandate. Top: New Mandate | ✓ |

**User's choice:** List with status, filter/search, action buttons — no summary stats cards
**Notes:** Table-to-card responsive pattern on mobile

---

## Payment Method on Leases

| Option | Description | Selected |
|--------|-------------|----------|
| Radio group in lease form | Three radios: GoCardless, Bank Transfer, Manual. Contextual sub-options per method | ✓ |
| Dropdown selector | Simple dropdown for payment method | |
| Step in lease creation wizard | Dedicated step for payment setup | |

**User's choice:** Radio group in lease form (Recommended)
**Notes:** GoCardless shows mandate status/setup button, Bank Transfer shows bank account dropdown

### Lease Detail Mandate Info

| Option | Description | Selected |
|--------|-------------|----------|
| Mandate status badge | Color-coded: green (active), yellow (pending), red (failed/cancelled/expired) | ✓ |
| Mandate reference & dates | GoCardless reference ID, created date, next charge date | |
| Quick actions | Setup/Cancel mandate buttons with cascade warning | ✓ |
| Last payment info | Last GoCardless payment status and date | ✓ |

**User's choice:** Status badge, quick actions, last payment info — no mandate reference/dates
**Notes:** None

---

## Claude's Discretion

- Modal layout and field arrangement for mandate setup dialog
- Mandates page column ordering and mobile card layout
- Toast messages for mandate setup/cancel
- Loading states and skeletons
- Error handling UI for GoCardless API failures
- Mandate status display on tenant profile page

## Deferred Ideas

None — discussion stayed within phase scope
