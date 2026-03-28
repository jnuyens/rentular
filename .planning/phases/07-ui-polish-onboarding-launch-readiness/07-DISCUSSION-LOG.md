# Phase 7: UI Polish, Onboarding & Launch Readiness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 07-ui-polish-onboarding-launch-readiness
**Areas discussed:** Landing page redesign, Mobile navigation, Onboarding wizard, Visual polish scope

---

## Landing Page Redesign

### Page type

| Option | Description | Selected |
|--------|-------------|----------|
| Full marketing page | Hero, features, pricing, footer, CTA buttons. Standard SaaS landing. | ✓ |
| Polished login-only | Centered login form with better spacing/logo. No marketing content. | |
| Split layout | Left: marketing content. Right: login form. Single viewport. | |

**User's choice:** Full marketing page
**Notes:** None

### Login/register location

| Option | Description | Selected |
|--------|-------------|----------|
| Separate /login page | Marketing page has nav buttons that go to dedicated auth page. | ✓ |
| Modal overlay on landing | Clicking Login opens modal over marketing page. | |
| Inline section at bottom | Login form is last section of landing page. | |

**User's choice:** Separate /login page with Facebook-style routing
**Notes:** User prefers that known users who previously logged in are not bothered by marketing — redirect straight to dashboard.

### Pricing

| Option | Description | Selected |
|--------|-------------|----------|
| Real pricing from Stripe | Show actual per-lease pricing from Stripe configuration. | ✓ |
| Static placeholder | Hardcoded tiers to update later. | |
| Contact us / Coming soon | No specific prices, just CTA. | |

**User's choice:** Real pricing from Stripe plans

### Hero visual

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard screenshot/mockup | Styled screenshot or illustration of Rentular dashboard. | |
| Abstract illustration | Professional abstract shapes or property-themed illustration. | |
| You decide | Claude picks best approach. | ✓ |

**User's choice:** You decide

### Page layout

| Option | Description | Selected |
|--------|-------------|----------|
| Scrollable sections | Hero, Features, Pricing, Footer as scrollable sections. | ✓ |
| Single viewport with tabs | Everything in one screen with tabs/anchors. | |

**User's choice:** Scrollable sections

### Feature highlights

| Option | Description | Selected |
|--------|-------------|----------|
| Core 6 features | SEPA DD, Indexation, Reminders, Property managers, Multi-lang, Reports. | |
| All features including Smovin import | Everything plus Smovin import, communication logging, maintenance. | |
| You decide | Claude picks most compelling set. | ✓ |

**User's choice:** You decide

### Style reference

| Option | Description | Selected |
|--------|-------------|----------|
| Smovin.be style | Clean, professional Belgian property management tool. | |
| Rentila.com style | International property management. Feature-rich landing pages. | ✓ |
| No reference | Build from scratch with brand colors. | |

**User's choice:** Rentila.com style

### Navigation bar

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky top nav | Logo + nav links (Features, Pricing, Login/Get Started) that stick on scroll. | ✓ |
| No nav bar | Just scroll with hero CTA buttons. | |
| Minimal header only | Logo + Login button, no section anchors. | |

**User's choice:** Sticky top nav

### Dark mode

| Option | Description | Selected |
|--------|-------------|----------|
| Light only | Marketing page always light. Dashboard dark mode later. | ✓ |
| Respect system preference | Auto-detect OS dark/light preference. | |
| You decide | Claude picks based on effort vs impact. | |

**User's choice:** Light only

### Default language

| Option | Description | Selected |
|--------|-------------|----------|
| Browser language detection | Detect browser locale, fall back to English. Already configured. | ✓ |
| Always English first | English default regardless of browser. | |
| Dutch first (Belgian market) | Default to Dutch for Belgian landlords. | |

**User's choice:** Browser language detection

---

## Mobile Navigation

### Sidebar behavior on mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Hamburger drawer | Hamburger icon opens slide-out drawer with sidebar content. Dimmed overlay. | ✓ |
| Bottom tab bar | 4-5 icon tabs at bottom. "More" opens full menu. | |
| Collapsible icon-only sidebar | Sidebar shrinks to icons (48px) on mobile. | |

**User's choice:** Hamburger drawer

### Mobile top bar

| Option | Description | Selected |
|--------|-------------|----------|
| Logo + page title | Hamburger, Rentular logo, current page name. | |
| Logo only | Just hamburger + logo. | |
| You decide | Claude picks best layout. | ✓ |

**User's choice:** You decide

### Data layout on mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Card-based on mobile | Tables convert to stacked cards on small screens. | ✓ |
| Horizontal scroll tables | Keep tables, add horizontal scroll on mobile. | |
| You decide | Claude picks best approach per page. | |

**User's choice:** Card-based on mobile

---

## Onboarding Wizard

### Wizard appearance

| Option | Description | Selected |
|--------|-------------|----------|
| Full-page wizard | Dedicated /onboarding route. Clean layout with step indicator. No dashboard chrome. | ✓ |
| Modal overlay in dashboard | Modal appears over dimmed dashboard. Can close and resume. | |
| Sidebar coach marks | Floating tooltips guide through each dashboard section. | |

**User's choice:** Full-page wizard

### Smovin importers

| Option | Description | Selected |
|--------|-------------|----------|
| Skip wizard entirely | Detect existing data, skip onboarding for import users. | |
| Abbreviated wizard | Short welcome summary, then focus on payment setup. | |
| Always show wizard | Show wizard regardless. Completed steps show imported data. | ✓ |

**User's choice:** Always show wizard
**Notes:** User wants all users to go through onboarding, even Smovin importers. Imported data shown as summary per step.

### Progress tracking

| Option | Description | Selected |
|--------|-------------|----------|
| Database flag + step | onboardingStep (1-4) + onboardingComplete on user record. | ✓ |
| Cookie/localStorage | Client-side tracking. Simpler but device-dependent. | |
| You decide | Claude picks most reliable approach. | |

**User's choice:** Database flag + step

### Data creation

| Option | Description | Selected |
|--------|-------------|----------|
| Create real data per step | Each step creates records via existing API. Partial data preserved. | ✓ |
| Collect all, create at end | Wizard collects info, batch creates at final step. | |

**User's choice:** Create real data per step

### Import user step behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Show imported data, mark as done | Summary of imported data per step. Focus on payment setup. | ✓ |
| Pre-fill forms with imported data | Forms pre-filled for review and edit. | |
| You decide | Claude picks best UX for both user types. | |

**User's choice:** Show imported data, mark as done

---

## Visual Polish Scope

### UI primitives approach

| Option | Description | Selected |
|--------|-------------|----------|
| Build primitives | Create reusable components in ui/ folder. Manual consistency. | |
| Fix inline only | Audit and fix directly. No abstraction. | |
| Shadcn/ui or similar | Install component library. Battle-tested, adds dependency. | ✓ |

**User's choice:** Shadcn/ui or similar

### Top priority

| Option | Description | Selected |
|--------|-------------|----------|
| Logo and branding | UI-01 + UI-02. Most visible. | |
| Spacing and alignment | UI-05. Inconsistent padding/margins. | |
| Overall look and feel | General modernization. | |
| All equal priority | Address everything systematically. | ✓ |

**User's choice:** All equal priority

### Migration scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full migration | All existing dashboard pages to shadcn/ui. 100% consistency. | ✓ |
| New + touched pages only | Only new components and pages needing fixes. Mixed styles. | |
| You decide | Claude picks based on effort vs consistency. | |

**User's choice:** Full migration

### Toast notifications

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, shadcn toast | Add toast for save/delete/error confirmations. | ✓ |
| No, keep current | Inline messages sufficient. | |
| You decide | Claude adds where most impactful. | |

**User's choice:** Yes, shadcn toast

### Loading skeletons

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, for all data pages | Skeletons for properties, payments, leases, tenants, communications. | ✓ |
| Only for slow pages | Only where loading is noticeable. | |
| You decide | Claude adds where most impactful. | |

**User's choice:** Yes, for all data pages

---

## Claude's Discretion

- Hero visual for landing page
- Mobile top bar layout
- Feature selection for landing page highlights
- Loading skeleton designs
- Specific shadcn/ui component selection and configuration
- Toast message wording and placement

## Deferred Ideas

None — discussion stayed within phase scope
