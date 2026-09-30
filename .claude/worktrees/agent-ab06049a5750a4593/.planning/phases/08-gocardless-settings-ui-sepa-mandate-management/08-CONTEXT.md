# Phase 8: GoCardless Settings UI & SEPA Mandate Management - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Give landlords a UI to configure GoCardless, set up SEPA mandates for tenants, select payment methods on leases, and monitor mandate status across their portfolio. The backend (API routes, webhook handling, mandate lifecycle, payment state machine) is already built in Phase 2 — this phase is purely frontend with minor API additions for mandate listing/filtering.

</domain>

<decisions>
## Implementation Decisions

### Settings tab — GoCardless configuration
- **D-01:** Rename the existing "General" tab in Settings to "GoCardless" — it becomes the dedicated GoCardless configuration tab
- **D-02:** Show GoCardless connection status: whether API token is configured, environment (sandbox/live), green/red status indicator. Read-only — config is via env vars
- **D-03:** Default payment method selector: dropdown to set default for new leases (GoCardless / Bank Transfer / Manual). Persists to settings table
- **D-04:** Creditor info display: show GoCardless creditor ID and scheme (SEPA Core) fetched from the GoCardless API

### Mandate setup flow
- **D-05:** Modal dialog for mandate setup — reusable component triggered from lease detail, tenant profile, mandates page, and onboarding wizard step 4
- **D-06:** Landlord clicks "Setup Mandate" → GoCardless creates billing request → tenant receives email with authorization link → tenant signs mandate on GoCardless hosted page → webhook fires → mandate becomes active → lease auto-updates with mandateId
- **D-07:** Email-based authorization only — GoCardless sends the tenant an email with the authorization link (no manual copy-link flow)
- **D-08:** "Setup Mandate" button accessible from: lease detail page, tenant profile page, mandates management page ("New Mandate" button), and onboarding wizard step 4

### Mandate management view
- **D-09:** Dedicated "Mandates" page in sidebar navigation, positioned between Payments and Communications
- **D-10:** Table listing all mandates: tenant name, lease/property reference, mandate status (active/pending/cancelled/failed/expired), created date, next charge date. Table-to-card responsive pattern on mobile
- **D-11:** Status filter dropdown (All, Active, Pending, Cancelled, Failed, Expired) + search by tenant name or property address
- **D-12:** Per-row actions: View details, Cancel mandate (with cascade warning about pending payment cancellation). "New Mandate" button at top of page

### Payment method on leases
- **D-13:** Radio group in lease creation/edit form: GoCardless (SEPA Direct Debit), Bank Transfer, Manual. Selecting GoCardless shows mandate status or "Setup Mandate" button. Bank Transfer shows bank account selector dropdown
- **D-14:** Lease detail page shows: color-coded mandate status badge (green=active, yellow=pending, red=failed/cancelled/expired)
- **D-15:** Lease detail quick actions: "Setup Mandate" when no mandate active, "Cancel Mandate" when active (with cascade warning)
- **D-16:** Lease detail shows last GoCardless payment status and date alongside mandate info

### Claude's Discretion
- Exact modal layout and field arrangement for mandate setup dialog
- Mandates page column ordering and mobile card layout
- Toast notification messages for mandate setup/cancel actions
- Loading states and skeletons for GoCardless API calls
- Error handling UI for GoCardless API failures (token not configured, network errors)
- How to surface mandate status on tenant profile page

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GoCardless Backend
- `apps/api/src/lib/gocardless.ts` — GoCardless client: createCustomer, createMandateSetupFlow, getMandate, cancelMandate, createPayment, verifyWebhookSignature
- `apps/api/src/routes/gocardless.ts` — Mandate API routes: GET /status, POST /mandates/setup, POST /mandates/complete, GET /mandates/:id, POST /mandates/:id/cancel, POST /customers
- `apps/api/src/routes/webhooks.ts` — Webhook handler: mandate status mapping (active/cancelled/failed/expired), cascade cancellation of pending payments, lease flagging

### Database Schema
- `packages/db/src/schema/leases.ts` — paymentMethod enum (gocardless/bank_transfer/manual), gocardlessMandateId, bankAccountId, structuredCommunication
- `packages/db/src/schema/tenants.ts` — gocardlessCustomerId, gocardlessMandateId
- `packages/db/src/schema/payments.ts` — method enum includes gocardless, gocardlessPaymentId

### Existing Settings Page
- `apps/web/app/(dashboard)/settings/page.tsx` — Current settings page with 4 tabs (follow-up, landlord-reports, bank-accounts, general). General tab is "Coming Soon" placeholder

### UI Patterns (Phase 7)
- `.planning/phases/07-ui-polish-onboarding-launch-readiness/07-CONTEXT.md` — shadcn/ui adoption (D-17/D-18), responsive mobile patterns (D-09/D-10), table-to-card pattern

### Prior Payment Decisions (Phase 2)
- `.planning/phases/02-payment-processing-webhooks/02-CONTEXT.md` — Dual payment model (D-01), mandate lifecycle cascade (D-13), GoCardless Bank Account Data API (D-03)

### Requirements
- `.planning/REQUIREMENTS.md` — Full requirement list with traceability

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/gocardless.ts`: Full GoCardless client — mandate setup, cancel, get, payment operations. No new API client code needed
- `apps/api/src/routes/gocardless.ts`: Mandate routes with role-based access control (manager+ for setup/complete). May need new list/filter endpoint
- Settings page: shadcn Tabs component already wired with responsive grid-cols-2/md:grid-cols-4
- shadcn/ui components: Button, Card, Dialog, Input, Table, Badge, Select, RadioGroup all available from Phase 7
- `apps/web/components/IbanInput.tsx`, `BankAccountSelect` patterns: Reusable for payment method selection

### Established Patterns
- shadcn/ui for all new components (Phase 7 mandate)
- next-intl `useTranslations()` for all user-facing strings in 4 languages
- @tanstack/react-query for data fetching with loading skeletons
- Table-to-card responsive pattern (hidden md:block / md:hidden)
- NAV_VISIBILITY pattern for sidebar item role-based filtering
- Toast notifications via shadcn Toaster for action confirmations

### Integration Points
- Settings page General tab → replace "Coming Soon" with GoCardless config
- Sidebar navigation → add "Mandates" item between Payments and Communications
- Lease creation/edit form → add payment method radio group
- Lease detail view → add mandate status badge and quick actions
- Tenant profile → add mandate info display
- Onboarding wizard step 4 → integrate mandate setup modal
- New route: `/dashboard/mandates` page
- New API endpoints needed: GET /gocardless/mandates (list with filters), GET /gocardless/status (connection info + creditor)

</code_context>

<specifics>
## Specific Ideas

- GoCardless authorization flow is email-based: tenant receives email from GoCardless, signs mandate on their hosted page, webhook notifies Rentular
- No DB migrations needed — all GoCardless fields already exist on leases and tenants tables
- The mandate setup modal should be a reusable component since it's triggered from 4 different places
- Cancel mandate action must warn about cascade: cancelling a mandate also cancels all pending payments for that mandate (Phase 2, D-13)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-gocardless-settings-ui-sepa-mandate-management*
*Context gathered: 2026-03-31*
