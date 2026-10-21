---
quick_id: 261021-euc
status: complete
completed: 2026-10-21
subsystem: api
tags: [health-index, statbel, email, indexation-alerts]
tech-stack:
  added: [fflate 0.8.2 (exact pin)]
key-files:
  created:
    - apps/api/src/services/__tests__/healthIndex.test.ts
    - apps/api/src/services/__tests__/fixtures/cpi-all-base-years-excerpt.txt
  modified:
    - apps/api/src/services/healthIndex.ts
    - apps/api/src/jobs/healthIndexWorker.ts
    - apps/api/src/lib/email.ts
    - apps/api/src/lib/__tests__/email.test.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/services/__tests__/indexationAlerts.test.ts
    - apps/api/package.json
    - pnpm-lock.yaml
    - .env.example
commits:
  - 4625d54 fix(api): fetch health index from Statbel open-data zip (261021-euc)
  - 0a34356 fix(api): send platform mail as Rentular <noreply@rentular.com> (261021-euc)
  - 3905339 fix(api): stop repeating the address in indexation alert labels (261021-euc)
  - cbbc31d feat(api): alert admin when the health index fetch fails or is overdue (261021-euc)
---

# Quick 261021-euc: health index open data, email sender name, indexation alert label

Health index now comes from the Statbel open-data zip (base 2013 MS_HLTH_IDX) with an admin alert when it fails or goes stale, platform mail is sent as "Rentular <noreply@rentular.com>", and the indexation digest no longer repeats the address.

## Task 1: Statbel open-data zip (4625d54)

- Removed the beSTAT view path (URL, month-name map, parseStatbelMonth, JSON facts).
- `parseStatbelCpiFile(text)` strips the BOM, splits on `\r?\n`, finds columns by header name, keeps `NM_BASE_YR == 2013` rows with a numeric `MS_HLTH_IDX`, zero pads the month, stores `Number(v.toFixed(2)).toString()`.
- `extractStatbelCpiText(zip)` uses fflate `unzipSync`, prefers `CPI All base years.txt`, else the first `.txt`.
- `fetchAndCacheHealthIndex()` loads the existing (year, month) keys once and inserts only the missing months with source `statbel-opendata`.
- Worker log now reads `Daily refresh scheduled at 06:00 (${tz})`, comments fixed.
- Fixture: 10 real lines copied from the Statbel file (BOM, CRLF kept). Header, 1990|1 base 2013 and 2025 with ".", 2025|12, 2026|8 and 2026|9 at base 2013 and 2025, and 2026|9 at base 2004.
- I checked the parser against the real downloaded zip (scratchpad cpi.zip): 393 rows, 1994-01 through 2026-09. 2025-12 = 136.69, 2026-08 = 140.3 (that is 140.30 under the existing storage rule), 2026-09 = 140.67.

## Task 2: Sender display name (0a34356)

- `getPlatformSender()` returns `fromName = EMAIL_FROM_NAME || "Rentular"` for both platform transport paths (no ownerId, and an owner without SMTP settings). If `EMAIL_FROM` contains `<`, it is passed through unchanged with no name.
- `sendEmail` passes `{ name, address }` (via `buildFromHeader`) whenever a name is set. I checked with a nodemailer streamTransport: envelope `{"from":"noreply@rentular.com"}`, header `From: Rentular <noreply@rentular.com>`.
- Searched for other places that build a sender: `routes/settings.ts` `/smtp/test` sends through the landlord's own SMTP using their fromAddress, not the platform transport, so it was left alone.
- `.env.example` only documented `SMTP_FROM` (the API never reads it). I added `EMAIL_FROM` and `EMAIL_FROM_NAME` with a short comment.

## Task 3: Property label dedupe (3905339)

`formatPropertyLabel` is now exported. If the normalised name contains the normalised "street number", any trailing city is dropped from the name and only ", postalCode City" is appended. Otherwise the label is the old "name, street number, postal city".

Exact outputs (from the tests):
- `{name:"Tervuursestraat 97 leuven", street:"Tervuursestraat", streetNumber:"97", postalCode:"3000", city:"Leuven"}` -> `Tervuursestraat 97, 3000 Leuven`
- `{name:"Carnotstraat 65 b102 Antwerpen", street:"Carnotstraat", streetNumber:"65", postalCode:"2018", city:"Antwerpen"}` -> `Carnotstraat 65 b102, 2018 Antwerpen`
- "Residentie Zuid" -> `Residentie Zuid, Kerkstraat 1, 9000 Gent`. A null name -> `Kerkstraat 1, 9000 Gent`.

## Task 4 (extra, requested by the orchestrator mid-run): staleness alert (cbbc31d)

- `fetchAndCacheHealthIndex()` now returns `{ ok, error?, fetched, inserted }` and keeps its log lines. Zero parseable rows counts as a failure.
- `expectedLatestMonth(now, tz)` returns null on days 1 to 4 (local time in tz). From the 5th it returns the previous month, and January asks for December of the year before.
- `decideHealthIndexAlert(result, expected, present)` returns `fetch-failed` when the fetch failed (on any day), `stale` when the fetch worked but the expected month is missing, and null otherwise.
- `checkHealthIndexAndAlert(result, deps)` sends "[Rentular] Health index not updated" to ADMIN_EMAIL. The body has the error, the expected month, the latest month in the DB, fetched/new counts and the check time. If ADMIN_EMAIL is unset it only logs a `[HealthIndex]` warning. Dedupe is `SET healthindex:alert:<kind>:<YYYY-MM> NX EX 82800` on the health-index queue's own ioredis client (`healthIndexQueue.client`). Before the 5th, a fetch failure uses `none` as the month part.
- If Redis is unavailable, the error is logged and the mail is still sent: a duplicate mail is better than a silent stale index. If sending fails, the dedupe key is deleted so the next run retries.
- The worker wires this up after every daily run using `queueEmail`, `getHealthIndexValue`, `getLatestHealthIndex` and `getScheduleTimezone()`. Errors in the check are caught and logged.
- Tests cover day 4 vs day 5, the January rollover, the 2026-11-04T23:30Z boundary (null in UTC, already 5 Nov in Europe/Brussels so October is required), the alert decisions (failed -> alert, ok but missing -> alert, ok and present -> none), once-per-day dedupe, ADMIN_EMAIL unset, Redis down, and freeing the key after a send failure.

## Verification (observed)

- Baseline before changes: 36 files, 251 tests passed.
- After all four commits: `npx vitest run` in apps/api gives 37 files, 286 tests passed, 0 failed.
- `npx tsc --noEmit -p apps/api` exits 0.
- `grep -ri bestat apps/api/src` finds nothing.
- No em or en dashes in any commit diff, and no Co-Authored-By lines.
- Not verified: a live fetch against statbel.fgov.be from the app runtime and a real alert mail through the queue. Both need the deployed environment, and deploying was out of scope.

## Deviations from Plan

- [Rule 2] Task 2: also documented `EMAIL_FROM`, because `.env.example` only had `SMTP_FROM`, which the code does not read.
- Task 4 was added by the orchestrator during execution and committed as its own feat commit.
- I added `release` (delete the dedupe key when sending fails) so a failed queue push does not block alerts for 23h.
- To meet the "no bestat" done criterion I amended the beSTAT wording out of a comment in the Task 4 commit (the file was still unpushed, local only).

## Self-Check: PASSED

All listed files exist, and commits 4625d54, 0a34356, 3905339 and cbbc31d are on branch worktree-agent-a1ef1afb00e350c50.
