# Phase 7: UI Polish, Onboarding & Launch Readiness - Research

**Researched:** 2026-03-28
**Domain:** Frontend UI components (shadcn/ui), responsive design, onboarding wizard, i18n completeness
**Confidence:** HIGH

## Summary

Phase 7 covers five distinct workstreams: (1) Marketing landing page redesign with Facebook-style auth routing, (2) shadcn/ui component library adoption and full dashboard migration, (3) responsive mobile layout with hamburger drawer, (4) onboarding wizard with database-tracked progress, and (5) i18n coverage for all new screens. The project's existing stack (Next.js 15, Tailwind CSS v3.4, HSL CSS variables, next-intl, Lucide icons) is highly compatible with shadcn/ui -- the CSS variable theming pattern already matches, `clsx` and `tailwind-merge` are already installed, and Lucide React is the icon library shadcn/ui uses natively.

The primary technical risk is the volume of migration work: 9 dashboard pages totaling ~5,261 lines need shadcn/ui component migration, plus a 702-line landing page rewrite, plus the onboarding wizard (new feature), plus database schema changes. The user schema needs two new columns (`onboardingStep`, `onboardingComplete`) and the middleware needs onboarding redirect logic. Translation files currently have 667 keys across all 4 languages -- new keys for the wizard, landing page changes, and toast messages will need to be added to all locales.

**Primary recommendation:** Initialize shadcn/ui with `shadcn@2.3.0` (Tailwind v3 compatible), install foundational components (Button, Card, Dialog, Input, Table, Badge, Skeleton, Sonner) in a single setup wave, then systematically migrate pages while adding new features (landing page, wizard, mobile nav).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Full marketing page with scrollable sections: hero, features, pricing, footer
- **D-02:** Facebook-style auth routing -- returning users (with session cookie) redirect straight to dashboard; new/logged-out users see the marketing page
- **D-03:** Login/register on a separate /login page (not modal overlay). "Get Started" and "Login" buttons in nav navigate to it
- **D-04:** Real pricing pulled from Stripe plans (not placeholder)
- **D-05:** Sticky top navigation bar with logo + section anchors (Features, Pricing) + Login/Get Started buttons
- **D-06:** Light mode only for the marketing page
- **D-07:** Browser language detection for default locale (existing next-intl as-needed prefix behavior)
- **D-08:** Rentila.com as visual style reference for the marketing page layout
- **D-09:** Hamburger drawer pattern for mobile (<768px): hamburger icon in top-left opens slide-out drawer with same sidebar content. Dimmed overlay on main content, tap outside or X to close
- **D-10:** Tables convert to stacked cards on mobile (each row becomes a card with label:value pairs)
- **D-11:** Full-page wizard at dedicated /onboarding route. Clean layout with step indicator, form content, next/back buttons. No dashboard chrome until complete or skipped
- **D-12:** 4 steps: Add property -> Add tenant -> Create lease -> Set up payment collection
- **D-13:** Always shown to all users after first login, including Smovin importers. For users with existing data (from import), completed steps show a summary of imported data ("5 properties imported") marked as done. Focus shifts to payment setup step
- **D-14:** Database-tracked progress: onboardingStep (1-4) and onboardingComplete boolean on user record. Redirect to wizard on login if not complete
- **D-15:** Each step creates real data via existing API endpoints. Partial completion is preserved -- user can resume where they left off
- **D-16:** "Skip setup -> Dashboard" option always visible at bottom of wizard
- **D-17:** Adopt shadcn/ui component library for Tailwind-based UI primitives (Button, Card, Modal/Dialog, Input, Table, Badge, etc.)
- **D-18:** Full migration of all existing dashboard pages to shadcn/ui components -- not just new pages
- **D-19:** Add shadcn/ui toast notifications for user actions (save, delete, error confirmations)
- **D-20:** Add loading skeletons for all data-heavy dashboard pages (properties, payments, leases, tenants, communications)
- **D-21:** All visual issues addressed with equal priority: bigger logo (UI-01), landing page branding (UI-02), responsive mobile (UI-03), landing page refresh (UI-04), consistent styling (UI-05)

### Claude's Discretion
- Hero visual for landing page (dashboard screenshot/mockup vs abstract illustration -- pick what works best with brand colors)
- Mobile top bar layout (whether to show current page title alongside hamburger + logo)
- Feature selection for landing page highlights (pick most compelling competitive differentiators against Smovin/Rentila)
- Loading skeleton designs and exact placement
- Specific shadcn/ui component selection and configuration
- Toast message wording and placement

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Dashboard has bigger logo in top-left position | Current logo is 36x36px in sidebar header. Increase to ~48-56px. Straightforward CSS change in dashboard layout.tsx |
| UI-02 | Landing page has properly aligned watermark/branding | Current page.tsx has watermark at opacity 0.03. Landing page rewrite will address proper branding placement |
| UI-03 | Dashboard is responsive and usable on mobile devices (collapsible sidebar) | D-09 hamburger drawer pattern. Requires client-side state for drawer open/close. Dashboard layout.tsx needs refactor from server to client component or hybrid approach |
| UI-04 | Landing page is refreshed with better layout and visual consistency | Full rewrite of page.tsx (702 lines). New marketing page with sections per D-01, Rentila-style layout per D-08 |
| UI-05 | All pages have consistent visual styling and spacing | shadcn/ui migration (D-17, D-18) standardizes all components. 9 dashboard pages to migrate |
| ONB-01 | New user sees a guided setup wizard after first login | New /onboarding route with full-page wizard. Database schema change: add onboardingStep + onboardingComplete to users table |
| ONB-02 | Wizard walks through: add property, add tenant, create lease, set up payment collection | 4-step wizard using existing API endpoints. Each step creates real data |
| ONB-03 | Wizard tracks completion and can be resumed | onboardingStep (int 1-4) and onboardingComplete (boolean) on user record. Middleware redirect if not complete |
| I18N-01 | All new UI screens and features are translated in EN, NL, FR, DE | New translation keys for: wizard steps, marketing page updates, toast messages, mobile nav labels. Currently 667 keys across 4 balanced languages |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Do not add Co-Authored-By lines to commit messages
- Always use A4 page size (210mm x 297mm) when generating .docx documents
- Tech stack: Next.js 15, Hono, Drizzle ORM, MySQL, GoCardless, Stripe
- Language: All UI must be available in EN, NL, FR, DE
- Tailwind CSS v4 migration is explicitly OUT OF SCOPE

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| shadcn@2.3.0 | 2.3.0 | CLI for adding shadcn/ui components (Tailwind v3 compatible) | Official shadcn/ui CLI pinned to v3-compatible version |
| tailwindcss-animate | 1.0.7 | Animation plugin for shadcn/ui components | Required by shadcn/ui v3 for transitions and animations |
| class-variance-authority | 0.7.1 | Component variant API used by shadcn/ui | Required dependency for all shadcn/ui components |
| @radix-ui/react-dialog | 1.1.15 | Accessible dialog/modal primitives | Used by shadcn/ui Dialog component |
| @radix-ui/react-slot | 1.2.4 | Component composition primitive | Used by shadcn/ui Button (asChild pattern) |
| sonner | 2.0.7 | Toast notification library | Official shadcn/ui toast replacement (shadcn deprecated their own toast) |

### Already Installed (reuse)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| clsx | 2.1.1 | Conditional classNames | Part of `cn()` utility |
| tailwind-merge | 2.6.0 | Tailwind class conflict resolution | Part of `cn()` utility |
| lucide-react | 0.468.0 | Icon library | Already matches shadcn/ui's default icon library |
| @tanstack/react-query | 5.62.0 | Data fetching | Use with Skeleton loading states |
| next-intl | 3.24.0 | i18n | All new strings need 4-locale coverage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn/ui | Radix UI directly | More control but no pre-styled components -- much more work |
| sonner | react-hot-toast | sonner is official shadcn/ui choice, better animations |
| tailwindcss-animate | CSS keyframes | Manual work for every animation, shadcn/ui expects the plugin |

**Installation:**
```bash
# In apps/web directory
pnpm add class-variance-authority tailwindcss-animate sonner
pnpm dlx shadcn@2.3.0 init
# Then add components:
pnpm dlx shadcn@2.3.0 add button card dialog input table badge skeleton label separator
```

## Architecture Patterns

### Recommended Project Structure
```
apps/web/
├── app/
│   ├── (marketing)/          # NEW: Marketing route group
│   │   └── page.tsx          # Landing page (rewrite of current app/page.tsx)
│   ├── (auth)/
│   │   └── login/page.tsx    # Existing login page
│   ├── (dashboard)/
│   │   ├── layout.tsx        # MODIFY: Add mobile drawer, bigger logo
│   │   └── [existing pages]  # MODIFY: shadcn/ui migration
│   ├── onboarding/
│   │   └── page.tsx          # NEW: Onboarding wizard
│   ├── layout.tsx            # MODIFY: Add Toaster provider
│   └── page.tsx              # MODIFY: Auth-routing redirect logic
├── components/
│   ├── ui/                   # NEW: shadcn/ui generated components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── table.tsx
│   │   ├── badge.tsx
│   │   ├── skeleton.tsx
│   │   ├── label.tsx
│   │   ├── separator.tsx
│   │   └── sonner.tsx        # Toast wrapper
│   ├── MobileDrawer.tsx      # NEW: Hamburger nav drawer
│   ├── OnboardingWizard.tsx  # NEW: Wizard step container
│   └── [existing].tsx        # KEEP: Domain-specific components
├── lib/
│   └── utils.ts              # NEW: cn() utility function
└── messages/
    ├── en/common.json        # MODIFY: Add new keys
    ├── nl/common.json
    ├── fr/common.json
    └── de/common.json
```

### Pattern 1: Facebook-Style Auth Routing
**What:** Returning users with valid session cookie bypass the landing page and go directly to dashboard. New/logged-out users see the marketing page.
**When to use:** Landing page (app/page.tsx or root redirect)
**Implementation approach:**
```typescript
// Option A: Server component at app/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/properties");
  }
  // Render marketing page for unauthenticated users
  return <MarketingPage />;
}
```
**Note:** The current page.tsx is "use client" with a login modal. The rewrite should make it a server component that conditionally renders the marketing page or redirects. The marketing page content itself can be a client component for interactivity.

### Pattern 2: Onboarding Wizard with DB-Tracked Progress
**What:** Full-page wizard at /onboarding that uses existing API endpoints to create real data.
**When to use:** After first login, before accessing dashboard.
**Implementation approach:**
```typescript
// Database schema addition (packages/db/src/schema/users.ts)
export const users = mysqlTable("users", {
  // ... existing columns ...
  onboardingStep: int("onboarding_step").default(1),
  onboardingComplete: boolean("onboarding_complete").default(false),
});

// Middleware check (apps/web/middleware.ts)
// After auth check, if user has onboardingComplete === false, redirect to /onboarding
// Exception: don't redirect if already on /onboarding

// API endpoint needed: GET /api/v1/auth/me or /api/v1/users/me
// Returns user record including onboarding fields
// PATCH /api/v1/users/onboarding to update step/completion
```

### Pattern 3: Mobile Hamburger Drawer
**What:** Slide-out drawer on mobile (<768px) containing same sidebar navigation content.
**When to use:** Dashboard layout on mobile viewports.
**Implementation approach:**
```typescript
// Dashboard layout needs to become hybrid (server auth + client interactivity)
// Approach: Keep server component for auth, extract sidebar into client component

// DashboardSidebar.tsx (new client component)
"use client";
export function DashboardSidebar({ items, session, isMobile, isOpen, onClose }) {
  // Desktop: always visible static sidebar
  // Mobile: slide-out drawer with overlay
}
```
**Key constraint:** The current dashboard layout.tsx is a server component (uses `auth()`, `cookies()`, `getTranslations()`). Mobile drawer requires client-side state. Solution: extract the sidebar into a separate client component that receives data from the server layout.

### Pattern 4: Table-to-Card Mobile Responsiveness
**What:** Tables on desktop become stacked cards on mobile.
**When to use:** All data-heavy dashboard pages (properties, payments, tenants, leases, communications).
**Implementation approach:**
```typescript
// Use responsive Tailwind classes
// Desktop: standard shadcn/ui Table
// Mobile: hidden table, visible card layout
<div className="hidden md:block">
  <Table>...</Table>
</div>
<div className="md:hidden space-y-3">
  {data.map(item => (
    <Card key={item.id}>
      <CardContent className="space-y-2 p-4">
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Name</span>
          <span className="text-sm font-medium">{item.name}</span>
        </div>
      </CardContent>
    </Card>
  ))}
</div>
```

### Pattern 5: shadcn/ui Component Migration
**What:** Replace inline Tailwind-styled elements with shadcn/ui components.
**When to use:** Every dashboard page during migration.
**Migration map:**
| Current Pattern | shadcn/ui Replacement |
|----------------|----------------------|
| `<button className="rounded-lg bg-[hsl(var(--primary))]...">` | `<Button>` |
| `<div className="rounded-xl border...p-8">` | `<Card><CardContent>` |
| `<div className="fixed inset-0...bg-black/50">` | `<Dialog>` |
| `<input className="w-full rounded-lg border...">` | `<Input>` |
| `<table className="w-full text-sm">` | `<Table><TableHeader><TableRow>` |
| Role badges (RoleBadge.tsx) | `<Badge variant="...">` |
| Loading spinners | `<Skeleton>` |
| Alert messages | `<Alert>` or toast via `sonner` |

### Anti-Patterns to Avoid
- **Mixing inline Tailwind with shadcn/ui:** After migration, do not write raw button/input/card styles. Always use the shadcn/ui component.
- **Modal state management duplication:** Use shadcn/ui Dialog's built-in open/onOpenChange instead of managing showModal state manually.
- **Hardcoded HSL values:** Use shadcn/ui's semantic color tokens (bg-primary, text-muted-foreground) instead of `bg-[hsl(var(--primary))]`.
- **Server component with client state:** Don't try to add useState to the dashboard layout. Extract client-interactive parts into child client components.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom alert banners | sonner (via shadcn/ui) | Animation, stacking, auto-dismiss, promise integration |
| Modal dialogs | Custom overlay + portal | shadcn/ui Dialog (Radix) | Focus trapping, escape handling, scroll locking, accessibility |
| Loading states | Custom spinner components | shadcn/ui Skeleton | Consistent shimmer animation, layout-matching placeholders |
| Responsive tables | Custom CSS media queries per page | Shared responsive Table + Card pattern | Consistency across 9 pages, reduces duplication |
| Form validation display | Custom error rendering | shadcn/ui form pattern with Label | Accessible error associations, consistent styling |
| Mobile navigation | Custom drawer from scratch | shadcn/ui Sheet component | Slide animation, overlay, focus management built-in |

**Key insight:** The current codebase has 9 dashboard pages each with their own button, input, modal, and table implementations using raw Tailwind. Migrating to shadcn/ui components eliminates ~200+ lines of duplicated styling per page and ensures visual consistency automatically.

## Common Pitfalls

### Pitfall 1: shadcn/ui CLI Version Mismatch with Tailwind v3
**What goes wrong:** Running `pnpm dlx shadcn@latest init` on a Tailwind CSS v3 project generates v4-style CSS imports (`@import "tailwindcss"`) that break the build.
**Why it happens:** As of 2025, shadcn/ui defaults to Tailwind v4. The project explicitly excludes Tailwind v4 migration.
**How to avoid:** Pin to `shadcn@2.3.0` for all CLI commands. This version generates Tailwind v3 compatible output with `tailwindcss-animate` plugin instead of `tw-animate-css`.
**Warning signs:** CSS import errors mentioning `@import "tailwindcss"` or `shadcn/tailwind.css`, or missing `tailwind.config` plugin entries.

### Pitfall 2: Server Component vs Client Component Boundary
**What goes wrong:** The dashboard layout.tsx is a server component (uses `auth()`, `cookies()`, server-side translations). Adding mobile drawer state (useState) requires client component, causing build errors.
**Why it happens:** Next.js App Router enforces strict server/client boundaries.
**How to avoid:** Keep layout.tsx as server component for auth. Extract sidebar into a `DashboardSidebar` client component that receives navigation items, session data, and translation strings as props.
**Warning signs:** "useState can only be used in Client Components" build error in layout.tsx.

### Pitfall 3: Onboarding Redirect Loop
**What goes wrong:** Middleware redirects unauthenticated users to /login, but onboarding redirect sends new users to /onboarding. If the onboarding check runs before auth check, logged-out users could get stuck.
**Why it happens:** Multiple redirect conditions in middleware without proper ordering.
**How to avoid:** Middleware order: (1) check if public page -- pass through, (2) check auth token -- redirect to /login if missing, (3) check onboarding status -- redirect to /onboarding if incomplete. The /onboarding route itself must be in the protected list (requires auth) but exempt from onboarding redirect.
**Warning signs:** Infinite redirect loop (302 cycles), or unauthenticated users seeing the onboarding page.

### Pitfall 4: Onboarding Status Check Performance
**What goes wrong:** Middleware needs to check onboardingComplete for every protected route. If this requires a database query on every request, it adds latency.
**Why it happens:** User record fields aren't available in the JWT/session token by default.
**How to avoid:** Include `onboardingComplete` in the NextAuth.js session callback so it's available in the JWT token. This avoids per-request API calls. Update the session when onboarding completes.
**Warning signs:** Slow page loads on every dashboard navigation, visible API call to check onboarding status.

### Pitfall 5: Translation Key Drift Between Languages
**What goes wrong:** Adding new i18n keys to EN but forgetting NL/FR/DE, causing runtime fallback or missing text.
**Why it happens:** Manual management of 4 JSON files with 667+ keys each.
**How to avoid:** Add all new keys to all 4 locale files in the same task. Use a simple script to verify all files have identical key sets. The current files are perfectly balanced (667 keys each).
**Warning signs:** `next-intl` warnings about missing keys in console, untranslated strings showing English text or key names.

### Pitfall 6: Stripe Price API Requires Server-Side Key
**What goes wrong:** D-04 requires real pricing from Stripe. Client-side code cannot call Stripe API (requires secret key).
**Why it happens:** Stripe secret key must never be exposed to the browser.
**How to avoid:** Add a new API endpoint (GET /api/v1/stripe/plans) that fetches prices from Stripe and returns formatted data. The landing page calls this endpoint. Cache the response for 1 hour to avoid hitting Stripe rate limits.
**Warning signs:** Hardcoded prices on landing page, Stripe key exposed in client bundle.

### Pitfall 7: CSS Variable Naming Conflicts
**What goes wrong:** shadcn/ui init overwrites the existing globals.css HSL variable definitions, breaking current styling.
**Why it happens:** shadcn/ui generates its own CSS variable block during init.
**How to avoid:** The project's existing CSS variables (--background, --foreground, --muted, --primary, etc.) already match shadcn/ui's naming convention. During init, carefully merge -- keep existing values (brand-tuned) but add any missing variables shadcn/ui needs (--accent, --popover, --card, --secondary, --input, --ring, --chart-*). The HSL format already matches.
**Warning signs:** Colors change unexpectedly after shadcn/ui init, dark mode breaks.

## Code Examples

### shadcn/ui Initialization for Tailwind v3
```bash
# From apps/web directory
pnpm dlx shadcn@2.3.0 init

# When prompted:
# Style: Default
# Base color: Blue (matches brand)
# CSS variables: Yes (already using them)
# CSS file: app/globals.css
# Tailwind config: tailwind.config.ts
# Components alias: @/components
# Utils alias: @/lib/utils
# React Server Components: Yes
```

### cn() Utility (apps/web/lib/utils.ts)
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Toaster Setup (apps/web/app/layout.tsx)
```typescript
import { Toaster } from "@/components/ui/sonner";

export default async function RootLayout({ children }) {
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster position="bottom-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### Toast Usage in Dashboard Pages
```typescript
import { toast } from "sonner";

// After successful save
toast.success(t("propertySaved"));

// After delete
toast.success(t("propertyDeleted"));

// On error
toast.error(t("saveFailed"));

// With promise (loading -> success/error)
toast.promise(fetch(`${apiUrl}/api/v1/properties`, { method: "POST", ... }), {
  loading: t("saving"),
  success: t("propertySaved"),
  error: t("saveFailed"),
});
```

### Database Schema Addition
```typescript
// packages/db/src/schema/users.ts
import { boolean } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  // ... existing columns ...
  onboardingStep: int("onboarding_step").default(1),
  onboardingComplete: boolean("onboarding_complete").default(false),
});
```

### Onboarding Middleware Extension
```typescript
// apps/web/middleware.ts
export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Public pages pass through
  if (pathname === "/" || isPublicPage(pathname)) {
    return NextResponse.next();
  }

  // 2. Auth check
  const token = await getToken({ req, ... });
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Onboarding check (skip if already on /onboarding)
  if (!token.onboardingComplete && pathname !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  return NextResponse.next();
}
```

### Stripe Plans Endpoint (new)
```typescript
// apps/api/src/routes/stripe.ts - add GET /plans
stripeRouter.get("/plans", async (c) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    // Return fallback static prices when Stripe is not configured
    return c.json({ plans: [
      { id: "starter", name: "Starter", price: 400, currency: "eur", interval: "month" },
      { id: "standard", name: "Standard", price: 1000, currency: "eur", interval: "month" },
      { id: "professional", name: "Professional", price: 1900, currency: "eur", interval: "month" },
    ]});
  }

  const priceIds = [
    process.env.STRIPE_PRICE_STARTER,
    process.env.STRIPE_PRICE_STANDARD,
    process.env.STRIPE_PRICE_PROFESSIONAL,
  ].filter(Boolean);

  const prices = await Promise.all(
    priceIds.map(id => stripe.prices.retrieve(id!, { expand: ["product"] }))
  );

  return c.json({ plans: prices.map(p => ({
    id: (p.product as Stripe.Product).metadata?.plan || p.id,
    name: (p.product as Stripe.Product).name,
    price: p.unit_amount,
    currency: p.currency,
    interval: p.recurring?.interval,
  }))});
});
```

### Mobile Sheet/Drawer for Dashboard
```typescript
// Using shadcn/ui Sheet component for mobile nav
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

function MobileNav({ items, session }) {
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-3 border-b bg-background px-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          {/* Same sidebar content as desktop */}
        </SheetContent>
      </Sheet>
      <Image src="/rentular.png" alt="Rentular" width={28} height={28} />
      <span className="font-semibold">Rentular</span>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| shadcn/ui toast component | sonner (via shadcn/ui) | March 2025 | Must use sonner, not @shadcn/ui toast |
| tailwindcss-animate plugin | tw-animate-css (Tailwind v4) | 2025 | For v3 projects, still use tailwindcss-animate |
| shadcn@latest (Tailwind v4) | shadcn@2.3.0 (Tailwind v3) | 2025 | Critical: pin CLI version for v3 compatibility |
| Raw CSS variables in components | shadcn/ui semantic tokens | Ongoing | Use bg-primary not bg-[hsl(var(--primary))] |

**Deprecated/outdated:**
- shadcn/ui built-in Toast component: deprecated in favor of sonner
- tailwindcss-animate: deprecated for Tailwind v4 projects (but still needed for v3)

## Open Questions

1. **Stripe Plans API -- caching strategy**
   - What we know: D-04 requires real Stripe pricing. A new API endpoint is needed.
   - What's unclear: How frequently Stripe prices change. Cache TTL needs to balance freshness vs API usage.
   - Recommendation: 1-hour server-side cache with fallback static prices when Stripe is unconfigured.

2. **Onboarding for Smovin importers -- data counting**
   - What we know: D-13 says imported data should show summaries ("5 properties imported").
   - What's unclear: Whether counting should happen at wizard load or be pre-computed during import.
   - Recommendation: Count at wizard load via existing API endpoints (GET /properties, GET /tenants, etc.). The counts will be small and the queries are already optimized.

3. **Marketing page hero visual**
   - What we know: Claude's discretion per context. Rentila uses an image carousel.
   - What's unclear: Whether a dashboard screenshot or abstract visual better fits the brand.
   - Recommendation: Use a stylized dashboard screenshot/mockup showing the properties list. This demonstrates the product directly and is simpler than a carousel.

4. **shadcn/ui Sheet vs custom drawer for mobile nav**
   - What we know: D-09 specifies hamburger + slide-out drawer + dimmed overlay.
   - What's unclear: Whether shadcn/ui Sheet component fully matches the spec.
   - Recommendation: Use shadcn/ui Sheet component -- it provides slide-out from left, dimmed overlay, click-outside-to-close, and X button. This matches D-09 exactly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | Yes | 20.x | -- |
| pnpm | Package management | Yes | 9.x | -- |
| Tailwind CSS | Styling | Yes | 3.4.19 | -- |
| MySQL | Database (onboarding schema) | Assumed | -- | -- |

**Missing dependencies with no fallback:**
- None

**Missing dependencies with fallback:**
- None (all external dependencies already present)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected (no test config in project) |
| Config file | None -- Wave 0 must establish |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Logo size increase in dashboard | manual-only | Visual inspection | N/A |
| UI-02 | Landing page branding alignment | manual-only | Visual inspection | N/A |
| UI-03 | Mobile responsive dashboard with drawer | manual-only | Browser resize / mobile view | N/A |
| UI-04 | Landing page refresh | manual-only | Visual inspection | N/A |
| UI-05 | Consistent styling across pages | manual-only | Visual inspection | N/A |
| ONB-01 | Wizard shown after first login | smoke | Manual: create user, login, verify redirect | N/A |
| ONB-02 | Wizard 4 steps create real data | smoke | Manual: complete wizard, verify data in DB | N/A |
| ONB-03 | Wizard resume after leaving | smoke | Manual: leave midway, return, verify step | N/A |
| I18N-01 | All screens translated in 4 languages | unit | `node -e "compare all 4 JSON key sets"` | Can create |

**Justification for manual-only:** This phase is primarily UI visual polish. Automated visual regression testing would require Playwright or Cypress with screenshot comparison, which is not in the current stack. The most practical validation approach is manual visual inspection and functional smoke testing.

### Sampling Rate
- **Per task commit:** Manual visual check of affected pages
- **Per wave merge:** Full walkthrough of all 9 dashboard pages + landing + onboarding on desktop and mobile
- **Phase gate:** Complete manual QA checklist covering all 9 requirements

### Wave 0 Gaps
- [ ] i18n key comparison script (simple node script comparing JSON key sets across 4 locales)
- No test framework setup needed -- this phase is UI-focused with manual validation

## Inventory of Pages Requiring Migration

| Page | Lines | Has Tables | Has Modals | Has Forms | Priority |
|------|-------|-----------|------------|-----------|----------|
| properties | 374 | Yes (property list) | Yes (add/edit) | Yes | HIGH |
| tenants | 405 | Yes (tenant list) | Yes (add/edit) | Yes | HIGH |
| leases | 545 | Yes (lease list) | Yes (add/edit) | Yes | HIGH |
| payments | 605 | Yes (payment list) | Yes (add manual) | Yes | HIGH |
| communications | 370 | Yes (comm log) | No | No | MEDIUM |
| indexation | 328 | Yes (index list) | Yes (preview) | Yes | MEDIUM |
| maintenance | 646 | Yes (maint list) | Yes (add/edit) | Yes | MEDIUM |
| settings | 1401 | Yes (templates) | Yes (multiple) | Yes (many) | HIGH |
| import | 587 | No | No | Yes (credentials) | LOW |

**Total dashboard migration scope:** ~5,261 lines across 9 pages.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: Direct reading of all relevant source files (page.tsx, layout.tsx, middleware.ts, users.ts, tailwind.config.ts, globals.css, package.json, messages/*.json)
- shadcn/ui official docs (ui.shadcn.com) -- installation, components, Tailwind v3/v4 differences
- shadcn/ui v3 legacy docs (v3.shadcn.com) -- Tailwind v3 specific installation

### Secondary (MEDIUM confidence)
- Rentila.com visual analysis -- layout patterns for marketing page reference
- npm registry -- verified package versions (shadcn@2.3.0, sonner@2.0.7, tailwindcss-animate@1.0.7, class-variance-authority@0.7.1)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- shadcn/ui compatibility with existing HSL variables and Tailwind v3 verified through docs and codebase analysis
- Architecture: HIGH -- patterns derived directly from codebase reading (server/client component boundaries, middleware logic, i18n setup)
- Pitfalls: HIGH -- pitfalls identified from actual codebase constraints (server component layout, CSS variable naming, middleware ordering)
- Migration scope: HIGH -- every page line count verified, component patterns catalogued

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable -- shadcn/ui v3 is mature, project stack is frozen)
