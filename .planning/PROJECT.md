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

### Active

**Payments & Webhooks (Critical)**
- [ ] Payment endpoints: list, details, record manual payment, trigger collection, retry, cancel
- [ ] GoCardless webhook handlers: persist payment status, mandate changes, payout events to database
- [ ] Payment follow-up logic: late fees, grace periods, automated escalation
- [ ] Idempotency tracking for webhook processing

**Property Managers**
- [ ] Full property manager role: invite via email, accept invitation, manage assigned properties
- [ ] Role-based access control (owner vs manager permissions)
- [ ] Property manager dashboard view (see assigned properties only)

**Rent Indexation**
- [ ] Belgian health index integration (Statbel API)
- [ ] Automatic rent indexation calculations
- [ ] Indexation history and overdue tracking

**Notifications**
- [ ] Email delivery with domain-specific SMTP configuration
- [ ] SMS delivery via configured provider (Twilio/MessageBird/OVH)
- [ ] Automated payment reminders (configurable per language, per reminder level)
- [ ] Email queue rate limiting enforcement

**Reports**
- [ ] Monthly/yearly payment overview for landlords
- [ ] Payment status summary (collected, overdue, fees)

**Smovin Import**
- [ ] In-app import flow: user enters Smovin credentials
- [ ] Scrape properties, tenants/contacts, lease data, payment history from user's own Smovin account
- [ ] Map Smovin data to Rentular data model and import

**Onboarding**
- [ ] Guided setup wizard: add property -> add tenant -> create lease -> set up payment collection

**Layout & Visual Polish**
- [ ] Bigger logo top-left across dashboard and marketing pages
- [ ] Better aligned watermark/branding on landing page
- [ ] Full responsive design (mobile-friendly dashboard)
- [ ] Visual consistency and polish across all pages

**Security Hardening**
- [ ] CSRF protection on all state-changing endpoints
- [ ] Remove in-memory store fallbacks (fail fast on database errors)
- [ ] Proper error logging with secret sanitization
- [ ] Fix type-safety violations (remove `any` typing on database imports)

**Maintenance**
- [ ] Basic auto-generated maintenance reminders based on property/lease type

**Infrastructure**
- [ ] Complete all remaining TODO stubs across API routes
- [ ] Database indexing for common query patterns (payments by lease+status, properties by owner)
- [ ] Cost tracking endpoints
- [ ] Rent adjustment endpoints
- [ ] Communication logging endpoints

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
- **Current state:** Core CRUD works (properties, tenants, leases, bank accounts). Payment processing and 70+ TODO stubs across API routes need completion. Webhooks receive events but don't persist state.
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
*Last updated: 2026-03-22 after initialization*
