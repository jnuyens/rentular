---
quick_id: 261021-euc
mode: quick
type: execute
autonomous: true
---

# Quick 261021-euc: health index open data, email sender name, indexation alert label

Three independent API fixes in apps/api. One atomic commit per task. No deploy, no m1.
Rules: no em-dashes or en-dashes anywhere (code, comments, commits). No Co-Authored-By lines in commits.

## Task 1: Health index fetch from Statbel open-data zip

files: apps/api/src/services/healthIndex.ts, apps/api/src/jobs/healthIndexWorker.ts, apps/api/package.json, pnpm-lock.yaml, apps/api/src/services/__tests__/healthIndex.test.ts, apps/api/src/services/__tests__/fixtures/cpi-all-base-years-excerpt.txt

action:
- The current STATBEL_API_URL (beSTAT view 208b69bd-...) is a fixed Dec 2024 to Dec 2025 range and never returns new months. Delete that path entirely (URL, English month map, parseStatbelMonth, JSON facts parsing).
- New source: https://statbel.fgov.be/sites/default/files/files/opendata/Consumptieprijsindex%20en%20gezondheidsindex/CPI%20All%20base%20years.zip
  Zip with one pipe-separated file "CPI All base years.txt" (UTF-8 with BOM). Header:
  NM_YR|NM_MTH|MS_CPI_IDX|MS_CPI_INFL|MS_WT_CPI|MS_HLTH_IDX|_FREQ_|NM_BASE_YR|MS_WTHOUT_ENE_IDX|MS_WITHOUT_PTRL_IDX|MS_SMOOTH_IDX
- Zip extraction: no zip lib exists in the monorepo. Add fflate (pinned exact version, e.g. 0.8.2) to apps/api dependencies via pnpm. Use unzipSync on the downloaded ArrayBuffer and pick the .txt entry (prefer name "CPI All base years.txt", else first .txt).
- Export a pure parser, e.g. `parseStatbelCpiFile(text: string): Array<{ year: string; month: string; value: string }>`:
  strip leading BOM (﻿), split lines (handle \r\n), locate columns by header name (not fixed index), keep rows where NM_BASE_YR == "2013" and MS_HLTH_IDX is not "." and parses as a finite number, year = NM_YR, month = NM_MTH zero padded to 2 ("9" -> "09"), value = Number(v).toFixed(2) style matching the current storage (Number(x.toFixed(2)).toString() is what is used now; keep the same).
  Expected: 2026|9 -> 140.67, 2026|8 -> 140.30 (stored as current code would store it), 2025|12 -> 136.69. Verify against the real file.
- fetchAndCacheHealthIndex(): fetch zip, on !ok log `[HealthIndex] Failed to fetch from Statbel: HTTP ...` and return; unzip, parse; same insert-only-missing loop (never overwrite), source "statbel-opendata". Whole thing in try/catch logging `[HealthIndex] Failed to fetch from Statbel: <msg>` (retry next day). Log count fetched / new. Consider loading existing (year, month) keys once instead of one query per row, since the file has many years (optional, keep simple).
- apps/api/src/jobs/healthIndexWorker.ts: the cron passes tz: getScheduleTimezone(), so the comments and log line "Daily refresh scheduled at 06:00 UTC" are wrong. Log `Daily refresh scheduled at 06:00 (${tz})` and fix the comments.
- Fixture: small excerpt (header with BOM + a handful of rows) from /private/tmp/claude-503/-Users-jnuyens-src-rentular-source/4f00c592-354c-4ebc-ab0d-a647c1302f4b/scratchpad/statbel/x/CPI All base years.txt . Include rows from base 2013 for 2025|12, 2026|8, 2026|9, rows from another base year for the same month, and a base 2013 row whose MS_HLTH_IDX is "." (old years). Copy real lines, do not invent.
- Tests (vitest): base-year filter, "." skipping, month padding, BOM stripped (first column parses as NM_YR), CRLF tolerance, expected values above. Optionally a test of the zip path with fflate zipSync round trip.

verify: `pnpm --filter <api package> test` and `npx tsc --noEmit -p apps/api` pass.
done: no reference to bestat remains in apps/api/src; parser tests pass.

## Task 2: Sender display name "Rentular <noreply@rentular.com>"

files: apps/api/src/lib/email.ts, apps/api/src/lib/__tests__/email.test.ts, .env.example (document EMAIL_FROM_NAME if EMAIL_FROM is documented there)

action:
- Platform transport paths (no ownerId, and owner without smtp settings, lines ~47 and ~68) return fromAddress = process.env.EMAIL_FROM || "noreply@rentular.com" and no fromName. Give them fromName = process.env.EMAIL_FROM_NAME || "Rentular", unless EMAIL_FROM already contains "<" (then send it raw as before, no name).
- In sendEmail (line ~101) build from as a nodemailer address object `{ name: fromName, address: fromAddress }` when fromName is set, else the bare string. Envelope sender must stay the bare address (noreply@rentular.com); nodemailer derives the envelope from address, so do not set a different envelope. Owner custom SMTP path keeps its own fromName/fromAddress (it will also go through the object form, which is fine).
- Check other places in apps/api that build a "from" from EMAIL_FROM directly (grep EMAIL_FROM) and apply the same helper if they send via the platform transport.
- Update email.test.ts: default produces { name: "Rentular", address: "noreply@rentular.com" }; EMAIL_FROM_NAME override; EMAIL_FROM containing "<" passes through unchanged; owner fromName preserved.

verify: tests and tsc pass.

## Task 3: Property label dedupe in indexation alert digest

files: apps/api/src/services/indexationAlerts.ts, apps/api/src/services/__tests__/indexationAlerts.test.ts

action:
- formatPropertyLabel currently returns "name, street number, postal city", giving "Tervuursestraat 97 leuven, Tervuursestraat 97, 3000 Leuven".
- New rule: normalise (lowercase, collapse whitespace, trim). If the normalised name contains normalised "street streetNumber": label = name with a trailing city (case-insensitive, whole word at the end) removed, trimmed of trailing commas/spaces, then ", postalCode City" appended (from the address fields; skip missing parts). Examples:
  {name:"Tervuursestraat 97 leuven", street:"Tervuursestraat", streetNumber:"97", postalCode:"3000", city:"Leuven"} -> "Tervuursestraat 97, 3000 Leuven"
  {name:"Carnotstraat 65 b102 Antwerpen", street:"Carnotstraat", streetNumber:"65", postalCode:"2018", city:"Antwerpen"} -> "Carnotstraat 65 b102, 2018 Antwerpen"
  If name contains street+number and no trailing city: "name, postal city".
- Otherwise keep existing "name, street number, postal city" e.g. "Residentie Zuid, Kerkstraat 1, 9000 Gent". Missing name -> address only, as now.
- Export formatPropertyLabel (named export) for tests. Add tests for the two real examples, "Residentie Zuid", and a null name.

verify: tests and tsc pass.
