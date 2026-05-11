# Roadmap: Rentular

## Overview

Rentular has a working foundation (auth, property/tenant/lease CRUD, bank accounts, GoCardless integration shell, BullMQ infrastructure) but is non-functional for its core value: automated rent collection. The critical blocker is that GoCardless webhooks acknowledge events without persisting state, silently losing all payment data. This roadmap prioritizes fixing that foundation (security, infrastructure, webhook persistence), then layers on the features that depend on it (notifications, indexation), then adds expansion features (property managers, Smovin import), and finishes with launch polish (UI, onboarding, translations).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security & Infrastructure Foundation** - CSRF protection, type safety, database indexes, TODO stub completion, and lease type support
- [ ] **Phase 2: Payment Processing & Webhooks** - Webhook persistence, idempotency, payment CRUD, GoCardless collection, and payment reporting
- [ ] **Phase 3: Rent Indexation** - Belgian health index integration, regional indexation calculations with EPC corrections, and indexation workflow
- [ ] **Phase 4: Notifications & Payment Follow-Up** - Email and SMS delivery, automated payment reminder escalation, communication logging, and template localization
- [ ] **Phase 5: Property Manager Roles** - Invitation flow, role-based access control, scoped dashboard views, and access management
- [ ] **Phase 6: Smovin Import (Beta)** - Authenticated scraping of Smovin accounts, data mapping, and guided import flow
- [ ] **Phase 7: UI Polish, Onboarding & Launch Readiness** - Responsive dashboard, visual consistency, guided setup wizard, and full i18n coverage
- [ ] **Phase 8: GoCardless Settings UI & SEPA Mandate Management** - GoCardless configuration tab, mandate management page, payment method on leases, onboarding integration
- [ ] **Phase 9: PSD2 Bank Connection Flow (Ponto Connect, Customer-Paying)** - Ponto Connect provider, OAuth flow, bank_statements audit table, Bank Connections dashboard, locale-aware renewal emails, TOS + Privacy disclosures, retention cron

## Phase Details

### Phase 1: Security & Infrastructure Foundation
**Goal**: The platform has a hardened, type-safe, and performant backend foundation that all subsequent features build on
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, INF-01, INF-02, INF-03, INF-04, INF-05, LSE-01, LSE-02
**Success Criteria** (what must be TRUE):
  1. All state-changing API endpoints reject requests without valid CSRF tokens
  2. Database imports throughout the codebase use typed Drizzle schema references with zero `any` casts
  3. All TODO stubs in API routes are either implemented with working logic or explicitly removed with a comment explaining why
  4. Cost tracking, rent adjustment, and communication logging endpoints return valid data when called
  5. Database queries for payments-by-lease, payments-by-status, and properties-by-owner use indexed columns (verified via EXPLAIN)
**Plans**: 5 plans

Plans:
- [x] 01-01-PLAN.md -- Schema foundation: maintenance table, heatingType column, database indexes
- [x] 01-02-PLAN.md -- CSRF middleware with webhook exclusion and enhanced health check
- [x] 01-03-PLAN.md -- Static typed imports for properties, tenants, bankAccounts, authMiddleware
- [x] 01-04-PLAN.md -- Wire costs, rentAdjustments, communications, settings to DB; relabel deferred TODOs
- [x] 01-05-PLAN.md -- Rewrite leases and maintenance to DB; delete memoryStore

### Phase 2: Payment Processing & Webhooks
**Goal**: Landlords can collect rent via SEPA direct debit and have complete visibility into payment status, with no data loss from GoCardless events
**Depends on**: Phase 1
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PAY-08, PAY-09, PAY-10
**Success Criteria** (what must be TRUE):
  1. Landlord can view a list of all payments for their properties, filtered by status (paid, overdue, processing, failed, cancelled)
  2. Landlord can trigger a SEPA direct debit collection for a lease and see the payment appear with "processing" status
  3. Landlord can record a manual cash/transfer payment and see it reflected in the payment list
  4. When GoCardless sends a webhook (payment confirmed, failed, charged back, mandate changed), the event is persisted to the database and the payment/mandate status updates automatically
  5. Sending the same GoCardless webhook event twice does not create duplicate records or change state incorrectly
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md -- Schema foundations (webhook_events, bank_connections) and payment state machine service
- [x] 02-02-PLAN.md -- Idempotent webhook persistence and GoCardless mandate/customer DB wiring
- [x] 02-03-PLAN.md -- Payment CRUD endpoints: list, detail, record, collect, retry, cancel
- [x] 02-04-PLAN.md -- Bank account monitoring interface, transaction matcher, and worker implementations
- [x] 02-05-PLAN.md -- Payment overview report endpoint and webhook event cleanup job

### Phase 3: Rent Indexation
**Goal**: Landlords can automatically calculate and apply Belgian rent indexation with correct regional formulas, giving them a key tool that justifies choosing Rentular
**Depends on**: Phase 1
**Requirements**: IDX-01, IDX-02, IDX-03, IDX-04, IDX-05, IDX-06, IDX-07, IDX-08
**Success Criteria** (what must be TRUE):
  1. System has cached Belgian health index data from Statbel and calculations use real index values (not hardcoded or zero)
  2. Landlord can preview an indexed rent calculation for a lease and see the correct formula applied for the property's region (Brussels, Flanders, or Wallonia) including EPC correction factors
  3. Landlord can apply the indexation (or a lower custom amount), which updates the lease rent amount and creates a history record
  4. Tenant receives an indexation notification email in their preferred language after the landlord applies the indexation
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- Statbel health index service and BullMQ daily refresh worker
- [x] 03-02-PLAN.md -- Wire indexation endpoints to DB, email notification with regional legal references

### Phase 4: Notifications & Payment Follow-Up
**Goal**: The system automatically reminds tenants about overdue payments through escalating email and SMS notifications, with full delivery tracking
**Depends on**: Phase 2
**Requirements**: NTF-01, NTF-02, NTF-03, NTF-04, NTF-05, NTF-06, NTF-07, I18N-02
**Success Criteria** (what must be TRUE):
  1. When a payment is overdue, the system automatically sends a friendly reminder email, then a formal reminder after the grace period, then a final warning before escalation
  2. SMS reminders are sent at each escalation level alongside email reminders
  3. Landlord can customize email and SMS templates per language (EN, NL, FR, DE) and per reminder level, and those templates are used for outgoing messages
  4. Every sent email and SMS is logged with delivery status, and the landlord can see the communication history
  5. Email delivery works through domain-specific SMTP configuration (not a shared/default sender)
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md -- SMTP settings schema, encryption library, and centralized communications logging in queueEmail/queueSms
- [x] 04-02-PLAN.md -- Per-landlord SMTP transport cache, SMTP settings API, and communications resend/send wiring
- [x] 04-03-PLAN.md -- Communications dashboard page, sidebar nav, Email Settings tab, SMS consent notice, i18n in 4 languages

### Phase 5: Property Manager Roles
**Goal**: Property owners can delegate management of their properties to other users with appropriate role-based permissions
**Depends on**: Phase 1
**Requirements**: PM-01, PM-02, PM-03, PM-04, PM-05, PM-06
**Success Criteria** (what must be TRUE):
  1. Owner can invite a property manager by email, specifying a role (co_owner, manager, accountant, viewer), and the invitee receives an email with accept/decline options
  2. An accepted property manager sees only their assigned properties in the dashboard, not the owner's full portfolio
  3. Property manager permissions are enforced on all API endpoints -- a viewer cannot modify data, a manager cannot change billing settings, etc.
  4. Owner can revoke access or change a property manager's role at any time, with immediate effect
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md -- Schema extension, propertyAccess middleware, owner auto-register, migration endpoint
- [x] 05-02-PLAN.md -- Invitation flow API (invite, accept, decline, list, update, remove) and properties userRole
- [x] 05-03-PLAN.md -- Route retrofit for all property-scoped API endpoints (9 route files)
- [x] 05-04-PLAN.md -- Frontend: managers page, invite modal, accept page, sidebar filtering, role badges, i18n

### Phase 6: Smovin Import (Beta)
**Goal**: Landlords migrating from Smovin can bring their existing data into Rentular without manual re-entry, reducing the biggest barrier to switching
**Depends on**: Phase 1
**Requirements**: IMP-01, IMP-02, IMP-03, IMP-04, IMP-05
**Success Criteria** (what must be TRUE):
  1. User can enter their Smovin credentials in Rentular and initiate an import
  2. The system scrapes properties, tenants, leases, and payment history from the user's Smovin account and imports them into Rentular
  3. User sees real-time import progress and a summary of what was imported (counts) and any errors encountered
  4. Smovin credentials are used only for the import session and are never stored in the database
**Plans**: 4 plans

Plans:
- [x] 06-01-PLAN.md -- Schema foundation, Playwright+stealth installation, spike test gate (D-02)
- [x] 06-02-PLAN.md -- Import API routes and BullMQ discovery worker with Smovin scraper
- [x] 06-03-PLAN.md -- Data mapper (Smovin-to-Rentular) and import write worker with duplicate detection
- [x] 06-04-PLAN.md -- Frontend import page (6 view states), sidebar nav, i18n in 4 languages

### Phase 7: UI Polish, Onboarding & Launch Readiness
**Goal**: The platform looks polished, works on mobile, guides new users to success, and every screen is fully translated -- ready for public launch
**Depends on**: Phases 2, 3, 4 (all features must exist before final polish and onboarding can reference them)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, ONB-01, ONB-02, ONB-03, I18N-01
**Success Criteria** (what must be TRUE):
  1. Dashboard displays a bigger logo top-left and the landing page has properly aligned branding/watermark
  2. Dashboard is fully usable on mobile devices with a collapsible sidebar that does not obscure content
  3. All pages across the application have consistent visual styling, spacing, and layout
  4. New users see a guided setup wizard after first login that walks them through adding a property, tenant, lease, and payment collection -- and can resume it if they leave partway
  5. Every UI screen and feature added in Phases 1-6 has complete translations in EN, NL, FR, and DE
**Plans**: 6 plans

Plans:
- [x] 07-01-PLAN.md -- shadcn/ui foundation: init, 18 components, cn() utility, CSS variables, Toaster, logo fix, DB onboarding columns
- [x] 07-02-PLAN.md -- Mobile responsive layout: hamburger drawer, sidebar extraction + properties/tenants/leases shadcn migration
- [x] 07-03-PLAN.md -- Landing page rewrite: auth routing, marketing page with hero/features/pricing/footer, Stripe plans endpoint
- [x] 07-04-PLAN.md -- Dashboard migration batch 2: payments, communications, indexation, maintenance to shadcn/ui
- [x] 07-05-PLAN.md -- Onboarding wizard: 4-step wizard, middleware redirect, session extension, import detection
- [ ] 07-06-PLAN.md -- Settings/import migration + comprehensive i18n audit across all 4 locales

### Phase 8: GoCardless Settings UI & SEPA Mandate Management
**Goal**: Landlords have a complete UI to configure GoCardless, manage SEPA mandates, and select payment methods on leases -- making the existing backend infrastructure (Phase 2) fully accessible through the dashboard
**Depends on**: Phase 7
**Requirements**: GC-SETTINGS, GC-SHARED-COMPONENTS, GC-MANDATES-PAGE, GC-LEASE-PAYMENT-METHOD, GC-LEASE-MANDATE-STATUS, GC-TENANT-MANDATE, GC-ONBOARDING, GC-I18N-AUDIT
**Success Criteria** (what must be TRUE):
  1. GoCardless settings tab shows connection status, creditor info, and default payment method selector
  2. Dedicated Mandates page lists all mandates with status filtering, search, and per-mandate actions (view, cancel)
  3. Lease creation/edit form has a payment method radio group (GoCardless/Bank Transfer/Manual) with conditional sub-content
  4. Lease detail shows mandate status badge and quick actions (Setup/Cancel Mandate)
  5. Mandate setup modal is accessible from lease detail, tenant profile, mandates page, and onboarding wizard step 4
  6. All strings translated in EN, NL, FR, DE
**Plans**: 4 plans

Plans:
- [x] 08-01-PLAN.md -- Shared components (MandateStatusBadge, MandateSetupModal, CancelMandateDialog, PaymentMethodRadioGroup), API extensions, GoCardless settings tab
- [x] 08-02-PLAN.md -- Mandates management page with table/card views, status filter, search, sidebar navigation
- [x] 08-03-PLAN.md -- Lease form payment method radio group, lease detail mandate status, tenant profile mandate display
- [x] 08-04-PLAN.md -- Onboarding wizard step 4 mandate integration and comprehensive i18n verification

### Phase 9: PSD2 Bank Connection Flow (Ponto Connect, Customer-Paying)
**Goal**: Landlords can link their Belgian bank account via Ponto Connect (Ibanity) under the Customer-Paying model so the existing polling worker auto-imports statements and matches incoming rent transfers, with PSD2-compliant 180-day consent renewal, encrypted token storage, locale-aware renewal emails, GDPR disclosures, and a 7-year retention policy aligned to Belgian tax law
**Depends on**: Phase 8
**Requirements**: BANK-INFRA, BANK-SCHEMA, BANK-PROVIDER, BANK-OAUTH, BANK-ROUTES, BANK-UI-LIST, BANK-UI-DETAIL, BANK-UI-CALLBACK, BANK-UI-NAV, BANK-WORKER, BANK-MATCHER, BANK-EMAIL, BANK-I18N, BANK-TOS, BANK-RETENTION
**Success Criteria** (what must be TRUE):
  1. Landlord can click "Connect bank account" from /dashboard/bank-connections, view the €4/account/month Ibanity cost disclosure + ToS notice, select a Belgian bank from the picker, and be redirected through Ponto's OAuth flow
  2. On successful OAuth callback the system stores AES-256-GCM-encrypted access + refresh tokens in `bank_connections`, sources `consentExpiresAt` from the provider response (not a hardcoded value), and shows the connection as Active in the dashboard
  3. The Phase 2 polling worker picks up the new active connection on its next cycle and persists every transaction to a new `bank_statements` audit table with encrypted counterparty PII before invoking the existing matcher
  4. Landlord can manually Sync now (rate-limited 1/min), Renew consent (signs a fresh state JWT and redirects to Ponto), and Revoke (calls Ponto revoke endpoint then soft-deletes — bank_statements retained for 7 years)
  5. Renewal warning emails sent at 7-day and 1-day pre-expiry thresholds use locale-aware subject and body strings (EN/NL/FR/DE) rather than hardcoded English
  6. Sidebar "Bank Connections" entry appears between Payments and Mandates for owner role only; hidden from co_owner/manager/accountant/viewer
  7. All UI strings translated in EN, NL, FR, DE with zero missing keys (enforced by extended i18n-completeness test)
  8. Terms of Service includes a Bank Account Connections clause and Privacy Policy lists Ibanity SA/NV as a third-party processor
  9. BullMQ weekly cron (Sunday 03:00) hard-deletes bank_statements older than `BANK_STATEMENTS_RETENTION_DAYS` (default 2555 = 7 years)
**Plans**: 5 plans

Plans:
- [x] 09-01-PLAN.md -- Schema additions (bank_connections encrypted-token columns + bank_statements table), Ponto test fixtures, MSW dev-dep, drizzle-kit push
- [x] 09-02-PLAN.md -- PontoConnectProvider class + pontoConnect.ts REST client + bankOAuthState.ts JWT helper + factory dispatch + .env.example
- [ ] 09-03-PLAN.md -- /api/v1/bank-connections Hono router (8 endpoints), bankStatementImporter, bankConnectionSync service, paymentCheckWorker Phase B refactor
- [ ] 09-04-PLAN.md -- Bank Connections dashboard UI (list, connect, detail, callback pages), sidebar nav, status badge, institution picker, Settings tab cross-link
- [ ] 09-05-PLAN.md -- i18n in 4 locales, locale-aware renewal emails, TOS + Privacy clauses, BANK_STATEMENTS_RETENTION_DAYS cron, full integration gates (lint + build + db:push + test + i18n audit)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
Note: Phases 3 and 5 depend only on Phase 1 (not Phase 2), so they could theoretically be reordered, but the listed order prioritizes core value delivery (payments -> indexation -> notifications) before expansion features.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security & Infrastructure Foundation | 5/5 | Complete | - |
| 2. Payment Processing & Webhooks | 0/5 | Planning complete | - |
| 3. Rent Indexation | 0/2 | Planning complete | - |
| 4. Notifications & Payment Follow-Up | 0/3 | Planning complete | - |
| 5. Property Manager Roles | 0/4 | Planning complete | - |
| 6. Smovin Import (Beta) | 0/4 | Planning complete | - |
| 7. UI Polish, Onboarding & Launch Readiness | 0/6 | Planning complete | - |
| 8. GoCardless Settings UI & SEPA Mandate Management | 0/4 | Planning complete | - |
| 9. PSD2 Bank Connection Flow (Ponto Connect, Customer-Paying) | 0/5 | Planning complete | - |
