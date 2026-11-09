---
quick_id: 261109-ebk
status: complete
completed: 2026-11-09
branch: worktree-agent-a7d1ba010fc490968
commits:
  - 042fd9e feat: Enable Banking client, provider options and per-landlord app storage
  - 4120a93 feat: Enable Banking connect, callback, re-login and sync
  - 0eb8d6c feat: morning re-login warnings and no automatic reminders on stale bank data
  - 4d27d50 test: JWT, auth body, mapping, paging, provider options, warnings and guard
  - 10ac4ed feat: web setup, provider choice and re-login banners (EN/NL/FR/DE)
  - 103fb91 docs: Enable Banking self-hosting steps and env vars
  - c021d86 style: no dash characters in new comment and test
ddl_first: true
---

# Quick 261109-ebk: Enable Banking (own app) for self-hosted and free users, Ponto for paying users, re-login warnings

Landlords on a self-hosted install or the free hosted plan can now connect their bank through their own Enable Banking application (restricted mode, free). Paying hosted landlords keep Ponto. Every connection whose consent runs out (Enable Banking, Ponto, GoCardless BAD) now gets re-login emails at 14/7/3/1/0 days and an in-app banner. While a connection is stale, automatic tenant reminders for leases paid into that account are held back.

## What was built

**Provider choice** (`apps/api/src/lib/bankProviderOptions.ts`, `GET /api/v1/bank-connections/options`)
- `RENTULAR_INSTANCE=hosted|self`. When it is unset, a `WEB_URL` on rentular.com counts as hosted and anything else as self.
- Self-hosted: Enable Banking (the default), plus Ponto when Ponto is configured.
- Hosted free: both, Enable Banking first. Hosted paid: Ponto only.
- New `users.plan` enum('free','paid'), NULL by default. `derivePlan()` treats NULL as paid above 3 active properties and free otherwise.
- Existing connections keep working after a plan change. A notice says so ("Je gebruikt Enable Banking met je eigen app. Dat blijft werken.", and the same for Ponto).

**Enable Banking client and provider** (`apps/api/src/lib/enableBanking.ts`)
- RS256 JWT signed with jose. Header {typ, alg, kid = app id}, claims iss/aud, 1 hour lifetime. Accepts PKCS#8 and PKCS#1 keys.
- PSU headers (Psu-Ip-Address + Psu-User-Agent) are sent all-or-none, taken from the landlord's request on /auth, /sessions, Sync now, and the first fetch after login.
- `valid_until` is now + min(the bank's `maximum_consent_validity`, 180 days).
- Transactions are paged with `continuation_key`. Only BOOK transactions are imported. CRDT is positive, DBIT negative.
- Structured communication is read from the remittance text (`+++`, `***` or bare 12 digits) and must pass the mod-97 check. When `entry_reference` is missing, the id is a stable sha256 of booking date, amount, IBAN and remittance.
- `EnableBankingApiError` separates app errors (invalid JWT) from consent errors (401/403, expired session).

**Per-landlord app** (`enable_banking_apps` table, `apps/api/src/lib/enableBankingApps.ts`)
- The private key is stored AES-256-GCM encrypted and decrypted only to sign. The API only ever returns `keyUploadedAt`, `lastVerifiedAt` and `lastError`.
- A self-hosted install can use `ENABLE_BANKING_APP_ID` + `ENABLE_BANKING_PRIVATE_KEY_PATH` instead. These are ignored when hosted.

**Routes** (`apps/api/src/routes/enableBankingConnections.ts`, mounted at `/bank-connections/enable-banking`)
- `GET/PUT/DELETE /app` and `POST /app/verify`. Verification signs a JWT and calls `GET /aspsps`, then shows "Werkt" or the exact error, with a hint for Invalid JWT.
- `GET /aspsps`: the bank picker list.
- `POST /`: creates a pending row and returns the login url.
- `GET /callback`: checks the signed state (bound to owner + connection row, provider must be enable_banking). With one account it activates immediately; with several it offers a picker (`POST /:id/accounts`).
- Re-login goes through `POST /:id/renew`, which now dispatches by provider. The callback puts the new session on the same row, matched by IBAN because account uids change per session, and moves sibling rows of the same session too. It updates `consent_expires_at`, resets the warning stage, and deletes the old session.
- `DELETE /:id` removes the Enable Banking session only when no other monitored account still uses it.
- The callback path is exempt from the session check in `index.ts`, like the Ponto callback.

**Sync** (`services/bankConnectionSync.ts` dispatches; `services/enableBankingSync.ts`)
- The fetch window starts at the last booked date minus 5 days, never more than 90 days back.
- Unattended fetches are capped at 3 per account per day (counter in provider_metadata). Sync now does not count. The 19:15 rematch makes no bank call.
- A consent or app error marks the connection `expired`/`error` with the message and sends the stage-0 warning right away. A failed Ponto token refresh now does the same.

**Re-login warnings** (`services/bankReauth.ts` pure, `services/bankReauthWarnings.ts`)
- New repeatable job `bank-reauth-warnings` at 09:00 in the schedule timezone. It replaces the old Phase C (7-day/1-day GoCardless logic) in paymentCheckWorker.
- Stages 14, 7, 3, 1 and 0, each sent once (`reauth_warn_stage` / `reauth_warned_at`). A missed day catches up with the tightest stage that applies.
- The email goes to the connection owner only, in their language (EN/NL/FR/DE). NL subject: "Log binnen 7 dagen opnieuw in bij KBC, anders stopt de opvolging van je huur". It includes the masked IBAN, the date, the one-click link `/bank-connections/<id>?relogin=1`, and says plainly that automatic reminders stop while the connection is expired.
- Each warning is logged as a `landlord_notification` with `metadata.kind = "bank_reauth_warning"`.
- Ponto is included automatically, because its `consent_expires_at` comes from `authorizationExpirationExpectedAt`.

**Reminder safety**
- `createMonitoringGuard()` finds the stale connection a lease is monitored through: the lease's bank account, else the default account, else the only account. A connection counts as stale when it is expired, in error, or past its consent date with no sync since, and no healthy connection covers the same IBAN.
- The 19:15 overdue reminders and the due-date SMS/WhatsApp skip those leases. The landlord gets the stage-0 warning once instead.
- A manual reminder is still sent, but the result carries `staleBankConnection` and the overview shows a warning toast.

**Web**
- Connect page: a choice between "Enable Banking met je eigen app" (Gratis) and Ponto, two short lines each.
- `/bank-connections/enable-banking` setup page: the steps, the redirect URL with a copy button, a link to the Control Panel, the application ID field and .pem upload, the test result, a searchable bank list with personal/business choice, and "Inloggen bij je bank".
- The detail page has an account picker for logins with several accounts. "Log in again" shows from 14 days before expiry and when expired or in error.
- `BankReauthBanner` on the overview and the bank connections pages (amber within 14 days, red when expired). It works in the Android WebView too.

**Docs:** `SELF-HOSTING.md` has a new "Enable Banking (free, your own app)" section, a redirect URL row and the 09:00 job. `.env.example` and `.env.production.example` have `RENTULAR_INSTANCE`, `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY_PATH` and `ENABLE_BANKING_REDIRECT_URL`.

## Checks (actually run)

- `apps/api`: `npx vitest run`: 75 files, 668 tests passed. 53 of them are new, across 6 new test files.
- `apps/api` and `apps/web`: `npx tsc --noEmit -p .`: clean.
- `apps/web`: `pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: exit 0. `/bank-connections/enable-banking` was built. The edge-runtime and standalone-copy warnings were there before this work.
- Not verified: nothing called the real Enable Banking API (as instructed). Endpoints and field names follow the plan's reference. The live flow is the owner's test below.

## Deploy order (DDL FIRST)

1. Back up the `rentular` database on m1.
2. Apply `.planning/quick/261109-ebk-enable-banking-provider/prod-ddl.sql`. It only adds things: `users.plan`, two `bank_connections` columns, a provider enum no-op, and the `enable_banking_apps` table. The code reads the new columns on every bank-connection query and in the 19:15 worker, so the DDL must go in before the code.
3. On m1, add `RENTULAR_INSTANCE=hosted` to the API env. Without it, the API also derives hosted from `WEB_URL=https://www.rentular.com`. Do NOT set `ENABLE_BANKING_APP_ID` on hosted, it is ignored there anyway.
4. Merge the branch, build web, and `pm2 restart` api and web. The API restart registers the new 09:00 `bank-reauth-warnings` job; the old schedules are removed and added again at boot.
5. Smoke test: `GET /api/v1/bank-connections/options` returns providers, and the existing Ponto connection still lists and syncs.

## Testing it on prod with your own KBC account

Your hosted account is treated as **paid** if you have more than 3 properties, and then Enable Banking is hidden. To test, run `UPDATE users SET plan='free' WHERE email='<your email>';` and set it back to NULL or 'paid' afterwards. Your Ponto connection keeps working either way.

In the **Enable Banking Control Panel** (enablebanking.com, sign up with your own email):
1. Applications: register a new application. Environment **Production**. Use any name, for example "Rentular (eigen gebruik)".
2. Redirect URL: copy the exact value shown on Rentular's Enable Banking page. With the current prod env that is `https://www.rentular.com/api/v1/bank-connections/enable-banking/callback`. It is derived from `BANK_CONNECTION_REDIRECT_URL`; `ENABLE_BANKING_REDIRECT_URL` overrides it.
3. Let the panel generate the key pair and download the private key `.pem`. Note the application ID.
4. Click **"Activate by linking accounts"** and link your own KBC account (personal), confirming with KBC Mobile. This puts the app in restricted mode (free, your own accounts only).

Then in Rentular:
5. Bank connections, Connect, "Enable Banking met je eigen app". Paste the application ID, upload the `.pem`, click "Bewaren en testen". You should see "Werkt: N banken beschikbaar". "Invalid JWT" means the ID and key do not match, or the server clock is off.
6. Pick KBC, Privérekening, "Inloggen bij je bank". Log in at KBC and you land on the connection page. A first sync runs right away with your PSU headers (Caddy must pass X-Forwarded-For, which it does by default).
7. Check that transactions appear and the consent date is about 180 days out. Optionally test a re-login with "Opnieuw inloggen" on the detail page: the history stays on the same row.

## Deviations from Plan

1. **[Rule 2] The Ponto token-refresh failure also triggers the immediate stage-0 warning.** The plan asked for this for Enable Banking only. Cost if wrong: one extra email when a Ponto refresh fails.
2. **[Rule 3] The old Phase C renewal email builder was removed from paymentCheckWorker.** The new job replaces it. The `bankConnections.email.renewalWarning` i18n keys are left in place, now unused. Cost if wrong: none functionally; the unused keys can be removed later.
3. **[Rule 2] Stale detection also covers an active connection past its consent date with no sync since.** This avoids holding reminders on Ponto's "expected" expiry while data still flows. Cost if wrong: reminders would be held one or two syncs late.
4. **The re-login of an Enable Banking row is matched by IBAN.** Account uids are per session. If the bank does not return the same IBAN, the landlord is told to log in again and pick the same account (`error=account_missing`). Cost if wrong: re-login fails for banks that hide IBANs.
5. **Manual reminders show the warning after sending (a toast on the overview), not as a confirm before sending.** This mirrors the existing waiting-transfer warning. Cost if wrong: small UX change if the owner wants a pre-send confirm.

## Assumption Drift (advisory)

- The plan says "Ponto offered whenever Ponto env credentials are configured" for self-hosted. The same condition now applies to hosted free too, so a hosted install without Ponto offers Enable Banking alone. Cost if wrong: none on prod, where Ponto is configured.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: unauthenticated-callback | apps/api/src/index.ts, routes/enableBankingConnections.ts | `/bank-connections/enable-banking/callback` skips the session check. The HS256 state JWT (10 min, nonce, owner + connection id, provider) protects it. |
| threat_flag: secret-at-rest | lib/enableBankingApps.ts | The landlord's RSA private key is stored AES-256-GCM encrypted under AUTH_SECRET, never returned or logged. |
| threat_flag: outbound-third-party | lib/enableBanking.ts | New outbound calls to api.enablebanking.com, carrying the landlord's IP and user agent as PSU headers. |

## Self-Check: PASSED

- All files listed above exist on disk. Commits 042fd9e, 4120a93, 0eb8d6c, 4d27d50, 10ac4ed, 103fb91 and c021d86 are on branch worktree-agent-a7d1ba010fc490968.
- SUMMARY, prod-ddl.sql, STATE.md and PLAN.md are not committed, as instructed.
