---
quick_id: 261110-ebw
type: quick
autonomous: true
---

# Quick Task 261110-ebw: Enable Banking step-by-step wizard in the app, plus a public tutorial on rentular.com

## Why

The first real user of the new Enable Banking provider (261109-ebk) is a non-technical landlord with an existing free Rentular account (1 property, locale nl, not at KBC). The current setup page (apps/web/app/(dashboard)/bank-connections/enable-banking/page.tsx) is one long form with a 5-line numbered list. She needs to be guided one step at a time, and there should be a public tutorial on the website she (and self-hosters, and anyone evaluating Rentular) can keep open next to the Enable Banking Control Panel.

## Task 1: Guided wizard in the app

Replace the single form with a stepper (same route, same API calls, keep every existing capability: replace/remove key, test, psu type, bank search, login, re-login). Steps with a progress indicator ("Stap 2 van 6") and Back/Next; the current step is derived from server state so she can stop and come back later (key saved -> step 4; verified -> step 5; connection active -> done). Each step: a short title, 2 to 4 plain sentences, exactly what to click (use the literal Enable Banking button and field names in quotes, in English as they appear there), and a "Wat je nu zou moeten zien" line. Link "Bekijk de uitgebreide handleiding" to the public tutorial anchor for that step (opens in a new tab).

1. Wat je gaat doen: what Enable Banking is, why it is free (your own app, only your own accounts), time needed (about 10 minutes), what you need (your banking app or card reader). Two lines on Ponto as the alternative (paid by the landlord, no own app) with a link to the Ponto flow.
2. Account bij Enable Banking: button "Open enablebanking.com" (new tab), sign up, confirm email.
3. App registreren: in the Control Panel go to API applications, register a new application, choose Production (not Sandbox), name e.g. "Rentular", paste the redirect URL (large copy button, show a check when copied), privacy and terms URLs if asked (give rentular.com/privacy and rentular.com/terms if those routes exist; check), then the browser downloads a file named <application-id>.pem: "Bewaar dit bestand, je kan het maar één keer downloaden."
4. Sleutelbestand uploaden: drag and drop or pick the .pem. Auto-fill the application id from the file name when it matches the id pattern (UUID), editable; explain where to find it otherwise. On save Rentular verifies immediately: success "Werkt: Rentular kan met je app praten" or a plain explanation of the error (Invalid JWT -> wrong file or id or the clock; 403 -> app not active yet, go to step 5).
5. Je eigen rekening koppelen in Enable Banking: in the Control Panel open the application, "Activate by linking accounts", choose your bank, log in with your banking app. Explain this only tells Enable Banking which account the free app may read; Rentular still asks your bank separately in the next step.
6. Inloggen bij je bank via Rentular: pick personal or business (explain: privé rekening = personal), search your bank, "Inloggen bij je bank", approve in the banking app, come back to Rentular, choose the account(s) to follow. If the session returns no accounts: show "Je bank gaf geen rekeningen terug. Meestal is stap 5 (rekening koppelen in Enable Banking) nog niet gebeurd." with a button back to step 5.
7. Klaar: the account, the date until which the bank login is valid ("Je bank laat dit toe tot 08/05/2027"), that Rentular warns 14, 7, 3 and 1 days before, and what happens next (first sync now, then 3 times a day).

Also: an entry card on the bank connections page and a small banner on the overview for free/self-hosted landlords without any bank connection ("Koppel je bankrekening gratis, stap voor stap"), dismissible (localStorage per user, wrapped in try/catch). A "Hulp nodig?" line on every step with the support email (SUPPORT_EMAIL env, fallback to the existing contact on the site).

## Task 2: Public tutorial on the website

- New marketing route, e.g. /help/enable-banking (check the existing marketing route structure and i18n routing; all four languages EN/NL/FR/DE, reachable without login, linked from the footer or a Help section and from the pricing/features copy where bank connections are mentioned, and from SELF-HOSTING.md).
- Content: the same 7 steps in more detail with anchors (#stap-1 ... or language-neutral ids #step-1 ...), what Enable Banking is, why it is free for your own accounts (restricted mode, your own app; do not promise anything legal; say Enable Banking's terms apply), the difference with Ponto, a troubleshooting section (Invalid JWT, no accounts returned, bank not in the list, consent expired / re-login, "my bank asks again after 90 days", lost .pem file: generate a new key in the Control Panel and upload it again), a privacy note (the key is stored encrypted on the Rentular server; Rentular only reads, never pays), and a short self-hosting note linking SELF-HOSTING.md on GitHub.
- No screenshots of third-party UIs (we cannot capture the Enable Banking Control Panel); instead clear text, the literal button names, and simple illustrative step badges. Match the current marketing design (navy/green, the redesign from 261104-qhe).
- Human tone, no marketing words (seamless, robust, powerful, leverage, elevate), no rule-of-three filler, no em-dashes or en-dashes. Belgian NL for the Dutch version, proper French and German with accents and umlauts.
- Add the page to the sitemap if one exists.

## Checks

- apps/web `npx tsc --noEmit -p .` and `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed); api vitest green if the API is touched; grep the new copy for dashes.
- No Co-Authored-By lines. Never deploy, never touch prod, never send messages, never call Enable Banking.
