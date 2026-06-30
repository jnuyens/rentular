---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
plan: 04
subsystem: ui
tags: [nextjs, shadcn, react, psd2, i18n, dashboard]

# Dependency graph
requires:
  - phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con (Plan 03)
    provides: "/api/v1/bank-connections REST routes (list, detail, institutions, create, renew, sync, revoke) + polling worker"
  - phase: 07-shadcn-ui-foundation
    provides: "shadcn/ui component library, DashboardSidebar/MobileNav split, NAV_VISIBILITY role gating, Table-to-Card responsive pattern"
provides:
  - "Four-page bank-connections dashboard surface (list, connect, callback, detail)"
  - "BankConnectionStatusBadge + InstitutionPicker reusable components"
  - "Owner-only sidebar nav entry between Payments and Mandates with Banknote icon"
  - "Settings GoCardless tab cross-link widget to /dashboard/bank-connections"
  - "Full bankConnections.* + settings.bankConnectionsCrossLink.* i18n key tree (Plan 05 translation input)"
affects: [09-05-i18n-translation-fill, deployment-phase-staging-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-step client wizard via local step state machine (info -> select -> redirecting -> error) on connect page"
    - "Server-issued consentLink redirect via window.location.href (open-redirect mitigated by trusted server origin)"
    - "useSearchParams-driven callback page mapping error codes to i18n keys"

key-files:
  created:
    - apps/web/components/BankConnectionStatusBadge.tsx
    - apps/web/components/InstitutionPicker.tsx
    - apps/web/app/(dashboard)/bank-connections/page.tsx
    - apps/web/app/(dashboard)/bank-connections/connect/page.tsx
    - apps/web/app/(dashboard)/bank-connections/callback/page.tsx
    - apps/web/app/(dashboard)/bank-connections/[id]/page.tsx
  modified:
    - apps/web/app/(dashboard)/layout.tsx
    - apps/web/components/DashboardSidebar.tsx
    - apps/web/components/MobileNav.tsx
    - apps/web/app/(dashboard)/settings/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json

key-decisions:
  - "Cross-link widget i18n keys nested under settings.bankConnectionsCrossLink (Settings page uses useTranslations('settings'), not a gocardless namespace)"
  - "Checkpoint approved on build-evidence + code-inspection basis (no runtime available); live UX verification deferred to deployment/staging phase"

patterns-established:
  - "Step state machine for connect wizard reused across PSD2 onboarding"
  - "Status badge color tokens mirrored from MandateStatusBadge for visual consistency"

requirements-completed: [BANK-UI-LIST, BANK-UI-DETAIL, BANK-UI-CALLBACK, BANK-UI-NAV]

# Metrics
duration: 5min
completed: 2026-06-30
---

# Phase 09 Plan 04: Bank Connections Dashboard UI Summary

**Four-page Next.js bank-connections dashboard surface (list, connect wizard, OAuth callback, detail) wired to the Plan 03 PSD2 API, with owner-only sidebar nav, status badge + institution picker components, Settings cross-link, and a complete i18n key tree across EN/NL/FR/DE.**

## Performance

- **Duration:** ~5 min (task execution); checkpoint approval received separately
- **Started:** 2026-06-30T01:09:55+02:00 (first task commit)
- **Completed:** 2026-06-30T01:14:18+02:00 (last code task commit)
- **Tasks:** 4 (3 auto + 1 checkpoint:human-verify)
- **Files modified:** 14 (6 created, 8 modified)

## Accomplishments

- Built the full landlord-facing bank-connection UI: list view (with €4/account/month Ibanity pricing disclosure + ToS link empty state), multi-step connect wizard redirecting to the Ponto consent link, OAuth callback page mapping error codes / success to messages, and a detail page with sync / renew / revoke actions.
- Added two reusable components: `BankConnectionStatusBadge` (pending/active/expired/revoked/error color tokens mirroring MandateStatusBadge) and `InstitutionPicker` (searchable, fed by GET /bank-connections/institutions).
- Added the owner-only `Bank Connections` sidebar entry (Banknote icon) between Payments and Mandates, gated via NAV_VISIBILITY against co_owner/manager/accountant/viewer, with the Banknote icon registered in both DashboardSidebar and MobileNav icon maps.
- Cross-linked the Settings GoCardless tab to the bank-connections surface.
- Seeded the complete `bankConnections.*` and `settings.bankConnectionsCrossLink.*` i18n key tree in all four locale files so Plan 05 is a pure translation fill, not a rewrite.

## Task Commits

Each task was committed atomically:

1. **Task 1: Status badge, institution picker, sidebar nav + Banknote icon + i18n keys** - `0d3850b` (feat)
2. **Task 2: List, connect, callback pages** - `4a020c5` (feat)
3. **Task 3: Detail page + Settings GoCardless cross-link** - `93cfa5d` (feat)
4. **Task 4: Checkpoint (human-verify, visual/UX)** - APPROVED by human (no code commit)

**Plan metadata:** (this SUMMARY + STATE.md update) — see final docs commit

## Files Created/Modified

**Created:**
- `apps/web/components/BankConnectionStatusBadge.tsx` - Status badge mapping pending/active/expired/revoked/error to color tokens
- `apps/web/components/InstitutionPicker.tsx` - Searchable institution Select fed by GET /bank-connections/institutions
- `apps/web/app/(dashboard)/bank-connections/page.tsx` - List view + empty-state pricing/ToS disclosure + Connect CTA
- `apps/web/app/(dashboard)/bank-connections/connect/page.tsx` - Multi-step connect wizard, POST then redirect to consentLink
- `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` - Post-redirect page reading ?error / ?connected query params
- `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` - Detail page with sync / renew / revoke actions + revoke AlertDialog

**Modified:**
- `apps/web/app/(dashboard)/layout.tsx` - Added bankConnections nav entry (index 4) + NAV_VISIBILITY owner gate
- `apps/web/components/DashboardSidebar.tsx` - Registered Banknote icon
- `apps/web/components/MobileNav.tsx` - Registered Banknote icon
- `apps/web/app/(dashboard)/settings/page.tsx` - GoCardless tab cross-link widget to /dashboard/bank-connections
- `apps/web/messages/{en,nl,fr,de}/common.json` - bankConnections.* + settings.bankConnectionsCrossLink.* key tree

## Translation Keys Used (Plan 05 input)

These keys exist in all four locale files (`apps/web/messages/{en,nl,fr,de}/common.json`). Plan 05 fills the localized values for NL/FR/DE.

**`bankConnections.*` (list / connect / callback / shared):**
- `title`, `subtitle`, `connectBank`, `emptyTitle`, `pricingDisclosure`, `tosNotice`, `viewTerms`
- `loadError`, `retry`, `searchBanks`, `selectInstitution`, `institution`, `account`, `statusLabel`
- `lastSync`, `expiry`, `expiresIn`, `expiresToday`, `neverSynced`
- `aboutToConnect`, `continue`, `back`, `cancel`, `connect`, `redirecting`, `connectError`
- `callbackSuccess`, `callbackSuccessBody`, `viewConnection`, `backToConnections`
- `errorAccessDenied`, `errorExpiredState`, `errorMissingParams`, `errorNoAccounts`, `errorUnknown`, `notFound`

**`bankConnections.status.*`:** `pending`, `active`, `expired`, `revoked`, `error`

**`bankConnections.actions.*`:** `syncNow`, `renewConsent`, `revoke`

**`bankConnections.detail.*`:** `connectionDetails`, `syncStatus`, `consent`, `iban`, `institutionId`, `country`, `createdAt`, `errorLabel`, `expiresInDays`, `expiredDaysAgo`, `lastSyncedAt`, `neverSynced`

**`bankConnections.toasts.*`:** `syncStarted`, `syncRateLimited`, `syncError`, `renewError`, `revokeSuccess`

**`bankConnections.dialogs.*`:** `revokeTitle`, `revokeBody`, `confirm`, `cancel`

**`settings.bankConnectionsCrossLink.*`:** `title`, `description`, `manageButton`

## Decisions Made

- The Settings cross-link widget keys were nested under `settings.bankConnectionsCrossLink` (not `gocardless.*`) because the Settings page uses `useTranslations("settings")`. The plan allowed this fallback explicitly.

## Deviations from Plan

None - plan executed exactly as written. (All four pages, two components, layout/icon-map edits, and Settings cross-link match the plan's artifacts and key-link specs.)

## Checkpoint Approval Status

**Task 4 (checkpoint:human-verify, gate="blocking") — APPROVED.**

The checkpoint was approved on a **build-evidence + code-inspection** basis, NOT a live manual UI click-through. No local or staging runtime was available at approval time (no local Docker/DB; no deployment exists yet). Evidence relied on:
- Production build passes (`pnpm --filter @rentular/web build`)
- All four `/bank-connections*` routes register
- All visible strings use `useTranslations("bankConnections")`
- The owner-only NAV_VISIBILITY gate and callback-state handling are present in code

### Deferred live verification (defer to deployment phase / staging on rentular.com)

The following remain to be verified against a running instance and were explicitly NOT confirmed at approval:
- Visual rendering of the four pages + empty-state €4 disclosure + ToS link
- Owner sees the sidebar entry; manager (non-owner) does NOT
- Connect-flow redirect + graceful error when Ponto is unconfigured
- Callback states (`access_denied` / `expired_state` / `connected`) render correctly
- No console / hydration errors

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required for this UI plan. (Ponto/Ibanity credentials are a deployment-phase concern, covered by Plan 03's API config.)

## Next Phase Readiness

- UI surface complete; **Plan 05** can proceed as a pure i18n translation fill against the documented key tree above.
- **Deployment/staging phase** must complete the deferred live verification checklist above before this surface is considered production-verified.

---
*Phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con*
*Completed: 2026-06-30*
