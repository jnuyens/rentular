---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
plan: 02
subsystem: bank-connections
tags: [ponto, oauth, psd2, jose, msw, vitest]
requires:
  - apps/api/src/lib/bankAccountData.ts BankAccountDataProvider interface (Phase 2)
  - apps/api/test/fixtures/ponto/*.json (Plan 09-01)
  - msw ^2.6.0 (Plan 09-01)
  - jose ^6.2.1 (existing)
provides:
  - apps/api/src/lib/bankOAuthState.ts (signOAuthState / verifyOAuthState)
  - apps/api/src/lib/pontoConnect.ts (REST + OAuth client, 9 named exports)
  - apps/api/src/lib/bankAccountData.ts PontoConnectProvider class
  - factory getBankAccountDataProvider(tokens?) — dispatches on BANK_DATA_PROVIDER
  - .env.example documentation for PSD2 + Ponto + retention env vars
affects:
  - apps/api/src/lib/bankAccountData.ts factory signature now accepts optional tokens
tech-stack:
  added: []
  patterns:
    - "Dynamic import('./pontoConnect') inside provider methods keeps the provider class light at module load and matches GoCardlessBadProvider's nordigen-node pattern"
    - "OAuth state token = jose HS256 JWT, AUTH_SECRET-keyed, 10-min TTL, UUID nonce stamped at sign time"
    - "JSON:API envelope flattening — public API of pontoConnect.ts returns plain typed objects, never leaks { type, id, attributes } to callers"
    - "MSW v2 setupServer with regex URL handlers + server.resetHandlers between tests for HTTP isolation"
    - "Customer-Paying onboarding: Rentular issues integration-level client credentials; per-landlord OAuth tokens injected into the provider class via setTokens()"
key-files:
  created:
    - apps/api/src/lib/bankOAuthState.ts
    - apps/api/src/lib/pontoConnect.ts
    - apps/api/src/lib/__tests__/bankOAuthState.test.ts
    - apps/api/src/lib/__tests__/pontoConnect.test.ts
  modified:
    - apps/api/src/lib/bankAccountData.ts
    - .env.example
decisions:
  - "OAuth state JWT uses HS256 (symmetric) keyed off AUTH_SECRET — same key already used by NextAuth and the encryption.ts AES key derivation; rotating AUTH_SECRET invalidates all in-flight OAuth callbacks (acceptable; 10-min window)"
  - "pontoConnect.listFinancialInstitutions uses no auth header — Ponto's public catalogue endpoint accepts unauthenticated GETs in sandbox; production uses a service token (Plan 03 wires the bootstrap token if needed)"
  - "PontoConnectProvider.createConsent default expiresAt = now+180d (EBA upper bound) is a fall-back only — the callback route (Plan 03 Task 2) MUST overwrite with the real provider value from the post-token-exchange consent metadata"
  - "Factory accepts optional tokens param (backward-compatible) so Plan 03 Task 3 can construct a provider pre-loaded with a specific landlord's decrypted OAuth tokens without breaking existing callers"
  - "renewConsent returns null (matches GoCardless BAD) because Ponto Connect requires a full OAuth re-auth — Phase C consent-expiry worker sends 7-day / 1-day warnings, existing pattern"
metrics:
  duration_seconds: 261
  duration_pretty: "4m 21s"
  tasks_completed: 3
  files_created: 4
  files_modified: 2
  completed_at: "2026-05-11T23:00:50Z"
---

# Phase 09 Plan 02: Ponto Connect Provider + OAuth State Helper Summary

**One-liner:** Ships the `PontoConnectProvider` class, a fetch-based `pontoConnect.ts` REST/OAuth client (no SDK exists — Ponto exposes only HTTP), and a tiny `bankOAuthState.ts` JWT helper that signs the CSRF state token for the OAuth callback, all behind a `BANK_DATA_PROVIDER`-keyed factory dispatch.

---

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 (RED) | Failing test for bankOAuthState JWT helper | `4127f74` | `apps/api/src/lib/__tests__/bankOAuthState.test.ts` |
| 1 (GREEN) | Implement bankOAuthState | `0be4cbf` | `apps/api/src/lib/bankOAuthState.ts` |
| 2 (RED) | MSW-mocked failing test for pontoConnect | `b393f1c` | `apps/api/src/lib/__tests__/pontoConnect.test.ts` |
| 2 (GREEN) | Implement Ponto Connect REST/OAuth client | `06f2603` | `apps/api/src/lib/pontoConnect.ts` |
| 3 | PontoConnectProvider class + factory + .env.example | `447eb16` | `apps/api/src/lib/bankAccountData.ts`, `.env.example` |

---

## `bankOAuthState.ts` (new)

| Export | Shape | Purpose |
| --- | --- | --- |
| `signOAuthState(payload)` | `(payload: Omit<OAuthStatePayload, "nonce">) => Promise<string>` | Stamp a UUID nonce, sign HS256 JWT with `AUTH_SECRET`, 10-min TTL |
| `verifyOAuthState(token)` | `(token: string) => Promise<OAuthStatePayload>` | Validate signature + expiry; throw on tamper or wrong-secret |
| `OAuthStatePayload` | `{ ownerId; institutionId?; connectionId?; nonce }` | Payload type consumed by Plan 03 callback route |

**Threat mitigations:**

- T-09-02-01 (Spoofing): signature-gated state — wrong-secret tokens throw at `jwtVerify`.
- T-09-02-06 (Elevation/Replay): 10-min TTL + per-call UUID nonce + signature gate.

---

## `pontoConnect.ts` (new) — 9 named exports

| Export | Shape | Notes |
| --- | --- | --- |
| `isPontoConfigured()` | `() => boolean` | true iff `PONTO_CLIENT_ID` AND `PONTO_CLIENT_SECRET` are set |
| `getPontoBaseUrls()` | `() => { apiBase; authBase }` | Switches on `PONTO_ENVIRONMENT==="production"` |
| `getRedirectUri()` | `() => string` | `PONTO_REDIRECT_URI` ?? `BANK_CONNECTION_REDIRECT_URL` ?? localhost fallback |
| `createPontoAuthorizationUrl(p)` | `(state; redirectUri?; scopes?) => string` | Default scopes: `["ai","pi","name","offline_access"]` |
| `exchangeAuthorizationCode(code, redirectUri?)` | OAuth → PontoTokenResponse | grant_type=authorization_code, HTTP Basic auth |
| `refreshAccessToken(refreshToken)` | OAuth → PontoTokenResponse | grant_type=refresh_token, HTTP Basic auth |
| `revokeAccess(token)` | OAuth → void | POST `/oauth2/revoke` |
| `listAccounts({accessToken})` | Bearer → `PontoAccount[]` | Maps JSON:API envelope to flat objects |
| `listTransactions({accessToken, accountId, dateFrom?})` | Bearer → `PontoTransaction[]` | Optional date filter via `filter[executionDate][gte]` |
| `listFinancialInstitutions(country)` | → `PontoInstitution[]` | Public catalogue endpoint |

**Threat mitigations:**

- T-09-02-03 (Info Disclosure): no `console.log` interpolates raw access/refresh tokens (grep-verified).
- T-09-02-07 (Spoofing host): base URLs hardcoded module-scope constants; `PONTO_ENVIRONMENT` only switches between two pre-baked URLs, never accepts user input.

---

## `bankAccountData.ts` (modified)

- **`PontoConnectProvider` class added** between `GoCardlessBadProvider` and the factory; implements all 5 `BankAccountDataProvider` methods.
- Tokens are not held in module state — passed via constructor argument or `setTokens()` post-construction.
- `requireAccessToken()` guard throws if any auth-requiring method is called pre-token-injection.
- `renewConsent` returns `null` (Phase C email pattern, mirrors GoCardless BAD).
- `getTransactions` correctly bisects `remittanceInformation` into `remittanceStructured` (when `type==="structured"`) vs `remittanceUnstructured` — feeding the existing digits-only matcher.
- **Factory** signature changed to `getBankAccountDataProvider(tokens?: { accessToken: string; refreshToken?: string })`. All existing callers continue to compile because the parameter is optional.
- **`GoCardlessBadProvider` untouched** — remains as the dormant reference implementation per CONTEXT line 37.

---

## `.env.example` (modified) — 4 new sections

```env
# ----- Bank Data Provider (PSD2 / Open Banking) -----
BANK_DATA_PROVIDER=ponto
BANK_CONNECTION_REDIRECT_URL=http://localhost:4000/api/v1/bank-connections/callback

# ----- Ponto Connect (Ibanity) -----
PONTO_CLIENT_ID=
PONTO_CLIENT_SECRET=
PONTO_ENVIRONMENT=sandbox
PONTO_REDIRECT_URI=

# ----- GoCardless Bank Account Data (legacy / dormant reference) -----
GOCARDLESS_BAD_SECRET_ID=
GOCARDLESS_BAD_SECRET_KEY=

# ----- Bank Statement Retention (Belgian tax law) -----
BANK_STATEMENTS_RETENTION_DAYS=2555
```

---

## Test Results

```
✓ src/lib/__tests__/bankOAuthState.test.ts (4 tests)
  ✓ round-trip ownerId + institutionId with UUID nonce
  ✓ round-trip renewal payload (ownerId + connectionId)
  ✓ reject token signed with a different secret (T-09-02-01)
  ✓ reject expired token (T-09-02-06)

✓ src/lib/__tests__/pontoConnect.test.ts (6 tests)
  ✓ isPontoConfigured returns true
  ✓ createPontoAuthorizationUrl returns sandbox URL with required params
  ✓ exchangeAuthorizationCode parses OAuth token response
  ✓ listFinancialInstitutions returns 6 BE banks
  ✓ listAccounts returns single fixture account
  ✓ listTransactions returns 2 transactions with structured remittance preserved

Test Files  2 passed (2)
Tests       10 passed (10)
Duration    ~820ms
```

---

## Acceptance Criteria Coverage

| Criterion | Status |
| --- | --- |
| `bankOAuthState.ts` exists | PASS |
| Contains `HS256`, `"10m"`, `AUTH_SECRET` | PASS (3 / 1 / 3 hits) |
| `signOAuthState` referenced ≥ 2 (export + test usage across files) | PASS (1 + 4 = 5) — see Deviations note |
| `bankOAuthState.test.ts` passes 4 cases | PASS |
| `pontoConnect.ts` exists | PASS |
| `export function isPontoConfigured` | PASS (1) |
| `export async function exchangeAuthorizationCode` | PASS (1) |
| `export async function refreshAccessToken` | PASS (1) |
| `export async function listAccounts` | PASS (1) |
| `export async function listTransactions` | PASS (1) |
| `export async function listFinancialInstitutions` | PASS (1) |
| `export async function revokeAccess` | PASS (1) |
| `export function createPontoAuthorizationUrl` | PASS (1) |
| All 6 `pontoConnect.test.ts` cases pass | PASS |
| No raw token interpolation in logs | PASS (grep-verified empty) |
| `class PontoConnectProvider` count = 1 | PASS |
| `BANK_DATA_PROVIDER` referenced in `bankAccountData.ts` | PASS (2 hits) |
| `.env.example` has PONTO_CLIENT_ID, PONTO_CLIENT_SECRET, PONTO_ENVIRONMENT, BANK_DATA_PROVIDER, BANK_CONNECTION_REDIRECT_URL, BANK_STATEMENTS_RETENTION_DAYS | PASS (all 6) |
| GoCardlessBadProvider still exported | PASS |
| Factory accepts optional tokens param | PASS |
| `pnpm --filter @rentular/api lint` passes | DEFERRED — see Deviations |

---

## Deviations from Plan

### Scope-bound non-actions

**1. `pnpm --filter @rentular/api lint` (full project `tsc --noEmit`) reports pre-existing errors in unrelated files**

- **Found during:** Task 1 lint check (and matches Plan 09-01 SUMMARY "Scope-bound non-actions").
- **Files with pre-existing errors (NOT touched by this plan):** `apps/api/src/routes/rentAdjustments.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/services/paymentStateMachine.ts`, `apps/api/src/services/smovinScraper.ts`, `apps/api/src/services/transactionMatcher.ts`, `apps/api/src/services/importDiscoveryWorker.ts`, `apps/api/src/services/importWriteWorker.ts`.
- **Pre-existing error in `bankAccountData.ts`:** line 85 — `nordigen-node` typing issue in the GoCardlessBadProvider section (not in Plan 09-02 changes). Confirmed by reading line 85 in git HEAD~5 before any 09-02 changes.
- **Resolution:** Per the executor scope boundary rule, these are out-of-scope and were NOT fixed. The new files (`bankOAuthState.ts`, `pontoConnect.ts`, and the new `PontoConnectProvider` section of `bankAccountData.ts`) compile cleanly on their own — verified by running `tsc --noEmit` per-file with the project's strict settings.
- **Audit:** `npx tsc --noEmit` filtered to just `bankAccountData.ts | bankOAuthState.ts | pontoConnect.ts` returns ONE error and that error is on the pre-existing GoCardlessBadProvider `nordigen-node` import (line 85), not on any Plan 09-02 code.

**2. `signOAuthState` reference-count acceptance criterion (worded "at least 2 in bankOAuthState.ts")**

- **Found during:** Task 1 verification.
- **Issue:** The criterion text reads "grep on apps/api/src/lib/bankOAuthState.ts for 'signOAuthState' returns at least 2 (export + usage)". The helper file itself only declares the function once (its export); no additional self-reference exists or should exist in a clean module.
- **Interpretation:** Read as the spirit of the criterion — verifying that `signOAuthState` IS exported AND IS used — the cross-file count is 5 (1 in helper, 4 in test). Adding redundant `signOAuthState` mentions inside the helper file (e.g., as a comment) would be artificial. Marked PASS via the cross-file interpretation.

**3. `pnpm install` was needed to populate `node_modules` in the fresh worktree**

- **Found during:** First lint attempt (`tsc: command not found`).
- **Resolution:** Ran `pnpm install` at the worktree root — idempotent against the existing lockfile (added 491 packages, all already in the lockfile, no lockfile mutation). Matches the same Rule 3 (blocking environment) handling documented in Plan 09-01 SUMMARY.

---

## Authentication Gates

None. The plan implements helpers that will be consumed by Plan 03's OAuth callback, but Plan 02 itself does not run against the live Ponto sandbox — all 6 `pontoConnect.test.ts` cases use MSW v2 with the fixtures committed in Plan 09-01.

---

## Known Stubs

- `PontoConnectProvider.createConsent` returns a default `expiresAt = now+180d` placeholder. **This is intentional and documented inline** — the callback route in Plan 03 Task 2 MUST overwrite this with the real value from the post-token-exchange consent metadata. The 180-day default is a fail-safe so that Phase C consent-expiry warnings still trigger if the metadata is missing.
- `PontoConnectProvider.listAccounts` returns `institutionId: ""` for every account. **This is intentional** — the route layer (Plan 03) is responsible for resolving the institution id via `bank_connections.providerMetadata`, which carries the Ponto `organisation_id` / `integration_id`. The interface field is preserved for API surface compatibility with `GoCardlessBadProvider`.

Both stubs have explicit inline comments referencing the Plan 03 task that will consume them.

---

## Threat Flags

No new security surface introduced beyond what the plan's `<threat_model>` already enumerates. All 7 STRIDE entries (T-09-02-01 through T-09-02-07) are addressed:

- T-09-02-01 / T-09-02-06 mitigated by `bankOAuthState` HS256 + 10-min TTL + UUID nonce.
- T-09-02-02 mitigated by HTTPS round-trip — `exchangeAuthorizationCode` throws on non-2xx.
- T-09-02-03 mitigated by no-token-in-logs convention (grep-verified).
- T-09-02-04 accepted per plan.
- T-09-02-05 deferred to Plan 03 (worker rate-limiting).
- T-09-02-07 mitigated by hardcoded base URLs.

---

## TDD Gate Compliance

Tasks 1 and 2 are TDD tasks; all four gate commits are present and in the correct order:

| Plan task | RED commit | GREEN commit | REFACTOR |
| --- | --- | --- | --- |
| Task 1 (bankOAuthState) | `4127f74` test(09-02): add failing test… | `0be4cbf` feat(09-02): implement bankOAuthState… | none needed |
| Task 2 (pontoConnect) | `b393f1c` test(09-02): add MSW-mocked failing test… | `06f2603` feat(09-02): implement Ponto Connect… | none needed |

Both RED commits were confirmed failing before the implementation (Task 1 RED failed with `Cannot find module '../bankOAuthState'`; Task 2 RED failed with the same module-not-found pattern). Both GREEN commits passed all cases on first run.

---

## Self-Check: PASSED

- `apps/api/src/lib/bankOAuthState.ts` — FOUND
- `apps/api/src/lib/pontoConnect.ts` — FOUND
- `apps/api/src/lib/bankAccountData.ts` — FOUND (modified)
- `apps/api/src/lib/__tests__/bankOAuthState.test.ts` — FOUND
- `apps/api/src/lib/__tests__/pontoConnect.test.ts` — FOUND
- `.env.example` — FOUND (modified)
- Commits `4127f74`, `0be4cbf`, `b393f1c`, `06f2603`, `447eb16` — all FOUND in `git log`.
- No untracked files in the worktree.
