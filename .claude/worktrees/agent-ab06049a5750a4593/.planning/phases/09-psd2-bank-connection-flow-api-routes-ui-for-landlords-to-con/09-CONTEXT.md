# Phase 09: PSD2 Bank Connection Flow (Ponto Connect, Customer-Paying) — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** Inline orchestrator capture during /gsd:plan-phase (user opted to skip /gsd:discuss-phase but answered targeted decisions during research review)

<domain>
## Phase Boundary

This phase delivers the end-to-end flow that lets a Belgian landlord link their bank account to Rentular so the existing polling worker (Phase 2) can auto-import statements and reconcile incoming rent transfers against expected payments.

**In scope:**
- A new `PontoConnectProvider` class implementing the existing `BankAccountDataProvider` interface from Phase 2.
- Customer-Paying onboarding flow: Rentular initiates Ponto registration → landlord signs up directly with Ibanity → OAuth tokens issued back to Rentular → polling worker activates.
- API routes for connection lifecycle (create, list, callback, renew, revoke, manual sync).
- Dedicated "Bank Connections" sidebar page in the dashboard (owner-only), positioned between Payments and Mandates.
- New `bank_statements` audit table for raw transaction lines (dedup safety net + unmatched-transaction inbox + audit trail).
- Additive schema migration on existing `bank_connections` table (encrypted token columns, provider metadata, consent_expires_at sourced from provider response not hardcoded).
- 180-day PSD2 consent renewal flow with pre-expiry warning emails (7/1 day thresholds, matching the GoCardless BAD pattern already established).
- i18n in EN, NL, FR, DE.

**Out of scope (deferred to future phases):**
- Manual statement upload (CAMT.053 / CODA / CSV / MT940) — not a v1 deliverable; revisit if Ponto onboarding friction proves too high.
- Multi-account-per-requisition picker — v1 takes `accounts[0]`; v1.5 adds picker.
- Ponto Partner-Paying model (Rentular absorbs cost) — Customer-Paying chosen specifically to keep Rentular's variable cost at €0.
- Becoming Rentular's own AISP (NBB licensing, eIDAS QWAC) — multi-month regulatory project, not for this milestone.
</domain>

<decisions>
## Implementation Decisions (locked)

### Provider
- **Selected provider:** Ponto Connect (Ibanity / Isabel Group). Belgian-domiciled, covers all 6 priority BE banks (Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan) plus Aion, Beobank, Keytrade, VDK.
- **Pricing model:** Customer-Paying. Up to €4/linked bank account/month, billed by Ibanity directly to the landlord. Rentular's variable cost: €0.
- **Why this instead of Partner-Paying:** User hard constraint of ≤€5/landlord/month rules out Rentular subsidising the connection. Customer-Paying shifts the cost to the user who values the convenience.
- **Why Ponto over Enable Banking / finAPI:** Ponto is Belgian-domiciled (Isabel Group), specifically markets the "Representative" model for real-estate/property-management SaaS, has ~100 SaaS integrators in production, and Customer-Paying mechanics are documented and verified by 3 independent sources (myponto.com, Odoo docs, Teamleader Focus). finAPI's self-serve pricing only pays back above ~200 active landlords. Enable Banking is fully sales-gated.
- **GoCardless BAD (existing Phase 2 provider):** Stays in the codebase as the abstraction reference but is NOT activated in production (Nordigen closed to new signups July 2025). The `GoCardlessBadProvider` class becomes a dormant reference implementation.

### Customer-Paying onboarding flow
- **Landlord-side steps:** (1) Rentular "Connect bank account" CTA → (2) redirect to Ponto self-service signup with Rentular's integration referrer → (3) landlord registers their own Ibanity organisation → (4) landlord links their bank via PSD2 redirect → (5) callback to Rentular with the new OAuth client credentials for that landlord's Ponto organisation → (6) Rentular stores encrypted tokens in `bank_connections` and the polling worker activates on its next cycle.
- **Rentular-side requirements:** Disclose in Terms of Service that the landlord is signing a separate contract with Ibanity; surface the €4/account/month price clearly in the connect-flow UI before the landlord proceeds; do not collect or store the landlord's Ponto credentials — only the issued OAuth tokens.
- **Single Ponto org per landlord:** v1 assumes one landlord = one Ponto organisation. Multi-org per landlord (e.g., landlord-as-person plus landlord-as-LLC) is deferred.

### UI placement
- **Dedicated top-level sidebar page:** `/dashboard/bank-connections`, positioned between Payments and Mandates.
- **Icon:** `Banknote` from lucide-react (distinct from `Landmark` used for IBAN-only bank accounts).
- **Visibility gate:** Owner-only — add `bankConnections: ["co_owner", "manager", "accountant", "viewer"]` to the existing `NAV_VISIBILITY` blocking map in `apps/web/app/(dashboard)/layout.tsx` (matches the Settings/Import pattern).
- **GoCardless settings tab cross-link:** Add a status widget in the existing GoCardless Settings tab linking out to the Bank Connections page (deferred to Phase 9, not a separate phase).

### Schema
- **New table `bank_statements`** (additive, no breaking change to existing data):
  - Columns: `id`, `connectionId` FK → `bank_connections`, `externalTransactionId` (provider id), `amount` (decimal), `currency`, `valueDate`, `executionDate`, `counterpartyName` (encrypted at rest), `counterpartyIban` (encrypted), `structuredCommunication` (digits-only normalized — matches existing matcher), `unstructuredCommunication` (free-text), `rawPayload` (JSON, encrypted), `matchedPaymentId` FK → `payments` (nullable), `matchStatus` enum (`unmatched`, `matched`, `mismatched-amount`, `ignored`), `importedAt`, `matchedAt`.
  - Indexes: `(connectionId, valueDate)`, `(connectionId, externalTransactionId)` UNIQUE, `(matchStatus)`.
- **Additive columns on `bank_connections`:**
  - `encryptedAccessToken` (text), `encryptedRefreshToken` (text), `tokenIv` (binary) — reuse existing `lib/encryption.ts` AES-256-GCM helper.
  - `providerMetadata` (JSON) — store Ponto-specific fields (organisation_id, integration_id, account_ids[] for future multi-account).
  - `consentExpiresAt` (timestamp) — sourced from provider response, NOT hardcoded `+90 days`. EBA mandates up to 180 days under new rules; provider determines exact value.
  - `country` (varchar(2)) — defaults `BE`, allows future EU expansion.
- **No changes** to `payments`, `properties`, `tenants`, `leases`, `bank_accounts` (IBAN store), or `users`.

### Routes (Hono API)
All routes mounted under `/api/v1/bank-connections/`:
- `POST /` — Initiate connection. Returns redirect URL to Ponto.
- `GET /callback` — Receive Ponto OAuth callback. Validates state token (jose JWT, AUTH_SECRET, 10-min TTL). Exchanges code → access+refresh tokens. Inserts `bank_connections` row.
- `GET /` — List connections for current owner. Returns sanitized view (no tokens).
- `GET /:id` — Get single connection details + last sync metadata.
- `POST /:id/renew` — Initiate re-consent (handles 180-day expiry). Returns fresh redirect URL.
- `DELETE /:id` — Revoke and soft-delete. Calls Ponto revoke endpoint then marks `status='revoked'`.
- `POST /:id/sync` — Manually trigger a sync (BullMQ job enqueue). Rate-limited to 1/min per connection.
- All routes use existing `requireAuth` middleware + ownership check pattern from `gocardless.ts`.
- All state-changing routes are subject to existing CSRF middleware.

### Polling worker integration
- The existing `paymentCheckWorker.ts` Phase B (poll active connections) and Phase C (consent expiry warnings) loops already iterate `bank_connections WHERE status='active'`. No worker code changes required for Phase 9 — when the first Ponto connection lands in the table, the worker picks it up automatically.
- The worker MUST call `provider.getTransactions()` and persist results to the new `bank_statements` table BEFORE calling the matcher. Add a `persistStatements()` helper in the worker. Matcher continues to update `payments` as it does today; the new `bank_statements.matchStatus` and `matchedPaymentId` columns are populated by the matcher result.
- Add a "Last synced" timestamp on `bank_connections` (`lastSyncedAt`), updated at the end of each successful poll.

### Security
- OAuth state token: signed JWT, AUTH_SECRET, 10-minute TTL, embeds `userId` + `nonce`. Reuses existing `jose` library.
- Token encryption at rest: reuse existing AES-256-GCM helper in `lib/encryption.ts`.
- HTTPS-only redirect URIs registered with Ponto.
- `bank_statements.counterpartyName` and `counterpartyIban` encrypted at rest (PII).
- `bank_statements.rawPayload` encrypted at rest (full provider payload retention for audit).
- Audit log entry on every connection create/renew/revoke.
- CSRF middleware applies to all POST/DELETE routes (existing pattern).

### Consent renewal
- Polling worker Phase C (already exists) sends warning emails at 7-day and 1-day pre-expiry thresholds. Phase 9 only needs to ensure `consentExpiresAt` is populated correctly on connection creation.
- Renewal flow: landlord clicks email link → lands on a deep link to `/dashboard/bank-connections/:id` → "Renew consent" CTA → `POST /:id/renew` → redirect to Ponto → callback updates existing connection's tokens + `consentExpiresAt`.
- Expired connection: `status='expired'`, polling worker skips. UI shows "Renew" CTA prominently.

### i18n
- All new UI strings keyed in `apps/web/messages/{locale}/common.json` under the existing `bankConnections.*` namespace.
- 4 locales: EN (source), NL, FR, DE.
- Email templates (renewal warnings) — strings live in DB-side email templates (existing Phase 4 pattern), one row per (template_key, locale).

### Compliance
- Terms of Service update required: disclose third-party Ibanity contract. Add a clause "By connecting a bank account, you agree to enter a separate service agreement with Ibanity SA/NV; Rentular is not party to that agreement."
- GDPR: bank_statements retention policy default 7 years (Belgian tax law). Configurable via env var `BANK_STATEMENTS_RETENTION_DAYS` (default 2555). Soft-delete + hard-delete cron added.
- Privacy policy: update to reference bank data processing.

### Claude's Discretion (not pre-locked)
- Plan boundary split between (a) PontoConnectProvider class + schema, (b) API routes + state token + CSRF wiring, (c) Bank Connections UI page + onboarding flow + i18n, (d) bank_statements persistence wiring + worker integration. Planner may rebalance.
- Test-fixture format and breadth.
- Error-message copy.
- Specific shadcn component choices (Form/Dialog/Card composition).
- Whether onboarding wizard step (Phase 7 wizard) gets a "Connect bank" optional step — recommend yes but planner decides.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 9 research
- `.planning/phases/09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con/09-RESEARCH.md` — full research output including provider comparison matrix, Customer-Paying mechanics (lines 1043+), and validation architecture

### Existing Phase 2 scaffolding (REUSE — do not re-invent)
- `apps/api/src/lib/bankAccountData.ts` — `BankAccountDataProvider` interface + factory
- `apps/api/src/services/transactionMatcher.ts` — digits-only structured-communication matching (format-agnostic, works with new bank_statements rows)
- `apps/api/src/jobs/paymentCheckWorker.ts` — polling worker Phase B/C (extend, do not rewrite)
- `apps/api/src/lib/encryption.ts` — AES-256-GCM helper for token + PII encryption
- `packages/db/src/schema/bankConnections.ts` — existing table to extend with additive columns
- `apps/api/src/routes/gocardless.ts` — route shape reference (Hono + zod-validator + ownership check + CSRF)
- `apps/api/src/routes/bankAccounts.ts` — IBAN validation reference

### Existing Phase 7/8 UI scaffolding (REUSE)
- `apps/web/app/(dashboard)/layout.tsx` — sidebar nav + `NAV_VISIBILITY` blocking pattern
- `apps/web/app/(dashboard)/mandates/page.tsx` — top-level dashboard page structure reference
- `apps/web/app/(dashboard)/settings/page.tsx` — tabbed settings reference (only used here as cross-link target)
- `apps/web/components/MandateSetupModal.tsx` — modal pattern reference for connect flow if needed
- `apps/web/messages/{en,nl,fr,de}/common.json` — i18n namespacing pattern

### Project-wide
- `./CLAUDE.md` — Belgian context, tech stack lock, language requirements, no-emoji rule
- `.planning/STATE.md` — accumulated Phase 1-8 decisions
- `.planning/PROJECT.md` — Key Decisions table
- `.planning/ROADMAP.md` — Phase 9 entry (currently thin; planner updates roadmap goal + requirements)

### External (read for protocol mechanics)
- https://documentation.ibanity.com/ponto-connect/api — Ponto Connect API reference
- https://myponto.com/en/pricing/customer-paying-model/ — Customer-Paying contract mechanics
- https://documentation.ibanity.com/ponto-connect/products/quickstart — onboarding sequence
</canonical_refs>

<specifics>
## Specific Ideas

- **Provider class structure:** mirror `GoCardlessBadProvider` in `apps/api/src/lib/bankAccountData.ts`. The factory function should switch on `process.env.BANK_DATA_PROVIDER` (values: `gocardless-bad`, `ponto`). Default to `ponto` in production.
- **Route file:** new `apps/api/src/routes/bankConnections.ts` (NOT mixed into existing `bankAccounts.ts` which is the IBAN store).
- **UI page tree:** `apps/web/app/(dashboard)/bank-connections/page.tsx` (list view), `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` (detail + renew + revoke).
- **Onboarding wizard touchpoint:** add an optional "Connect your bank for auto-reconciliation" step in the existing Phase 7 wizard (step 4 already wires GoCardless; this would be a new step 5 OR a sub-option of step 4). Marked optional — landlords can skip and connect later.
- **Empty state on Bank Connections page:** explain the €4/account/month Ibanity cost up-front, link to TOS clause, then "Connect a bank account" CTA.
- **Error handling on callback:** Ponto returns errors via `error` and `error_description` query params; show a user-friendly message + log the technical reason. Common cases: user-cancelled (`access_denied`), expired-state-token, unknown error.
- **Sandbox/test mode:** Ponto sandbox available; add `PONTO_ENVIRONMENT=sandbox|production` env var following existing `GOCARDLESS_ENVIRONMENT` pattern.
- **Manual sync rate limit:** 1 request/minute per connection. Reuse Redis-based rate limiter if one exists; otherwise simple in-memory check is acceptable for v1.
- **Connection deletion:** soft-delete pattern — set `status='revoked'`, keep historical `bank_statements` rows for tax retention. Do NOT hard-delete.
</specifics>

<deferred>
## Deferred Ideas

- **Manual statement upload (CAMT.053 / CODA / CSV / MT940 / XLSX)** — strong research case for this as the free tier, but user chose to skip in favor of full Ponto integration. Revisit as a separate phase if Ponto onboarding friction is high in early user testing.
- **Multi-account picker on callback** — v1.5. Take `accounts[0]` for now; document the limitation in the connect UI.
- **OCR of PDF statements** — out of scope.
- **Direct bank PSD2 integration (Rentular-as-AISP)** — out of scope; multi-month NBB licensing project.
- **finAPI / Enable Banking provider classes** — abstraction supports them but no business case to implement now.
- **Argenta `.xlsx` 40-row pagination workaround** — only relevant if/when manual upload ships.
- **Tenant-side "view what your landlord saw" GDPR-DSR export endpoint** — not blocking for v1; add to backlog.
- **Statement search/filter UI** — Phase 9 ships the import + reconciliation; full statement-browser UI can be a follow-up.
</deferred>

---

*Phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con*
*Context locked: 2026-05-12 via inline orchestrator capture during plan-phase*
