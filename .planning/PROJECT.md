# Rentular

## What This Is

A Belgian rental property management platform for landlords and property managers. Rentular handles property listings, tenant management, lease tracking (residential and commercial), automated rent collection via SEPA direct debit (GoCardless), payment follow-up with email and SMS reminders, Belgian rent indexation, and payment reporting. It competes on price against existing Belgian tools like Smovin and Rentila.

## Core Value

Landlords can automatically collect rent via SEPA direct debit and track all their properties in one affordable, multilingual platform.

## Requirements

### Validated

- ✓ User authentication with email/password and OAuth (Google, Facebook, Twitter) — existing
- ✓ Property CRUD with address, heating type, and details — existing
- ✓ Tenant CRUD with contact information — existing
- ✓ Lease creation and tracking (linking tenants to properties) — existing
- ✓ Bank account management with IBAN validation and Belgian bank lookup — existing
- ✓ Multi-language support (EN, NL, FR, DE) with next-intl — existing
- ✓ GoCardless integration for SEPA mandate setup and customer creation — existing
- ✓ Stripe integration for Rentular subscription billing — existing
- ✓ BullMQ email and SMS queue infrastructure — existing
- ✓ Landing page with marketing content and pricing — existing
- ✓ Dashboard layout with sidebar navigation — existing
- ✓ Settings page with notification template customization — existing
- ✓ Privacy policy and terms of service pages — existing
- ✓ IBAN validation with Belgian bank lookup — existing
- ✓ CSRF protection on all state-changing endpoints — Phase 1
- ✓ Type-safe database imports (zero `any` casts) — Phase 1
- ✓ In-memory store fallbacks removed (fail fast on DB errors) — Phase 1
- ✓ All TODO stubs implemented or relabeled with phase markers — Phase 1
- ✓ Database indexes for common query patterns — Phase 1
- ✓ Cost tracking, rent adjustment, and communication logging endpoints functional — Phase 1
- ✓ Residential + commercial lease types supported in schema — Phase 1
- ✓ Maintenance task auto-generation with DB persistence — Phase 1
- ✓ Health check endpoint (DB + Redis) — Phase 1
- ✓ Payment CRUD: list, detail, record, collect, retry, cancel, overdue summary — Phase 2
- ✓ GoCardless webhook persistence with idempotent event processing — Phase 2
- ✓ Mandate lifecycle cascade (cancel pending payments + flag lease on mandate failure) — Phase 2
- ✓ Bank account monitoring via GoCardless BAD / Open Banking PSD2 — Phase 2
- ✓ Transaction matching by Belgian structured communication — Phase 2
- ✓ Payment overview report with period/property/lease filtering — Phase 2
- ✓ Payment state machine enforcing valid status transitions — Phase 2
- ✓ Webhook event cleanup (12-month retention) — Phase 2
- ✓ PSD2 consent expiry monitoring with renewal + notification fallback — Phase 2
- ✓ Belgian health index integration (Statbel beSTAT API with daily BullMQ refresh) — Phase 3
- ✓ Rent indexation calculation with regional formulas (Brussels/Flanders/Wallonia EPC restrictions) — Phase 3
- ✓ Indexation preview, apply, and tenant notification in 4 languages with legal references — Phase 3

### Active

**Payment Follow-Up (remaining from Payments)**
- [ ] Payment follow-up logic: late fees, grace periods, automated escalation — *worker logic exists, notification delivery in Phase 4*

**Property Managers**
- [ ] Full property manager role: invite via email, accept invitation, manage assigned properties
- [ ] Role-based access control (owner vs manager permissions)
- [ ] Property manager dashboard view (see assigned properties only)

**Rent Indexation** — *Validated in Phase 3*

**Notifications**
- [ ] Email delivery with domain-specific SMTP configuration
- [ ] SMS delivery via configured provider (Twilio/MessageBird/OVH)
- [ ] Automated payment reminders (configurable per language, per reminder level)
- [ ] Email queue rate limiting enforcement

**Reports**
- [ ] Monthly/yearly payment overview for landlords
- [ ] Payment status summary (collected, overdue, fees)

**Smovin Import** — *Validated in Phase 6 (beta, human verification pending)*

**Onboarding**
- [ ] Guided setup wizard: add property -> add tenant -> create lease -> set up payment collection

**Layout & Visual Polish**
- [ ] Bigger logo top-left across dashboard and marketing pages
- [ ] Better aligned watermark/branding on landing page
- [ ] Full responsive design (mobile-friendly dashboard)
- [ ] Visual consistency and polish across all pages

**Maintenance**
- [ ] Basic auto-generated maintenance reminders based on property/lease type — *route logic exists (Phase 1), needs end-to-end testing*

### Out of Scope

- PDF lease contract generation — track only for now; contracts handled externally
- Holosign.co integration — depends on their API launch; future milestone
- Native Android app — responsive web first; native app is a future consideration
- CSV bulk import — manual entry sufficient for launch; consider post-launch
- Google address book integration — possible future enhancement for contact import
- Advanced maintenance tracking — only basic reminders at launch
- Enforced legal compliance — informational reminders only, no blocking rules
- Real-time chat or messaging — not part of property management core

## Context

- **Existing codebase:** Monorepo (Turborepo) with Next.js 15 frontend, Hono API, Drizzle ORM, MySQL
- **Current state:** Phases 1-6 complete — backend hardened, full payment processing with SEPA Direct Debit + bank monitoring, Belgian rent indexation, notifications & payment follow-up, property manager roles, and Smovin import (beta). UI polish, onboarding & launch readiness is next (Phase 7).
- **Competitive landscape:** Smovin, Rentila are established Belgian alternatives. Rentular differentiates on price.
- **Target market:** Belgian landlords (1-10 properties) and professional property managers
- **Infrastructure:** Proxmox on Hetzner, Docker deployment. SMTP available on server but needs domain configuration.
- **Pricing model:** Per-contract (per lease), configured via Stripe subscription plans

## Constraints

- **Tech stack**: Existing stack must be preserved — Next.js 15, Hono, Drizzle ORM, MySQL, GoCardless, Stripe
- **Language**: All UI must be available in EN, NL, FR, DE
- **Market**: Belgian rental law context (health index, SEPA, residential + commercial leases)
- **Timeline**: ASAP — launch as soon as everything works
- **Payments**: GoCardless for rent collection (SEPA direct debit), Stripe for Rentular subscription billing only
- **Hosting**: Must run on Proxmox/Hetzner VPS with Docker

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GoCardless only for rent collection | SEPA direct debit is standard for Belgian rent; card payments add complexity | — Pending |
| Per-contract pricing model | Aligns cost with value delivered; scales with portfolio size | — Pending |
| Track leases only (no PDF generation) | Reduces scope; contracts handled externally for now | — Pending |
| Informational compliance only | Avoid legal liability; remind but don't block | — Pending |
| Smovin import as launch feature | First users are likely Smovin users switching; reduces migration friction | — Pending |
| In-app Smovin import (not CLI tool) | Better UX; users can self-serve migration | — Pending |
| Residential + commercial leases | Both lease types common in Belgian market | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after Phase 6 completion*
