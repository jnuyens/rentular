---
quick_id: 261114-bru
status: complete
completed: 2026-11-14
subsystem: indexation
tags: [brussels, epc, epb, indexation, health-index]
key-files:
  created:
    - apps/api/src/services/brusselsEpcFactor.ts
    - apps/api/src/services/__tests__/brusselsEpcFactors.test.ts
    - apps/api/src/services/__tests__/brusselsEpcFactor.test.ts
    - apps/web/components/BrusselsEpcNote.tsx
    - .planning/quick/261114-bru-brussels-epc-indexation-fix/prod-ddl.sql
  modified:
    - packages/shared/src/constants/index.ts
    - packages/db/src/schema/leases.ts
    - apps/api/src/services/indexationCalc.ts
    - apps/api/src/services/indexationEmail.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/services/healthIndex.ts
    - apps/api/src/jobs/healthIndexWorker.ts
    - apps/api/src/lib/adminNotify.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/routes/leases.ts
    - apps/api/src/routes/properties.ts
    - apps/web/app/(dashboard)/leases/page.tsx
    - apps/web/app/(dashboard)/indexation/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
---

# Quick 261114-bru: Brussels EPC indexation fix

Brussels indexation now follows art. 224/2 of the Brussels Housing Code: the official correction factor multiplies the whole indexed rent, only for EPB E/F/G leases that took effect before 14/10/2022, keyed on the anniversary period (October split at the 14th). No EPB certificate or an unregistered lease blocks indexation. The factor is stored per lease on first use and cleared only by a better certificate (A++ to D). Plus a month-based health index check with a once-per-month admin alert.

## Commits

| Commit | What |
|---|---|
| fef9e51 | Constants (`BRUSSELS_EPC_CORRECTION_FACTORS`, `BRUSSELS_EPC_CUTOFF`), calculation rewrite, Brussels tests, table guard test |
| eb6240b | Lease columns, factor persistence on apply, clearing on a better certificate, blocked apply/preview, route tests |
| 5fc11ef | Tenant letter paragraph for the Brussels factor (NL/EN/FR/DE) |
| 3f2aa2a | Web: "Lease registered" toggle, Brussels explanation lines, prod DDL file |
| 7f2df3f | Month-based health index staleness, once-per-month admin alert, apply waits for the legal index month |

## Table verification (digit for digit)

- Fetched both official pages with curl on 2026-11-14 (EN `.../indexation-rents-correction-factor`, NL `.../huurprijsindexatie-met-correctiefactoren`) and parsed the HTML `<table>` directly.
- Result: 13 rows on each page, **0 mismatches** against the provisional table in the plan, in both E and F-G columns. The provisional table was correct.
- Independent check: downloaded Statbel open data "CPI All base years" (health index, base 2013) and recomputed every factor from the ordinance formulas (health index of the month before the anniversary month; 2021/2022 for 14 Oct to 31 Dec, 2022/2023 for 1 Jan to 13 Oct). All 26 values match to well within 1e-6 (only February E differs in the 10th digit: exact value 0.9617578125, table rounds half up to 0.961757813).
- Also reproduced the page's worked example: 50% x (113.94 + 127.92) / 127.92 = 0.945356473; 1165.19 x 0.945356473 = 1101.52.
- Guard test `brusselsEpcFactors.test.ts` checks the constants against a hard-coded copy of the official table and against a recomputation from embedded Statbel indices (2021-09 to 2023-09). The embedded indices make the test always runnable, so there is no skip path. The table is fixed by the 2023 ordinance and does not change monthly; this test is the guard against drift.
- Note: the Brussels E/FG values equal the Flemish D/efNone values month for month (same formulas), except October, which Brussels splits at the 14th.

## Behaviour decisions

- **Factor applies to the whole indexed rent:** `newRent = round2(unrestricted x factor)`, never to the increase.
- **Cutoff:** `startDate < "2022-10-14"` (string compare on YYYY-MM-DD, no timezone shift). On or after: full indexation for any label.
- **Guards:** result is `min(unrestricted, max(corrected, baseRent))`. The base-rent floor mirrors the Flemish code (`Math.max(corrected, baseRent)`); the law sets no floor of its own, so I added no current-rent floor. The `min` makes sure the result can never be above the standard indexed rent, even when the index falls.
- **Stored factor:** used when present (value strictly between 0 and 1, otherwise ignored and the table is used) even if the label changed since. It is cleared only through the property PATCH when the EPB label changes to A++..D. A new E/F/G certificate keeps it. A new lease row starts with null.
- **No certificate / not registered:** `indexationBlocked` = `brussels_no_epc` / `brussels_not_registered`, newRent = current rent, and apply plus letter preview return 400. An unknown registration value (undefined) counts as not registered.
- **Registration:** leases had no registration field, so I added `lease_registered boolean NOT NULL DEFAULT false` with a toggle on the contract form. It only blocks Brussels. Flanders and Wallonia are not blocked in this task. I did not verify whether their law also makes registration a condition for indexation (my understanding is that it does not in Flanders; Wallonia should be checked against the 2018 decree). I recommend a separate legal check.

## Monthly health index check (coordinator addition)

- The daily 06:00 refresh already existed, with a month-based check from day 5 and a dedupe of once per day. Changed: due day is now **3** (Statbel publishes month M near the end of M). A missing month alerts **once per missing month** (Redis key per month, 40-day TTL). A failed fetch still alerts at most once a day. The mail lists the expected month, the latest stored month and the Statbel URL, and the event is logged. The mail is sent through `lib/adminNotify.ts` (`sendAdminEmail`) to ADMIN_EMAIL.
- `isHealthIndexStale` used fetched_at age. Since rows are insert-only, that age is about a month by design, so it was stale most of the time. It is now month-based (`healthIndexStatusFor`). `GET /indexation/health-index` returns `isStale`, `expectedMonth` and `latestMonth`. The indexation page shows a small warning when stale (EN/NL/FR/DE).
- Missing month in calculations: `computeIndexationCore` still flags this with `currentIndexPublished: false` (unchanged). The alert digest already skipped those leases. Apply did not check it, so it could have applied with the latest month as a fallback. Apply now refuses with 400 until the legal month is published.
- Tests with a fixed clock: missing on the 2nd gives no alert, missing on the 3rd gives one alert and none on the 4th, present gives nothing.

## Checks run (observed)

- `apps/api`: `npx vitest run`: 77 files, **727 tests passed**.
- `apps/api`: `npx tsc --noEmit -p .`: clean.
- `apps/web`: `npx tsc --noEmit -p .`: clean.
- `apps/web`: `pnpm build` with placeholder DB_PASSWORD/AUTH_SECRET: succeeded.
- Diff and commit messages: no em-dashes or en-dashes, no Co-Authored-By lines.
- Not verified: UI rendering in a browser, and the DDL against MariaDB (both need prod or a live DB, which this task does not touch).

## Deviations

1. **[Rule 2] Apply refuses an unpublished legal index month.** Found while doing the coordinator's health index item. Apply could silently use an older month. Cost if wrong: a landlord has to wait a few days for Statbel before applying.
2. **[Rule 2] Letter preview also refuses blocked Brussels leases**, not just apply. Cost if wrong: none for rents; the landlord sees the reason in the indexation dialog.
3. **Internal history note language:** the plan gave the Dutch text "Correctiefactor vervalt: nieuw EPB-certificaat". The note is written in the landlord's locale (NL text exactly as planned, plus EN/FR/DE). Other internal notes are English-only. Cost if wrong: cosmetic.
4. **Health index warning visibility:** the web app has no admin role, so the overdue warning shows to every user of the indexation page. The admin email goes only to ADMIN_EMAIL. Cost if wrong: landlords see a short informational line.
5. **Health index alert mail transport:** now sent directly through `lib/adminNotify.ts` as requested, no longer through the email queue. The communication log no longer records it. Cost if wrong: one fewer row in a log nobody reads for admin mails.
6. Ran `pnpm install --frozen-lockfile` in the worktree (no new packages) to get node_modules for the checks.

## Deploy order

1. Run `.planning/quick/261114-bru-brussels-epc-indexation-fix/prod-ddl.sql` on the prod MariaDB (`rentular`). It is additive: `lease_registered`, `brussels_epc_factor`, `brussels_epc_factor_label`, `brussels_epc_factor_set_at`. **This must happen before step 2**, because the code selects these columns.
2. Merge, build web, `pm2 restart` web and api as usual.
3. Optional: prod has no Brussels leases (13 leases, all Flanders), so no data migration. Any future Brussels lease must get "Lease registered" ticked before it can be indexed.

## Known stubs

None.

## Self-Check: PASSED

- Files exist: brusselsEpcFactor.ts, brusselsEpcFactors.test.ts, brusselsEpcFactor.test.ts, BrusselsEpcNote.tsx, prod-ddl.sql.
- Commits exist: fef9e51, eb6240b, 5fc11ef, 3f2aa2a, 7f2df3f.
