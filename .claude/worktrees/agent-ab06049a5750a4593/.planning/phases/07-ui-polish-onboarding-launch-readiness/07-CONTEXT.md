# Phase 7: UI Polish, Onboarding & Launch Readiness - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The platform looks polished, works on mobile, guides new users to success, and every screen is fully translated — ready for public launch. This phase covers: landing page redesign, responsive mobile layout, onboarding wizard, shadcn/ui component migration, and full i18n coverage for all features added in Phases 1-6.

</domain>

<decisions>
## Implementation Decisions

### Landing Page
- **D-01:** Full marketing page with scrollable sections: hero, features, pricing, footer
- **D-02:** Facebook-style auth routing — returning users (with session cookie) redirect straight to dashboard; new/logged-out users see the marketing page
- **D-03:** Login/register on a separate /login page (not modal overlay). "Get Started" and "Login" buttons in nav navigate to it
- **D-04:** Real pricing pulled from Stripe plans (not placeholder)
- **D-05:** Sticky top navigation bar with logo + section anchors (Features, Pricing) + Login/Get Started buttons
- **D-06:** Light mode only for the marketing page
- **D-07:** Browser language detection for default locale (existing next-intl as-needed prefix behavior)
- **D-08:** Rentila.com as visual style reference for the marketing page layout

### Mobile Navigation
- **D-09:** Hamburger drawer pattern for mobile (<768px): hamburger icon in top-left opens slide-out drawer with same sidebar content. Dimmed overlay on main content, tap outside or X to close
- **D-10:** Tables convert to stacked cards on mobile (each row becomes a card with label:value pairs)

### Onboarding Wizard
- **D-11:** Full-page wizard at dedicated /onboarding route. Clean layout with step indicator, form content, next/back buttons. No dashboard chrome until complete or skipped
- **D-12:** 4 steps: Add property → Add tenant → Create lease → Set up payment collection
- **D-13:** Always shown to all users after first login, including Smovin importers. For users with existing data (from import), completed steps show a summary of imported data ("5 properties imported") marked as done. Focus shifts to payment setup step
- **D-14:** Database-tracked progress: onboardingStep (1-4) and onboardingComplete boolean on user record. Redirect to wizard on login if not complete
- **D-15:** Each step creates real data via existing API endpoints. Partial completion is preserved — user can resume where they left off
- **D-16:** "Skip setup → Dashboard" option always visible at bottom of wizard

### Visual Polish & Component System
- **D-17:** Adopt shadcn/ui component library for Tailwind-based UI primitives (Button, Card, Modal/Dialog, Input, Table, Badge, etc.)
- **D-18:** Full migration of all existing dashboard pages to shadcn/ui components — not just new pages
- **D-19:** Add shadcn/ui toast notifications for user actions (save, delete, error confirmations)
- **D-20:** Add loading skeletons for all data-heavy dashboard pages (properties, payments, leases, tenants, communications)
- **D-21:** All visual issues addressed with equal priority: bigger logo (UI-01), landing page branding (UI-02), responsive mobile (UI-03), landing page refresh (UI-04), consistent styling (UI-05)

### Claude's Discretion
- Hero visual for landing page (dashboard screenshot/mockup vs abstract illustration — pick what works best with brand colors)
- Mobile top bar layout (whether to show current page title alongside hamburger + logo)
- Feature selection for landing page highlights (pick most compelling competitive differentiators against Smovin/Rentila)
- Loading skeleton designs and exact placement
- Specific shadcn/ui component selection and configuration
- Toast message wording and placement

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above and in these project files:

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01 through UI-05, ONB-01 through ONB-03, I18N-01 requirements with acceptance criteria

### Prior Phase UI Patterns
- `.planning/phases/04-notifications-payment-follow-up/04-CONTEXT.md` — Communications dashboard decisions (D-05 through D-10): table-based view, expandable rows, settings integration
- `.planning/phases/05-property-manager-roles/05-CONTEXT.md` — Role badges (D-07), unified dashboard view (D-08), filtered sidebar by role (D-09)
- `.planning/phases/06-smovin-import-beta/06-CONTEXT.md` — Import page decisions (D-08 through D-11): two-phase flow, real-time progress, beta label

### Codebase Analysis
- `.planning/codebase/STRUCTURE.md` — Directory layout, where to add new code
- `.planning/codebase/CONVENTIONS.md` — Naming patterns, code style, i18n patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/components/LanguageSwitcher.tsx`: Language dropdown — reuse in marketing page nav and mobile drawer
- `apps/web/components/RoleBadge.tsx`: Role badges — will be migrated to shadcn/ui Badge
- `apps/web/components/IbanInput.tsx`, `PhoneInput.tsx`, `BelgianCityInput.tsx`, `CountrySelect.tsx`: Domain-specific inputs — keep functionality, wrap with shadcn/ui Input styling
- `apps/web/components/SupportChat.tsx`: Chat widget — keep as-is, already independent
- `apps/web/app/globals.css`: HSL CSS variable theming — compatible with shadcn/ui which uses same pattern
- `apps/web/tailwind.config.ts`: Brand color palette (blue 50-950) — integrate with shadcn/ui theme

### Established Patterns
- `next-intl` for i18n: `useTranslations("section")` hook, messages in `apps/web/messages/{locale}/common.json`
- Tailwind + HSL CSS variables for theming (matches shadcn/ui approach)
- `@tanstack/react-query` for data fetching — use with loading skeletons
- Lucide React for icons (already used by shadcn/ui)
- Next.js App Router route groups: `(auth)`, `(dashboard)`, `(marketing)`

### Integration Points
- `apps/web/app/(dashboard)/layout.tsx`: Dashboard layout — needs mobile hamburger, sidebar refactor
- `apps/web/app/page.tsx`: Current landing page (702 lines) — full rewrite to marketing page
- `apps/web/middleware.ts`: Auth guard — extend with Facebook-style redirect (session → dashboard)
- `apps/web/app/layout.tsx`: Root layout — add toast provider
- `packages/db/src/schema/users.ts`: User table — add onboardingStep and onboardingComplete columns

</code_context>

<specifics>
## Specific Ideas

- Facebook-style auth routing: known users who previously logged in should not be bothered by marketing content — redirect straight to dashboard
- Rentila.com as visual style reference for the marketing page
- For Smovin importers in wizard: show summary of imported data per step ("5 properties imported") rather than pre-filling forms — verify without re-entry
- Per-lease pricing model from Stripe should be displayed on the marketing page pricing section

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-ui-polish-onboarding-launch-readiness*
*Context gathered: 2026-03-28*
