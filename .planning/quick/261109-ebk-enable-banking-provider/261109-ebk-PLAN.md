---
quick_id: 261109-ebk
type: quick
autonomous: true
---

# Quick Task 261109-ebk: Enable Banking provider (bring your own app) for self-hosted and free users, Ponto for paying users, plus timely re-login warnings

## Decision (owner, 2026-11-09)

Self-hosted installs and free hosted accounts are treated as Enable Banking "restricted mode" users: each landlord registers their OWN Enable Banking production application, activates it by linking their own account(s) in the Enable Banking Control Panel, and Rentular uses that app to read those accounts. This is free under Enable Banking's restricted mode (individual non-commercial use / evaluation). Paying hosted users keep Ponto (customer-paying model, Phase 9). Rentular never uses one shared Enable Banking app for many landlords on the hosted service.

## Reference

- Enable Banking API: base https://api.enablebanking.com. Auth: `Authorization: Bearer <JWT>`, JWT RS256 signed with the app's private key, header {typ: JWT, alg: RS256, kid: <application id>}, claims {iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp} with exp - iat <= 86400 (use 1 hour). Use `jose` (already a dependency).
- Endpoints: GET /aspsps?country=BE&psu_type=personal|business (bank list with maximum_consent_validity), POST /auth {access: {valid_until: ISO}, aspsp: {name, country}, state, redirect_url, psu_type} -> {url, authorization_id}; POST /sessions {code} -> {session_id, accounts[{uid, account_id{iban}, ...}], access{valid_until}}; GET /sessions/{id}; DELETE /sessions/{id}; GET /accounts/{uid}/transactions?date_from&date_to&continuation_key (page until no continuation_key); GET /accounts/{uid}/balances; GET /accounts/{uid}/details.
- Transaction fields: entry_reference, transaction_amount{amount, currency}, credit_debit_indicator (CRDT/DBIT), debtor{name}, debtor_account{iban}, creditor_account{iban}, remittance_information (string[]), status (BOOK/PDNG), booking_date, value_date. Map to IncomingTransaction: transactionId = entry_reference or a stable hash of (booking_date, amount, iban, remittance) when absent; amount positive for CRDT; structured Belgian communication detected in remittance text (+++xxx/xxxx/xxxxx+++ or 12 digits per existing helpers); only BOOK transactions are imported.
- Bank specifics learned by a working reference implementation (github.com/jersteth/enablebanking-psd2, Apache-2.0, Python; may be read for behaviour, do not copy large blocks): KBC requires PSU headers (Psu-Ip-Address and Psu-User-Agent; Enable Banking accepts all of them or none), so send both on user-present calls (/auth, /sessions, first fetch) from the landlord's request; unattended fetches may be capped at 4 per day per account (our syncs at 00:00, 12:00, 19:00 = 3, fits; do not add extra unattended syncs for this provider, the 19:15 rematch must not call the bank); maximum consent at KBC 180 days; history may be limited to ~90 days without fresh SCA.
- Code: apps/api/src/lib/bankAccountData.ts (BankAccountDataProvider interface, GoCardlessBadProvider dormant), Ponto in apps/api/src/lib/pontoConnect.ts, routes apps/api/src/routes/bankConnections.ts, sync apps/api/src/services/bankConnectionSync.ts, importer bankStatementImporter.ts, schema packages/db/src/schema/bankConnections.ts (provider enum already contains 'enable_banking'), web apps/web/app/(dashboard)/bank-connections and settings, encryption apps/api/src/lib/encryption.ts, existing 7-day consent warning logic in apps/api/src/jobs/paymentCheckWorker.ts (~line 1080, built for GoCardless BAD).

## Task 1: Provider choice per landlord

- Add `resolveBankProviderOptions(user)` returning which providers a landlord may use and the default:
  - Self-hosted instance (env `RENTULAR_INSTANCE=self` or unset and not rentular.com; hosted rentular.com sets `RENTULAR_INSTANCE=hosted`, document it): BOTH options, Enable Banking default; Ponto offered whenever Ponto env credentials are configured.
  - Hosted, free account: BOTH options (owner decision 2026-11-09): Enable Banking with your own app (free, default, shown first) and Ponto (customer-paying, the landlord pays Ponto directly, more convenient: no own app to set up). The choice screen explains the difference in two short lines each. Free = the current free plan rule (up to 3 properties, see pricing copy `pricingFreeFeature1`) and no paid subscription. There is no stored subscription state today: add a nullable `users.plan` enum('free','paid') (default NULL = derive: paid if > 3 properties else free) and let an admin/Stripe webhook set it later; keep the derivation in one function with tests.
  - Hosted, paying account: Ponto (default). Enable Banking hidden on hosted paid accounts.
  - Existing active connections are never broken by a plan change; show a gentle notice if a paid user still runs on Enable Banking ("Je gebruikt Enable Banking met je eigen app. Dat blijft werken.") and vice versa.
- Expose the options in the bank connections API so the web UI shows the right choice.

## Task 2: EnableBankingProvider

- New `apps/api/src/lib/enableBanking.ts` implementing BankAccountDataProvider (createConsent = POST /auth with valid_until = now + min(bank maximum_consent_validity, 180 days); listAccounts from the session; getTransactions with paging; renewConsent returns null (a new SCA is required); revokeConsent = DELETE /sessions).
- Credentials per landlord: new table `enable_banking_apps` (id, owner_id unique, application_id varchar(64), private_key_encrypted/iv/auth_tag via lib/encryption, environment enum('production','sandbox') default 'production', created_at, updated_at, last_verified_at, last_error). Optional instance-wide fallback for a single-landlord self-host: env `ENABLE_BANKING_APP_ID` + `ENABLE_BANKING_PRIVATE_KEY_PATH` (only when RENTULAR_INSTANCE is self; never on hosted).
- Settings flow (web, Bank connections page): "Verbind via Enable Banking (je eigen app, gratis)":
  1. Short step-by-step with links: create an account at enablebanking.com, register a PRODUCTION application, set the redirect URL to the exact value Rentular shows (copy button): `${WEB or API public URL}/api/v1/bank-connections/enable-banking/callback`, download the .pem, then in the Control Panel "Activate by linking accounts" with your own bank account.
  2. Upload the .pem file and paste the application id; Rentular verifies by signing a JWT and calling GET /aspsps (shows "Werkt" or the exact error, e.g. Invalid JWT = wrong key/app id or clock).
  3. Pick the bank (from /aspsps for BE, searchable) and personal/business, then "Inloggen bij je bank" -> redirect to the bank -> callback creates the session, stores bank_connections (provider 'enable_banking', consent_expires_at = access.valid_until, provider_metadata {sessionId, accountUids, aspsp}) and the accounts; the landlord picks which account(s) to monitor (same as Ponto flow).
  - State parameter signed and bound to the user (reuse lib/bankOAuthState.ts), callback validates it. Private key never leaves the server, never logged, never returned by the API (only "key uploaded on <date>"). Allow replacing/removing the key (removing revokes sessions).
- Sync: bankConnectionSync dispatches by provider; Enable Banking fetches date_from = last booking date - 5 days (dedup by transaction id is already in the importer), maximum 3 unattended fetches per day per account; on 401/403 consent errors mark the connection `expired`/`error` with the message and trigger the re-login warning immediately.

## Task 3: Timely re-login warnings (all providers that expire: Enable Banking, Ponto if applicable, GoCardless BAD)

- Daily job (in the landlord's schedule timezone, morning, e.g. 09:00) checks every active connection's consent_expires_at:
  - Email the landlord (and property managers who receive landlord notifications? only the connection owner) at 14, 7, 3 and 1 day(s) before expiry and on the day it expired, each at most once (store `reauth_warned_at` + `reauth_warn_stage` on bank_connections). Subject NL e.g. "Log binnen 7 dagen opnieuw in bij KBC, anders stopt de opvolging van je huur". Body: which bank and IBAN (masked), the date, what stops working (automatic matching, and therefore reminders would be wrong: while a connection is expired, NO automatic tenant reminders are sent for leases whose rent goes to that account, to avoid chasing tenants who already paid; the landlord is told this explicitly), and a one-click button to the re-login page. Owner's language, EN/NL/FR/DE.
  - Log each warning as landlord_notification (kind 'bank_reauth_warning') in communications (no lease_id).
- In the app (web and therefore the Android WebView): a banner on the overview and on the bank connections page from 14 days before expiry ("Je bankkoppeling met KBC verloopt op 12/05. Opnieuw inloggen duurt een minuut.") with the "Opnieuw inloggen" button; red when expired.
- Re-login = new POST /auth for the same bank and account(s), then the new session replaces the old one on the same bank_connections row (keep history and statement links), consent_expires_at updated, warning stage reset.
- Safety: when a connection is expired or in error, paymentCheckWorker must not send automatic tenant reminders for leases whose expected payments are monitored through that connection (determine via the landlord's monitored accounts); it sends the landlord one email instead (reuse the warning). Manual reminders show a warning. Unit tests.
- Generalise the existing 7-day GoCardless logic into this job; keep Ponto behaviour if Ponto consents do not expire (check pontoConnect; Ponto has its own reauthorization requirement roughly every 90 or 180 days depending on bank: if the Ponto API exposes it, use it, otherwise skip Ponto).

## Schema / DDL

- `enable_banking_apps` table; `users.plan` enum('free','paid') NULL; `bank_connections.reauth_warn_stage` tinyint NULL, `reauth_warned_at` timestamp NULL; new communications type values only if needed (prefer existing landlord_notification + metadata.kind).
- Prod DDL to `.planning/quick/261109-ebk-enable-banking-provider/prod-ddl.sql`, additive only, keep every existing enum value (current prod: communications.channel email,sms,letter,whatsapp,signal,internal; type list ends with tenant_reply,internal_note). Never run db:generate. State "DDL first" in the SUMMARY if code reads new columns.

## Docs

- SELF-HOSTING.md: an "Enable Banking (free, your own app)" section with the exact steps and redirect URL; env vars added to both env templates (`RENTULAR_INSTANCE`, `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY_PATH`); note that restricted mode is for your own accounts.

## Tests

- JWT shape (kid, iss, aud, exp <= 24h) against a generated test key; /auth body (valid_until capped by the bank maximum and 180 days, PSU headers all-or-none); transaction mapping (CRDT/DBIT, BOOK only, structured communication, missing entry_reference hash stable); paging with continuation_key; provider option resolution (self-hosted, hosted free, hosted paid, plan override); warning stages 14/7/3/1/0 each sent once, timezone; expired connection blocks automatic tenant reminders for its leases; callback state validation; key never returned by the API.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed).
- No em-dashes or en-dashes; human tone; all UI strings EN/NL/FR/DE with proper accents; no Co-Authored-By lines. Never deploy, never touch prod, never call the real Enable Banking API, never send messages, never run db:generate.
