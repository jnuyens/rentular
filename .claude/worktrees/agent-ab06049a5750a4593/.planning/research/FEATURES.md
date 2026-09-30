# Feature Research

**Domain:** Belgian rental property management platform
**Researched:** 2026-03-22
**Confidence:** HIGH (Belgian market specifics verified against Statbel, regional housing codes, competitor product pages)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. Grouped by functional area.

#### Payment Processing & Collection

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SEPA direct debit collection (GoCardless) | Core value proposition. Smovin's bank-connection auto-matching sets the bar. Landlords need automated rent collection, not just tracking. | HIGH | GoCardless mandate setup exists; payment creation, retry, cancel endpoints are stub-only. Must complete the full lifecycle: create payment on due date, handle success/failure/chargebacks, persist webhook state. |
| Manual payment recording | Not all tenants use direct debit. Bank transfer and cash payments are common. Smovin supports manual + automatic side-by-side. | LOW | Schema supports `bank_transfer`, `cash`, `other` methods. UI and API endpoints need completing. |
| Payment status tracking | Landlords need a single view: who paid, who is late, what is pending. This is the first thing a landlord checks daily. | MEDIUM | Payments page exists but API endpoints for list/detail/filtering are incomplete. Need status filters, date range, lease grouping. |
| Structured communication (Belgian +++format+++) | Belgian bank transfers use structured communications (+++xxx/xxxx/xxxxx+++) for payment matching. Every Belgian landlord expects this. | LOW | Schema field exists on both leases and payments. Need auto-generation on lease creation and display in payment instructions. |
| Automated payment reminders (email) | Smovin sends reminders in one click. Rentila auto-generates reminders. Landlords expect escalating reminders: friendly, formal, final. | MEDIUM | BullMQ queue infrastructure exists. Email templates exist in settings. `paymentFollowUpSettings` schema is complete. Need to wire the payment check worker to actually send reminders based on settings. |
| Payment overview / reports | Landlords need monthly/yearly summaries for tax purposes and portfolio health monitoring. Smovin's dashboard shows payment rate, occupancy rate, and cash flow. | MEDIUM | `landlordReportWorker` exists but is a stub. Need: monthly payment summary per property, overdue summary, exportable format (at minimum CSV). |

#### Rent Indexation (Belgian-Specific, Critical)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Automatic rent indexation calculation | Belgian law allows annual rent indexation based on the health index. Smovin auto-calculates and notifies. This is THE Belgian-specific feature. Formula: `(base rent x new health index) / initial health index`. | HIGH | Schema is well-designed (healthIndexValues, indexationRecords). Indexation page exists in web app. Need: Statbel data ingestion (no REST API -- must download and parse Excel/TXT files), correct formula per region, EPC correction factors. |
| Regional indexation rules | Flanders, Wallonia, and Brussels have different rules. Flanders (post-2019 contracts): initial index = month before lease start. Brussels/Wallonia: month before signing date. EPC correction factors apply differently per region. | HIGH | Lease schema already has `region` field. Must implement per-region calculation logic. Flanders EPC D/E/F/G correction factors are not time-limited. Brussels E/F/G corrections apply to pre-Oct-2022 leases. |
| EPC-based indexation limits | Since Oct 2022, properties with poor EPC scores (D, E, F, G) have restricted indexation in Flanders and Brussels. Landlords who ignore this risk legal challenges. | MEDIUM | Property schema has `epcLabel` field. Need to apply correction factors: Flanders D = 50% correction, E+ = stronger correction. Brussels E/F/G uses correction factor formula depending on anniversary date. |
| Indexation notification to tenant | After calculating, landlords must notify tenants of the new rent. Smovin offers email, letter, or registered letter. | LOW | Communications schema supports `indexation_notification` type. Template system exists. Wire calculation result to notification send. |

#### Lease Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Lease CRUD with Belgian lease types | Residential short/long/lifetime, student, commercial -- these are the Belgian categories. Every competitor supports them. | LOW | Already exists and works. Schema is complete. |
| Co-tenant support | Belgian leases commonly have multiple tenants (couples, roommates). Solidarity clauses are standard. | LOW | `leaseTenants` join table exists with `isPrimary` flag. UI needs to support adding multiple tenants to a lease. |
| Lease key dates and reminders | Lease end dates, renewal deadlines, notice periods -- landlords need reminders before key dates. Smovin surfaces these as automated tasks. | MEDIUM | Lease schema has start/end dates. Need a task/reminder system that alerts before lease expiry, renewal windows, and notice period deadlines. |
| Deposit tracking | Belgian law requires deposits in blocked accounts. Maximum varies by region (Flanders: 3 months, Brussels/Wallonia: 2 months). Landlords must track deposit IBAN. | LOW | Schema has `deposit` amount and `depositAccount` IBAN fields. Need UI to display and validate deposit amounts against regional maximums (informational, not blocking). |

#### Webhook & Event Processing

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| GoCardless webhook persistence | Payments created via GoCardless change state asynchronously. Without persisting webhook events, the system has no source of truth for payment status. | HIGH | Webhook handler exists and processes events but does NOT persist state changes to the payments table. This is the single most critical gap -- without it, the payment system is non-functional for GoCardless users. |
| Idempotent webhook processing | GoCardless can deliver webhooks multiple times. Processing the same event twice could create duplicate records or incorrect state transitions. | MEDIUM | No idempotency tracking exists. Need a `webhook_events` table to store event IDs and skip already-processed events. |
| Mandate lifecycle tracking | Mandates can be active, cancelled, failed, or expired. Landlords need to know if a tenant's mandate is still valid before creating payments. | MEDIUM | `gocardlessMandateId` exists on leases. Need to persist mandate status from webhooks and surface it in the UI (e.g., warning badge if mandate is cancelled). |

#### Security & Infrastructure

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CSRF protection | State-changing endpoints without CSRF protection are a security vulnerability. Any production financial application needs this. | LOW | Not implemented. Hono framework supports CSRF middleware. Must add to all POST/PUT/DELETE routes. |
| GDPR compliance basics | Belgian law (Law of 30 July 2018) plus GDPR. Tenant data must be collected minimally, stored securely, with consent. Privacy policy exists but no data export/deletion capability. | MEDIUM | Privacy/terms pages exist. Need at minimum: consent acknowledgment, data retention awareness. Full data export/deletion can be v1.x. |
| Proper error handling (no in-memory fallbacks) | In-memory fallbacks mask database failures instead of failing fast. In production, silent data loss is worse than a visible error. | LOW | PROJECT.md flags this explicitly. Remove all in-memory store fallbacks, ensure database errors propagate properly. |

#### User Experience

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Guided onboarding wizard | First-time landlord needs to: add property, add tenant, create lease, set up payment method. Without guidance, the multi-step setup is confusing. Smovin has a clear step-by-step flow. | MEDIUM | No onboarding exists. Build a step-by-step wizard: property -> tenant -> lease -> payment method (GoCardless mandate or bank transfer). Show progress indicator. |
| Responsive mobile design | Landlords check payments on their phones. Smovin has dedicated iOS and Android apps. At minimum, the web dashboard must be usable on mobile. | MEDIUM | Dashboard layout exists with sidebar. Need responsive breakpoints, collapsible sidebar, mobile-optimized tables. |
| Multi-language (4 languages) | Belgium has 3 official languages (NL, FR, DE) plus English for expats. Smovin supports NL, FR, EN. | LOW | Already implemented with next-intl (EN, NL, FR, DE). Existing translations need completion for all new features added. |

### Differentiators (Competitive Advantage)

Features that set Rentular apart from Smovin and Rentila. Aligned with the core value: affordable, automated rent collection.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **SEPA direct debit as first-class citizen** | Smovin connects to bank accounts for passive payment detection. Rentular actively collects rent via GoCardless SEPA direct debit -- the landlord does not wait for the tenant to pay, they pull the money. This is a fundamentally different (better) model. | Already partially built | GoCardless integration exists. Complete the payment creation flow and this becomes the key differentiator. Market as "set it and forget it" rent collection. |
| **Per-contract pricing** | Smovin charges per unit (EUR 4-8/unit/month). Rentular charges per lease/contract. A building with 10 units but 5 vacant only costs for 5 active leases. More aligned with landlord's actual revenue. | LOW | Stripe subscription with per-contract pricing is already configured. Advantage: landlords pay less during vacancies. |
| **Smovin data import** | First users are likely switching from Smovin. Reducing migration friction is a huge competitive advantage. No competitor offers import from other competitors. | HIGH | Not built. Requires scraping Smovin's web interface with user-provided credentials. Import properties, tenants, leases, payment history. Legal: user is accessing their own data (GDPR right of data portability). |
| **Property manager RBAC** | Professional property managers handle multiple owners' portfolios. Multi-user access with role-based permissions (owner, co-owner, manager, accountant, viewer) is a differentiator for the professional segment. | MEDIUM | Schema is complete and well-designed with 5 roles. Need: invitation flow (email invite, accept link), role-based UI filtering, permission middleware on API routes. |
| **German language support** | Neither Smovin nor Rentila supports German. Belgium's German-speaking community (Ostbelgien, ~77,000 people) plus German-speaking expats are underserved. | LOW | Already implemented. DE translations exist. Ensure all new features include DE translations. |
| **Belgian charges settlement (provision accounting)** | Belgian leases often use "provisions" for charges (monthly advances adjusted annually). Smovin handles charge reconciliation. Landlords managing apartments with common costs need year-end settlement calculations. | HIGH | Schema supports `chargesType: fixed|provision`. No settlement logic exists. For launch: track provisions. Post-launch: year-end reconciliation calculator. |

### Anti-Features (Deliberately NOT Building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **PDF lease contract generation** | Landlords sometimes ask for contract templates. | Belgian lease contracts have strict legal requirements that vary by region and lease type. Getting it wrong creates legal liability. The regulatory surface area is enormous. Smovin does not generate contracts either. | Track lease metadata only. Landlords use notary templates or official regional templates. Link to official sources in the help section. |
| **Native mobile apps** | Smovin has iOS and Android apps. Users expect native apps. | Building and maintaining native apps triples the development surface. PWA or responsive web covers 90% of mobile use cases. | Build a fully responsive web app first. Consider PWA (add-to-home-screen) for the "app" feel. Native apps are a post-PMF investment. |
| **Integrated accounting / bookkeeping** | Smovin integrates with Exact Online, BOB50, Winbooks, Odoo. Landlords want one tool for everything. | Accounting integration is complex (chart of accounts varies, VAT handling, regional rules). Building accounting features is scope that competitors spent years on. | Export payment data as CSV/Excel for import into accounting tools. Sufficient for launch. |
| **Open banking / automatic bank matching** | Smovin's bank connection auto-detects payments. Landlords love the automation. | Requires PSD2 open banking integration (Tink/Plaid), which adds significant cost, complexity, and regulatory burden. The value is partially replicated by SEPA direct debit (you already know the payment because you initiated it). | For GoCardless users: payments are tracked automatically via webhooks. For bank transfer users: manual payment recording with structured communication for easy identification. |
| **Tenant portal / tenant login** | Some platforms let tenants log in to see their lease, payments, documents. | Adds a second user type with its own auth, permissions, and UI. Significant scope increase. Belgian tenants do not expect a portal -- they expect an email or letter. | Communicate with tenants via email/SMS. Provide payment information in those communications. |
| **Real-time chat / messaging** | Modern SaaS products have chat. | Property management is document-based (emails, letters, registered letters), not chat-based. Chat adds real-time infrastructure complexity without solving the actual communication needs. | Email and SMS communication with templates. Communication log for audit trail. |
| **Enforced legal compliance** | Block landlords from doing illegal things (e.g., charge too much deposit, skip lease registration). | Creates legal liability. If the system enforces rules and gets one wrong, Rentular is responsible. Belgian rental law varies by region and changes frequently. | Informational reminders only. Show warnings like "Deposit exceeds regional maximum" but do not block actions. Landlord remains responsible for compliance. |
| **CSV bulk import** | Large landlords want to import all data at once from spreadsheets. | CSV parsing is error-prone (encoding, date formats, missing fields). Support burden is high. First users likely come from Smovin, not spreadsheets. | Smovin import covers the main migration path. Manual entry works for 1-10 properties. |
| **Multi-currency support** | International SaaS often supports multiple currencies. | Belgian market is EUR-only. Adding currency support adds complexity to every financial calculation, display, and report for zero benefit. | Hardcode EUR everywhere. |
| **Advanced charts and analytics dashboards** | Smovin shows occupancy rates, rental yield, cash flow charts. | Charting libraries add bundle size and maintenance burden. Simple tables with filters deliver the same information. | Simple table views with status indicators and filters. Export data for landlords who want to make their own charts. Add visual dashboards post-launch when user demand is clear. |

## Feature Dependencies

```
[GoCardless Webhook Persistence]
    |
    +--requires--> [Idempotency Tracking]
    |
    +--enables--> [Payment Status Tracking]
    |                  |
    |                  +--enables--> [Automated Payment Reminders]
    |                  |                  |
    |                  |                  +--enables--> [Payment Reports]
    |                  |
    |                  +--enables--> [Manual Payment Recording]
    |
    +--enables--> [Mandate Lifecycle Tracking]

[Statbel Health Index Data Ingestion]
    |
    +--enables--> [Automatic Indexation Calculation]
    |                  |
    |                  +--requires--> [Regional Indexation Rules]
    |                  |                  |
    |                  |                  +--requires--> [EPC Correction Factors]
    |                  |
    |                  +--enables--> [Indexation Notification to Tenant]

[CSRF Protection] --independent-- (no dependencies, do early)

[Property Manager RBAC]
    |
    +--requires--> [Email Invitation Flow]
    |
    +--requires--> [Permission Middleware on API Routes]
    |
    +--requires--> [Role-filtered Dashboard Views]

[Guided Onboarding Wizard]
    |
    +--requires--> [Property CRUD] (exists)
    |
    +--requires--> [Tenant CRUD] (exists)
    |
    +--requires--> [Lease CRUD] (exists)
    |
    +--requires--> [GoCardless Mandate Setup] (exists)

[Smovin Import]
    |
    +--requires--> [Property CRUD] (exists)
    +--requires--> [Tenant CRUD] (exists)
    +--requires--> [Lease CRUD] (exists)
    +--independent from payment processing (import historical data only)
```

### Dependency Notes

- **Webhook persistence must come first:** Everything payment-related depends on the system correctly tracking GoCardless payment states. Without webhooks persisting to the database, payments are a black hole.
- **Health index data must be loaded before indexation works:** No REST API exists from Statbel. Must download and parse their Excel/TXT files. Consider a scheduled job to fetch monthly updates.
- **CSRF is independent:** Can be added at any time without affecting other features. Do it early to avoid security debt.
- **Onboarding wizard requires all CRUD to work:** But all CRUD already exists. The wizard is a UX layer on top of existing functionality.
- **Smovin import is independent of payment processing:** Import only brings in historical data (properties, tenants, leases). Does not need active payment features to work.
- **RBAC requires invitation flow first:** A property manager can only access the system after being invited and accepting. Permissions middleware must be added to all existing API routes, which is a cross-cutting concern.
- **Email delivery must work before reminders and notifications:** BullMQ workers exist but need actual SMTP send logic and template rendering completed.

## MVP Definition

### Launch With (v1)

Minimum viable product for first paying customers. Ordered by dependency.

- [ ] **GoCardless webhook persistence + idempotency** -- Without this, SEPA collection does not work. The product has no core value.
- [ ] **Payment CRUD (list, detail, manual recording, trigger collection, retry, cancel)** -- Landlords must see payment status and record non-GoCardless payments.
- [ ] **Automated payment reminders (email)** -- Late payments are the #1 pain point. Automated escalation (friendly -> formal -> final) is what landlords pay for.
- [ ] **Rent indexation with Statbel health index** -- Belgian-specific killer feature. Must handle regional rules and EPC correction factors correctly.
- [ ] **Indexation notifications** -- After calculating, landlords must notify tenants. Template-based email.
- [ ] **CSRF protection** -- Non-negotiable for a financial application handling real money.
- [ ] **Security hardening (remove in-memory fallbacks, sanitize errors, fix type safety)** -- Production readiness baseline.
- [ ] **Guided onboarding wizard** -- First-time user experience determines conversion. Without it, landlords bounce.
- [ ] **Basic payment reports (monthly summary, CSV export)** -- Landlords need data for tax declarations and portfolio health.
- [ ] **Responsive mobile design** -- Landlords check rent status on their phones.
- [ ] **Visual polish (logo sizing, branding alignment, page consistency)** -- Professional appearance builds trust for a financial product.

### Add After Validation (v1.x)

Features to add once core is working and first customers are onboarded.

- [ ] **Smovin data import** -- Add when first Smovin-switching customers appear. High effort, high reward for acquisition.
- [ ] **Property manager RBAC** -- Add when professional property managers express interest. Schema is ready; needs invitation flow and permission middleware.
- [ ] **SMS payment reminders** -- Add when landlords report email reminders being ignored. Infrastructure exists (BullMQ + SMS provider abstraction).
- [ ] **Charges provision settlement** -- Add when landlords with apartment buildings request year-end reconciliation.
- [ ] **Lease key date reminders** -- Add when landlords complain about missing renewal deadlines.
- [ ] **GDPR data export/deletion** -- Legally required upon request. Build when first tenant or landlord requests data access.
- [ ] **Lease registration reminder** -- Informational reminder after lease creation that registration is required within 2 months.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Open banking payment matching (Tink/Plaid)** -- Only after GoCardless direct debit proves the model. Expensive integration.
- [ ] **Accounting tool integration (Exact Online, BOB50)** -- Only after CSV export proves insufficient for power users.
- [ ] **Native mobile apps** -- Only after responsive web proves insufficient and user base justifies the investment.
- [ ] **Tenant portal** -- Only if landlords report tenant demand for self-service access.
- [ ] **PDF lease contract generation** -- Only with legal review. Too much liability risk for early stage.
- [ ] **Holosign.co digital signatures** -- Depends on their API launch. Future milestone.
- [ ] **VAT management for commercial leases** -- Smovin handles VAT invoicing. Only add if commercial lease users request it.
- [ ] **Dashboard analytics (charts, yield calculation, occupancy rates)** -- Only after table-based views prove insufficient.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| GoCardless webhook persistence + idempotency | HIGH | MEDIUM | P1 |
| Payment CRUD (list, detail, trigger, manual, retry, cancel) | HIGH | MEDIUM | P1 |
| Automated payment reminders (email) | HIGH | MEDIUM | P1 |
| Rent indexation (Statbel + regional rules + EPC) | HIGH | HIGH | P1 |
| CSRF protection | HIGH | LOW | P1 |
| Security hardening | HIGH | LOW | P1 |
| Guided onboarding wizard | HIGH | MEDIUM | P1 |
| Basic payment reports + CSV export | MEDIUM | MEDIUM | P1 |
| Responsive mobile design | MEDIUM | MEDIUM | P1 |
| Indexation notification emails | MEDIUM | LOW | P1 |
| Visual polish | MEDIUM | LOW | P1 |
| Smovin data import | HIGH | HIGH | P2 |
| Property manager RBAC + invitations | MEDIUM | MEDIUM | P2 |
| SMS reminders | MEDIUM | LOW | P2 |
| Charges provision settlement | MEDIUM | HIGH | P2 |
| Lease key date reminders | MEDIUM | MEDIUM | P2 |
| GDPR data export/deletion | MEDIUM | MEDIUM | P2 |
| Open banking integration | HIGH | VERY HIGH | P3 |
| Accounting integrations | MEDIUM | HIGH | P3 |
| Native mobile apps | LOW | VERY HIGH | P3 |
| Tenant portal | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when demand validates
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Smovin | Rentila | Rentular (planned) |
|---------|--------|---------|-------------------|
| **Rent collection method** | Passive: bank connection detects incoming payments | Manual recording + bank import | Active: SEPA direct debit pulls money from tenant's account. Also supports manual recording. |
| **Payment reminders** | One-click email/letter/registered letter | Auto-generated reminders | Automated escalating reminders (friendly/formal/final) via email, SMS (v1.x) |
| **Rent indexation** | Auto-calculate + notify via email/letter/registered letter | Not Belgian-specific | Auto-calculate with regional rules + EPC correction factors + email notification |
| **Bank connection** | Open banking (auto-detect payments) | Bank import (manual trigger) | GoCardless (active collection). Open banking deferred to v2. |
| **Property types** | Residential, commercial, office, professional | General residential | Residential (short/long/lifetime), student, commercial |
| **Charges/provisions** | Full provision settlement with year-end reconciliation | Basic charge tracking | Track provisions. Settlement calculator in v1.x |
| **Accounting integration** | Exact Online, BOB50, Winbooks, Odoo, Horus | Basic export | CSV/Excel export. Integrations in v2. |
| **Multi-user/roles** | Team access for asset managers | Limited collaboration | Full RBAC: owner, co-owner, manager, accountant, viewer |
| **Document management** | Rent receipts, invoices, notices, charge settlement docs | Receipts, lease templates | Communication log (emails, SMS). Document generation in v1.x. |
| **VAT management** | VAT invoicing for commercial leases | Not mentioned | Not for launch. Add if commercial lease users request it. |
| **Mobile** | iOS + Android native apps | iOS + Android apps | Responsive web (PWA in v1.x) |
| **Languages** | NL, FR, EN | Multi-language | NL, FR, DE, EN (German is a differentiator for Ostbelgien) |
| **Pricing** | Free (2 units), EUR 4-8/unit/month | Free (1 property), EUR 9.90/month unlimited | Per-contract pricing (cheaper for small portfolios with vacancies) |
| **Data import** | None from competitors | None | Smovin import (v1.x differentiator) |
| **Maintenance** | Maintenance reminders + repair tracking | Basic task management | Basic auto-generated reminders (exists). Full tracking deferred. |
| **Dashboard/analytics** | Occupancy rate, payment rate, cash flow, rental yield | Basic overview | Payment summary, overdue tracking. Full analytics in v1.x. |
| **Task management** | Auto-generated task lists (reminders, indexations, terminations) | Basic tasks | Partially covered by automated reminders and indexation notifications. Full task system deferred. |

## Belgian Market-Specific Notes

### Statbel Health Index Data Access
- **No REST API exists.** Statbel publishes data as Excel (XLSX) and TXT (ZIP) downloads only.
- Open data page: `statbel.fgov.be/en/open-data/consumer-price-index-and-health-index`
- Strategy: Download and parse monthly. Store in `healthIndexValues` table. Run a scheduled job to check for new data.
- The rent calculator at `rentcalculator.economie.fgov.be` can be used for result verification but is not a data API.
- European open data portal also hosts the dataset: `data.europa.eu/data/datasets/2d799e04338f86f4dd29b43f5a13f41ee9c2899e`

### Regional Indexation Complexity
- **Flanders (post-2019 contracts):** Initial index = health index of month before lease START date.
- **Flanders (pre-2019 contracts):** Initial index = health index of month before lease SIGNING date.
- **Brussels and Wallonia:** Initial index = health index of month before lease SIGNING date (always).
- **EPC correction factors (Flanders):** D label = 50% correction, E/F/G = stronger correction. Not time-limited.
- **EPC correction factors (Brussels):** E/F/G affected. Correction formula depends on anniversary date period (Jan-Oct 13 vs Oct 14-Dec). Only for pre-Oct-2022 leases.
- **Wallonia:** Had temporary restrictions that have ended. Standard formula applies.

### Lease Registration Reminder
- Belgian law requires lease registration within 2 months of signing (landlord obligation).
- Good candidate for an informational reminder after lease creation (not a launch blocker, but easy to add).

### Deposit Validation
- Flanders: max 3 months' rent.
- Brussels and Wallonia: max 2 months' rent.
- Must be placed in a blocked bank account within 30 days.
- Show informational warnings if deposit exceeds regional maximum (do not block).

### Belgian Tax Reporting Context
- Rental income for private use: taxed on cadastral income (indexed + 40%), not actual rent received.
- Rental income for professional use: taxed on actual rent minus costs.
- Implication: Payment reports should export actual rent received (useful for professional-use tenants) and a summary of payment dates (useful for all tax reporting scenarios).

## Sources

- [Smovin features and pricing (Software Finder)](https://softwarefinder.com/property-management-software/smovin) -- MEDIUM confidence
- [Smovin pricing page](https://www.smovin.app/en-be/pricing/) -- HIGH confidence (official)
- [Smovin how it works](https://www.smovin.app/en-be/how-it-works/) -- HIGH confidence (official)
- [Smovin property management software](https://www.smovin.app/en-be/property-management-software/) -- HIGH confidence (official)
- [Smovin vs Rentila comparison](https://moyasync.fr/blog/comparatif-logiciels-gestion-locative-2025) -- MEDIUM confidence
- [Rentila features (Appvizer)](https://www.appvizer.com/construction/real-estate-mgt/rentila) -- MEDIUM confidence
- [Statbel Health Index](https://statbel.fgov.be/en/themes/consumer-prices/health-index) -- HIGH confidence (official Belgian government)
- [Statbel Open Data](https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index) -- HIGH confidence (official)
- [Brussels rent indexation with correction factor](https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor) -- HIGH confidence (official Brussels-Capital Region)
- [Belgian rental guarantees by region](https://rental-guarantee.be/) -- MEDIUM confidence
- [Belgian landlord obligations](https://en.ubex.be/publications/obligations-proprietaire-locataire-belgique) -- MEDIUM confidence
- [Belgian EPC indexation rules (Titeca)](https://www.titeca.be/en/news-item/rent-indexation-check-your-epc-label/) -- MEDIUM confidence
- [Flanders and Brussels EPC indexation (Lexgo)](https://www.lexgo.be/en/news-and-articles/13065-housing-rent-indexation-in-flanders-and-brussels) -- MEDIUM confidence
- [Belgian rental income taxation (Keytrade Bank)](https://www.keytradebank.be/en/our-blog/how-is-rental-income-taxed-in-belgium) -- MEDIUM confidence
- [Belgian rental charges explained](https://garantie.be/en/rental-lease-costs-belgium/) -- MEDIUM confidence
- [GDPR in property management](https://www.verto-hv.de/en/blog/gdpr-property-management-practice-2025) -- MEDIUM confidence

---
*Feature research for: Belgian rental property management platform*
*Researched: 2026-03-22*
