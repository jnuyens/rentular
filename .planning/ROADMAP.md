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
- [ ] 06-01-PLAN.md -- Schema foundation, Playwright+stealth installation, spike test gate (D-02)
- [ ] 06-02-PLAN.md -- Import API routes and BullMQ discovery worker with Smovin scraper
- [ ] 06-03-PLAN.md -- Data mapper (Smovin-to-Rentular) and import write worker with duplicate detection
- [ ] 06-04-PLAN.md -- Frontend import page (6 view states), sidebar nav, i18n in 4 languages

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
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
Note: Phases 3 and 5 depend only on Phase 1 (not Phase 2), so they could theoretically be reordered, but the listed order prioritizes core value delivery (payments -> indexation -> notifications) before expansion features.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security & Infrastructure Foundation | 5/5 | Complete | - |
| 2. Payment Processing & Webhooks | 0/5 | Planning complete | - |
| 3. Rent Indexation | 0/2 | Planning complete | - |
| 4. Notifications & Payment Follow-Up | 0/3 | Planning complete | - |
| 5. Property Manager Roles | 0/4 | Planning complete | - |
| 6. Smovin Import (Beta) | 0/4 | Planning complete | - |
| 7. UI Polish, Onboarding & Launch Readiness | 0/? | Not started | - |
