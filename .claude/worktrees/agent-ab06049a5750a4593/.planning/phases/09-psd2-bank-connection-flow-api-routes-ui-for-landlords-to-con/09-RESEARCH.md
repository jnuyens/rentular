# Phase 9: PSD2 Bank Connection Flow — Research

**Researched:** 2026-05-11
**Domain:** PSD2 Open Banking (AIS), provider selection, OAuth consent flow, Hono API design, Next.js dashboard UX
**Confidence:** MEDIUM-HIGH overall — HIGH on existing scaffolding, MEDIUM on provider selection (pricing requires sales contact), HIGH on regulatory/consent lifecycle

## Summary

Phase 2 built nearly all of the back-end machinery this phase needs: a `bank_connections` table, a provider-agnostic `BankAccountDataProvider` interface with a working `GoCardlessBadProvider` implementation, a transaction matcher keyed on Belgian structured communications, and a polling worker (`paymentCheckWorker.ts`) that already iterates over `status='active'` rows and calls `provider.getTransactions(...)`. **What's missing is the connection-flow itself** — landlords cannot create a row in `bank_connections`, so the worker has nothing to poll. Phase 9 closes that loop end-to-end.

The single biggest planning question is **provider selection**. GoCardless Bank Account Data (the only currently-implemented provider) has been closed to new registrations since July 2025 [VERIFIED: openbankingtracker.com, GoCardless docs portal], meaning if Rentular does not already hold a Nordigen/GoCardless BAD account predating that closure, the existing `GoCardlessBadProvider` cannot be used in production. The realistic Belgium-first alternatives are **Ponto Connect (Ibanity / Isabel Group)** — Belgian-domiciled, used by ~100 SaaS integrators, explicitly markets a "Representative" model for accountants and real-estate agents — and **Enable Banking** — Nordic-headquartered, broader EU coverage, custom-quote pricing. Tink (Visa) is enterprise-priced and overkill. Pricing for Ponto and Enable Banking is not public; both require a sales call to obtain a quote [CITED: myponto.com/en/pricing, enablebanking.com].

The EU regulatory landscape also shifted: **EBA extended the SCA re-consent window from 90 days to 180 days** and introduced a mandatory AISP exemption from SCA [CITED: vixio.com, projectivegroup.com]. The schema's `consentExpiresAt` and the worker's 7/1-day warning logic are still correct in shape, but the assumed 90-day window in Phase 2 code (`expiresAt.setDate(expiresAt.getDate() + 90)`) is now provider-dependent — each provider implements the 180-day exemption differently, and some still default to 90.

UI placement: Phase 8 already established a `/dashboard/settings` page with tabs (follow-up, landlord-reports, bank-accounts, gocardless). Phase 8's GoCardless tab handles direct debit *outbound* (collecting rent from tenants). Bank connections are conceptually adjacent but functionally different (*incoming* monitoring of the landlord's own account). The recommendation is a **new top-level sidebar item "Bank Connections"** (icon `Link2` or `Banknote`) positioned between Payments and Mandates, NOT a sub-tab of Settings — because: (a) it is its own multi-step workflow with status pages, not a settings form; (b) connection rows are first-class business entities with lifecycle status, not preferences; (c) onboarding wizard step 4 can deep-link to it; (d) it parallels the existing Mandates page that Phase 8 introduced. A status widget in the GoCardless Settings tab can summarise "0/1 banks connected" and link to the dedicated page.

**Primary recommendation:** Plan Phase 9 to (1) ship the connection flow API + UI against the existing `BankAccountDataProvider` interface so the worker becomes useful immediately, (2) elevate provider selection to the user as a blocking decision before plans lock — recommend **Ponto Connect** as the primary based on Belgian market fit and existing SaaS-integrator track record, (3) extend the schema with three small additions (`bank_statements` raw table for audit + dedup, `redirect_state` for OAuth CSRF protection, and provider-encrypted credentials on `bank_connections`), and (4) tighten the existing consent logic to be provider-agnostic about expiry duration.

<phase_requirements>
## Phase Requirements

The roadmap entry has requirements as "TBD". This research recommends introducing a new **BANK** requirement family. Existing `REQUIREMENTS.md` traces line item *"PSD2 consent expiry monitoring with renewal + notification fallback — Phase 2"* under Validated (it covers the *worker side*, not the *connection side*), so this phase formally introduces the user-facing capability.

| ID | Description | Research Support |
|----|-------------|------------------|
| **BANK-01** | Landlord can initiate a PSD2 bank connection by selecting their bank from a searchable list of supported Belgian institutions | Provider `listInstitutions()` capability (must be added to interface — currently missing), Belgian bank coverage verified for Ponto + Enable Banking + Nordigen |
| **BANK-02** | Landlord is redirected to their bank's SCA flow and back to Rentular; the returned consent is persisted as a `bank_connections` row with `status='active'` and `consentExpiresAt` set | Existing `provider.createConsent()` already returns `{requisitionId, consentLink, expiresAt}`; Hono callback endpoint pattern + redirect-state CSRF token required |
| **BANK-03** | Landlord can view a list of their connected bank accounts with institution name, masked IBAN, status badge (active/expired/error/revoked), and days-until-expiry | New `GET /bank-connections` route; existing schema columns sufficient |
| **BANK-04** | Landlord can manually trigger an immediate sync of a connected account (does not wait for the next cron tick) | New `POST /bank-connections/:id/sync` route delegating to the same polling code path as `paymentCheckWorker` Phase B |
| **BANK-05** | Landlord can revoke a bank connection, which calls `provider.revokeConsent()` and sets `status='revoked'` | Existing `provider.revokeConsent()` method; new `DELETE /bank-connections/:id` route |
| **BANK-06** | Landlord can re-authorise an expired or about-to-expire connection from the same UI, reusing institution selection but generating a new consent | Reuses BANK-01 flow with the prior `institutionId` pre-filled; ties into existing 7/1-day warning emails (D-09) |
| **BANK-07** | The system stores every imported bank transaction in a `bank_statements` (or `bank_transactions`) raw audit table, deduplicated by `(connectionId, externalTransactionId)`, before matching | Currently the matcher updates `payments` but never persists the raw transaction — duplicates rely on provider-side dedup which is not guaranteed across syncs |
| **BANK-08** | Landlord can view a list of recent imported transactions for a connection, including match status (matched/mismatched/unmatched/ignored) | Follows from BANK-07 storage; needed for tenant-facing dispute scenarios and audit |
| **BANK-09** | The OAuth callback verifies an opaque state token tied to the initiating landlord's session before persisting the consent — prevents cross-account hijack | New `oauth_states` table or signed JWT state; not implemented today |
| **BANK-10** | All connection-flow UI strings exist in EN, NL, FR, DE | Project i18n convention (Phase 7 D-mandate) |

**Recommendation to user:** Approve adding BANK-01 through BANK-10 to `REQUIREMENTS.md` before plans are locked.

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Initiate consent (POST /bank-connections) | API / Backend | Frontend Server (auth gate) | Holds provider credentials, signs redirect-state, talks to provider |
| OAuth callback (GET /bank-connections/callback) | API / Backend | — | Receives provider redirect; needs DB write + state verification |
| Bank selection picker (institutions list) | API / Backend (cached) | Browser (display) | Provider returns large institution list; backend caches + filters by country |
| Connection list view | Browser | API / Backend (data) | Standard CRUD-list page; data via fetch |
| Manual sync trigger | API / Backend | Browser (button) | Server-side because rate-limited per-provider |
| Revoke connection | API / Backend | Browser | Server must call provider API, then DB update |
| Polling worker | API / Backend (BullMQ) | — | Already implemented; runs server-side on BALANCE_CHECK_CRON |
| Transaction matching | API / Backend | Database | Pure server-side; updates payments table |
| Raw transaction storage | Database (write by API) | — | New table; never directly touched by frontend |
| Consent expiry warnings | API / Backend (worker + queueEmail) | Browser (dashboard banner) | Worker sends email; dashboard polls for status |
| OAuth state CSRF protection | API / Backend | — | Must not be client-side |
| i18n string presentation | Browser (next-intl) | — | Standard Phase 7 pattern |

## Standard Stack

### Core (already installed — no new dependencies for the API surface)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.6.0 | API router for `/api/v1/bank-connections` | Project standard; all other routers use it [VERIFIED: apps/api/package.json] |
| @hono/zod-validator | ^0.4.0 | Request body validation | Pattern used in `gocardless.ts`, `bankAccounts.ts` etc. [VERIFIED: codebase grep] |
| zod | ^3.24.0 | Schemas | Project standard [VERIFIED: apps/api/package.json] |
| drizzle-orm | ^0.36.0 | DB access for `bank_connections` + new tables | Project standard [VERIFIED: apps/api/package.json] |
| drizzle-kit | ^0.31.9 | Migration generation | Pattern: generate + commit `.sql`, deploy applies it [VERIFIED: packages/db/drizzle/0000_*.sql exists] |
| bullmq | ^5.25.0 | (Reuse existing payment-check worker; no new queues needed for Phase 9) | Already wired in `paymentCheckWorker.ts` |
| nordigen-node | ^1.4.1 | GoCardless BAD client — already wired in `bankAccountData.ts` | Existing implementation; v1.4.1 published 2025-04-07, latest [VERIFIED: npm view] |
| next-intl | 3.24.0 | i18n in EN/NL/FR/DE | Project standard [VERIFIED: project CLAUDE.md] |
| shadcn/ui | pinned via Phase 7 | UI components | Locked at 2.3.0 per [Phase 07] decision in STATE.md |
| @tanstack/react-query | 5.62.0 | Connection list polling, status refresh | Project standard for dashboard data [CITED: CLAUDE.md] |

### Provider Selection — Decision Required (block before plan lock)

| Option | Belgian Coverage | Pricing | Sandbox | Node SDK | Maturity for SaaS | Verdict |
|--------|------------------|---------|---------|----------|--------------------|---------|
| **GoCardless BAD** (Nordigen) | Belfius, KBC, BNP Paribas Fortis, ING, Argenta — yes [CITED: developer.gocardless.com] | Existing accounts only; new registrations CLOSED since July 2025 [VERIFIED: openbankingtracker.com] | Yes (existing accounts) | `nordigen-node` v1.4.1 already installed [VERIFIED: npm] | High (Phase 2 used it) | **Use only if Rentular already has an account predating July 2025; otherwise blocked** |
| **Ponto Connect (Ibanity / Isabel Group)** | Argenta, Aion, Belfius, Beobank, BNP Paribas Fortis, Crelan, KBC, Keytrade, VDK [VERIFIED: openbankingtracker.com] | Two models: "Partner Paying" (SaaS pays per interaction) or "Customer Paying" (end-user registers directly). Public price not disclosed — sales contact [CITED: myponto.com/en/pricing] | Yes, free sandbox [CITED: ibanity.com] | No official Node SDK — REST/OAuth direct integration | High — ~100 SaaS integrators, explicitly markets "Representative" model for real-estate agents [CITED: ibanity.com] | **Recommended primary — Belgian-domiciled, B2B-SaaS-native, Isabel Group backing** |
| **Enable Banking** | Argenta, Belfius, BNP Paribas Fortis, KBC (3 brands), ING, Crelan, BBVA, Wise [VERIFIED: enablebanking.com/docs/markets/be/] | Custom quote only [CITED: enablebanking.com] | Yes, demo at tilisy.com [CITED: enablebanking.com] | No official Node SDK; OpenAPI spec + GitHub code samples | Medium — newer entrant, Wellstreet portfolio company | **Recommended fallback if Ponto pricing is prohibitive** |
| **Tink (Visa)** | Yes (BNP Paribas Fortis partnership) [CITED: computerweekly.com] | Enterprise pricing only, "agreed directly with Tink", not public [CITED: merchantmachine.co.uk] | Yes | Yes (older) | Very high — owned by Visa | **Overkill for SMB Belgian landlord SaaS; defer to v2 if scale demands it** |
| **Direct bank PSD2 APIs** | All 5 majors expose Berlin Group NextGenPSD2 [CITED: ibanity.com/blog] | Free | Per-bank sandboxes | None | Low — would require Rentular to obtain its own PSD2 AISP licence | **Out of scope: AISP licensing is a multi-month regulatory effort** |

**Recommendation:** Ponto Connect as primary. The existing provider-agnostic interface means a `PontoConnectProvider` class can be implemented alongside `GoCardlessBadProvider` and selected via env var.

### Supporting Libraries (new)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none mandatory) | — | OAuth state and provider client — both can use existing `jose` (already installed for JWT) and `crypto` (Node built-in) | Sign and verify the redirect-state token; encrypt refresh tokens at rest reusing existing `lib/encryption.ts` AES-256-GCM helper |

### Alternatives Considered (within Ponto Connect implementation)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct REST calls in `pontoConnectProvider.ts` | Generated TypeScript client from OpenAPI spec | More maintenance overhead; Ponto's API surface is small enough that hand-written client is simpler |
| Per-landlord OAuth client credentials | Single shared client_id with Ponto + per-user authorization | Ponto's "Partner Paying" model expects single SaaS client_id [CITED: myponto.com] |

**No new npm packages strictly required.** The existing stack covers all integration needs for either Ponto or Enable Banking via REST + jose.

**Version verification:**
- `nordigen-node`: v1.4.1, published 2025-04-07 — latest [VERIFIED: npm view]
- `gocardless-nodejs`: v8.1.0 latest on registry; project uses ^4.2.0 — unchanged since Phase 2 [VERIFIED: npm view]
- No published `@ibanity/*` or `enable-banking` npm packages exist [VERIFIED: npm view 404]

## Architecture Patterns

### System Architecture Diagram

```
Landlord browser              Next.js (dashboard)              Hono API                       Provider (Ponto/Nordigen)         Bank
─────────────────              ───────────────────              ────────                       ─────────────────────────         ────
       │                                │                            │                                    │                       │
   1. Click "Connect bank" ──► /dashboard/bank-connections            │                                    │                       │
                                        │                            │                                    │                       │
       2. Pick bank (search) ─────────► GET /bank-connections/institutions?country=BE                     │                       │
                                        │                            │── institutionsList() ──────────────►│                       │
                                        │                            │◄────────────────── 9 BE banks ─────│                       │
                                        │                            │                                    │                       │
       3. Click "Authorize" ──────────► POST /bank-connections {institutionId}                            │                       │
                                        │                            │── createConsent({redirectUrl, ref})►│                       │
                                        │                            │◄─── {requisitionId, consentLink} ──│                       │
                                        │                            │  generate state token (jose JWT)   │                       │
                                        │                            │  INSERT bank_connections (pending) │                       │
                                        │                            │  INSERT oauth_states (state→ownerId, requisitionId)         │
                                        │◄──── 302 to consentLink ───│                                    │                       │
       4. Redirect to bank ──────────────────────────────────────────────────────────────────────────────►│── SCA challenge ─────►│
                                                                                                          │◄── tenant authorizes ─│
       5. Redirect back ──► GET /api/v1/bank-connections/callback?ref=...&state=...                       │                       │
                                        │                            │  verify state JWT (signature, owner, expiry)               │
                                        │                            │── listAccounts(requisitionId) ─────►│                       │
                                        │                            │◄──── account[] + IBAN ─────────────│                       │
                                        │                            │  UPDATE bank_connections (active, externalAccountId, iban)│
                                        │                            │  DELETE oauth_states row           │                       │
                                        │◄──── 302 to /dashboard ────│                                    │                       │
       6. List view shows row ────────► GET /bank-connections                                              │                       │
                                        │                            │── SELECT * FROM bank_connections ─►│                       │
                                                                                                                                  │
   ─── Later, every 8 hours (BALANCE_CHECK_CRON) ───                                                                              │
                                                                     │                                    │                       │
                                       paymentCheckWorker Phase B  ──│── getTransactions({accountId, dateFrom}) ──►│              │
                                                                     │◄──── transactions[] ───────────────│                       │
                                                                     │  INSERT bank_statements (raw, dedup'd)                     │
                                                                     │  processIncomingTransactions(owner, txs)                   │
                                                                     │  UPDATE payments (matched=paid, mismatched=flagged)         │
                                                                     │  UPDATE bank_connections.lastSyncAt                         │
```

### Recommended Project Structure (delta from existing)

```
apps/api/src/
  routes/
    bankConnections.ts          # NEW: POST/GET/DELETE /bank-connections, /institutions, /callback, /sync
  lib/
    bankAccountData.ts          # EXISTING: extend interface with listInstitutions(), expose factory selection via env
    pontoConnectProvider.ts     # NEW: PontoConnectProvider implements BankAccountDataProvider
    bankOAuthState.ts           # NEW: sign/verify redirect-state JWT via existing jose dep
  services/
    bankStatementImporter.ts    # NEW: wrap transactionMatcher to ALSO insert into bank_statements before matching
packages/db/src/schema/
  bankConnections.ts            # EXTEND: add encryptedAccessToken, encryptedRefreshToken, providerMetadata json, country, accountHolder
  bankStatements.ts             # NEW: raw transaction audit + dedup
  bankOAuthStates.ts            # NEW: state→ownerId mapping (alternative: signed JWT only, no table — see below)
apps/web/app/(dashboard)/
  bank-connections/
    page.tsx                    # NEW: list + status + manual sync
    connect/
      page.tsx                  # NEW: institution picker → initiate consent
    callback/
      page.tsx                  # NEW: thin client page (most logic is server callback) showing success/error
apps/web/components/
  BankConnectionCard.tsx        # NEW: list-row component
  BankConnectionStatusBadge.tsx # NEW: parallel to MandateStatusBadge
  InstitutionPicker.tsx         # NEW: searchable bank list
```

### Pattern 1: OAuth State Token (CSRF Protection)
**What:** Sign a short-lived JWT containing `{ownerId, requisitionId, nonce, exp}` using the existing `AUTH_SECRET`. Pass it as the `state` query param on the redirect URL. Verify signature, expiry, and ownership match on callback before persisting the connection.
**When to use:** Every `POST /bank-connections` → callback round-trip.
**Why:** Prevents an attacker from sending a victim a crafted callback URL that links the attacker's bank to the victim's account.

```typescript
// Source: pattern derived from RFC 6749 § 10.12 + project's existing jose usage
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

export async function signOAuthState(payload: {
  ownerId: string;
  requisitionId: string;
}): Promise<string> {
  return new SignJWT({ ...payload, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m") // consent flows complete in seconds, 10m is generous
    .sign(secret);
}

export async function verifyOAuthState(token: string): Promise<{
  ownerId: string;
  requisitionId: string;
}> {
  const { payload } = await jwtVerify(token, secret);
  return { ownerId: payload.ownerId as string, requisitionId: payload.requisitionId as string };
}
```

Two viable storage strategies:
- **JWT-only (recommended):** No DB table; state is self-contained. Pro: simpler; Con: cannot revoke before expiry.
- **DB-backed `oauth_states` table:** Insert on initiate, delete on callback success. Pro: revocable; Con: extra schema + cleanup.

The threat model here is short-lived (10 minutes), so JWT-only is sufficient. The recommendation is **JWT-only**.

### Pattern 2: Provider Interface Extension
**What:** Add two missing methods to `BankAccountDataProvider`:

```typescript
// EXTEND apps/api/src/lib/bankAccountData.ts
export interface BankAccountDataProvider {
  // ... existing methods ...

  /** List available institutions for an ISO 3166 country code (cached upstream). */
  listInstitutions(countryCode: string): Promise<Institution[]>;

  /** Default consent duration in days (provider-dependent: 90 or 180 per EBA). */
  readonly defaultConsentDays: number;
}

export interface Institution {
  id: string;
  name: string;
  bic?: string;
  logoUrl?: string;
  countries: string[];
  // Provider-specific metadata
  transactionTotalDays?: number; // How far back transactions can be retrieved
}
```

**When to use:** Both `GoCardlessBadProvider` and the new `PontoConnectProvider` must implement these. Move the hard-coded `expiresAt.setDate(expiresAt.getDate() + 90)` in `GoCardlessBadProvider.createConsent` to read from `this.defaultConsentDays` so the regulatory shift to 180 days is provider-controlled.

### Pattern 3: Raw Bank Statement Audit Trail
**What:** Insert every fetched transaction into a `bank_statements` table BEFORE matching. The matcher updates `payments` based on this data. Deduplicate by `(connectionId, externalTransactionId)`.

```typescript
// packages/db/src/schema/bankStatements.ts (NEW)
export const bankStatements = mysqlTable("bank_statements", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  connectionId: varchar("connection_id", { length: 36 })
    .notNull()
    .references(() => bankConnections.id),
  // Provider-side transaction ID — UNIQUE in combination with connectionId
  externalTransactionId: varchar("external_transaction_id", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  bookingDate: date("booking_date").notNull(),
  valueDate: date("value_date"),
  remittanceStructured: varchar("remittance_structured", { length: 50 }),
  remittanceUnstructured: text("remittance_unstructured"),
  debtorName: varchar("debtor_name", { length: 255 }),
  debtorIban: varchar("debtor_iban", { length: 34 }),
  // Matching result
  matchedPaymentId: varchar("matched_payment_id", { length: 36 }), // nullable
  matchConfidence: mysqlEnum("match_confidence", ["exact", "amount_mismatch", "unmatched", "ignored"]),
  matchedAt: timestamp("matched_at"),
  // Audit
  rawPayload: json("raw_payload"), // Full provider response for debugging
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  connectionTxUniq: unique("bank_statements_conn_tx_uniq").on(table.connectionId, table.externalTransactionId),
  connectionDateIdx: index("bank_statements_conn_date_idx").on(table.connectionId, table.bookingDate),
  unmatchedIdx: index("bank_statements_unmatched_idx").on(table.matchConfidence),
}));
```

**Why:** Three reasons —
1. **Dedup across sync runs:** A re-sync after a transient error must not double-mark a payment as paid. The UNIQUE constraint on `(connectionId, externalTransactionId)` enforces this at the DB level — INSERT IGNORE or ON DUPLICATE KEY UPDATE provides idempotency.
2. **Audit trail:** Landlords (and Belgian tax inspectors) may need to prove which bank transaction corresponded to which rent payment.
3. **Unmatched transaction inbox:** The current matcher discards unmatched transactions. Storing them lets the dashboard show "5 unmatched incoming transfers — review" as a landlord task.

### Pattern 4: Polling Worker Integration (minimal change)
**What:** `paymentCheckWorker.ts` Phase B already iterates `bank_connections` and calls `provider.getTransactions()`. Change two things:

1. Insert into `bank_statements` (with `INSERT IGNORE ... UNIQUE`) before calling `processIncomingTransactions`.
2. Pass only the *newly inserted* rows to the matcher (so re-syncs don't re-attempt matching of already-processed transactions).

```typescript
// Pseudocode for the change inside paymentCheckWorker.ts Phase B loop:
const transactions = await provider.getTransactions({
  accountId: conn.externalAccountId!,
  dateFrom: conn.lastSyncAt
    ? conn.lastSyncAt.toISOString().split("T")[0]
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  // 90 days back on first sync — Ponto/Nordigen limit
});

const newTransactions = await importBankStatements(conn.id, transactions);
// importBankStatements does INSERT ... ON DUPLICATE KEY UPDATE id=id (no-op for dup)
// and returns only rows whose insert was new

if (newTransactions.length > 0) {
  await processIncomingTransactions(conn.ownerId, newTransactions);
}
```

This is a 10-line edit, not a worker rewrite.

### Pattern 5: Manual Sync Endpoint Reuse
**What:** `POST /bank-connections/:id/sync` should not duplicate worker logic. Extract the per-connection loop body of `paymentCheckWorker.ts` Phase B into a service `syncBankConnection(connectionId)`, and have BOTH the worker and the route call it.

```typescript
// apps/api/src/services/bankConnectionSync.ts (NEW)
export async function syncBankConnection(connectionId: string): Promise<{
  fetched: number;
  matched: number;
  mismatched: number;
}> {
  // ... extracted from paymentCheckWorker.ts Phase B ...
}
```

**Why:** Single source of truth. Avoids drift between cron behaviour and manual-trigger behaviour.

### Pattern 6: Status Polling on Connection List Page
**What:** Use `@tanstack/react-query` with `refetchInterval: 30_000` on the list view so a freshly-completed callback updates the badge from `pending` → `active` without manual reload.
**When to use:** Pages where status changes server-side asynchronously (callback handler updates `bank_connections.status`).

### Anti-Patterns to Avoid
- **Sending the consent_link via email instead of in-browser redirect:** Some integrations push a "click this link to authorize" email. Don't. The landlord is already in the browser session; an inline redirect is faster and reduces phishing surface. Reserve email for the expiry-warning flow already implemented in Phase 2.
- **Storing the provider's API access tokens in cleartext:** If a provider returns a long-lived refresh token (Ponto does), encrypt at rest using the existing `lib/encryption.ts` AES-256-GCM helper. Never log token values.
- **Trusting query params on the callback:** GoCardless BAD redirects with `?ref=` only; an attacker could craft a callback URL pointing to a malicious requisition. ALWAYS verify the requisition status via `listAccounts()` before marking the connection active.
- **Polling at the same rate for inactive connections:** Skip `status != 'active'` in Phase B (the existing code does this — preserve it).
- **Coupling UI to a specific provider's institution-list schema:** Define the `Institution` type in the interface, not in `bankConnections.ts` route handlers, so swapping providers does not break the frontend contract.
- **Using `?` for the consent state token in the URL:** Some providers strip query params. Use `state` as that's the OAuth2 / PSD2 standard and is preserved by all known AISPs.
- **Implementing "delete connection" as a hard DELETE:** Soft-delete (`status='revoked'`) preserves the audit trail of past matched transactions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Belgian IBAN validation | Custom regex | Existing `ibanSchema` in `apps/api/src/routes/bankAccounts.ts` (mod-97 + format) | Already battle-tested with Belgian IBAN edge cases |
| Structured communication matching | New matcher | Existing `transactionMatcher.ts` from Phase 2 | Handles digits-only normalization (D-04) |
| Email warnings on consent expiry | New cron / new templates | Existing Phase B/C code in `paymentCheckWorker.ts` + `queueEmail` from Phase 4 | 7-day/1-day thresholds already implemented |
| AES-256-GCM token encryption | New crypto code | Existing `apps/api/src/lib/encryption.ts` | Already keyed off `AUTH_SECRET` |
| JWT signing for OAuth state | New HMAC | Existing `jose` library (^6.2.1 installed for NextAuth) | Already in dep tree, FIPS-compliant primitives |
| Drizzle migrations | Hand-written SQL | `drizzle-kit generate` then commit `.sql` file | Project convention per [Phase 07] decision |
| Sidebar nav item registration | Hardcoded edit | `navigationItems` array in `apps/web/app/(dashboard)/layout.tsx` | Established Phase 7 pattern |
| Mandate-style status badge | New badge | Pattern of `MandateStatusBadge.tsx` from Phase 8 | Already shadcn-themed |
| Dialog / Modal | New modal | shadcn `<Dialog>` + Phase 8 `MandateSetupModal.tsx` reference | Pinned at shadcn 2.3.0 [Phase 07] |
| BullMQ queue for sync | New queue | Reuse `paymentCheckQueue` or call sync service synchronously from route | Worker already provisioned |
| OAuth client management for Ponto | Per-user OAuth apps | Single SaaS-wide client_id (Ponto's "Partner Paying" model) | Lower operational overhead, matches Ponto's expected pattern |

**Key insight:** Phase 2 over-delivered the back-end primitives. Phase 9 is largely about exposing them via routes + UI, with one new schema (`bank_statements`), one new provider class (Ponto or Enable Banking), and a 10-line edit to the worker.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `bank_connections` table exists with rows likely already present in dev DBs from Phase 2 work (pending status). `mysql` DB. | New tables: `bank_statements` (additive, no migration risk). Extension of `bank_connections` with `encryptedAccessToken/encryptedRefreshToken/providerMetadata/country` columns (additive, nullable — no breaking change). |
| Live service config | None — no third-party UI hosts the connection config (the provider's developer dashboard is where the SaaS-level credentials live). | After selecting a provider, register the production redirect URL `https://<prod-host>/api/v1/bank-connections/callback` in the provider's developer console. |
| OS-registered state | None — no systemd unit, Windows Task Scheduler, or pm2 process references bank connections directly. | None. |
| Secrets/env vars | `GOCARDLESS_BAD_SECRET_ID`, `GOCARDLESS_BAD_SECRET_KEY` documented in code but NOT in `.env.example` [VERIFIED: grep .env.example]. No Ponto / Enable Banking vars defined. | Add to `.env.example`: provider selection (`BANK_DATA_PROVIDER=ponto\|gocardless_bad\|enable_banking`) and per-provider credentials (`PONTO_CLIENT_ID`, `PONTO_CLIENT_SECRET`, `PONTO_REDIRECT_URI` OR equivalents for chosen provider). |
| Build artifacts / installed packages | `nordigen-node` installed but the existing `GoCardlessBadProvider` uses dynamic `import()` so it's load-bearing only at runtime. If switching to Ponto, do not uninstall `nordigen-node` yet — keep as fallback. | If Ponto chosen: add no new npm package (REST + jose). If user prefers SDK: no official Ponto npm SDK exists [VERIFIED: npm view 404]. |

## Common Pitfalls

### Pitfall 1: 90 vs 180-Day Consent Drift
**What goes wrong:** Code hard-codes 90 days (current `GoCardlessBadProvider`), but EBA extended SCA exemption to 180 days in 2024–2025. Different providers default to different windows.
**Why it happens:** Phase 2 (2026-03-22) coded 90 days into `createConsent()` per the then-prevailing rule. The mandatory 180-day exemption was published by EBA before that but not yet uniformly adopted by providers.
**How to avoid:** Read `provider.defaultConsentDays`; do not hardcode in `createConsent()`. Ponto Connect supports 180-day re-consent with no SCA. Some Belgian banks have not yet rolled out the 180-day flow on their side, so consent may still expire at 90 days in practice — capture the provider-returned `expiresAt` as the source of truth, not a client-side computation.
**Warning signs:** Landlords get expiry warnings exactly 83/89 days after connect when the UI promised 173/179.

### Pitfall 2: Refresh Token Storage Without Encryption
**What goes wrong:** Ponto issues OAuth refresh tokens with long TTL. If stored cleartext in MySQL and the DB is dumped, an attacker can replay them against Ponto for the consent window.
**Why it happens:** Phase 2's schema doesn't have a column for them because Nordigen uses requisition IDs (opaque, server-validated, not tokens).
**How to avoid:** Add `encryptedAccessToken` / `encryptedRefreshToken` columns; wrap reads/writes with `encrypt()`/`decrypt()` from `lib/encryption.ts`.
**Warning signs:** PR diffs that introduce a `text("refreshToken")` column without `encrypted` prefix.

### Pitfall 3: Callback URL Mismatch in Production
**What goes wrong:** Provider sandbox is configured with `http://localhost:4000/api/v1/bank-connections/callback`; production deploy uses `https://app.rentular.be/...` but provider redirect URL still points to localhost. Bank rejects the redirect.
**Why it happens:** Provider-side allowlists are environment-specific and must be updated separately from app code.
**How to avoid:** Document the URL registration step explicitly in the Phase 9 SUMMARY's "User Setup Required" section. Make the redirect URL configurable via env (`BANK_CONNECTION_REDIRECT_URL`).
**Warning signs:** "invalid_redirect_uri" error after first production deploy.

### Pitfall 4: Transaction Duplication on Re-Sync
**What goes wrong:** Worker fetches transactions for `dateFrom = lastSyncAt`. Same transaction is fetched twice if `lastSyncAt` is the same day as a transaction. Payment is auto-marked paid twice, ignoring the state machine (no transition error because `paid → paid` is a no-op, but `notes` gets clobbered with a stale match record).
**Why it happens:** Date-only `dateFrom` granularity. Existing matcher in `transactionMatcher.ts` does not check for prior matches.
**How to avoid:** The `bank_statements` UNIQUE constraint on `(connectionId, externalTransactionId)` is the dedup safety net. Combined with the "only newly-inserted rows go to matcher" rule from Pattern 4 above.
**Warning signs:** Identical "Auto-matched from bank transfer" notes appearing twice on the same payment.

### Pitfall 5: Cross-Account Hijack via Callback
**What goes wrong:** Attacker initiates a consent on their own bank, captures the redirect URL, then sends it to a victim. Victim's session is used to attach the attacker's bank to the victim's account. Now attacker can poison the victim's payment matching.
**Why it happens:** No state-token verification.
**How to avoid:** Pattern 1 above — signed JWT state token with `ownerId`. Verify `ownerId === c.get("userId")` on callback.
**Warning signs:** Bank connections appearing for users who didn't initiate them.

### Pitfall 6: Institution List Provider-Lock-In
**What goes wrong:** UI hardcodes the GoCardless BAD `institutionId` format. Switching to Ponto silently breaks the picker because Ponto uses different IDs.
**Why it happens:** Direct passthrough of provider IDs into the frontend.
**How to avoid:** The `Institution` interface above defines provider-agnostic shape `{id, name, bic, logoUrl}`. Frontend treats `id` as opaque. Switching providers requires only `provider.listInstitutions()` to return the new shape.
**Warning signs:** Picker shows empty list after provider env var change.

### Pitfall 7: SCA Mobile App Hang
**What goes wrong:** Belgian banks predominantly use mobile app-switch SCA (Belfius Mobile, itsme, ING Banking app). On desktop the user is prompted to scan a QR or open the app. If the user doesn't complete within the bank's session window (often 5 minutes), the redirect returns an error.
**Why it happens:** Bank-side timeout, not Rentular's.
**How to avoid:** Show a clear "Open your bank app to complete authorization" message before redirecting. On callback error, show a friendly retry CTA, not a stack trace. Document this in the i18n strings for the connect/callback pages.
**Warning signs:** High rate of `status='error'` rows with provider error codes referencing "expired" or "abandoned".

### Pitfall 8: 90-Day Transaction History Limit (Wise / Some Banks)
**What goes wrong:** A landlord connects a bank that has only signed off on 90 days of transaction history. Worker fetches with `dateFrom = now - 3 days` (default first-sync), gets a thin first sync, and never backfills.
**Why it happens:** PSD2 default is 90 days back; older requires a SECOND consent for "extended history" that not all banks support [CITED: enablebanking.com — Wise example].
**How to avoid:** First sync should request the maximum allowed history (90 days). The current worker code does this for the first sync with the 3-day fallback hardcoded — change to 90 days on first sync.
**Warning signs:** Landlord reports "you missed last month's rent payment" right after connecting.

### Pitfall 9: Provider Charges Per Connection (Cost Discipline)
**What goes wrong:** Pricing model on Ponto / Enable Banking is per active connection or per API call. A landlord who connects 5 bank accounts costs 5x. Without throttling, syncing 3x/day across BALANCE_CHECK_CRON for 100 landlords = 1500 API calls/day, easily breaching free-tier limits.
**Why it happens:** No public pricing means costs are unknown until invoiced.
**How to avoid:** Make polling cadence configurable per-environment. Document the upper bound to the user as a planning input (e.g., "v1 will support 1 connected account per landlord" or "polls at most twice/day instead of 3x").
**Warning signs:** Unexpected provider invoice spike.

## Code Examples

### Route Shape (Hono pattern matching existing routes)
```typescript
// apps/api/src/routes/bankConnections.ts (NEW)
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, bankConnections, leases, properties } from "@rentular/db";
import { getBankAccountDataProvider } from "../lib/bankAccountData";
import { signOAuthState, verifyOAuthState } from "../lib/bankOAuthState";
import { getRequiredUserId } from "../lib/routeAuth";
import { syncBankConnection } from "../services/bankConnectionSync";

export const bankConnectionsRouter = new Hono();

// GET /bank-connections — list all connections for current user
bankConnectionsRouter.get("/", async (c) => {
  const userId = getRequiredUserId(c);
  const db = getDb();
  const rows = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.ownerId, userId));
  return c.json({ data: rows });
});

// GET /bank-connections/institutions?country=BE
bankConnectionsRouter.get(
  "/institutions",
  zValidator("query", z.object({ country: z.string().length(2).default("BE") })),
  async (c) => {
    const { country } = c.req.valid("query");
    const provider = getBankAccountDataProvider();
    const institutions = await provider.listInstitutions(country);
    return c.json({ data: institutions });
  }
);

// POST /bank-connections — initiate consent
bankConnectionsRouter.post(
  "/",
  zValidator("json", z.object({ institutionId: z.string().min(1) })),
  async (c) => {
    const userId = getRequiredUserId(c);
    const { institutionId } = c.req.valid("json");
    const db = getDb();
    const provider = getBankAccountDataProvider();

    const id = crypto.randomUUID();
    const stateToken = await signOAuthState({ ownerId: userId, requisitionId: id });

    const baseUrl = process.env.BANK_CONNECTION_REDIRECT_URL
      || `${process.env.API_URL}/api/v1/bank-connections/callback`;
    const redirectUrl = `${baseUrl}?state=${encodeURIComponent(stateToken)}`;

    const consent = await provider.createConsent({
      institutionId,
      redirectUrl,
      reference: id,
    });

    await db.insert(bankConnections).values({
      id,
      ownerId: userId,
      provider: provider.name as any,
      externalRequisitionId: consent.requisitionId,
      institutionId,
      status: "pending",
      consentExpiresAt: consent.expiresAt,
    });

    return c.json({
      data: { id, consentLink: consent.consentLink },
    }, 201);
  }
);

// GET /bank-connections/callback?state=...&ref=...
bankConnectionsRouter.get("/callback", async (c) => {
  const state = c.req.query("state");
  if (!state) return c.json({ error: "Missing state" }, 400);

  let decoded: { ownerId: string; requisitionId: string };
  try {
    decoded = await verifyOAuthState(state);
  } catch {
    return c.json({ error: "Invalid state" }, 400);
  }

  const db = getDb();
  const provider = getBankAccountDataProvider();

  const conn = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.id, decoded.requisitionId))
    .limit(1);
  if (!conn[0] || conn[0].ownerId !== decoded.ownerId) {
    return c.json({ error: "Connection not found" }, 404);
  }

  const accounts = await provider.listAccounts(conn[0].externalRequisitionId!);
  if (accounts.length === 0) {
    await db.update(bankConnections)
      .set({ status: "error", errorMessage: "No accounts returned by provider", updatedAt: new Date() })
      .where(eq(bankConnections.id, conn[0].id));
    return c.redirect(`${process.env.WEB_URL}/bank-connections?error=no_accounts`);
  }

  // Take the first account; multi-account picker is a Phase 9.5 deferred idea
  const account = accounts[0];
  await db.update(bankConnections).set({
    externalAccountId: account.accountId,
    iban: account.iban,
    institutionName: account.institutionName,
    status: "active",
    updatedAt: new Date(),
  }).where(eq(bankConnections.id, conn[0].id));

  return c.redirect(`${process.env.WEB_URL}/bank-connections?success=1`);
});

// POST /bank-connections/:id/sync — manual trigger
bankConnectionsRouter.post("/:id/sync", async (c) => {
  const userId = getRequiredUserId(c);
  const id = c.req.param("id");
  const db = getDb();
  const conn = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
    .limit(1);
  if (!conn[0]) return c.json({ error: "Connection not found" }, 404);
  if (conn[0].status !== "active") {
    return c.json({ error: `Connection not active (status=${conn[0].status})` }, 409);
  }
  const result = await syncBankConnection(id);
  return c.json({ data: result });
});

// DELETE /bank-connections/:id — revoke
bankConnectionsRouter.delete("/:id", async (c) => {
  const userId = getRequiredUserId(c);
  const id = c.req.param("id");
  const db = getDb();
  const conn = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
    .limit(1);
  if (!conn[0]) return c.json({ error: "Connection not found" }, 404);

  const provider = getBankAccountDataProvider();
  try {
    if (conn[0].externalRequisitionId) {
      await provider.revokeConsent(conn[0].externalRequisitionId);
    }
  } catch (err) {
    console.error(`[BankConnections] Provider revoke failed: ${err}`);
    // Continue — we still mark our row as revoked
  }
  await db.update(bankConnections)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(bankConnections.id, id));

  return c.json({ message: "Connection revoked" });
});
```

### Wiring into `apps/api/src/index.ts`
```typescript
// Add to imports:
import { bankConnectionsRouter } from "./routes/bankConnections";

// Add to protectedPrefixes:
const protectedPrefixes = [
  // ... existing ...
  "/bank-connections",
];

// Mount the router (after other route mounts):
app.route("/bank-connections", bankConnectionsRouter);
```

### Sidebar Nav Edit
```typescript
// apps/web/app/(dashboard)/layout.tsx — add to navigationItems
{ key: "bankConnections" as const, href: "/bank-connections", iconName: "Banknote" as const },
```
Position immediately after `payments` and before `mandates`. Add `"bankConnections"` translation key in all four locales. Add `"bankConnections": []` (visible to all roles) to `NAV_VISIBILITY` — actually omit it from the map entirely since omitted keys are visible to everyone. Restrict to `owner` only if user prefers; the existing pattern blocks `settings` and `import` for non-owners — bank connections should follow the same rule because they're tied to landlord billing context.

### React Page Skeleton (parallel to `mandates/page.tsx`)
```tsx
// apps/web/app/(dashboard)/bank-connections/page.tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BankConnectionStatusBadge } from "@/components/BankConnectionStatusBadge";

export default function BankConnectionsPage() {
  const t = useTranslations("bankConnections");
  const [conns, setConns] = useState<any[]>([]);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/bank-connections`, { credentials: "include" })
      .then(r => r.json()).then(j => setConns(j.data || []));
  }, [apiUrl]);

  const handleConnect = async () => {
    // Redirect to /bank-connections/connect (institution picker)
    window.location.href = "/bank-connections/connect";
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Button onClick={handleConnect}>{t("connectBank")}</Button>
      </div>
      {/* Table-to-card responsive — see mandates page for reference */}
      {/* status badge, IBAN, institution name, lastSyncAt, expiresAt countdown, sync button, revoke action */}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GoCardless BAD (Nordigen) accepting new SaaS signups | Closed to new registrations | July 2025 | Must choose alternative provider; existing Phase 2 code stays but only usable if Rentular has a pre-July-2025 account |
| 90-day SCA re-consent window | 180-day mandatory exemption | EBA RTS amendment, gradual ASPSP rollout 2024–2026 | Provider-dependent; can't hardcode 90 |
| AISP licensing required to talk to Belgian banks | Licensed third parties (Ponto/Ibanity, Enable Banking, Tink) act as "regulated wrappers" | Stable since PSD2 enactment | Belgian banks don't expose direct customer APIs without an AISP intermediary |
| Polling-only transaction sync | Webhook + polling hybrid (some providers) | Provider-dependent; Ponto offers webhooks, Nordigen polling-only | Ponto integration could be reactive; staying with polling for now keeps parity |
| `gocardless-nodejs` 4.x | Latest is 8.1.0 | Continuous | Not relevant to BAD; the BAD client is `nordigen-node` |

**Deprecated/outdated:**
- GoCardless BAD new signups — closed July 2025.
- The hardcoded `setDate(+90)` in `GoCardlessBadProvider.createConsent` is regulatorily superseded; the source of truth must shift to provider-returned expiry.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (installed as devDep in apps/api per [VERIFIED: package.json]) |
| Config file | Not present at `apps/api/vitest.config.ts` — Phase 2 RESEARCH flagged this gap |
| Quick run command | `pnpm --filter @rentular/api test` |
| Full suite command | `pnpm test` (turbo cascade) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BANK-01 | List institutions for BE | unit (mock provider) | `pnpm --filter @rentular/api test bankConnections.list-institutions` | ❌ Wave 0 |
| BANK-02 | Initiate consent persists row | integration (mock provider + test DB) | `pnpm --filter @rentular/api test bankConnections.initiate` | ❌ Wave 0 |
| BANK-02 (callback) | Callback verifies state, updates to active | integration | `pnpm --filter @rentular/api test bankConnections.callback` | ❌ Wave 0 |
| BANK-02 (CSRF) | Callback rejects invalid state | unit | same as above | ❌ Wave 0 |
| BANK-03 | List connections for current user only | integration | `pnpm --filter @rentular/api test bankConnections.list` | ❌ Wave 0 |
| BANK-04 | Manual sync calls provider once | integration | `pnpm --filter @rentular/api test bankConnections.sync` | ❌ Wave 0 |
| BANK-05 | Revoke calls provider.revokeConsent and sets status | integration | `pnpm --filter @rentular/api test bankConnections.revoke` | ❌ Wave 0 |
| BANK-06 | Re-auth reuses institutionId | integration | `pnpm --filter @rentular/api test bankConnections.reauth` | ❌ Wave 0 |
| BANK-07 | Statement dedup via unique constraint | unit (DB) | `pnpm --filter @rentular/api test bankStatements.dedup` | ❌ Wave 0 |
| BANK-08 | Statement list endpoint scopes to owner | integration | `pnpm --filter @rentular/api test bankStatements.list` | ❌ Wave 0 |
| BANK-09 | State token signature verified, expiry enforced | unit | `pnpm --filter @rentular/api test bankOAuthState` | ❌ Wave 0 |
| BANK-10 | i18n strings present in all 4 locales | grep verification | `node scripts/check-i18n.js bankConnections` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @rentular/api test --reporter=verbose` (Wave 0 must establish a base test before this becomes meaningful)
- **Per wave merge:** `pnpm test` across monorepo
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Manual / Sandbox Validation (cannot be automated end-to-end)
Open Banking flows fundamentally require a real bank's SCA challenge. The following must be done manually in the chosen provider's sandbox before phase verification:
1. Sandbox bank login flow completes redirect successfully — verify `bank_connections.status` transitions `pending → active`.
2. Sandbox account returns at least one transaction with structured communication — verify matcher updates a payment to `paid`.
3. Sandbox consent expiry simulated (Ponto/Nordigen both expose a "force expire" sandbox endpoint) — verify worker Phase C sends the 7-day warning email.
4. State token forged with wrong owner — verify callback rejects with 400.
5. Multi-language: switch locale and verify all status badges + button labels render in NL/FR/DE.

### Wave 0 Gaps
- [ ] `apps/api/vitest.config.ts` — vitest config not present (Phase 2 RESEARCH flagged; never created)
- [ ] `apps/api/src/__tests__/bankConnections.test.ts` — covers BANK-01 through BANK-06
- [ ] `apps/api/src/__tests__/bankStatements.test.ts` — covers BANK-07, BANK-08
- [ ] `apps/api/src/__tests__/bankOAuthState.test.ts` — covers BANK-09
- [ ] `apps/api/src/__tests__/testHelpers/mockProvider.ts` — in-memory implementation of `BankAccountDataProvider` for tests
- [ ] `scripts/check-i18n.js` — already may exist for prior phases; verify before Wave 0
- [ ] Test DB strategy: Phase 2 SUMMARY confirms no test DB harness exists. Either spin up MySQL via testcontainers or use SQLite in-memory with Drizzle's SQLite dialect for unit tests (the schema uses MySQL-specific `mysqlEnum`/`mysqlTable` so SQLite needs a parallel schema definition — non-trivial). Recommendation: integration tests skipped in CI for v1, run manually against dev DB; unit tests cover pure logic (state token, dedup, matcher).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | NextAuth.js session + Hono `requireAuth` middleware (existing pattern) |
| V3 Session Management | yes | NextAuth cookies; JWT for short-lived OAuth state |
| V4 Access Control | yes | Verify `ownerId === c.get("userId")` on every route; same pattern as existing routes |
| V5 Input Validation | yes | `@hono/zod-validator` on all bodies + query params |
| V6 Cryptography | yes | `lib/encryption.ts` AES-256-GCM for stored tokens; `jose` HS256 for state JWT |
| V7 Error Handling | yes | Don't leak provider error details to client; log server-side, return generic error codes |
| V8 Data Protection | yes | Encrypt provider refresh tokens at rest; IBAN is PII (treat as such — already standard practice) |
| V9 Communication | yes | HTTPS only for provider callbacks (enforce via `BANK_CONNECTION_REDIRECT_URL` validation) |
| V10 Malicious Code | n/a | No third-party JS execution; provider SDK is server-side only |
| V11 Business Logic | yes | Provider rate limits, polling cadence, max connections per owner |

### Known Threat Patterns for Belgian Open Banking SaaS

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Callback state forgery — cross-account hijack | Spoofing | Signed state JWT (Pattern 1) |
| Refresh token theft from DB dump | Information Disclosure | AES-256-GCM at rest via `lib/encryption.ts` |
| Replay of consent link by attacker | Tampering | One-time-use state token + DB check `status='pending'` on callback |
| IDOR on `GET /bank-connections/:id/sync` | Elevation of Privilege | Filter by `ownerId === c.get("userId")` (Hono pattern) |
| CSRF on `POST /bank-connections` | Tampering | Existing Hono `csrf()` middleware applies (route is under `protectedPrefixes`) |
| Provider rate-limit DOS via manual sync button | Denial of Service | Rate-limit `POST /:id/sync` to 1 per minute per connection (track `lastSyncAt`) |
| Log leakage of access tokens | Information Disclosure | Never `console.log(token)`; mask in error messages; existing pattern uses masked GoCardless token in `/status` |
| Webhook spoofing (if provider supports webhooks) | Spoofing | Out of scope for Phase 9; polling-only |
| Stored XSS via institution name | Tampering | React auto-escapes; do not use `dangerouslySetInnerHTML` for any provider-returned strings |

### GDPR Considerations
- **Transaction data** is personal data of both the landlord and the debtor (tenant). Lawful basis: contract (rent reconciliation between landlord and Rentular) and legitimate interest (matching).
- **Retention:** Bank statement raw data should follow the same 12-month retention rule established for `webhook_events` (D-11 from Phase 2). After 12 months, the raw payload should be purged but the matched `payments` row stays. Recommend extending the existing `webhookCleanup.ts` worker to also purge `bank_statements` older than 12 months.
- **Right to erasure:** On account deletion, all `bank_connections` and `bank_statements` for that owner must be hard-deleted, not just soft-deleted. Out of scope for Phase 9 if no account-deletion flow exists yet — flag for milestone audit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ponto Connect is the best primary provider for Belgian rental SaaS | Standard Stack | If pricing is prohibitive (e.g., €5+/connection/month with no free tier), Enable Banking becomes primary. User must confirm after sales contact. |
| A2 | Single connected bank account per landlord is sufficient for v1 | Architecture, Pitfall 9 | Some landlords use multiple banks (rare in Belgium, more common with co-owners). Phase 9.5 deferred. |
| A3 | The polling worker's `BALANCE_CHECK_CRON` (3x/day) is acceptable for v1 cost discipline | Pitfall 9 | If provider pricing is per-call, 3x/day across the user base could be expensive. May need to drop to once/day. |
| A4 | Rentular does NOT have an existing pre-July-2025 GoCardless BAD account | Standard Stack, Pitfall 2 (Phase 2 Open Q1) | If user confirms they DO have one, GoCardless BAD becomes the primary provider with zero schema/code changes beyond the connection flow itself. |
| A5 | Provider-returned `consentExpiresAt` is the source of truth (could be 90 or 180 days) | Pitfall 1 | If the provider mis-reports, expiry warnings fire wrong. Mitigated by displaying countdown in UI based on stored value. |
| A6 | Single account per requisition is acceptable (callback picks `accounts[0]`) | Code Examples, Pattern callback | A landlord with a joint account + a business account at the same bank may need an account picker. Phase 9.5 deferred. |
| A7 | Bank connections should be owner-scoped (not delegatable to property managers) | Sidebar Nav Edit | If managers/accountants must trigger syncs, the role gate must change. User should confirm. |
| A8 | The "Representative" model (Ponto-specific) is not required for v1; landlords always connect their OWN bank | Provider Selection | If Rentular wants to support "I manage rent for Jan, here's a mandate to read his bank" then Ponto's Representative flow becomes load-bearing. Currently out of scope per the phase description. |
| A9 | Provider supports a `listInstitutions(country)` endpoint with structured returns | Pattern 2 | Both Ponto and Nordigen do. Enable Banking does too. Verified for Ponto and Nordigen via openbankingtracker.com; verified for Enable Banking via their docs. LOW risk. |
| A10 | 12-month retention for `bank_statements` matches the existing webhook retention policy | GDPR Considerations | User may want a different retention for transaction data (e.g., 7 years for Belgian tax compliance). Flag for confirmation. |

**If this table is empty:** N/A — assumptions are significant in this phase due to opaque provider pricing.

## Open Questions

1. **Provider selection — which one?**
   - What we know: GoCardless BAD closed to new signups; Ponto is Belgian-native and SaaS-friendly; Enable Banking is technically capable but newer; Tink is enterprise-priced.
   - What's unclear: (a) Whether Rentular has a pre-existing GoCardless BAD account, (b) actual Ponto pricing for ~10–100 landlords (typical SMB scale), (c) actual Enable Banking pricing.
   - Recommendation: **Block plan lock on user decision.** Concretely:
     - If pre-July-2025 GoCardless BAD account exists → use it (no new provider code, just the connection flow). Existing `GoCardlessBadProvider` is fine.
     - Else → recommend Ponto Connect; ask user to contact `sales@ibanity.com` for a quote before lock, or commit to "build provider abstraction without locking the choice and decide at deploy time."
     - If both Ponto and Enable Banking quotes are received and both are reasonable → pick Ponto for Belgian-domiciled support and Isabel Group brand recognition.

2. **Should the worker import bank statements into a new audit table (`bank_statements`)?**
   - What we know: Current matcher updates `payments` but discards raw transactions. This is fragile (no dedup safety net, no unmatched-transaction inbox, no GDPR-trackable audit).
   - What's unclear: Whether user accepts a new table (additive migration) or prefers minimum schema change.
   - Recommendation: **Yes, add it.** It's a small, additive change that closes three known gaps (dedup, audit, unmatched inbox).

3. **UI placement — dedicated page or settings tab?**
   - What we know: Settings has 4 tabs; adding a 5th makes it cramped. Bank Connections is a workflow, not preferences. Mandates is a top-level page; pattern is established.
   - What's unclear: User preference.
   - Recommendation: **Dedicated top-level sidebar page** "Bank Connections" between Payments and Mandates. Add a status widget in the GoCardless Settings tab linking to it.

4. **What sidebar icon?**
   - What we know: `lucide-react` is the icon library. Mandates uses `FileSignature`. Bank accounts in IBAN settings uses `Landmark`. Connecting / linking metaphor would be `Link2`, `Banknote`, or `BadgeEuro`.
   - What's unclear: Aesthetic preference.
   - Recommendation: **`Banknote`** — distinct from `Landmark` (used for stored IBAN bank accounts) and visually conveys money-flow vs. document-flow.

5. **Multi-account-per-requisition support?**
   - What we know: A single PSD2 consent (requisition) can grant access to multiple accounts at the same bank. The current callback code takes only `accounts[0]`.
   - What's unclear: How common is the multi-account scenario for Rentular's target SMB landlord?
   - Recommendation: **v1: single-account; v1.5: account picker on callback.** Document the limitation in the connect UI.

6. **Polling cadence — keep 3x/day or reduce?**
   - What we know: Cost discipline depends on provider pricing. The cron is already configurable via `BALANCE_CHECK_CRON`.
   - What's unclear: Provider pricing model.
   - Recommendation: **Keep 3x/day default; document the env var as a cost lever.**

7. **Should bank-connections be restricted to owner role only?**
   - What we know: Settings and Import are owner-only. Mandates is visible to all roles (no entry in `NAV_VISIBILITY`).
   - What's unclear: Whether co-owners and managers should see bank connections.
   - Recommendation: **Owner-only** (treat as billing-adjacent infrastructure). Add `bankConnections: ["co_owner", "manager", "accountant", "viewer"]` to `NAV_VISIBILITY` in layout.tsx.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | All API code | ✓ (per CLAUDE.md / package.json volta pin) | 20.19.0 | — |
| MySQL | Schema for `bank_statements` | ✓ (Phase 1+) | 5.7+ | — |
| Redis (BullMQ) | Worker (reuse existing queue) | ✓ (Phase 1+) | — | — |
| `nordigen-node` v1.4.1 | Existing GoCardless BAD provider | ✓ Installed | 1.4.1 | If switching providers, can stay installed as fallback |
| Ponto Connect SaaS credentials | NEW (if Ponto chosen) | ✗ Not provisioned | — | Block phase: requires sales contact + onboarding |
| Enable Banking SaaS credentials | NEW (if Enable chosen) | ✗ Not provisioned | — | Block phase: requires sales contact |
| GoCardless BAD existing account | Existing implementation | ❓ Unknown — depends on user | — | Block phase: confirm with user |
| `jose` for state JWT | New `bankOAuthState.ts` | ✓ Installed (NextAuth dep) | 6.2.1 | — |
| `lib/encryption.ts` AES-256-GCM | Token-at-rest encryption | ✓ Installed | — | — |
| Production HTTPS domain for callback registration | Provider redirect allowlist | ❓ depends on deploy state | — | Use ngrok / Cloudflare Tunnel for dev sandbox testing |

**Missing dependencies with no fallback:**
- Provider account (Ponto / Enable Banking / existing GoCardless BAD) — phase cannot ship without one. User confirmation required before plan lock.

**Missing dependencies with fallback:**
- Production HTTPS endpoint — can be deferred until deploy phase if dev uses ngrok / tunneling to test sandbox redirect.

## Project Constraints (from CLAUDE.md)

- **Tech stack frozen:** Next.js 15, Hono, Drizzle ORM, MySQL — all Phase 9 additions stay within this stack.
- **i18n in EN/NL/FR/DE:** All Phase 9 UI strings must exist in `apps/web/messages/{en,nl,fr,de}/common.json`. New keys recommended: `bankConnections.title`, `bankConnections.connectBank`, `bankConnections.statusActive`, `bankConnections.statusPending`, `bankConnections.statusExpired`, `bankConnections.statusError`, `bankConnections.statusRevoked`, `bankConnections.syncNow`, `bankConnections.revoke`, `bankConnections.expiresIn`, `bankConnections.lastSyncedAt`, `bankConnections.noConnections`, `bankConnections.selectInstitution`, `bankConnections.searchBanks`, `bankConnections.connectingTo`, `bankConnections.callbackSuccess`, `bankConnections.callbackError`. Also add `nav.bankConnections`.
- **CSRF middleware:** All state-changing routes (`POST`, `DELETE`) must NOT be excluded from the existing `csrf()` middleware in `apps/api/src/index.ts`. The callback route (`GET /bank-connections/callback`) is a GET so CSRF doesn't apply; instead it relies on the state JWT.
- **Belgian rental law context:** Bank connections are tied to Belgian IBAN accounts (BE prefix). The `ibanSchema` from `bankAccounts.ts` already validates this; the institution list should default to country=BE.
- **Per-contract pricing:** Rentular's revenue model is per-lease via Stripe. Bank connections are NOT separately priced to landlords — the provider cost is absorbed into Rentular's margin. This argues for keeping provider costs low (Ponto Customer-Paying model could shift cost to landlord; out of scope for v1 — use Partner Paying).
- **GSD workflow enforcement:** All edits flow through `/gsd:execute-phase`. Direct edits forbidden. (Affects how the planner structures plan files; no impact on research.)
- **No emojis in code or files** (per global `/Users/jnuyens/.claude/CLAUDE.md`).
- **No `Co-Authored-By` in commit messages** (per global CLAUDE.md).

## Sources

### Primary (HIGH confidence)
- **Project codebase** — direct reads of:
  - `apps/api/src/lib/bankAccountData.ts` (existing provider interface + GoCardless BAD impl)
  - `apps/api/src/services/transactionMatcher.ts` (existing matching logic)
  - `apps/api/src/jobs/paymentCheckWorker.ts` (existing Phase B/C polling code)
  - `apps/api/src/routes/gocardless.ts` (route pattern reference)
  - `apps/api/src/routes/bankAccounts.ts` (IBAN validation pattern)
  - `packages/db/src/schema/bankConnections.ts` (existing schema)
  - `apps/api/src/lib/encryption.ts` (AES-256-GCM helper)
  - `apps/web/app/(dashboard)/layout.tsx` (sidebar nav pattern)
  - `apps/web/app/(dashboard)/mandates/page.tsx` (page structure reference)
  - `apps/web/app/(dashboard)/settings/page.tsx` (tab pattern reference)
  - `.planning/phases/02-payment-processing-webhooks/02-RESEARCH.md` and `02-CONTEXT.md` (prior decisions D-04 through D-09)
  - `.planning/phases/08-gocardless-settings-ui-sepa-mandate-management/08-CONTEXT.md` (UI pattern reference)
  - `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`
- **npm registry** verified versions:
  - `nordigen-node@1.4.1` (published 2025-04-07, latest)
  - `gocardless-nodejs@8.1.0` (latest; project uses 4.2.0)
  - `@ibanity/*` — does not exist on npm
  - `enable-banking` — does not exist on npm
- **EBA Regulatory Technical Standards on SCA & CSC** — [paytechlaw.com summary](https://paytechlaw.com/en/regulatory-technical-standards-rts-sca-csc/)
- **EBA 90→180 day SCA exemption amendment** — [vixio.com](https://www.vixio.com/insights/pc-90-becomes-180-eba-makes-key-sca-change), [projectivegroup.com](https://www.projectivegroup.com/psd2-alert-authentication-period-for-account-information-services-extended-to-180-days/)

### Secondary (MEDIUM confidence)
- **GoCardless Bank Account Data API docs** — [developer.gocardless.com/bank-account-data/overview](https://developer.gocardless.com/bank-account-data/overview)
- **GoCardless registration closure (July 2025)** — [openbankingtracker.com/api-aggregators/gocardless](https://www.openbankingtracker.com/api-aggregators/gocardless) and confirmed via search of multiple community forums
- **Ponto Connect SaaS integration model** — [campaigns.ibanity.com](https://campaigns.ibanity.com/connect-bank-accounts-to-your-software-with-pontos-api-integrations-for-saas-providers)
- **Ponto Belgian bank list** — [openbankingtracker.com/api-aggregators/ibanity](https://www.openbankingtracker.com/api-aggregators/ibanity) (54+ banks including all major Belgian institutions)
- **Enable Banking Belgian market specifics** — [enablebanking.com/docs/markets/be/](https://enablebanking.com/docs/markets/be/)
- **Ponto Connect docs landing** — [documentation.ibanity.com/ponto-connect](https://documentation.ibanity.com/ponto-connect)
- **Ponto pricing models (Partner Paying vs Customer Paying)** — [myponto.com/en/pricing/](https://myponto.com/en/pricing/)

### Tertiary (LOW confidence — needs validation)
- **Actual pricing of Ponto Connect for SMB SaaS** — not public; sales contact required
- **Actual pricing of Enable Banking** — not public; sales contact required
- **Whether Rentular has a pre-July-2025 GoCardless BAD account** — must ask user
- **Per-Belgian-bank 180-day rollout status** — varies per bank, no consolidated public tracker

## Metadata

**Confidence breakdown:**
- Phase 2 inheritance / existing scaffolding: HIGH — direct codebase reads, no speculation needed
- Provider selection: MEDIUM — feature comparison is verified, pricing is not (sales-gated)
- Schema additions (`bank_statements`, encrypted token columns): HIGH — straightforward Drizzle additive migration
- Route shape: HIGH — derives from established Hono + zod-validator + ownership-check pattern across all existing routers
- UI placement (dedicated page vs. settings tab): MEDIUM — based on analogy with Phase 8 Mandates page, but ultimately a product preference
- EBA 180-day consent rule: HIGH — directly cited from regulatory tracking sources
- Pitfalls: HIGH for items inherited from Phase 2 RESEARCH; MEDIUM for new ones (state-token forgery, refresh-token encryption)
- Validation gaps: HIGH — Phase 2 RESEARCH already flagged the missing test infrastructure; nothing has been added since

**Research date:** 2026-05-11
**Valid until:** 2026-08-11 (90 days — open banking is a fast-moving regulatory area but the provider landscape and EBA rules are stable on 30–90 day horizons)

---

## Open Banking Provider Deep-Dive (Self-Serve Pricing)

**Research date:** 2026-05-11
**Trigger:** Follow-up to user feedback: "earlier provider table only surfaced sales-gated options. Re-check the ecosystem for any AISP with PUBLIC pricing AND SELF-SERVE online signup."

**Definition of "self-serve" for this review:** A developer can (1) sign up on the website with email + business name without speaking to a salesperson, (2) see exact prices on a public page before signing up, (3) reach an active production environment under their own contract by completing online forms — no quote negotiation required.

### Comparison Matrix

| Provider | Public Pricing? | Self-Serve Signup? | BE-6 Banks Covered | Free Tier / Sandbox | Cheapest Paid Tier | Node SDK | URL |
|----------|----------------|---------------------|----------------------|---------------------|--------------------|----------|-----|
| **finAPI** (BaFin-licensed, DE) | **YES — full tier table** | **YES — online order portal** | 13 BE banks via partner (specific 6 unconfirmed — sales request required) | 30-day free trial (form-based) | **€60/mo** flat for up to 200 users (B2C) / €100/mo (B2X — business accounts) | None official; REST + Berlin Group XS2A | https://www.finapi.io/en/prices/ |
| **GoCardless Bank Account Data** (Nordigen) | Was free; closed | **NO — closed to new signups since July 2025** | 5/6 covered (Crelan limited) | N/A — existing accounts only | N/A | `nordigen-node@1.4.1` | https://bankaccountdata.gocardless.com/ |
| **Enable Banking** (FI) | NO — "Get a Quote" tool | Sandbox self-serve YES; production NO | **All 6** (Belfius, KBC/CBC/KBC Brussels, BNP, ING, Argenta, Crelan) | Sandbox free; production "Restricted" mode free but explicitly **prohibits commercial use** | Sales-gated | None | https://enablebanking.com/ |
| **Ponto Connect** (Ibanity/Isabel Group, BE) | NO — "Schedule a call" | Sandbox free; production sales-gated | All 6 + Aion, Beobank, Keytrade, VDK | Free sandbox | Two undisclosed models ("Partner Paying" / "Customer Paying") | None | https://myponto.com/en/pricing/ |
| **Tink** (Visa) | NO — existing customers only | NO | Yes (BNP partnership) | None | "Personalised pricing" — contact sales | Yes (older) | https://tink.com/pricing/ |
| **TrueLayer** | NO | NO | Yes — 18 BE banks, 65% market | None published | Contact sales | Yes | https://truelayer.com/ |
| **Yapily** | NO — "Tailored pricing" | NO | KBC, CBC, ABN AMRO BE (Corp) — gaps in retail BE coverage | Sandbox free | Contact sales | Unofficial | https://www.yapily.com/pricing |
| **Klarna Kosma** | NO | NO | Belgium covered (specifics not public) | Time-limited sandbox program | Contact sales | None | https://www.klarna.com/kosma/ |
| **Salt Edge** | NO — usage-based custom | NO | Yes (BE coverage page exists) | Free trial possible | Contact sales | Unofficial | https://www.saltedge.com/ |
| **Plaid** | Partial pricing for US; EU custom | NO (EU) | Limited EU; BE coverage unclear from public docs | Free dev tier (US-focused) | EU pricing not public | Yes | https://plaid.com/en-eu/ |
| **Fintecture** | NO | NO | Yes (BE listed on coverage map) | — | Contact sales | None | https://www.fintecture.com/ |
| **Bridge (Bankin')** | NO | NO | 82+ banks; BE in coverage | — | Contact sales | None | https://bridgeapi.io/ |
| **Token.io** | NO | NO | 21 markets incl. BE | — | Contact sales | None | https://token.io/ |
| **Powens** (ex-Budget Insight) | NO | NO | 260+ institutions; BE included | — | Contact sales | Yes (older) | https://www.powens.com/ |
| **Finexer** | NO — "contact provider" | Partial | UK-focused; BE via PSD2 generic | — | Contact sales | Unclear | https://finexer.com/ |
| **BankingSDK** (open-source) | N/A (self-host) | YES — developer portal at developer.bankingsdk.com | Belgian project; covers BE banks | Free (open source) | Free | C#/.NET only (not Node) | https://github.com/JeanGabrielDebaille/BankingSDK |

### finAPI Pricing — Verbatim from https://www.finapi.io/en/prices/

| Tier (users) | Access B2C (private accounts) | Access B2X (private + business accounts) |
|--------------|-----|-----|
| Up to 200 (flat rate) | **€60 / month** | **€100 / month** |
| Up to 1,000 (flat rate) | €300 / month | €500 / month |
| 1,001 – 5,000 | €0.30 / user | €0.50 / user |
| 5,001 – 10,000 | €0.27 / user | €0.45 / user |
| 10,001 – 25,000 | €0.24 / user | €0.40 / user |
| 25,001 – 50,000 | €0.21 / user | €0.35 / user |
| 50,001 – 100,000 | €0.18 / user | €0.30 / user |
| 100,001+ | €0.15 / user | €0.25 / user |

Add-ons (each €20–€100 flat for small tiers, €0.05–€0.10/user at scale):
- International access (more countries beyond home market)
- Batch updates (background data refresh)

**Setup fees / minimums:** None published in the pricing table. Online order indicates an **initial 24-month contract term** [VERIFIED: finapi.io/en/order-now/].

**Onboarding mechanism:**
- "Order now" portal at https://www.finapi.io/en/order-now/ — products purchasable directly online including Banking-API Access (B2C, B2X variants), Add-on International, Add-on Batch, Demobank, AIS/PIS licence rental
- Identity of the purchaser is verified through **finAPI GiroIdent** before order completion (KYB check — Belgian companies should pass without issue)
- 30-day free trial at https://www.finapi.io/en/free-trial/ is form-gated (email + business details, then credentials issued) — not instant-API-key-on-signup, but unblocked without sales conversation

### Belgian Bank Coverage — finAPI

[VERIFIED: documentation.finapi.io/access/european-coverage-together-with-partner] finAPI states "With the help of our partner, we now provide connectivity to Belgium — 13 banks." The partner name is not publicly disclosed; the specific 13 banks are listed in a downloadable `Partner_Banks.xlsx` accessed via the documentation page (not surveyed in this research session).

[CITED: finapi.io/finapi-increases-its-presence-in-europe] finAPI launched in Belgium on **20 September 2023**, alongside France and the Netherlands.

**Coverage risk:** The "13 BE banks" figure is lower than Enable Banking's full-coverage roster of 30+ Belgian institutions and Ponto's 10+ major-bank list. Whether finAPI's 13 includes **all 6 priority banks (Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan)** is **not publicly verifiable from the website** and must be confirmed via sales pre-purchase. This is the **single biggest risk** in choosing finAPI [ASSUMED — high probability the 13 includes the BE-6 because these are the largest market-share institutions, but UNVERIFIED in this research session].

### Recommended Primary: **finAPI**

**Rationale:**
1. **Only candidate with truly public pricing** (transparent tier table, no hidden quote system)
2. **Only candidate with self-serve online ordering** for the Banking-API product (no sales call required to purchase)
3. **EU-domiciled (Germany, BaFin-licensed)** — same regulatory framework as Belgium, valid PSD2 AISP across the EEA
4. **Predictable Rentular cost:** at expected Year-1 scale (<200 connected landlord users), the bill is a flat **€100/month** on the B2X tier (because landlord bank accounts are business accounts — B2X is required, NOT B2C)
5. **Existing provider abstraction (`BankAccountDataProvider`) fits** — a new `FinApiProvider` class can be written using REST + Berlin Group XS2A patterns; no `nordigen-node`-style SDK required
6. **24-month initial contract is acceptable** — Rentular needs continuous bank connectivity to function; switching providers is non-trivial regardless

**Headroom math:** €100/mo * 12 = €1,200/year fixed. To break even at €19/landlord/month subscription (illustrative), Rentular needs ~6 paying landlords. Above 1,000 users the model shifts to €0.50/user/month — still well within SaaS gross-margin norms.

### Recommended Fallback: **Enable Banking** (Volume-Quote Tier)

**When to switch:** If finAPI's 13 BE banks turn out to NOT include all 6 priority institutions (likely Crelan or Argenta would be the gap), Enable Banking is the only verified-full-coverage alternative with EU domicile.

**Trade-offs:**
- Pricing is sales-gated (Get-a-Quote tool, minimum-monthly-invoice model)
- Sandbox is self-serve (start integration without commitment)
- Production requires written contract + KYB — but contract terms can presumably be negotiated to fit Belgian SaaS scale
- Best Belgian bank coverage in the market (all 6 priority banks + many smaller ones)

### Recommended Secondary Fallback: **Ponto Connect**

**When to consider:** If finAPI's BE coverage is inadequate AND Enable Banking quote returns unfavourable AND Rentular is willing to invest in a sales conversation. Ponto's "Customer Paying" model could allow landlords to pay Ibanity directly per connection, removing the SaaS-level pricing variable.

**Trade-offs:**
- Belgian-domiciled (Isabel Group) — strongest local fit
- All 6 priority banks covered
- Pricing is fully sales-gated — no public information
- ~100 SaaS integrators in production — well-established

### Disqualified (Sales-Gated, No Public Pricing)

- **Tink (Visa)** — "personalised pricing", new prospects must contact sales. Enterprise-grade, overkill for SMB Belgian landlord SaaS.
- **TrueLayer** — pricing not published; UK-centric.
- **Yapily** — "Tailored pricing for every business" — no public tier. Belgian retail bank coverage thin (KBC corporate-only on listed banks; BNP/Belfius/Argenta gaps).
- **Klarna Kosma** — sandbox-by-application program, no public pricing.
- **Salt Edge** — usage-based custom pricing, contact-only.
- **Plaid** — pay-as-you-go pricing public in US; EU pricing not public; Belgian retail coverage uncertain.
- **Fintecture / Bridge / Token.io / Powens / Finexer** — all "contact sales" models.

### Disqualified (Closed to New Customers)

- **GoCardless Bank Account Data / Nordigen** — **CONFIRMED closed to new signups since July 2025** [VERIFIED: multiple Firefly III / Invoice Ninja community threads dated Sept–Dec 2025; GoCardless support told community "open banking api will be only available to enterprise customers in the future"]. The existing `nordigen-node` wiring in Phase 2 (`bankAccountData.ts`) **cannot be used in production for Rentular** unless Rentular already holds a Nordigen/GoCardless BAD account predating July 2025 (presume NOT — confirm with the user).

### Disqualified (Not Suitable for Commercial B2B SaaS)

- **Enable Banking restricted/free mode** — explicitly prohibited for commercial use by terms: [CITED: enablebanking.com/terms/] *"These Terms do not grant any right or license to use the API for any business or professional purpose"*. The free production mode only works for accessing the developer's own pre-linked accounts, not for end-user-driven SaaS connections. (Enable Banking is still viable as the **paid-quote** fallback above.)

### Open-Source / Self-Host Options

- **BankingSDK** (JeanGabrielDebaille/BankingSDK on GitHub) — Belgian-origin open-source library connecting directly to bank PSD2 APIs without an aggregator intermediary. **.NET / C# only** — not viable for the Node.js stack without a rewrite or sidecar service. Also: using direct bank APIs requires **Rentular itself to hold an AISP licence** issued by the National Bank of Belgium, a multi-month regulatory effort. **Not viable for Phase 9.**
- No mature Node.js/TypeScript open-source PSD2 aggregator discovered in this review. Open-source approaches either (a) wrap an aggregator with the same licensing constraints (Firefly III's data-importer relies on GoCardless or Enable Banking — both gated as above), or (b) require the operator to obtain their own AISP licence.

### Impact on Phase 2 `BankAccountDataProvider` Abstraction

**The abstraction does NOT need modification.** The existing interface defined in Phase 2 covers exactly the operations finAPI exposes:
- `listInstitutions(country)` → GET `/api/v2/banks?country=BE`
- `createConsent({ institutionId, redirectUrl, reference })` → POST `/api/v1/bankConnections/import` then redirect to web-form URL
- `listAccounts(requisitionId)` → GET `/api/v1/accounts?bankConnectionIds=...`
- `getTransactions({ accountId, dateFrom, dateTo })` → GET `/api/v1/transactions?accountIds=...&minBookingDate=...`
- `revokeConsent(requisitionId)` → DELETE `/api/v1/bankConnections/{id}`

Implementation work is **a single new file** `apps/api/src/providers/finApiProvider.ts` parallel to the existing `bankAccountData.ts` (`GoCardlessBadProvider`). The factory function `getBankAccountDataProvider()` (Phase 2 line ~5 of `bankAccountData.ts`) picks the provider via env var `BANK_DATA_PROVIDER=finapi|nordigen|enable`.

**One-line addition to the existing interface** is recommended: a `getConsentStatus(requisitionId)` method, because finAPI's flow returns a "web form ID" rather than a requisition that's-completed-or-not — explicit status polling is needed during the redirect callback. The existing interface assumes the callback URL parameters alone identify completion (Nordigen pattern). This is a 2-line addition to `apps/api/src/providers/types.ts`, not a refactor.

### Updated Confidence Levels (this section)

| Claim | Confidence |
|-------|------------|
| GoCardless BAD is closed to new signups as of July 2025 | **HIGH** — verified by multiple independent community threads + by official GoCardless docs noting "Account verification is only offered to paying customers" with sales-contact requirement |
| Enable Banking prohibits commercial use of free tier | **HIGH** — directly quoted from enablebanking.com/terms/ |
| finAPI is the only candidate with public pricing + self-serve order | **HIGH** — verified by direct fetch of pricing + order-now pages |
| finAPI covers all 6 priority Belgian banks | **LOW** — UNVERIFIED, "13 banks" is publicly stated but the specific roster requires sales contact or Partner_Banks.xlsx download |
| finAPI has a 24-month initial contract | **MEDIUM** — pulled from order page content; not explicitly visible on the pricing page |
| Ponto Connect, Tink, Yapily, TrueLayer, Salt Edge are sales-gated | **HIGH** — verified by direct fetch of each pricing page |
| No Node.js open-source PSD2 aggregator exists with full BE coverage | **MEDIUM** — based on negative finding (extensive search, no match) rather than authoritative directory |

### Open Questions for User

1. **Does Rentular already hold a Nordigen / GoCardless BAD account predating July 2025?** If YES, the existing `GoCardlessBadProvider` implementation can be used in production and the provider question is resolved. If NO, finAPI becomes the recommendation pending bank-coverage verification.
2. **Acceptance of 24-month contract** — finAPI requires it; Ponto/Enable Banking commercial contracts probably similar.
3. **Bank coverage verification** — should research-phase contact finAPI sales for the bank list, or should we proceed with the recommendation contingent on a pre-signup verification email from the user?
4. **B2C vs B2X tier choice** — landlords typically operate via business bank accounts for commercial property income (B2X, €100/month). If hobby landlords with personal current accounts are also a target segment, B2C (€60/month) may apply, but mixing tiers requires careful product positioning.


## Budget-Constrained Path Research (≤€5/mo)

**Research date:** 2026-05-11
**Trigger:** Hard cost constraint from user — "under €5/month per landlord, ideally near €0". Every commercial AISP surveyed in the previous section (finAPI €60–€100/mo flat, Ponto Partner-Paying undisclosed, Enable Banking custom-quote with minimum monthly) exceeds this ceiling at any realistic launch volume.

**Question this section answers:** Can Rentular deliver "auto-import bank statements + match against rent payments" within a €0–€5/landlord/month budget, and at what UX cost?

### TL;DR Comparison Matrix

| Path | Cost / landlord / month (to Rentular) | Cost / landlord / month (to landlord) | Time-to-build | UX Quality | BE Bank Coverage | Maintenance Burden | Verdict |
|------|----------------------------------------|---------------------------------------|---------------|------------|--------------------|---------------------|---------|
| **A. Manual CAMT.053 / CODA / CSV upload** | **€0** | €0 | 2–3 weeks (parser + upload UI + reconciliation flow) | Medium — landlord uploads ~monthly; matching is automatic once uploaded; first-time onboarding requires "where do I find the export button?" guidance | Excellent — every BE bank supports at least one of CAMT.053, CODA, MT940, or CSV [VERIFIED: bank docs surveyed below] | Low–Medium — parsers are commodity once written; CSV per-bank quirks require periodic adjustment | **STRONGEST FIT for the €0 constraint. Recommended primary path.** |
| **B. Pay-per-use AISP** | Indeterminate — no surveyed AISP publishes a per-call rate that lands under €5/landlord/mo at typical poll volumes; all sales-gated | Indeterminate | 3–5 weeks (provider integration + connection flow + retry/expiry logic) | High — true auto-import, no landlord effort | Variable per provider | Medium | **NOT VIABLE — no AISP confirmed under €5/landlord/month at retail volumes** |
| **C. Rentular becomes a TPP (AISP licence)** | Spread over user base: ~€20–€40k year-1 fixed costs → at 1k landlords ≈ €2–€4/landlord/mo; at 100 landlords ≈ €20–€40/landlord/mo | €0 | **6–18 months** (NBB authorisation + eIDAS QWAC + direct bank API integration per institution) | Highest — fully owned UX | Whatever Rentular implements (Belfius, KBC, BNP, ING APIs each ≈4–8 weeks) | **Very High** — Rentular becomes a regulated entity with capital, governance, reporting, audit obligations | **NOT VIABLE for a small SaaS in 2026 — regulatory burden far exceeds Phase 9 scope** |
| **D. Open-source aggregator self-host** | €0 | €0 | Unknown — no mature Node.js OSS PSD2 aggregator exists | High in theory, none of the available projects are production-grade for BE | Project-dependent | High — Rentular maintains the integration | **NOT VIABLE — no Node.js OSS aggregator covers BE-6 banks production-quality. BankingSDK is .NET-only and also requires Rentular to be a TPP (see Path C).** |
| **E. Hybrid (Path A default + Ponto Customer-Paying premium)** | €0 (free tier) / €0 (premium — landlord pays Ponto directly via Customer-Paying) | €0 (free) / up to **€4/account/mo** paid to Ponto by landlord [VERIFIED: myponto.com + Odoo docs + Teamleader Focus] | 4–5 weeks (Path A + Ponto Customer-Paying integration) | Free tier: medium (upload). Premium: high (auto-sync) | Free tier: all BE banks via file upload. Premium: all 6 priority BE banks via Ponto | Medium | **STRONG SECONDARY — adds opt-in auto-sync without breaking the budget constraint, only paid by landlords who want the convenience** |

---

### Path A: Manual statement upload (NO PSD2) — DEEP DIVE

#### Belgian bank export capability matrix

Surveyed 2026-05-11. All twelve banks asked about explicitly:

| Bank | CAMT.053 (XML) | CODA (Belgian standard) | MT940 (SWIFT) | CSV | PDF | Retail self-serve? | Notes |
|------|----------------|--------------------------|---------------|-----|-----|---------------------|-------|
| **Belfius** | YES (XML reporting based on Febelfin standard) [CITED: belfius.be/professional reporting page] | YES (CODA) | YES (SWIFT) | YES (Belfius Direct Net "export history to CSV/Excel") [CITED: belfius.be FAQ] | YES (all clients) | YES — both retail (Belfius Direct Net) and pro (BelfiusWeb) | CODA is the Belgian native; CAMT.053 maps to it 1:1 [CITED: febelfin.be CODA 2.7 standard] |
| **KBC / CBC / KBC Brussels** | YES (CAMT and XML supported until further notice) [CITED: kbc.be/corporate ISO-20022 page] | YES (CODA) | YES (MT) | YES | YES | YES (KBC Touch + KBC Reach for business) | KBC explicitly states their conversion engine outputs CSV, CODA, XML, SWIFT [CITED: kbc.be electronic-account-information] |
| **BNP Paribas Fortis** | YES (XML/CAMT.053 via Easy Banking Business) | YES (CODA auto-delivery configurable) | YES (MT940) | YES (Easy Banking Web → "Account history → CSV download") [CITED: bnpparibasfortis.be FAQ + community forum] | YES (stored 10 years online) | YES for individuals (Easy Banking Web/App); broader formats via Easy Banking Business | CSV most accessible for retail; XML primarily a business-channel feature |
| **ING Belgium** | YES (camt.053.001.02) [CITED: ingwb.com formats page] | Limited (CODA configurable for business via Home'Bank Business) | YES (MT940 for business) | YES (Home'Bank export account movements to CSV) [CITED: ing.be/individuals/daily-banking] | YES | YES (Home'Bank for retail; intraday CSV/XML; statement frequency configurable) | Retail XML is documented but framed as a business feature; CSV is the safest assumption for landlords |
| **Argenta** | UNVERIFIED — not listed on the retail download page | UNVERIFIED for retail | UNVERIFIED for retail | **YES — but via Excel `.xlsx` download** [VERIFIED: homebank.argenta.be UI + community guides] | YES | YES — `homebank.argenta.be` → "Verrichtingen downloaden" | **40-row pagination limit per download** [CITED: rentcockpit.com community thread] — landlords with many transactions/month must download multiple files. Format is `.xlsx` (Excel), parseable by SheetJS / `xlsx` npm package |
| **Crelan** | UNVERIFIED at retail level (Crelan's PSD2 endpoints are documented for AISPs; export UI not surveyed) | Likely YES (CODA is industry standard in BE) | Likely YES | Likely YES | YES | YES | **Lower confidence — bank-specific verification needed before launch claim of "Crelan supported"** |
| **Beobank** | UNVERIFIED | UNVERIFIED | UNVERIFIED | Likely YES | YES | YES | Niche bank in landlord market; CSV is the realistic format |
| **Fintro** | Operates on BNP Paribas Fortis infrastructure — same formats as BNPPF [ASSUMED based on Fintro being a BNPPF brand] | Same as BNPPF | Same as BNPPF | Same as BNPPF | Same as BNPPF | YES | Treat as BNPPF for parser purposes |
| **AXA Bank Belgium** | UNVERIFIED | Likely YES (CODA standard) | UNVERIFIED | Likely YES | YES | YES | Now part of Crelan group post-2021 acquisition — likely converges on Crelan formats |
| **vdk bank** | UNVERIFIED | Likely YES | UNVERIFIED | Likely YES | YES | YES | Small bank; CSV is the safe fallback |
| **Hello Bank!** | Operates on BNP Paribas Fortis infrastructure [ASSUMED based on Hello Bank being a BNPPF brand] | Same as BNPPF | Same as BNPPF | Same as BNPPF | Same as BNPPF | YES | Treat as BNPPF for parser purposes |
| **bpost bank** | N/A | N/A | N/A | N/A | N/A | N/A | **Discontinued in 2022; integrated into BNP Paribas Fortis** [ASSUMED — verify if any landlords still reference this brand] |

**Coverage conclusion:** **Every major Belgian bank servicing landlords supports at least CSV export from their retail online banking platform.** CAMT.053 is reliably available at Belfius, KBC, BNP, and ING — the four largest. CODA is reliably available at every BE bank with a business channel. For Argenta retail, only `.xlsx` is confirmed.

**Retention windows:** BNP Paribas Fortis explicitly stores statements 10 years online [CITED: bnpparibasfortis.be FAQ]. Other banks not explicitly verified but Belgian retention regulation requires minimum 7 years. **A landlord can recover from a missed upload month — historical statements remain accessible.**

#### Node.js parser library survey (verified 2026-05-11)

| Library | npm Name | Last Publish | Version | License | Maintenance | Verdict |
|---------|----------|--------------|---------|---------|-------------|---------|
| **camt** | `camt` | "over a year ago" [VERIFIED: npm view camt] | 1.0.1 | MIT | Stale | Functional but dormant. Only 1 dependency (`xml4js`). Maintainer: sami-sweng. Acceptable for production with own test suite around it. |
| **camtjs** | `camtjs` | "over a year ago" [VERIFIED: npm view camtjs] | 0.0.7 | MIT | Stale | Pre-1.0; renames CAMT tags to ISO 20022 descriptions for easier JS access. Useful but immature. |
| **node-camt** | `node-camt` | "over a year ago" [VERIFIED: npm view node-camt] | 0.0.2 | MIT | Abandoned | v0.0.2; effectively unmaintained. |
| **camt-parser** | (GitHub only — `oroce/camt-parser`) | Not on npm | — | MIT | Abandoned | 2 commits total, no npm publish, README says "Not yet done" [VERIFIED: GitHub fetch]. Not viable. |
| **camtts** (Merzlabs) | (GitHub only) | 2021-09 | — | — | Abandoned | TypeScript camt.052 parser only — not 053. |
| **camt053-parser**, **iso20022-camt**, **iso-20022-xml-js** | — | — | — | — | **Do not exist on npm** [VERIFIED: npm view returned 404 for each] | The user's research-question candidate names are not real packages. |
| **mt940js** | `mt940js` | "over a year ago" [VERIFIED: npm view mt940js] | 1.3.5 | Apache-2.0 | Stable/quiet | Zero dependencies, 12 versions, beta 1.4.0 in pipeline. **Recommended MT940 parser** — Apache-2.0 license is compatible. |
| **mt940-js** (webschik) | `mt940-js` | UNVERIFIED in this session | — | — | UNVERIFIED | Separate package from `mt940js` despite confusable name. Lower-confidence option. |
| **node-mt940** | `node-mt940` | "over a year ago" [VERIFIED: npm view node-mt940] | 0.1.3 | LGPL-3.0 | Stale | LGPL licensing requires careful evaluation in a closed-source SaaS context. `mt940js` is the cleaner pick. |
| **@triptyk/coda-parser** | `@triptyk/coda-parser` | "over a year ago" [VERIFIED: npm view] | 0.0.0-alpha.0 (alpha tag exists at -alpha.5) | MIT | Stale, alpha | Belgian CODA parser, TypeScript, zero dependencies, requires Node ≥16 + TypeScript ≥4.5. **Only Node-native CODA parser found.** Alpha status is a concern; Rentular would likely fork/vendor for safety. |
| **xlsx** (SheetJS) | `xlsx` | Active | — | Apache-2.0 (community edition) | Active | **Required for Argenta `.xlsx` parsing.** Belt-and-braces — many other BE banks also offer Excel export. |
| **csv-parse** | `csv-parse` | Active | — | MIT | Active | Standard CSV streaming parser; needed for per-bank CSV variants (BNPPF, ING, Belfius). |

**Library recommendation for Path A:**
- **CAMT.053:** Vendor `camt@1.0.1` into the repo (small, dormant but functional) **OR** roll a thin wrapper using `fast-xml-parser` (already widely used in the Node ecosystem, actively maintained). The CAMT.053 XSD is stable and well-specified; a custom parser is ~200 LOC.
- **CODA:** Vendor `@triptyk/coda-parser` (alpha but the only Node option). Pin to a specific version and run an internal parser test suite against sample CODA files from each BE bank.
- **MT940:** Use `mt940js@1.3.5` (zero deps, Apache-2.0).
- **CSV (per-bank):** Use `csv-parse` with a per-bank adapter (header detection: which column is amount, date, structured communication).
- **XLSX (Argenta):** Use `xlsx` (SheetJS).

**Realistic build strategy:** Implement **CSV-first** for v1 because (a) every BE bank exports CSV, (b) per-bank header normalisation is a few hundred lines of mapping code, (c) no XML/binary parsing risk. Add CAMT.053 as a v2 upgrade for the four major banks where it provides richer structured-communication metadata.

#### Matching compatibility with existing `transactionMatcher`

[VERIFIED: codebase inspection during Phase 2 research] The Phase 2 matcher normalises payment-side and bank-side structured communications by digit-extraction (`.replace(/\D/g, '')`), so it accepts any format that exposes the OGM-VCS string as one of:
- `+++090/9337/55493+++`
- `***090/9337/55493***`
- `090933755493`
- `09093375549397` (12-digit electronic form)

CAMT.053 exposes structured creditor reference in `<RmtInf><Strd><CdtrRefInf><Ref>...</Ref>`. CODA exposes it in record-type-2 `communication` field at known offsets. CSV varies per bank but typically a "Communication" or "Mededeling" column carries the raw string.

**Therefore: no matcher changes required for Path A.** The phase only needs an upload endpoint that emits `{amount, date, externalRef, structuredCommunication}` rows into the existing `bank_statements` (proposed) or directly into the matcher.

**Matching latency:** With monthly manual upload, a payment that arrives on day 5 is matched on day ~30 when the landlord uploads. With PSD2 + 3-poll/day, the same payment matches within 8 hours. For Rentular's **email-reminder follow-up workflow**, the practical impact is one reminder might fire incorrectly if a tenant pays mid-month and the landlord hasn't yet uploaded — mitigation: a prominent "Last bank import: 23 days ago — your tenant may have paid" warning in the dashboard when the most recent statement is older than the configured reminder cadence.

#### Path A workflow sketch

1. Landlord navigates to `/dashboard/bank-statements` (new page, replaces "Bank Connections" wording from earlier Phase 9 spec)
2. UI shows: most-recent-imported date per IBAN, list of past uploads, "Upload statement" button
3. Click → file picker accepts `.csv`, `.xlsx`, `.xml` (CAMT.053), `.coda`, `.mt940`
4. Server detects format (sniff first 2 lines / file extension / XML root element), routes to appropriate parser
5. Parser emits transaction rows → dedup against `bank_statements` table on `(iban, bookingDate, amount, externalRef)` composite
6. New rows pass to `transactionMatcher` → updates `payments.status` as today
7. Landlord sees: "Imported 47 transactions. Matched 12 to rent payments. 35 unmatched (likely non-rent income/expenses)."

#### Path A risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Landlord forgets to upload → reminder emails fire incorrectly | Medium | Dashboard banner "Bank data is N days stale"; in-app email reminder to landlord at +30 days since last import; only auto-send tenant reminders if bank data < 14 days old (configurable) |
| Per-bank CSV format drift (banks change column headers) | Medium | Versioned per-bank adapter; surface "Unrecognised CSV format" error with the option to "report this format" → admin reviews and updates the adapter |
| Argenta 40-row pagination produces multiple files | Low | Multi-file upload (drag multiple `.xlsx` files; backend stitches them) |
| Duplicate transactions across overlapping monthly statements | Low | Composite-key dedup as described; this is exactly what the `bank_statements` audit table was scoped for in BANK-07 |
| Landlord uploads someone else's statement (mistake or attack) | Medium | IBAN on the statement must match an IBAN the landlord owns (verified via Phase 2's `bank_accounts` table); reject upload if not |
| Landlord uploads a forged/tampered statement | Low (no money moves on this signal alone) | Acceptable — manual import only changes the *status flag* on a payment that was already expected; it does not move money. Worst-case forgery makes the landlord *think* they were paid when they weren't, which the landlord harms only themselves with. |

---

### Path B: Pay-per-use AISP — dead end at this volume

For the surveyed providers, **none publishes a per-call price that lands under €5/landlord/month at realistic poll volumes** (30 calls/month minimum, 90 calls/month typical for 3x/day polling):

| Provider | Per-call public price? | Estimated cost at 90 calls/landlord/mo | Self-serve under €5? |
|----------|------------------------|-----------------------------------------|----------------------|
| Klarna Kosma | Not public. Free 3-month sandbox at 300 transactions [CITED: fintechfutures.com Klarna sandbox] | UNVERIFIABLE | No — sandbox only |
| Salt Edge | "Usage-based custom pricing" [CITED: saltedge.com] — no public per-call rate. Firefly III community confirms Salt Edge **withdrew free-tier access on 31 October 2025** [VERIFIED: firefly-iii community thread] | UNVERIFIABLE | No |
| TrueLayer | No public pricing [CITED: truelayer.com — pricing page contact-only] | UNVERIFIABLE | No |
| Yapily | "Tailored pricing for every business" [CITED: yapily.com] | UNVERIFIABLE | No |
| finAPI | Public — but model is per-USER (€0.50/user/mo on B2X tier at scale), not per-call. At 1 landlord = 1 user, this is €0.50/mo — **the only provider mathematically capable of <€5/landlord/mo at scale** [VERIFIED: finapi.io/en/prices], BUT the entry tier is a flat €100/month minimum for ≤1k users → **at <200 landlords the effective per-landlord cost is €0.50–€100/mo** depending on volume | €100/mo flat ÷ N landlords | YES at >200 landlords; NO below |
| Plaid (EU) | No public EU pricing [CITED: plaid.com/en-eu] | UNVERIFIABLE | No |

**Conclusion:** Path B is **not viable below ~200 connected landlords** at any surveyed provider. finAPI becomes viable above that scale but requires upfront commitment to a €100/month minimum (€1,200/year) — acceptable as a scale-tier addition, not as a launch strategy.

**Salt Edge "Free for personal use" specifically:** Withdrawn October 2025 for Firefly III-style use cases. Even when it existed, Salt Edge's terms restricted free-tier access to non-commercial use by named individuals. **Not viable for SaaS** [VERIFIED: firefly-iii data-importer documentation].

---

### Path C: Rentular becomes a TPP — not viable for Phase 9

Cost components (verified estimates from QTSP pricing surveys + EU regulatory literature):

| Component | Cost | Source |
|-----------|------|--------|
| eIDAS QWAC certificate (annual) | **€358/year** at Actalis (cheapest surveyed); typical range €500–€2,000/year across QTSPs | [CITED: actalis.com QWAC pricing] |
| eIDAS QSEALC certificate (annual, optional but practically required) | Similar range | [CITED: Sectigo, GlobalSign, Buypass QTSP pages] |
| NBB AISP authorisation — application | **Application fee structure not publicly listed** for AISP specifically | [CITED: nbb.be/en/financial-oversight/general/authorisation-information] |
| NBB AISP authorisation — process | Intake meeting → formal application → completeness review → substantive assessment → decision. Standard EU timing: 3 months from completeness if straightforward, up to 6 months total [CITED: nbb.be application guide PDF + Eubelius legal commentary] | |
| Ongoing supervision fees (annual) | Variable based on volume; published in NBB's annual fee schedule for "payment institutions" | [CITED: nbb.be/en/fees-companies-2025] |
| Initial capital requirement (AISP-only) | AISP has **no initial capital requirement** [CITED: nbb.be application guide, Eubelius commentary] — this is the only PSD2 licence that exempts capital, which makes Path C theoretically lighter than full PI/EMI licensing | |
| Direct bank API integration per institution | Belfius API + KBC API + BNP API + ING API each: ~4–8 weeks of integration effort, individual sandboxes/certifications | |
| Ongoing maintenance: 5+ direct integrations, breaking-change tracking, RTS compliance updates | Continuous engineering load — **probably the dominant cost over time** | |
| Insurance (professional indemnity) | Required for AISP — typical range €1–5k/year for low-volume | Industry standard |

**Time-to-market estimate:** **6–18 months** from "decide to do this" to "first production transaction." NBB authorisation alone is 3–6 months; per-bank certifications add another 3–6 months running in parallel.

**Verdict:** Even at the cheapest end (€358 cert + zero capital + DIY integrations), Path C is **engineering-headcount-bound, not cash-bound** — and the timeline (6–18 months) is incompatible with Rentular's "launch ASAP" constraint from CLAUDE.md. **Not viable for Phase 9.** Re-evaluate at Year 2+ if Rentular has >500 paying landlords and a dedicated platform engineer.

---

### Path D: Open-source aggregators — no Node option

Surveyed:
- **BankingSDK** (JeanGabrielDebaille on GitHub) — Belgian-origin OSS, covers BE banks via direct PSD2 integration. **.NET / C# only**. Using direct bank APIs requires the operator to **hold their own AISP licence** (Path C precondition). Even with rewrite to Node, the licensing pre-req kills it. Not viable.
- **Firefly III data-importer** — uses GoCardless BAD (closed to new customers since July 2025) or Salt Edge (free tier withdrawn October 2025). Self-host doesn't save you — the aggregator behind it is the gatekeeper. [VERIFIED: firefly-iii GitHub discussions + docs]
- **No production-grade Node.js / TypeScript open-source PSD2 aggregator discovered** in this review. Negative finding with MEDIUM confidence (search was extensive; absence of result strongly suggests absence of project).

**Verdict:** No viable Path D in the Node ecosystem in 2026.

---

### Path E: Hybrid (manual default + premium auto-sync) — recommended secondary

**Key insight from this research session:** **Ponto Connect's "Customer Paying" model bills the end-user directly at up to €4/month per linked bank account** [VERIFIED: myponto.com customer-paying-model + Odoo 14/15/16 docs + Teamleader Focus integration docs]. This converts what was previously a "Rentular pays €4/landlord/month" cost into a "landlord pays €4/landlord/month to Ponto directly" — **Rentular's cost is €0**.

**Pricing model sketch (Hybrid):**

| Plan | Statement Import | Cost to Landlord | Cost to Rentular |
|------|------------------|-------------------|-------------------|
| **Free / Basic** (default) | Manual upload (CAMT/CODA/CSV/XLSX) | €0 | €0 |
| **Auto-Sync Add-On** (opt-in) | PSD2 daily auto-import via Ponto | **€4/account/month** (paid directly to Ponto by the landlord on their own Ponto account; Rentular optionally markets it as +€5/mo with a €1 markup) | €0 (Ponto bills landlord; Rentular receives no money for this path) |

**Mechanics of "Customer Paying":**
1. Landlord clicks "Enable Auto-Sync" in Rentular
2. Rentular redirects them to Ponto's self-service signup
3. Landlord registers directly with Ibanity on their own account, links their bank
4. Ponto issues an OAuth client representing the landlord's Ponto account to Rentular
5. Rentular polls Ponto using that landlord's individual Ponto credentials
6. Ponto bills the landlord directly each month (€0 if no accounts linked; up to €4 per linked account)

**Trade-offs vs pure Path A:**
- ✅ Removes the "landlord forgot to upload" failure mode for opted-in users
- ✅ Generates a premium funnel for power-users without Rentular taking on per-user cost
- ✅ Belgium-domiciled provider, full BE-6 bank coverage
- ❌ Adds a Ponto-side onboarding step (landlord registers with a third party) — friction
- ❌ Rentular doesn't capture margin (unless markup model used)
- ⚠️ Ponto's "Customer Paying" requires the landlord to sign a contract directly with Ibanity — Rentular's terms-of-service must disclose this

**Implementation impact:** Path E ≈ Path A (manual upload, mandatory) + a deferred Phase 9.5 or Phase 10 ticket adding the Ponto Customer-Paying flow. **The Phase 9 plan does NOT need to ship the Ponto integration on day 1.** Ship Path A in Phase 9, ship Path E premium in a future phase once Path A is stable.

---

### Recommendation

**PRIMARY: Path A — Manual statement upload, all banks, CSV-first with CAMT.053/CODA/MT940/XLSX support added incrementally.**

**SECONDARY (future phase): Path E — add Ponto Customer-Paying as an opt-in premium feature once Path A is stable.**

**Rationale:**
1. **The €5/month constraint is structurally incompatible with any AISP at Rentular's launch scale.** finAPI's €100/month flat is the cheapest, and it pays back only above ~200 connected landlords. At 0–200 landlords Rentular would be subsidising the connection for everyone.
2. **Manual upload is not a downgrade for the core use case.** Rent reconciliation is inherently monthly — landlords already think in monthly cycles. A monthly upload is consistent with that mental model. The 30-day matching latency only matters for the auto-reminder edge case, which is mitigated by the "bank data is N days stale" UI banner.
3. **Every BE bank surveyed supports a self-serve export.** The format varies (CSV is universal, CAMT.053 and CODA are common, Argenta uses XLSX with 40-row limit), but no landlord is **excluded** from the system.
4. **The existing `transactionMatcher` is format-agnostic.** Path A reuses 100% of the Phase 2 matching engine — only the *ingestion* changes.
5. **Path E preserves the auto-sync future** without taking on the cost today. The €4/account Customer-Paying model is the only commercial AISP option that fits the budget — and only because the landlord pays Ponto directly, not because Rentular passes through.
6. **CLAUDE.md "launch ASAP" constraint** strongly favours the 2–3 week Path A timeline over Path C's 6–18 months or Path B's "wait for sales calls and 24-month contracts."

### What this means for Phase 9 scope

**Phase 9 reframes from "PSD2 Bank Connection Flow" to "Bank Statement Upload + Reconciliation."**

The requirements change from BANK-01 through BANK-10 (PSD2-oriented) to:

| New ID | Description |
|--------|-------------|
| **STMT-01** | Landlord can upload a bank statement file (CSV/XLSX/CAMT.053/CODA/MT940) and the system parses it, deduplicates against prior imports, and runs the matcher |
| **STMT-02** | UI accepts files via drag-and-drop on `/dashboard/bank-statements`; supports multi-file (for Argenta 40-row pagination) |
| **STMT-03** | Per-bank format adapters exist for at least Belfius, KBC, BNP Paribas Fortis, ING (CSV-first); Argenta `.xlsx` is supported |
| **STMT-04** | Imported transactions persist in a new `bank_statements` table (the same audit/dedup table previously scoped for BANK-07) |
| **STMT-05** | Dashboard shows "Last import: N days ago" status per IBAN; warns the landlord above a configurable staleness threshold |
| **STMT-06** | Tenant follow-up reminders are gated on bank-data freshness — system does not send "you haven't paid" if the last import is older than the reminder cadence (e.g., last import 35 days ago + tenant's payment was on day 5 means we'd falsely flag them) |
| **STMT-07** | All upload-flow UI strings exist in EN, NL, FR, DE |
| **STMT-08** | Landlord can view a list of imported transactions per IBAN with match status (matched / unmatched / mismatched-amount / ignored) |
| **STMT-09** | Upload validates that the IBAN(s) in the file match an IBAN the landlord has registered on a property (Phase 2 `bank_accounts` table); rejects if not |

The **existing Phase 2 scaffolding for `BankAccountDataProvider`, `bank_connections`, and the `paymentCheckWorker` polling cycle** remains valid as deferred infrastructure for a future Path E (Ponto Customer-Paying) phase. **It is not removed.** Phase 9 simply doesn't activate it; the worker continues to no-op when no `bank_connections` rows exist (current behaviour).

### Deal-breakers and regulatory risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Landlord uploads sensitive statement → GDPR data-residency exposure | Medium | Medium | Statements are stored encrypted at rest; the `bank_statements` table stores only `amount`, `date`, `iban` (already known), `externalRef`, `structuredCommunication`, `counterparty_name` (last 4 chars masked) — full statement file deleted after parse, not retained as a blob |
| Argenta 40-row limit blocks high-volume landlords (>40 tx/month) | Low (typical residential landlord: 5–20 rent payments/month) | Low | Multi-file upload supported; document the workaround on the help page |
| Bank changes CSV format → Rentular's adapter breaks | Medium | Medium | Versioned adapters per (bank, format-revision); CI check that runs a sample-file regression suite per bank; surface "unrecognised format" with a "report this format" link |
| Landlord uploads forged statement to "claim" payment received that didn't happen | Low | Low (self-harm only — money doesn't move) | No reconciliation rule moves money based on Path A imports. Worst case the landlord delays sending a legitimate reminder, harming only themselves. |
| Tenant disputes that they paid — landlord's imported data is incomplete | Medium | Medium | Audit table stores raw import history with file metadata (filename, uploaded-by, uploaded-at, sha256 of source file); tenant can request export of "what your landlord saw" if escalated |
| GDPR-DSR for tenant: tenant requests deletion of their bank transaction data from Rentular | Medium | Medium | `bank_statements.counterparty_name` field is the linkable PII. Soft-delete + retention policy needed. Defer to Phase 9 plan; not blocking. |
| Path A doesn't comply with a regulatory rule we don't know about | Low | High | **No regulatory requirement mandates PSD2 over manual upload for rent reconciliation** — landlords have always imported CSVs to Excel; Rentular is doing the same thing programmatically. Manual upload is the dominant pattern at competitor Smovin per Phase 1 research [CITED: phase 1 competitive analysis]. |

### Updated confidence levels (this section)

| Claim | Confidence |
|-------|------------|
| Every major BE bank offers retail self-serve statement export in at least one format Rentular can parse | **HIGH** — verified for Belfius, KBC, BNP, ING, Argenta directly; smaller banks (Crelan, Beobank, AXA Bank, vdk) ASSUMED based on industry-standard CODA support |
| Path A can be built in 2–3 weeks | **MEDIUM-HIGH** — depends on how many per-bank CSV adapters ship at v1 (recommend just CSV-only at launch, then CAMT.053/CODA/MT940/XLSX as fast-follow) |
| `mt940js` is the right MT940 library | **HIGH** — npm-view verified, zero dependencies, Apache-2.0 |
| `camt` (npm) is acceptable for CAMT.053 | **MEDIUM** — package is stale ("over a year ago"); usable but Rentular should vendor and add own tests |
| `@triptyk/coda-parser` is the right CODA library | **MEDIUM** — alpha tag, low stars, but only Node-native CODA parser found |
| Ponto Customer-Paying is €4/account/month and bills landlord directly | **HIGH** — three independent sources: myponto.com customer-paying-model, Odoo docs (14/15/16), Teamleader Focus integration FAQ |
| No commercial AISP exists with public per-call pricing under €5/landlord/mo at retail volumes | **HIGH** — verified by direct fetches of pricing pages of all major providers |
| No production-grade Node.js OSS PSD2 aggregator exists | **MEDIUM** — negative finding |
| Path C (Rentular as TPP) takes 6–18 months | **MEDIUM-HIGH** — based on NBB application guide + industry-standard EU TPP authorisation timelines |

### Open Questions (Budget-Constrained)

1. **Does the user accept manual monthly upload as the v1 UX?** This is the single biggest product decision implied by the Path A recommendation. Manual upload is a step backwards from "auto-sync" promised in earlier marketing, but is the only way to hit the €0 cost target.
2. **CSV-first or all-formats-at-launch?** CSV alone covers every BE bank but loses some richness (CAMT.053 has clean structured-communication fields; CSV per-bank often does not). Recommend CSV-first.
3. **Hybrid timeline:** Should Phase 9 ship Path A only, or scope Path E (Ponto Customer-Paying) into a follow-up Phase 9.5? Recommendation: defer Path E to a later phase to keep Phase 9 small and shippable.
4. **Argenta `.xlsx` parsing — accept the 40-row limit with multi-file upload, or invest in OCR of PDF statements as a fallback?** Recommend multi-file upload; OCR is a much bigger project.
5. **Marketing impact:** Does the user want to position the manual flow as "for now" or as the permanent free tier with auto-sync as a paid upgrade? This affects copy in onboarding and landing pages.

### Sources

- [Belfius CODA reporting documentation](https://www.belfius.be/professional/fr/banque-par-vous-meme/services/reporting-coda/index.aspx)
- [Belfius Direct Net CSV export FAQ](https://www.belfius.be/webapps/fr/selfcare/belfius/comptes/solde-historique/Comment-exporter-mon-historique-vers-un-fichier-CSV-(Excel)-en-Belfius-Direct-Net-)
- [KBC ISO-20022 corporate documentation](https://www.kbc.be/corporate/en/article/payments/iso-20022.html)
- [KBC electronic account information formats](https://www.kbc.be/corporate/en/product/payments/tools/electronic-account-information.html)
- [BNP Paribas Fortis Easy Banking statements FAQ](https://www.bnpparibasfortis.be/en/public/faq/how-to-download-your-statements-in-easy-banking-business)
- [ING Belgium electronic account statements (retail)](https://www.ing.be/en/individuals/daily-banking/electronic-account-statements)
- [ING Wholesale Banking formats catalogue](https://www.ingwb.com/en/service/our-international-network/emea/czech-republic/ing-formats-for-electronic-communication)
- [Febelfin CODA 2.7 standard PDF](https://febelfin.be/media/pages/publicaties/2023/febelfin-standaarden-voor-online-bankieren/5d601609cd-1754302976/standard-coda-2.7-en.pdf)
- [Febelfin CODA file explainer](https://febelfin.be/en/themes/digitalization-innovation/regulations/a-coda-file-what-is-it-and-what-can-you-use-it-for)
- [Ponto Connect pricing overview](https://myponto.com/en/pricing/)
- [Ponto Customer-Paying model](https://myponto.com/en/pricing/customer-paying-model/)
- [Odoo documentation — Ponto pricing at €4/month per account](https://www.odoo.com/documentation/16.0/applications/finance/accounting/bank/bank_synchronization/ponto.html)
- [Argenta retail downloads — rentcockpit community thread on 40-row limit](https://rentcockpit.com/forums/topic/csv-argenta-bank/)
- [GitHub: TRIPTYK/typescript-coda-parser](https://github.com/TRIPTYK/typescript-coda-parser)
- [GitHub: oroce/camt-parser (dormant)](https://github.com/oroce/camt-parser)
- [GitHub: sami-sweng/camt (npm package source)](https://github.com/sami-sweng/camt)
- [npm: mt940js](https://www.npmjs.com/package/mt940js)
- [npm: camt](https://www.npmjs.com/package/camt)
- [npm: @triptyk/coda-parser](https://www.npmjs.com/package/@triptyk/coda-parser)
- [Actalis QWAC certificate pricing](https://www.actalis.com/qwac-certificates)
- [NBB authorisation information](https://www.nbb.be/en/financial-oversight/general/authorisation-information)
- [NBB application guide for Belgian payment institutions](https://www.nbb.be/doc/cp/eng/2022/application_guide_payment_institutions.pdf)
- [Firefly III Enable Banking GitHub issue 10753](https://github.com/firefly-iii/firefly-iii/issues/10753)
- [Firefly III data-importer documentation — Salt Edge withdrawn October 2025](https://docs.firefly-iii.org/explanation/data-importer/about/gocardless-salt-edge/)
