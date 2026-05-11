# Requirements: Rentular

**Defined:** 2026-03-22
**Core Value:** Landlords can automatically collect rent via SEPA direct debit and track all their properties in one affordable, multilingual platform.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Payments

- [x] **PAY-01**: Landlord can view list of all payments with status (paid, overdue, processing, failed, cancelled)
- [x] **PAY-02**: Landlord can view payment details including GoCardless reference, charge date, and method
- [x] **PAY-03**: Landlord can record a manual payment (cash, bank transfer) for a lease
- [x] **PAY-04**: Landlord can trigger SEPA direct debit collection for a specific lease via GoCardless
- [x] **PAY-05**: Landlord can retry a failed GoCardless payment
- [x] **PAY-06**: Landlord can cancel a pending GoCardless payment
- [x] **PAY-07**: GoCardless webhook events persist payment status changes to database (confirmed, failed, charged back, cancelled)
- [x] **PAY-08**: GoCardless webhook events persist mandate status changes (active, failed, expired, cancelled)
- [x] **PAY-09**: Webhook processing is idempotent (duplicate events are safely skipped)
- [x] **PAY-10**: Landlord can view monthly/yearly payment overview report (collected, overdue, fees summary)

### Rent Indexation

- [x] **IDX-01**: System fetches Belgian health index data from Statbel beSTAT API and caches in database
- [x] **IDX-02**: System calculates indexed rent using correct regional formula (Brussels, Flanders, Wallonia)
- [x] **IDX-03**: System applies EPC correction factors for Brussels (E/F/G permanent penalty) and Flanders (correction factor)
- [x] **IDX-04**: Landlord can preview indexed rent calculation before applying
- [x] **IDX-05**: Landlord can choose to apply a lower-than-indexed rent amount
- [x] **IDX-06**: Landlord can customize the indexation notification message to tenant
- [x] **IDX-07**: Applying indexation updates the lease rent and creates an indexation history record
- [x] **IDX-08**: System sends indexation notification email to tenant in their preferred language

### Notifications

- [x] **NTF-01**: System sends automated friendly payment reminder email when rent is overdue
- [x] **NTF-02**: System sends formal payment reminder email after configurable grace period
- [x] **NTF-03**: System sends final payment reminder email before escalation
- [x] **NTF-04**: System sends SMS payment reminders at each reminder level
- [x] **NTF-05**: Landlord can customize email/SMS templates per language (EN, NL, FR, DE) and per reminder level
- [x] **NTF-06**: System logs all sent communications (email, SMS) with delivery status
- [x] **NTF-07**: Email delivery works with domain-specific SMTP configuration

### Property Managers

- [x] **PM-01**: Owner can invite a property manager by email with a specified role (co_owner, manager, accountant, viewer)
- [x] **PM-02**: Invited property manager receives email invitation and can accept/decline
- [x] **PM-03**: Property manager sees only their assigned properties in the dashboard
- [x] **PM-04**: Property manager permissions are enforced on all property-scoped API endpoints
- [x] **PM-05**: Owner can revoke a property manager's access
- [x] **PM-06**: Owner can change a property manager's role

### Security

- [x] **SEC-01**: All state-changing API endpoints have CSRF protection via Hono middleware
- [x] **SEC-02**: Database imports use proper TypeScript types (no `any` typing)

### Smovin Import (Beta)

- [x] **IMP-01**: User can enter Smovin credentials in Rentular import settings
- [x] **IMP-02**: System scrapes properties, tenants, leases, and payment history from user's own Smovin account
- [x] **IMP-03**: Scraped data is mapped to Rentular's data model and imported
- [x] **IMP-04**: User sees import progress and results (counts, errors)
- [x] **IMP-05**: Credentials are used once for import and never persisted

### Onboarding

- [x] **ONB-01**: New user sees a guided setup wizard after first login
- [x] **ONB-02**: Wizard walks through: add property -> add tenant -> create lease -> set up payment collection
- [x] **ONB-03**: Wizard tracks completion and can be resumed

### UI & Layout

- [x] **UI-01**: Dashboard has bigger logo in top-left position
- [x] **UI-02**: Landing page has properly aligned watermark/branding
- [x] **UI-03**: Dashboard is responsive and usable on mobile devices (collapsible sidebar)
- [x] **UI-04**: Landing page is refreshed with better layout and visual consistency
- [x] **UI-05**: All pages have consistent visual styling and spacing

### Infrastructure

- [x] **INF-01**: All remaining TODO stubs in API routes are implemented or explicitly removed
- [x] **INF-02**: Cost tracking endpoints are functional
- [x] **INF-03**: Rent adjustment endpoints are functional
- [x] **INF-04**: Communication logging endpoints are functional
- [x] **INF-05**: Database indexes exist for common query patterns (payments by lease+status, properties by owner)

### Leases

- [x] **LSE-01**: System supports both residential and commercial lease types
- [x] **LSE-02**: Basic auto-generated maintenance reminders based on property/lease type

### Internationalization

- [x] **I18N-01**: All new UI screens and features are translated in EN, NL, FR, DE
- [ ] **I18N-02**: Notification templates support all four languages

### PSD2 Bank Connection (Phase 9)

- [ ] **BANK-INFRA**: Vitest fixtures (Ponto sandbox JSON) + MSW dev-dep installed; per-task verification map populated
- [ ] **BANK-SCHEMA**: Drizzle migration adds encrypted-token + provider-metadata + country columns to bank_connections and creates bank_statements audit table with UNIQUE(connectionId, externalTransactionId), match_status enum, and PII-encryption triplets
- [ ] **BANK-PROVIDER**: PontoConnectProvider class implements BankAccountDataProvider; factory dispatches via BANK_DATA_PROVIDER env; GoCardless BAD remains as dormant reference
- [ ] **BANK-OAUTH**: signOAuthState / verifyOAuthState helpers using jose HS256 + AUTH_SECRET + 10-min TTL; HTTPS-only redirect URI registered with Ponto in production
- [ ] **BANK-ROUTES**: 8 Hono endpoints under /api/v1/bank-connections (POST /, GET /, GET /:id, GET /callback, GET /institutions, POST /:id/renew, DELETE /:id, POST /:id/sync) with auth + CSRF + zod validation + ownership scoping + token-column sanitization on responses
- [ ] **BANK-UI-LIST**: /dashboard/bank-connections list page with shadcn Card+Table responsive layout, empty state including €4/account/month Ibanity disclosure + ToS link + Connect CTA
- [ ] **BANK-UI-DETAIL**: /dashboard/bank-connections/[id] detail page with status badge, last synced, consent expiry countdown, Sync now / Renew consent / Revoke (AlertDialog confirmation) actions
- [ ] **BANK-UI-CALLBACK**: /dashboard/bank-connections/callback handles all error codes (access_denied, expired_state, missing_params, no_accounts, unknown) and ?connected=1 success
- [ ] **BANK-UI-NAV**: Sidebar entry between Payments and Mandates with Banknote icon; owner-only visibility via NAV_VISIBILITY
- [ ] **BANK-WORKER**: paymentCheckWorker Phase B delegates to syncBankConnection service; first-sync backfill window 90 days; Phase C consent-expiry warnings unchanged
- [ ] **BANK-MATCHER**: bankStatementImporter inserts encrypted rows BEFORE matcher; matcher results update bank_statements.matchedPaymentId + matchStatus + matchedAt
- [ ] **BANK-EMAIL**: Renewal warning emails (7-day and 1-day thresholds) use locale-aware templates from bankConnections.email.renewalWarning namespace in EN/NL/FR/DE
- [ ] **BANK-I18N**: Full bankConnections.* namespace coverage in all 4 locales with zero missing keys (enforced by extended i18n-completeness vitest)
- [ ] **BANK-TOS**: Terms of Service includes Bank Account Connections clause disclosing separate Ibanity agreement; Privacy Policy lists Ibanity SA/NV as third-party processor with purpose, lawful basis, retention, data categories
- [ ] **BANK-RETENTION**: BullMQ weekly cron (Sunday 03:00) hard-deletes bank_statements older than BANK_STATEMENTS_RETENTION_DAYS (default 2555 = 7 years per Belgian tax law)

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
| Manual statement upload (CAMT.053 / CODA / CSV / MT940) | Deferred from Phase 9 in favor of full Ponto integration; revisit only if Ponto onboarding friction is high |
| Multi-account picker on Ponto callback | v1 takes accounts[0]; multi-account picker is a v1.5 enhancement |
| Rentular-as-AISP (own PSD2 license) | NBB + eIDAS QWAC multi-month regulatory project; far out of v1 scope |
| Ponto Partner-Paying model | Customer-Paying chosen to keep Rentular's variable cost at €0 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1: Security & Infrastructure Foundation | Complete |
| SEC-02 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-01 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-02 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-03 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-04 | Phase 1: Security & Infrastructure Foundation | Complete |
| INF-05 | Phase 1: Security & Infrastructure Foundation | Complete |
| LSE-01 | Phase 1: Security & Infrastructure Foundation | Complete |
| LSE-02 | Phase 1: Security & Infrastructure Foundation | Complete |
| PAY-01 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-02 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-03 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-04 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-05 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-06 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-07 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-08 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-09 | Phase 2: Payment Processing & Webhooks | Complete |
| PAY-10 | Phase 2: Payment Processing & Webhooks | Complete |
| IDX-01 | Phase 3: Rent Indexation | Complete |
| IDX-02 | Phase 3: Rent Indexation | Complete |
| IDX-03 | Phase 3: Rent Indexation | Complete |
| IDX-04 | Phase 3: Rent Indexation | Complete |
| IDX-05 | Phase 3: Rent Indexation | Complete |
| IDX-06 | Phase 3: Rent Indexation | Complete |
| IDX-07 | Phase 3: Rent Indexation | Complete |
| IDX-08 | Phase 3: Rent Indexation | Complete |
| NTF-01 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-02 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-03 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-04 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-05 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-06 | Phase 4: Notifications & Payment Follow-Up | Complete |
| NTF-07 | Phase 4: Notifications & Payment Follow-Up | Complete |
| I18N-02 | Phase 4: Notifications & Payment Follow-Up | Pending |
| PM-01 | Phase 5: Property Manager Roles | Complete |
| PM-02 | Phase 5: Property Manager Roles | Complete |
| PM-03 | Phase 5: Property Manager Roles | Complete |
| PM-04 | Phase 5: Property Manager Roles | Complete |
| PM-05 | Phase 5: Property Manager Roles | Complete |
| PM-06 | Phase 5: Property Manager Roles | Complete |
| IMP-01 | Phase 6: Smovin Import (Beta) | Complete |
| IMP-02 | Phase 6: Smovin Import (Beta) | Complete |
| IMP-03 | Phase 6: Smovin Import (Beta) | Complete |
| IMP-04 | Phase 6: Smovin Import (Beta) | Complete |
| IMP-05 | Phase 6: Smovin Import (Beta) | Complete |
| UI-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| UI-02 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| UI-03 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| UI-04 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| UI-05 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| ONB-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| ONB-02 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| ONB-03 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| I18N-01 | Phase 7: UI Polish, Onboarding & Launch Readiness | Complete |
| BANK-INFRA | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-SCHEMA | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-PROVIDER | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-OAUTH | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-ROUTES | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-UI-LIST | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-UI-DETAIL | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-UI-CALLBACK | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-UI-NAV | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-WORKER | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-MATCHER | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-EMAIL | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-I18N | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-TOS | Phase 9: PSD2 Bank Connection Flow | Pending |
| BANK-RETENTION | Phase 9: PSD2 Bank Connection Flow | Pending |

**Coverage:**
- v1 requirements: 70 total (55 v1 launch features + 15 Phase 9 BANK-* additions)
- Mapped to phases: 70
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-05-12 after Phase 9 planning (added BANK-* requirement family)*
