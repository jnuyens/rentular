# Requirements: Rentular

**Defined:** 2026-03-22
**Core Value:** Landlords can automatically collect rent via SEPA direct debit and track all their properties in one affordable, multilingual platform.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Payments

- [ ] **PAY-01**: Landlord can view list of all payments with status (paid, overdue, processing, failed, cancelled)
- [ ] **PAY-02**: Landlord can view payment details including GoCardless reference, charge date, and method
- [ ] **PAY-03**: Landlord can record a manual payment (cash, bank transfer) for a lease
- [ ] **PAY-04**: Landlord can trigger SEPA direct debit collection for a specific lease via GoCardless
- [ ] **PAY-05**: Landlord can retry a failed GoCardless payment
- [ ] **PAY-06**: Landlord can cancel a pending GoCardless payment
- [ ] **PAY-07**: GoCardless webhook events persist payment status changes to database (confirmed, failed, charged back, cancelled)
- [ ] **PAY-08**: GoCardless webhook events persist mandate status changes (active, failed, expired, cancelled)
- [ ] **PAY-09**: Webhook processing is idempotent (duplicate events are safely skipped)
- [ ] **PAY-10**: Landlord can view monthly/yearly payment overview report (collected, overdue, fees summary)

### Rent Indexation

- [ ] **IDX-01**: System fetches Belgian health index data from Statbel beSTAT API and caches in database
- [ ] **IDX-02**: System calculates indexed rent using correct regional formula (Brussels, Flanders, Wallonia)
- [ ] **IDX-03**: System applies EPC correction factors for Brussels (E/F/G permanent penalty) and Flanders (correction factor)
- [ ] **IDX-04**: Landlord can preview indexed rent calculation before applying
- [ ] **IDX-05**: Landlord can choose to apply a lower-than-indexed rent amount
- [ ] **IDX-06**: Landlord can customize the indexation notification message to tenant
- [ ] **IDX-07**: Applying indexation updates the lease rent and creates an indexation history record
- [ ] **IDX-08**: System sends indexation notification email to tenant in their preferred language

### Notifications

- [ ] **NTF-01**: System sends automated friendly payment reminder email when rent is overdue
- [ ] **NTF-02**: System sends formal payment reminder email after configurable grace period
- [ ] **NTF-03**: System sends final payment reminder email before escalation
- [ ] **NTF-04**: System sends SMS payment reminders at each reminder level
- [ ] **NTF-05**: Landlord can customize email/SMS templates per language (EN, NL, FR, DE) and per reminder level
- [ ] **NTF-06**: System logs all sent communications (email, SMS) with delivery status
- [ ] **NTF-07**: Email delivery works with domain-specific SMTP configuration

### Property Managers

- [ ] **PM-01**: Owner can invite a property manager by email with a specified role (co_owner, manager, accountant, viewer)
- [ ] **PM-02**: Invited property manager receives email invitation and can accept/decline
- [ ] **PM-03**: Property manager sees only their assigned properties in the dashboard
- [ ] **PM-04**: Property manager permissions are enforced on all property-scoped API endpoints
- [ ] **PM-05**: Owner can revoke a property manager's access
- [ ] **PM-06**: Owner can change a property manager's role

### Security

- [x] **SEC-01**: All state-changing API endpoints have CSRF protection via Hono middleware
- [x] **SEC-02**: Database imports use proper TypeScript types (no `any` typing)

### Smovin Import (Beta)

- [ ] **IMP-01**: User can enter Smovin credentials in Rentular import settings
- [ ] **IMP-02**: System scrapes properties, tenants, leases, and payment history from user's own Smovin account
- [ ] **IMP-03**: Scraped data is mapped to Rentular's data model and imported
- [ ] **IMP-04**: User sees import progress and results (counts, errors)
- [ ] **IMP-05**: Credentials are used once for import and never persisted

### Onboarding

- [ ] **ONB-01**: New user sees a guided setup wizard after first login
- [ ] **ONB-02**: Wizard walks through: add property -> add tenant -> create lease -> set up payment collection
- [ ] **ONB-03**: Wizard tracks completion and can be resumed

### UI & Layout

- [ ] **UI-01**: Dashboard has bigger logo in top-left position
- [ ] **UI-02**: Landing page has properly aligned watermark/branding
- [ ] **UI-03**: Dashboard is responsive and usable on mobile devices (collapsible sidebar)
- [ ] **UI-04**: Landing page is refreshed with better layout and visual consistency
- [ ] **UI-05**: All pages have consistent visual styling and spacing

### Infrastructure

- [ ] **INF-01**: All remaining TODO stubs in API routes are implemented or explicitly removed
- [ ] **INF-02**: Cost tracking endpoints are functional
- [ ] **INF-03**: Rent adjustment endpoints are functional
- [ ] **INF-04**: Communication logging endpoints are functional
- [ ] **INF-05**: Database indexes exist for common query patterns (payments by lease+status, properties by owner)

### Leases

- [ ] **LSE-01**: System supports both residential and commercial lease types
- [ ] **LSE-02**: Basic auto-generated maintenance reminders based on property/lease type

### Internationalization

- [ ] **I18N-01**: All new UI screens and features are translated in EN, NL, FR, DE
- [ ] **I18N-02**: Notification templates support all four languages

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Contracts

- **CTR-01**: Landlord can generate lease contract suggestions/templates
- **CTR-02**: Integration with Holosign.co for automated signing (pending their API launch)

### Import

- **IMP-06**: CSV/Excel bulk import for properties, tenants, and leases
- **IMP-07**: Google address book integration for contact import

### Mobile

- **MOB-01**: Native Android app for property management on the go

### Maintenance

- **MNT-01**: Full maintenance request tracking with cost and scheduling
- **MNT-02**: Tenant-facing maintenance request submission

### Reports

- **RPT-01**: Property P&L reports
- **RPT-02**: Tax-ready export for Belgian tax declaration

### Compliance

- **CMP-01**: Enforced legal compliance checks (deposit rules, indexation limits)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| PDF lease contract generation | Track only for now; contracts handled externally |
| Real-time chat / messaging | Not core to property management |
| Enforced legal compliance | Informational only; avoid legal liability |
| Card payments for rent (Stripe) | GoCardless SEPA only for rent collection; Stripe for subscriptions |
| Tailwind CSS v4 migration | Major breaking changes, no launch benefit |
| Native mobile app | Responsive web first; native later |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1: Security & Infrastructure Foundation | Complete |
| SEC-02 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-01 | Phase 1: Security & Infrastructure Foundation | Pending |
| INF-02 | Phase 1: Security & Infrastructure Foundation | Pending |
| INF-03 | Phase 1: Security & Infrastructure Foundation | Pending |
| INF-04 | Phase 1: Security & Infrastructure Foundation | Pending |
| INF-05 | Phase 1: Security & Infrastructure Foundation | Pending |
| LSE-01 | Phase 1: Security & Infrastructure Foundation | Pending |
| LSE-02 | Phase 1: Security & Infrastructure Foundation | Pending |
| PAY-01 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-02 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-03 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-04 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-05 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-06 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-07 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-08 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-09 | Phase 2: Payment Processing & Webhooks | Pending |
| PAY-10 | Phase 2: Payment Processing & Webhooks | Pending |
| IDX-01 | Phase 3: Rent Indexation | Pending |
| IDX-02 | Phase 3: Rent Indexation | Pending |
| IDX-03 | Phase 3: Rent Indexation | Pending |
| IDX-04 | Phase 3: Rent Indexation | Pending |
| IDX-05 | Phase 3: Rent Indexation | Pending |
| IDX-06 | Phase 3: Rent Indexation | Pending |
| IDX-07 | Phase 3: Rent Indexation | Pending |
| IDX-08 | Phase 3: Rent Indexation | Pending |
| NTF-01 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-02 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-03 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-04 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-05 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-06 | Phase 4: Notifications & Payment Follow-Up | Pending |
| NTF-07 | Phase 4: Notifications & Payment Follow-Up | Pending |
| I18N-02 | Phase 4: Notifications & Payment Follow-Up | Pending |
| PM-01 | Phase 5: Property Manager Roles | Pending |
| PM-02 | Phase 5: Property Manager Roles | Pending |
| PM-03 | Phase 5: Property Manager Roles | Pending |
| PM-04 | Phase 5: Property Manager Roles | Pending |
| PM-05 | Phase 5: Property Manager Roles | Pending |
| PM-06 | Phase 5: Property Manager Roles | Pending |
| IMP-01 | Phase 6: Smovin Import (Beta) | Pending |
| IMP-02 | Phase 6: Smovin Import (Beta) | Pending |
| IMP-03 | Phase 6: Smovin Import (Beta) | Pending |
| IMP-04 | Phase 6: Smovin Import (Beta) | Pending |
| IMP-05 | Phase 6: Smovin Import (Beta) | Pending |
| UI-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| UI-02 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| UI-03 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| UI-04 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| UI-05 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| ONB-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| ONB-02 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| ONB-03 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |
| I18N-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Pending |

**Coverage:**
- v1 requirements: 55 total
- Mapped to phases: 55
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
