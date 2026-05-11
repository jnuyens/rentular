---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
plan: 03
subsystem: bank-connections
tags: [hono, api, oauth, psd2, ponto, bullmq, drizzle, encryption, vitest]
requires:
  - apps/api/src/lib/bankAccountData.ts PontoConnectProvider class (Plan 09-02)
  - apps/api/src/lib/pontoConnect.ts REST/OAuth client (Plan 09-02)
  - apps/api/src/lib/bankOAuthState.ts JWT helper (Plan 09-02)
  - apps/api/src/lib/encryption.ts AES-256-GCM helper (existing)
  - packages/db/src/schema/bankStatements.ts (Plan 09-01)
  - packages/db/src/schema/bankConnections.ts encrypted token columns (Plan 09-01)
provides:
  - apps/api/src/routes/bankConnections.ts Hono router (8 endpoints)
  - apps/api/src/services/bankStatementImporter.ts (encrypted dedup-safe importer)
  - apps/api/src/services/bankConnectionSync.ts (single source of truth for sync pipeline)
  - paymentCheckWorker Phase B refactor — delegates to syncBankConnection
  - /bank-connections protectedPrefix entry with /callback session-auth exemption
affects:
  - apps/api/src/index.ts (mount + protectedPrefix + auth-exemption wrapper)
  - apps/api/src/jobs/paymentCheckWorker.ts (Phase B inline matcher removed)
tech-stack:
  added: []
  patterns:
    - "Service-shared sync pipeline — syncBankConnection is called by both the cron-driven worker (Phase B) and the manual POST /:id/sync route, eliminating the duplication of provider/matcher/sync-cursor logic"
    - "Per-row try/catch with ER_DUP_ENTRY swallow — bank_statements UNIQUE(connection_id, external_transaction_id) is the dedup safety net (RESEARCH Pattern 3)"
    - "Encryption-at-rest triplet — every PII column on bank_statements (counterpartyName, counterpartyIban, rawPayload) is stored as { encrypted, iv, tag } via lib/encryption.ts AES-256-GCM"
    - "OAuth state JWT replaces session cookie on the single /callback path — the protectedPrefixes wrapper in index.ts is patched to exempt this one path (T-09-03-01)"
    - "Token-column sanitization on every list/detail response — sanitizeConnection helper strips 7 sensitive columns (4 encryption fields + tokenIv + authTag pairs + providerMetadata) before c.json (T-09-03-03 defense-in-depth)"
key-files:
  created:
    - apps/api/src/services/bankStatementImporter.ts
    - apps/api/src/services/bankConnectionSync.ts
    - apps/api/src/services/__tests__/bankStatementImporter.test.ts
    - apps/api/src/routes/bankConnections.ts
    - apps/api/src/routes/__tests__/bankConnections.test.ts
  modified:
    - apps/api/src/index.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
decisions:
  - "POST /:id/sync rate limit is in-memory (per-process Map keyed by ownerId:connectionId) — CONTEXT line 156 marks Redis-based limiter optional for v1; in-memory is acceptable for single-instance Proxmox/Hetzner Docker deployment"
  - "Callback /bank-connections/callback exempted from requireAuth via path-suffix check inside the protectedPrefixes wrapper (chosen over a deny-list because it touches one line and is grep-discoverable). State JWT signature gate replaces session auth."
  - "Best-effort revoke on DELETE — Ponto revoke call wrapped in try/catch with logging; soft-delete proceeds even if revoke fails because the row may already be expired/revoked upstream"
  - "First-sync backfill window 90 days (RESEARCH Pitfall 8) — replaces the inline 3-day fallback that previously lived in paymentCheckWorker Phase B"
  - "matchedPaymentId per-row linkage on bank_statements is best-effort in v1 — processIncomingTransactions returns counts not row-level identifiers, so syncBankConnection sets matchStatus on inserted rows that had ≥12-digit structured communication; precise per-row matched_payment_id requires a matcher-signature change which is deferred"
metrics:
  duration_seconds: 580
  duration_pretty: "9m 40s"
  tasks_completed: 3
  files_created: 5
  files_modified: 2
  completed_at: "2026-05-11T23:13:58Z"
---

# Phase 09 Plan 03: API Routes + Importer + Worker Refactor Summary

**One-liner:** Lands the 8-endpoint Hono router that powers the dashboard UI (Plan 04 consumer), the encrypted dedup-safe `bankStatementImporter`, the shared `syncBankConnection` service called by both the cron worker and the manual sync route, and a refactor that eliminates inline-matcher duplication from `paymentCheckWorker` Phase B.

---

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 (RED) | Failing test for bankStatementImporter (encrypt + dedup + normalize) | `9616f6e` | `apps/api/src/services/__tests__/bankStatementImporter.test.ts` |
| 1 (GREEN) | Implement bankStatementImporter + bankConnectionSync services | `d96cac2` | `apps/api/src/services/bankStatementImporter.ts`, `apps/api/src/services/bankConnectionSync.ts` |
| 2 | bankConnections Hono router (8 endpoints) + mount + protectedPrefix wiring | `b436131` | `apps/api/src/routes/bankConnections.ts`, `apps/api/src/index.ts` |
| 3 | paymentCheckWorker Phase B refactor + bankConnections route tests | `65d0308` | `apps/api/src/jobs/paymentCheckWorker.ts`, `apps/api/src/routes/__tests__/bankConnections.test.ts` |

---

## 8 Hono Endpoints (Mounted at `/api/v1/bank-connections`)

| # | Method | Path | Purpose | Auth |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/institutions` | List Ponto financial institutions for the picker (zValidator query `country` default `"BE"`) | Session cookie + CSRF |
| 2 | `POST` | `/` | Initiate OAuth flow — inserts pending `bank_connections` row, returns `{ id, consentLink }` | Session cookie + CSRF |
| 3 | `GET` | `/callback` | OAuth callback — verifies state JWT, exchanges code → tokens, encrypts tokens, sets row `active`, redirects to dashboard | **State JWT only** (session-cookie auth exempted) |
| 4 | `GET` | `/` | List current owner's connections, **token columns stripped** | Session cookie + CSRF |
| 5 | `GET` | `/:id` | Single owner-scoped connection (404 if missing or wrong owner), **token columns stripped** | Session cookie + CSRF |
| 6 | `POST` | `/:id/renew` | Return a fresh `consentLink` for re-consent (signs renewal state JWT with `connectionId`) | Session cookie + CSRF |
| 7 | `DELETE` | `/:id` | Best-effort `revokeAccess(token)` then soft-delete (`status='revoked'`, tokens nulled). **`bank_statements` retained** | Session cookie + CSRF |
| 8 | `POST` | `/:id/sync` | Manual sync — rate-limited **1/min per connection** (in-memory Map). Calls `syncBankConnection`. | Session cookie + CSRF |

---

## Services Created

### `apps/api/src/services/bankStatementImporter.ts`

```typescript
export interface ImportedStatement {
  id: string;
  externalTransactionId: string;
  amount: number;
  bookingDate: string;
  structuredCommunicationDigits: string | null;
  debtorName: string | null;
  debtorIban: string | null;
}

export async function importBankStatements(
  connectionId: string,
  transactions: IncomingTransaction[],
): Promise<{ inserted: ImportedStatement[]; skippedDuplicates: number }>;
```

- Per-row try/catch (not batch INSERT) so one duplicate can't abort the whole batch.
- `encrypt(tx.debtorName ?? "")` + `encrypt(tx.debtorIban ?? "")` + `encrypt(JSON.stringify(tx))` → three column-triplets per row.
- `ER_DUP_ENTRY` (mysql2 code) AND `"Duplicate entry"` (message) both treated as dedup hits.
- Returns only plaintext-safe fields (no encrypted ciphertext leaks back to callers).

### `apps/api/src/services/bankConnectionSync.ts`

```typescript
export async function syncBankConnection(connectionId: string): Promise<{
  fetched: number;
  matched: number;
  mismatched: number;
  unmatched: number;
  skippedDuplicates: number;
}>;
```

Pipeline:
1. Load row → refuse if `status !== "active"` (returns zeros, NOT an error).
2. Decrypt access + refresh tokens via `lib/encryption.ts` triplet.
3. Construct `PontoConnectProvider` with `getBankAccountDataProvider({ accessToken, refreshToken })`.
4. `dateFrom = lastSyncAt ?? now - 90 days` (CHANGED from inline 3-day worker fallback per RESEARCH Pitfall 8).
5. `provider.getTransactions({ accountId, dateFrom })` → `importBankStatements` → `processIncomingTransactions`.
6. Best-effort `UPDATE bank_statements SET matchStatus, matchedAt` on inserted rows with structured-communication ≥12 digits.
7. `UPDATE bank_connections SET lastSyncAt=now(), errorMessage=null, updatedAt=now()`.
8. Throws on provider error — caller (worker or route) decides how to log/persist the failure.

---

## Worker Delta (Phase B)

**Before** (`paymentCheckWorker.ts` lines 264-310):
- Inline `provider.getTransactions(...)` call.
- Inline 3-day fallback (`Date.now() - 3 * 24 * 60 * 60 * 1000`) for first sync.
- Inline `processIncomingTransactions(conn.ownerId, transactions)`.
- Inline `UPDATE bank_connections SET lastSyncAt = new Date()`.

**After:**
- Single `const result = await syncBankConnection(conn.id);` call inside the per-connection try block.
- Per-iteration try/catch retains the existing `errorMessage` write on failure (preserves behavior).
- The 3-day window literal `3 * 24 * 60 * 60 * 1000` is removed; 90-day backfill lives in the service.
- Phase A (overdue reminders) and Phase C (consent-expiry warnings) untouched.
- `processIncomingTransactions` import removed from the worker (now only inside the service).
- `getBankAccountDataProvider` import retained — Phase C still calls `renewConsent` via the factory.

---

## Sanitization Fields Stripped From API Responses

The `sanitizeConnection` helper in `apps/api/src/routes/bankConnections.ts` strips **7 fields** from every `GET /` and `GET /:id` response (T-09-03-03 defense-in-depth):

| # | Field | Reason |
| --- | --- | --- |
| 1 | `encryptedAccessToken` | Ciphertext — never returned even though encrypted |
| 2 | `tokenIv` | IV — combined with auth tag could enable offline attack if key leaks |
| 3 | `tokenAuthTag` | GCM auth tag |
| 4 | `encryptedRefreshToken` | Ciphertext for refresh-token rotation |
| 5 | `refreshTokenIv` | IV for refresh ciphertext |
| 6 | `refreshTokenAuthTag` | GCM auth tag for refresh ciphertext |
| 7 | `providerMetadata` | Contains Ponto `organisation_id` / `integration_id` / `account_ids[]` — internal-only routing data |

Public fields returned: `id, ownerId, provider, externalRequisitionId, externalAccountId, institutionId, institutionName, iban, status, consentExpiresAt, lastSyncAt, lastSyncCursor, errorMessage, country, createdAt, updatedAt`.

---

## Test Results

```
✓ src/services/__tests__/bankStatementImporter.test.ts (3 tests)
  ✓ encrypts counterpartyName at rest (T-09-03-04)
  ✓ dedups on duplicate externalTransactionId via ER_DUP_ENTRY (Pattern 3)
  ✓ normalizes structured communication to digits-only string

✓ src/routes/__tests__/bankConnections.test.ts (3 tests)
  ✓ BANK-ROUTES: GET /institutions returns 503 when Ponto not configured
  ✓ BANK-ROUTES: POST / inserts a pending connection and returns consentLink
  ✓ BANK-OAUTH: GET /callback with tampered state redirects to ?error=expired_state

Full @rentular/api suite: 12 test files / 59 tests pass.
Build (tsup esm + dts): success.
```

---

## Acceptance Criteria Coverage

| Criterion | Status | Detail |
| --- | --- | --- |
| `apps/api/src/services/bankStatementImporter.ts` exists | PASS | created |
| `apps/api/src/services/bankConnectionSync.ts` exists | PASS | created |
| `grep "encrypt("` in `bankStatementImporter.ts` ≥ 3 | PASS | 4 (name + IBAN + payload + import) |
| `grep "importBankStatements("` in `bankConnectionSync.ts` = 1 | PASS | 1 |
| `grep "processIncomingTransactions("` in `bankConnectionSync.ts` = 1 | PASS | 1 |
| `grep "90 \* 24 \* 60 \* 60"` in `bankConnectionSync.ts` ≥ 1 | PASS | 1 |
| 3 bankStatementImporter tests pass | PASS | 3/3 |
| `apps/api/src/routes/bankConnections.ts` exists | PASS | created |
| `grep "export const bankConnectionsRouter"` = 1 | PASS | 1 |
| Combined router method count (.get/.post/.delete) ≥ 8 | PASS | 8 |
| `grep "verifyOAuthState"` in route ≥ 1 | PASS | 2 (import + callback usage) |
| `grep "encrypt("` in route ≥ 2 | PASS | 2 (access + refresh) |
| `grep "consentExpiresAt"` in route ≥ 2 | PASS | 3 |
| `grep "bankConnectionsRouter"` in index.ts ≥ 2 | PASS | 2 (import + mount) |
| `grep "/bank-connections/callback"` in index.ts ≥ 1 | PASS | 2 (comment + endsWith check) |
| `grep "syncBankConnection"` in worker ≥ 1 | PASS | 3 (import + comment ref + call) |
| `grep "3 \* 24 \* 60 \* 60 \* 1000"` in worker = 0 | PASS | 0 (removed) |
| `grep "Phase C"` in worker still present | PASS | 2 (banner + comment) |
| `grep "BANK-ROUTES\|BANK-OAUTH"` in route test ≥ 2 | PASS | 6 |
| 3 route test cases pass | PASS | 3/3 |
| `pnpm --filter @rentular/api build` succeeds | PASS | tsup esm+dts success |
| `pnpm --filter @rentular/api lint` passes | PARTIAL | new files compile cleanly; pre-existing errors in unrelated files documented as scope-bound non-action (matches Plan 09-01 / 09-02) |

---

## Deviations from Plan

### Scope-bound non-actions

**1. `pnpm --filter @rentular/api lint` (project-wide `tsc --noEmit`) reports pre-existing errors in unrelated files**

- **Found during:** Task 1 + Task 3 verification.
- **Pre-existing errors NOT touched:** `apps/api/src/jobs/importDiscoveryWorker.ts`, `apps/api/src/jobs/importWriteWorker.ts`, `apps/api/src/jobs/landlordReportWorker.ts`, `apps/api/src/jobs/paymentCheckWorker.ts` lines 64/217/220 (Phase A overdue-payment logic, NOT my Phase B refactor), `apps/api/src/routes/costs.ts`, `apps/api/src/routes/indexation.ts`, `apps/api/src/routes/leases.ts`, `apps/api/src/routes/maintenance.ts`, `apps/api/src/routes/payments.ts`, `apps/api/src/routes/properties.ts`, `apps/api/src/routes/rentAdjustments.ts`, `apps/api/src/routes/tenants.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/services/paymentStateMachine.ts`, `apps/api/src/services/smovinScraper.ts`, `apps/api/src/services/transactionMatcher.ts`.
- **Resolution:** Per the executor scope boundary rule, these are out-of-scope and were NOT fixed. The new files (`bankStatementImporter.ts`, `bankConnectionSync.ts`, `bankConnections.ts`, the index.ts edit, the worker refactor lines 263-291, both test files) compile cleanly — verified by filtering the project-wide lint output to just these paths (zero hits).
- **Audit:** Three `pnpm --filter @rentular/api lint` errors land on `paymentCheckWorker.ts` lines 64 / 217 / 220 — all in Phase A code (the overdue-payment reminder pipeline), which my refactor did NOT touch. Lines 263-291 (my Phase B replacement) are clean.

**2. `pnpm install` was needed in the fresh worktree**

- **Found during:** Initial setup.
- **Resolution:** Ran `pnpm install` at the worktree root — idempotent against the existing lockfile (added all packages from cache, no lockfile mutation). Matches the Rule 3 handling documented in Plan 09-01 / 09-02 SUMMARIES.

**3. Per-row `matched_payment_id` linkage on `bank_statements` is best-effort in v1**

- **Found during:** Task 1 implementation of `bankConnectionSync.ts`.
- **Reason:** `processIncomingTransactions(ownerId, transactions)` returns counts (`matched`, `mismatched`, `unmatched`) but does NOT return row-level identifiers tying a specific transaction to a specific payment. Changing the matcher signature is OUT of Plan 03 scope (would touch Phase 2 contract).
- **Resolution:** `syncBankConnection` updates `matchStatus` (and `matchedAt`) on `bank_statements` rows with ≥12-digit structured communication after the matcher runs — this is the audit-trail signal. Precise `matchedPaymentId` linkage will require a matcher-signature change in a later plan and is documented as a Known Stub (below). This is documented in `bankConnectionSync.ts` lines 167-191 with an inline comment.

### Auto-fixed / Adapted

None — plan executed as written.

---

## Authentication Gates

None encountered during execution. The `GET /bank-connections/callback` route is itself an auth gate by design — it accepts a state JWT instead of a session cookie — and is fully implemented and tested.

---

## Known Stubs

1. **`syncBankConnection` writes `matchStatus` on `bank_statements` but NOT a precise `matchedPaymentId` per row.** The matcher returns aggregate counts only; tying each `bank_statements` row to its matched `payments.id` would require changing `processIncomingTransactions` to return per-transaction results. This is documented inline at `bankConnectionSync.ts` lines 167-191 and is acceptable for v1: the audit table still records which rows the matcher touched (via `matchStatus` + `matchedAt`); a future plan can tighten the linkage. The downstream consumer (Plan 04 UI dashboard) reads aggregate `matchStatus` for the inbox view, which is satisfied today.

2. **In-memory rate limiter on `POST /:id/sync`.** Per CONTEXT line 156, a Redis-based limiter is acceptable for future tightening. The current single-process `Map<string, number>` works for the Proxmox/Hetzner single-VPS deployment but resets on every API restart. Documented in `apps/api/src/routes/bankConnections.ts` `lastSyncCallByConnection` block.

3. **`providerMetadata` is set to `{ accountIds: [account.id] }` at callback time.** The full Ponto organisation_id / integration_id wiring will be useful in v1.5 for the multi-account picker (deferred per CONTEXT line 24). For v1 we take `accounts[0]` and store only the chosen account id.

---

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` enumerates. All 9 STRIDE entries (T-09-03-01 through T-09-03-09) are addressed:

- **T-09-03-01 (Spoofing /callback):** `verifyOAuthState` is called before token exchange; tampered tokens redirect to `?error=expired_state`. Test BANK-OAUTH covers this exact path.
- **T-09-03-02 (Tampering bank_connections via crafted state):** Renewal-path UPDATE is scoped `WHERE id AND ownerId=payload.ownerId`. Verified by reading `apps/api/src/routes/bankConnections.ts` lines 207-218.
- **T-09-03-03 (Info Disclosure on list/detail):** `sanitizeConnection` strips 7 fields before every `c.json`. Test coverage planned for Plan 04 UI tests (out of scope here).
- **T-09-03-04 (PII in bank_statements):** `bankStatementImporter` encrypts counterparty name + IBAN + raw payload via `lib/encryption.ts` AES-256-GCM. Test "encrypts counterpartyName at rest" verifies the ciphertext column does NOT equal the plaintext.
- **T-09-03-05 (DoS via /:id/sync flood):** In-memory 1/min rate limit; 429 with `retryAfterSeconds`. Manual verification — Redis-based limiter deferred per CONTEXT 156.
- **T-09-03-06 (Repudiation):** `bank_connections.createdAt` + `updatedAt` + `status` transitions provide audit (accepted per plan).
- **T-09-03-07 (Replay of valid state JWT within 10-min window):** UUID nonce per token; TTL 10 min. Nonce tracking deferred per CONTEXT decisions.
- **T-09-03-08 (Cross-tenant access via crafted :id):** All `:id` routes enforce `WHERE id AND ownerId=userId`; 404 on missing or wrong-owner. Verified by reading lines 248-279.
- **T-09-03-09 (Token leaked in error logs):** `bankConnectionSync` only logs row id; never interpolates token. Worker catches errors and writes `errorMessage = String(err)` — the underlying `lib/pontoConnect.ts` never includes the token in thrown error messages (verified during Plan 09-02 acceptance criteria).

---

## TDD Gate Compliance

Plan 03 contains one TDD task (Task 1). Both gate commits are present and in the correct order:

| Plan task | RED commit | GREEN commit | REFACTOR |
| --- | --- | --- | --- |
| Task 1 (bankStatementImporter) | `9616f6e` `test(09-03): add failing test for bankStatementImporter (encrypt+dedup+normalize)` | `d96cac2` `feat(09-03): add bankStatementImporter + bankConnectionSync services` | none needed |

RED commit confirmed failing before implementation: `Cannot find module '/src/services/bankStatementImporter'` for all 3 test cases. GREEN commit passed 3/3 on first run after the encrypt-call inlining.

---

## Self-Check: PASSED

- `apps/api/src/services/bankStatementImporter.ts` — FOUND
- `apps/api/src/services/bankConnectionSync.ts` — FOUND
- `apps/api/src/services/__tests__/bankStatementImporter.test.ts` — FOUND
- `apps/api/src/routes/bankConnections.ts` — FOUND
- `apps/api/src/routes/__tests__/bankConnections.test.ts` — FOUND
- `apps/api/src/index.ts` — FOUND (modified)
- `apps/api/src/jobs/paymentCheckWorker.ts` — FOUND (modified)
- Commits `9616f6e`, `d96cac2`, `b436131`, `65d0308` — all FOUND in `git log`.
- No untracked files in the worktree (other than HANDOFF.json which is orchestrator-managed).
