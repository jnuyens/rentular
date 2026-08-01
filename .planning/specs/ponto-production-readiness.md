# Ponto Connect — Production Readiness Design & Plan

**Date:** 2026-08-01
**Status:** Draft for review (no code written yet)
**Scope owner:** Ponto/Ibanity bank-connection integration (Phase 9 follow-up)

## Goal

Take the Ponto Connect integration from "works against sandbox" to "works against a real production Ibanity account," under the commercial setup Isabel confirmed: two applications (PPM for individual landlords, CPM for companies), production certificates, and HTTP request signing on POST calls.

## Locked facts (from Isabel support thread + Ibanity docs + code)

1. **Two Ponto applications**, because an Isabel application is either PPM or CPM, never both:
   - **PPM** (Partner Paying Model) for **individuals** — Rentular is billed, €4/account/month, no minimum commitment (contract signed 2026-07-23).
   - **CPM** (Customer Paying Model) for **companies** — the landlord pays Isabel directly.
   - Each application has **its own `clientId`/`clientSecret` and its own certificates** (private keys self-generated via OpenSSL).
2. **Request signing:** for Ponto Connect only **POST** requests must be signed (hs2019). GET reads (accounts, transactions, financial-institutions) may stay unsigned. Rentular's only POSTs to Ponto are `/oauth2/token` and `/oauth2/revoke`.
3. **keyId = the signature certificate's UUID**, shown in the portal certificates overview.
4. **redirect_uri** is set on the application in the portal once the Ponto Connect product is active. Register `https://www.rentular.com/api/v1/bank-connections/callback`.
5. **mTLS transport certificate** is required on every call and is already implemented (`getIbanityAgent()` in `pontoConnect.ts`).

## The load-bearing gap: landlord classification does not exist

The two-application routing key is "is this landlord a company or an individual?" **The data model does not capture this today.** `users` has only `name/email/image/passwordHash/locale/onboarding*`. There is no legal-form flag and no VAT number. `bank_connections` records `provider` and `providerMetadata` but nothing about which Ponto app/model a connection uses.

This makes the work larger than the Ponto library: it reaches into the user model and onboarding UI. This is the first thing to settle (see Open Decisions).

## Architecture

### 1. Two-application configuration

Introduce a `PontoModel = "ppm" | "cpm"` and resolve a `PontoAppConfig` per model:

```
interface PontoAppConfig {
  clientId: string;
  clientSecret: string;
  transport: { cert/key/pfx/passphrase };  // mTLS (existing shape)
  signature: { key: string; keyId: string; passphrase?: string };  // NEW: signing cert
}
```

Env layout (per model), with the current single-app vars kept as a **sandbox fallback** so dev/sandbox keeps working with one app:

```
PONTO_ENVIRONMENT=production            # shared
PONTO_PPM_CLIENT_ID / _CLIENT_SECRET
PONTO_PPM_TLS_CERT / _TLS_KEY / _TLS_PASSPHRASE   (or _TLS_PFX)
PONTO_PPM_SIG_KEY / _SIG_KEY_ID / _SIG_PASSPHRASE
PONTO_CPM_CLIENT_ID / ... (same set)
# Fallback (sandbox single app): existing PONTO_CLIENT_ID / PONTO_TLS_* used for both models when _PPM_/_CPM_ unset
```

`getPontoAppConfig(model)` returns the model's set, falling back to the legacy vars. Every function that currently reads `PONTO_CLIENT_ID` / builds the agent takes a `model` (or a resolved config) argument.

### 2. Model selection and propagation

- **At connect start** (`POST /bank-connections` connect route): resolve the landlord's model from `users.landlordType` (company → cpm, individual → ppm). Encode the model in the **OAuth state JWT** (alongside the existing state) so the callback knows which app to exchange the code against.
- **At callback:** read `model` from the verified state JWT, exchange the code using that app's config, and persist `model` on the new `bank_connections` row.
- **At sync / refresh / revoke** (`bankConnectionSync`, worker): read `bank_connections.pontoModel` to pick the app config for token refresh and revoke.

### 3. HTTP request signing (hs2019) on POST

Add `signPontoPost({ method, url, body, config })` returning headers to merge into the `ibanityFetch` POST calls:

- **Digest:** `Digest: SHA-512=<base64(sha512(body || ""))>`.
- **Signing string** (exact header set + order to be confirmed against the cert-creation step-by-step and Ibanity's HTTP Signature Generator reference vectors):
  `(request-target): post <path+query>` / `host: <host>` / `digest: <digest>` / `(created): <unix-ts>`.
- **Signature header:** `keyId="<uuid>",created=<ts>,algorithm="hs2019",headers="(request-target) host digest (created)",signature="<base64(RSASSA-SHA256(signingString))>"` signed with the signature cert's private key.
- Apply to `/oauth2/token` and `/oauth2/revoke`. GET helpers unchanged (signing optional; skip for now).
- If Ponto requires an `Ibanity-Idempotency-Key` on POST, generate a UUID and include it in the signed header set.

This is **unit-testable offline** against Ibanity's HTTP Signature Generator sample inputs/outputs — no live account needed to validate the signing string and digest.

### 4. financial-institutions production auth

`listFinancialInstitutions` / `getFinancialInstitution` currently send an **empty Bearer** (sandbox-only hack). Production needs a real token: implement `getClientAccessToken(model)` via `POST /oauth2/token` `grant_type=client_credentials` (signed POST + Basic auth + mTLS), cache it until expiry, and use its Bearer for the institutions calls.

## Schema changes

- `users`: add `landlordType mysqlEnum("individual","company")` (nullable; treated as individual when null) and `vatNumber varchar(32)` (nullable).
- `bank_connections`: add `pontoModel mysqlEnum("ppm","cpm")` (nullable; set at connect for Ponto connections).
- Migration: hand-written idempotent DDL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) per the m1 MariaDB note (drizzle-kit push is broken on that box). Existing users default to individual → PPM, which is the already-contracted model, so no back-fill risk.

## Component changes (files)

- `apps/api/src/lib/pontoConnect.ts` — `PontoModel`, `getPontoAppConfig(model)`, per-model agent cache (Map keyed by model), thread `config` through token/revoke/list helpers, add `signPontoPost`, add `getClientAccessToken`, fix institutions auth.
- `apps/api/src/lib/bankAccountData.ts` — `PontoConnectProvider` / factory accept the model so the right app config is used.
- `apps/api/src/lib/bankOAuthState.ts` — include `model` in the signed state JWT.
- `apps/api/src/routes/bankConnections.ts` — resolve model at connect from `users.landlordType`; persist `pontoModel` at callback; use it for sync/renew/revoke.
- `apps/api/src/services/bankConnectionSync.ts` — pick app config by `pontoModel`.
- `packages/db/src/schema/{users,bankConnections}.ts` — new columns; DDL migration.
- Onboarding + settings (web) — capture `landlordType` (+ VAT when company). Minimal: a radio in onboarding step 1 and the settings profile.
- `.env.example` — document the per-model vars and the sandbox fallback.
- Tests — `signPontoPost` unit tests against reference vectors; state-JWT model round-trip; model selection by landlordType.

## Config / rollout prerequisites (operator, not code)

1. Create the **two production applications** (PPM, CPM) in the Ibanity portal; generate transport + signature certs for each (self-held private keys); note each signature cert's UUID (keyId).
2. Set redirect_uri on both apps to `https://www.rentular.com/api/v1/bank-connections/callback`.
3. Inject both apps' creds + certs into the API container env (ties into the Caddy/containers migration — see `webhook-caddy-verification.md`).
4. Flip `PONTO_ENVIRONMENT=production`.

## Testing strategy

- **Offline unit:** signing string + digest + Signature header against Ibanity HTTP Signature Generator vectors; state-JWT model encode/decode; landlordType → model mapping.
- **Sandbox smoke:** existing sandbox app via the legacy-fallback config still connects end-to-end (regression guard that the refactor did not break the single-app path). Sandbox accepts signed POSTs, so signing can be exercised there too.
- **Production smoke (after operator prereqs):** one individual (PPM) and one company (CPM) connection through to statement import.

## Risks

- **Exact signed-header set / algorithm details** for Ponto hs2019 must be confirmed against the portal cert-creation walkthrough + reference generator before trusting production. Mitigation: unit-test against published vectors; sandbox-sign first.
- **Company/individual capture is a UX + data change** on live users; keep the default (individual/PPM) safe and non-blocking.
- Touches payment-adjacent code; ship behind the sandbox-fallback so nothing changes until the production env vars are present.

## Out of scope

- Payment initiation / the payments signature flows (Rentular is read-only AIS).
- Reconciliation matching improvements (separate workstream).
- The Caddy/container webhook verification (tracked in `webhook-caddy-verification.md`).

## Resolved decisions (approved 2026-08-01)

1. **Classify company vs individual** with an **explicit radio in onboarding + settings**; existing users default to individual (= PPM, the already-contracted model). Chosen over inferring from a VAT number: unambiguous and matches how Isabel splits the applications.
2. **Sign POSTs only** (`/oauth2/token`, `/oauth2/revoke`), not every call — matches Isabel's answer, less code.
3. **Keep the legacy single-app env vars as a sandbox fallback** so dev/sandbox keeps working with one application.
