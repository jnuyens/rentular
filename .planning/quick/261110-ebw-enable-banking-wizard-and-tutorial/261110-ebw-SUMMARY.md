---
quick_id: 261110-ebw
status: complete
completed: 2026-11-09
branch: worktree-agent-a0fd4d82bc3a65f0f
public_tutorial_url: https://www.rentular.com/help/enable-banking
commits:
  - b1bece3 feat: tell the web which Enable Banking step to show after a failed check or login
  - ddf482b feat: Enable Banking setup as a step by step wizard (EN/NL/FR/DE)
  - 7a51e66 feat: entry points into the Enable Banking setup
  - ab95f4d feat: public Enable Banking guide at /help/enable-banking (EN/NL/FR/DE)
---

# Quick 261110-ebw: Enable Banking wizard in the app and a public guide

The Enable Banking setup page is now a guided wizard. It shows one step at a time and opens at the step the landlord had reached. There is also a public guide at **https://www.rentular.com/help/enable-banking** (anchors `#step-1` to `#step-7`, `#troubleshooting`, `#privacy`, `#self-hosting`). Both are in EN, NL, FR and DE.

## Wizard (`/bank-connections/enable-banking`, same route, same API calls)

- `components/enableBanking/EnableBankingWizard.tsx`: six steps with "Stap X van 6", a progress bar and Back/Next. Each step has a title, short text with the literal Enable Banking labels in quotes, a "Wat je nu zou moeten zien" line, a link to the guide anchor for that step (new tab) and "Hulp nodig? Mail naar ...".
- Opening step: `?step=N` first (clamped to what the server allows). With an active Enable Banking connection it opens the done screen. Otherwise it uses the server state (no key: 1; key saved: 4; verified: 5; verified with a pending connection: 6), raised to the step stored in localStorage per user when the server allows that step. Next stays disabled until the key is saved (4 to 5) and verified (5 to 6). If the admin manages the app for the whole install, the wizard shows only step 1 and step 6.
- Step 3: large copy button for the redirect URL, which shows a check once copied. It also gives copy fields for `<origin>/privacy` and `<origin>/terms` (both routes exist) and the warning that the .pem can be downloaded only once.
- Step 4: drag and drop or a file picker. The application id is filled in from a `<uuid>.pem` file name and can still be edited. The result reads "Werkt: Rentular kan met je app praten", or explains the error: Invalid JWT means the wrong file, the wrong id or the server clock; 403 means the app is not active yet and offers a button to step 5. Replace key, remove key and test again all still work.
- Step 5: "Activate by linking accounts", with the note that Rentular asks the bank separately afterwards, and a re-test button.
- Step 6: personal/business choice with an explanation, bank search, "Inloggen bij je bank".
- Done (`EnableBankingDoneCard`): the account and masked IBAN, "Je bank laat dit toe tot {date}", warnings at 14/7/3/1 days, the first sync now and then three times a day. The same card appears on the connection page after `?connected=1` or after picking accounts.
- No accounts returned: the API callback now adds `provider=enable_banking` to its error redirects. The callback page shows "Je bank gaf geen rekeningen terug. Meestal is stap 5 ... nog niet gebeurd." with a button to `?step=5`. Other Enable Banking errors link back to step 6.
- Entry points (`EnableBankingEntry.tsx`): a card on the bank connections page, and a dismissible banner on the overview ("Koppel je bankrekening gratis, stap voor stap"; localStorage per user, in try/catch). Both show only when `/options` offers Enable Banking and the landlord has no connection that is not revoked.
- The Ponto line on step 1 links to `/bank-connections/connect?provider=ponto`, which now opens the Ponto flow directly.
- Support email: `SUPPORT_EMAIL` (read server side in the dashboard layout and the guide), falling back to `privacy@rentular.com`, the only contact address on the site.

## Public guide (`apps/web/app/help/enable-banking/page.tsx`)

- Server component with locale-aware metadata. It is public in the middleware (`/help/...`), listed in `sitemap.ts`, and linked from the marketing footer, from a new pricing note ("Op het gratis plan koppel je je bank zonder kosten ... Zo werkt het") and from SELF-HOSTING.md.
- Content: what Enable Banking is, why it is free (restricted mode, your own app; Enable Banking's terms apply, no promises), Enable Banking or Ponto, what you need, the 7 steps with numbered badges, and troubleshooting (Invalid JWT, no accounts returned, bank not in the list, expired / log in again, the bank asks again after 90 days, lost .pem). It also has a privacy section (key encrypted on the server, read only, never pays) and self-hosting with a GitHub SELF-HOSTING.md link. The redirect, privacy and terms URLs come from `getBaseUrl()`, so a self-hosted install shows its own addresses.
- Navy/green marketing styling (brand gradient header, tint cards, shadow-soft). No third-party screenshots.

## Checks (actually run)

- `apps/web`: `npx tsc --noEmit -p .` was clean (final state).
- `apps/web`: `pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET exited 0, and `/help/enable-banking` and `/bank-connections/enable-banking` were built. The standalone traced-file copy warning for `(marketing)/page.js` was there before this work.
- `apps/api`: `npx vitest run` passed: 75 files, 669 tests, including a new callback test for `no_accounts&provider=enable_banking` and the i18n completeness test over the web messages.
- Local `next start` of the build: `/help/enable-banking` returned 200 in nl/en/fr/de (NEXT_LOCALE cookie). The rendered HTML has all the anchors and the URLs filled in. Without a session the wizard route redirects to login, as expected.
- Dash check: no en or em dashes in the new message namespaces (`ebWizard`, `ebHelp`, the new marketing keys), the new files, or the touched API route and SELF-HOSTING.md.
- **Not verified:** I did not click through the wizard in a browser with a signed-in session and a running API (none was available locally). Nothing called Enable Banking. Nothing was deployed.

## Deviations from Plan

1. **[Rule 2] Small API change.** Callback error redirects now carry `provider=enable_banking`, and verification returns `hint: "app_not_active"` on a 403. The web page needs both to send the landlord to step 5. Cost if wrong: one extra query parameter on the callback page. The Ponto/GoCardless callbacks are unchanged.
2. **Support fallback is `privacy@rentular.com`.** It is the only address shown on the site. Cost if wrong: support mails land in the privacy inbox until `SUPPORT_EMAIL` is set on the web process (on m1 it may only be set for the API today).
3. **Done screen on the connection page too.** The callback lands on `/bank-connections/<id>?connected=1`, not on the wizard, so step 7 shows there as well as in the wizard. Cost if wrong: none.
4. **`/bank-connections/connect?provider=ponto`.** Added so the Ponto alternative on step 1 has a direct target. Cost if wrong: none.

## Assumption Drift (advisory)

- The plan asks for the literal Enable Banking button and field names. I only quote labels that the plan or the existing docs give ("API applications", "Production", "Sandbox", "Activate by linking accounts"). The other actions (register a new application, the redirect URL field) are described in words, without quotes, because I could not check the Control Panel. Cost if wrong: if a label differs in the Control Panel, one sentence needs a tweak.
- The NL dashboard menu label is still "Bank Connections" in every language (the existing `nav.bankConnections` is not translated), so the guide quotes it as "Bank Connections". Cost if wrong: if that label is translated later, the guide's quote has to follow.

## Deferred

- `nav.bankConnections` is "Bank Connections" in NL/FR/DE. This was there before and is out of scope.

## Known Stubs

None.

## Threat Flags

None. The guide is a public static page with no new endpoints. The new `provider` query parameter on the callback page is only read for display.

## Self-Check: PASSED

- The files exist: components/enableBanking/{EnableBankingWizard,EnableBankingDoneCard,EnableBankingEntry}.tsx, components/enableBanking/links.ts, app/help/enable-banking/page.tsx.
- Commits b1bece3, ddf482b, 7a51e66 and ab95f4d are on worktree-agent-a0fd4d82bc3a65f0f. SUMMARY, STATE and PLAN are not committed.
