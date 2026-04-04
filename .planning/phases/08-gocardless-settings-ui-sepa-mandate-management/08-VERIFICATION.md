---
phase: 08-gocardless-settings-ui-sepa-mandate-management
verified: 2026-04-04T12:00:00Z
status: passed
score: 18/18 must-haves verified
re_verification: false
---

# Phase 8: GoCardless Settings UI & SEPA Mandate Management — Verification Report

**Phase Goal:** Landlords have a complete UI to configure GoCardless, manage SEPA mandates, and select payment methods on leases — making the existing backend infrastructure (Phase 2) fully accessible through the dashboard
**Verified:** 2026-04-04T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GoCardless settings tab shows connection status, creditor info, and default payment method selector | VERIFIED | `GoCardlessSettingsTab` component in `settings/page.tsx` fetches `/gocardless/status` and `/gocardless/creditor`, shows green/red badge, creditor ID, scheme, masked token, and `Select` with 3 payment method options |
| 2 | Dedicated Mandates page lists all mandates with status filtering, search, and per-mandate actions | VERIFIED | `apps/web/app/(dashboard)/mandates/page.tsx` with `Select` status filter (all/active/pending/cancelled/failed/expired), debounced search input, desktop `Table` and mobile `Card` layout, `DropdownMenu` with view/cancel actions |
| 3 | Lease creation/edit form has a payment method radio group | VERIFIED | `PaymentMethodRadioGroup` imported and rendered in `leases/page.tsx` with 3 options (GoCardless/Bank Transfer/Manual) and conditional sub-content |
| 4 | Lease detail shows mandate status badge and quick actions | VERIFIED | `MandateStatusBadge` and `MandateSetupModal`/`CancelMandateDialog` integrated in `leases/page.tsx` with mandate setup/cancel in `DropdownMenu` |
| 5 | Mandate setup modal accessible from lease detail, tenant profile, mandates page, and onboarding wizard step 4 | VERIFIED | `MandateSetupModal` imported in: `leases/page.tsx`, `tenants/page.tsx`, `mandates/page.tsx`, `onboarding/page.tsx` |
| 6 | All strings translated in EN, NL, FR, DE | VERIFIED | `mandates` section present in all 4 locale files at line 829; nav.mandates key at line 37; i18n audit confirms 71+ GoCardless/mandate keys per locale |

### Observable Truths (from Plan must_haves)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | GoCardless connection status (green/red) and creditor info display in settings | VERIFIED | `GoCardlessSettingsTab` fetches `/gocardless/status`, renders green/red badge conditionally; creditor section shows ID and scheme |
| 2  | Default payment method selector persists choice for new leases | VERIFIED | `Select` with `onValueChange` handler calls `localStorage.setItem` and shows toast confirmation |
| 3  | MandateStatusBadge renders correct color per status | VERIFIED | `statusStyles` map in `MandateStatusBadge.tsx`: active=green-500, pending/pending_submission/submitted=amber-500, cancelled=gray-500, failed/expired=destructive |
| 4  | MandateSetupModal shows tenant selector and sends authorization email via API | VERIFIED | Multi-step modal: step 1 fetches `/api/v1/tenants` into `Select`, step 2 shows confirm with tenant details, POSTs to `/gocardless/mandates/setup` |
| 5  | CancelMandateDialog warns about cascade and calls cancel API | VERIFIED | `AlertDialog` with warning description using `cancelDescription` i18n key, POSTs to `/gocardless/mandates/:id/cancel` |
| 6  | PaymentMethodRadioGroup shows 3 options with conditional sub-content | VERIFIED | `RadioGroup` with `gocardless` (mandate badge or setup button), `bank_transfer` (bank account select + structured communication), `manual` (no sub-content) |
| 7  | Mandates page has desktop table and mobile card layout | VERIFIED | `hidden md:block` wraps `Table`; `md:hidden` wraps `Card` list — same responsive pattern as other dashboard pages |
| 8  | Mandates page has status filter dropdown with all/active/pending/cancelled/failed/expired | VERIFIED | `Select` with 6 `SelectItem` values corresponding to GoCardless mandate statuses |
| 9  | Mandates page has debounced search | VERIFIED | `useRef` timer with 300ms `setTimeout` for `debouncedSearch` state |
| 10 | Mandates sidebar navigation item added | VERIFIED | `{ key: "mandates", href: "/mandates", iconName: "FileSignature" }` in `layout.tsx` nav items; `FileSignature` icon imported in `DashboardSidebar.tsx` and `MobileNav.tsx` |
| 11 | Lease form includes paymentMethod in form submission | VERIFIED | `PaymentMethodRadioGroup` rendered in lease create/edit form in `leases/page.tsx` |
| 12 | Tenant table shows SEPA Mandate column with badge or "No mandate" | VERIFIED | `tenants/page.tsx` has `TableHead` for `sepaMandate`, renders `MandateStatusBadge` or `noMandate` text |
| 13 | Tenant dropdown has "Setup Mandate" action for tenants without mandates | VERIFIED | `DropdownMenuItem` conditionally rendered when `!tenant.gocardlessMandateId`, opens `MandateSetupModal` with tenant pre-fill |
| 14 | Onboarding wizard step 4 has "Setup SEPA Mandate" button | VERIFIED | `onboarding/page.tsx` imports `MandateSetupModal`, renders setup button with `t("onboarding.setupMandate")` |
| 15 | Mandate setup is optional in onboarding (does not block completion) | VERIFIED | Mandate setup shows success state or skip note; wizard completion not gated on mandate |
| 16 | API has /gocardless/status endpoint with masked token | VERIFIED | `gocardlessRouter.get("/status", ...)` in `routes/gocardless.ts` |
| 17 | API has /gocardless/creditor endpoint | VERIFIED | `gocardlessRouter.get("/creditor", ...)` in `routes/gocardless.ts` |
| 18 | API has /gocardless/mandates list, setup, and cancel endpoints | VERIFIED | GET `/mandates`, POST `/mandates/setup`, POST `/mandates/:mandateId/cancel` all present in `routes/gocardless.ts` |

---

## Requirement Traceability

| Requirement | Plan | Status |
|-------------|------|--------|
| GC-SETTINGS | 08-01 | Implemented — GoCardless tab in settings |
| GC-SHARED-COMPONENTS | 08-01 | Implemented — 4 shared components created |
| GC-MANDATES-PAGE | 08-02 | Implemented — /mandates page with full functionality |
| GC-LEASE-PAYMENT-METHOD | 08-03 | Implemented — PaymentMethodRadioGroup on lease form |
| GC-LEASE-MANDATE-STATUS | 08-03 | Implemented — MandateStatusBadge on lease detail |
| GC-TENANT-MANDATE | 08-03 | Implemented — Mandate column and setup on tenant page |
| GC-ONBOARDING | 08-04 | Implemented — MandateSetupModal in onboarding step 4 |
| GC-I18N-AUDIT | 08-04 | Implemented — 71+ keys verified across 4 locales |

---

## Key Files

### Created
- `apps/web/components/ui/radio-group.tsx`
- `apps/web/components/MandateStatusBadge.tsx`
- `apps/web/components/MandateSetupModal.tsx`
- `apps/web/components/CancelMandateDialog.tsx`
- `apps/web/components/PaymentMethodRadioGroup.tsx`
- `apps/web/app/(dashboard)/mandates/page.tsx`

### Modified
- `apps/api/src/lib/gocardless.ts`
- `apps/api/src/routes/gocardless.ts`
- `apps/web/app/(dashboard)/settings/page.tsx`
- `apps/web/app/(dashboard)/leases/page.tsx`
- `apps/web/app/(dashboard)/tenants/page.tsx`
- `apps/web/app/(dashboard)/layout.tsx`
- `apps/web/components/DashboardSidebar.tsx`
- `apps/web/components/MobileNav.tsx`
- `apps/web/app/onboarding/page.tsx`
- `apps/web/messages/{en,nl,fr,de}/common.json`

---

## Human Verification

No human verification items required. All success criteria are verifiable through code inspection.
