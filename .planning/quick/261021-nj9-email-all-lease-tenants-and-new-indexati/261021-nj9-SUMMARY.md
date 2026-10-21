---
phase: quick-261021-nj9
plan: 01
subsystem: api/messaging
tags: [email, cc, indexation, i18n, belgian-formatting]
requires: []
provides:
  - getLeaseEmailRecipients / pickLeaseRecipients / mergeCc (apps/api/src/lib/leaseRecipients.ts)
  - Belgian formatting helpers (apps/api/src/lib/belgianFormat.ts)
  - Rebuilt four-language indexation letter (apps/api/src/services/indexationEmail.ts)
affects:
  - email worker (cc now actually sent)
  - manual + automatic payment reminders, landlord-action reminder, custom messages, indexation preview/apply
tech-stack:
  added: []
  patterns: ["single recipient helper for tenant emails", "cc recorded in communications.metadata json"]
key-files:
  created:
    - apps/api/src/lib/leaseRecipients.ts
    - apps/api/src/lib/__tests__/leaseRecipients.test.ts
    - apps/api/src/lib/belgianFormat.ts
    - apps/api/src/lib/__tests__/belgianFormat.test.ts
    - apps/api/src/services/__tests__/indexationEmail.test.ts
  modified:
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/jobs/__tests__/emailQueueWorker.test.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/services/reminderChannel.ts
    - apps/api/src/services/__tests__/reminderChannel.test.ts
    - apps/api/src/services/manualReminder.ts
    - apps/api/src/services/__tests__/manualReminder.test.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/services/indexationEmail.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/routes/landlordActions.ts
    - apps/api/src/routes/communications.ts
    - apps/api/src/routes/indexation.ts
decisions:
  - "One communications row per email; cc addresses stored in the existing metadata json column (no schema change)"
  - "Test-phase reminder mail drops the cc so co-tenants never receive test mail"
  - "French dates use '1er' for the first of the month; FR letter uses 'certificat PEB' for EPC"
  - "Owner phone in the signature comes from users.whatsappNumber (no phone column)"
metrics:
  duration: "~25 min"
  completed: 2026-10-21
  tasks: 3
  files: 18
---

# Quick 261021-nj9: All-tenant emails and new indexation letter Summary

Every tenant-facing email for a lease now goes to the primary tenant with the other linked tenants in cc (one shared helper), the email worker finally passes cc to nodemailer, and the default indexation letter is rebuilt in NL/FR/DE/EN after the landlord's reference letter with Belgian formatting and the Flemish EPC correction computation.

## What was built

**Task 1: recipients and cc plumbing** (commits 75dcaee RED, 1eb1714)
- `lib/leaseRecipients.ts`: `pickLeaseRecipients` (pure), `getLeaseEmailRecipients(leaseId)` (one join query), `mergeCc`. Primary = isPrimary row else first row; `to` = primary's email else the first other tenant's; cc = the rest, trimmed, deduped case-insensitively, `to` excluded.
- `emailQueueWorker.ts`: worker destructures `cc` and passes it to `sendEmail` (it was dropped before); `queueEmail` writes `metadata: { cc: [...] }` on the communications row when cc is present.
- `reminderChannel.ts`: optional `cc` forwarded as 6th arg to `sendReminder` on the email branch only.
- `manualReminder.ts`, `paymentCheckWorker.ts` (overdue escalation only), `landlordActions.ts` (co-tenants merged into the landlord cc via `mergeCc`), `communications.ts` (custom email; SMS stays primary-only) all use the helper.

**Task 2: formatting + letter** (commits 6825ca0 RED, 09ccdd8)
- `lib/belgianFormat.ts`: `formatEur`, `formatIndexValue`, `formatShortDate`, `formatLongDate`, `formatMonthName`, `formatMonthYear`, `formatCountry`, `MONTH_NAMES`, `letterLanguage`.
- `indexationEmail.ts`: new `IndexationEmailParams`, `buildIndexationTemplateVars` (new placeholders plus legacy keys), `generateDefaultIndexationEmail` returning fully rendered text; empty computed blocks drop their line, blank-line runs collapse. `LEGAL_REFERENCES` rewritten with proper accents.
- `indexationAlerts.ts` imports `formatEur` instead of its private `eur()`.

**Task 3: indexation routes** (commit d3da767)
- `CalculationResult` gains signingDate, paymentMethod, baseRent (lease), address fields (property), currentIndexMonth.
- Private `buildIndexationEmailParams` maps calc + tenant + owner onto the letter params.
- Preview and apply use `getLeaseEmailRecipients`; apply queues with `cc: rec.cc`; preview response adds `recipients: { to, cc }`.

Rendered NL output for the Akpinar reference case was printed and checked by eye against `reference-letter-nl.txt`: same order, "€ 675,00 × 134,77 / 108,98 = € 834,74", "€ 834,74 × 0,943883189 = € 787,90", round down to € 780,00, standing-order sentence, "van kracht vanaf 1 juni 2025", full signature.

## Verification (observed)

- Task 1 verify: 4 test files, 28 tests passed; grep for `eq(leaseTenants.isPrimary, true)` in manualReminder/landlordActions/communications returned 0; `sendEmail({ to, cc, ...` present.
- Task 2 verify: belgianFormat + indexationEmail + indexationAlerts: 3 files, 51 tests passed; dash count 0 in the three new lib/service files; no `function eur` left.
- Task 3 verify: `tsc --noEmit -p apps/api/tsconfig.json` exit 0; full apps/api vitest suite: **41 files, 342 tests passed, 0 failed** (baseline was 38 files, 303 tests); `getLeaseEmailRecipients` appears 3 times in indexation.ts.
- Remaining `eq(leaseTenants.isPrimary, true)` in apps/api/src: landlordReportWorker.ts, paymentCheckWorker.ts:236 (due-date SMS/WhatsApp nudge), indexation.ts `upcoming` route. Matches the plan.
- Not verified: real sending in production (manual spot check on lease 167863a8 after deploy, per plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Privacy] Test-phase reminders would have cc'd co-tenants**
- **Found during:** Task 1
- **Issue:** `sendReminder` redirects `to` to the landlord in the test phase but kept `cc`. With co-tenant cc now flowing through `reminderChannel`, test mail would have reached real co-tenants.
- **Fix:** clear `emailOptions.cc` in the test-phase branch of `paymentFollowUp.sendReminder`.
- **Files modified:** apps/api/src/services/paymentFollowUp.ts
- **Commit:** 1eb1714

**2. [Rule 1 - Project rule] Pre-existing em-dashes in touched files**
- **Found during:** Task 1
- Three comment lines in paymentCheckWorker.ts and landlordActions.ts had em-dashes; replaced with commas/colon since the files were changed. Unused imports (`tenants`, `leaseTenants`, `and`) removed from landlordActions.ts and communications.ts.
- **Commit:** 1eb1714

**3. [Rule 1] Write tool turned the escaped dash code points in the test regex into literal characters**
- Fixed with perl back to escape sequences before committing Task 2 (09ccdd8).

### Notes
- The Task 2 commit (09ccdd8) leaves `routes/indexation.ts` not type-checking (old param shape) until the Task 3 commit (d3da767). The plan's "keep compiling until Task 3" was not achievable once `IndexationEmailParams` changed shape; final HEAD is clean.
- Behaviour change in `manualReminder`: when the primary has no email, the name and language now stay the primary's (previously the whole fallback tenant row was used). This is what the plan specifies.
- `node_modules` was restored in the worktree with `pnpm install --frozen-lockfile --offline` (no new packages).

## Assumption Drift (advisory)

- **Found during:** Task 2. **Planned:** "print the factor as given (e.g. 0.94)". **Actual:** the Flemish factors are stored with 9 decimals (0.943883189), so the letter prints "0,943883189". **Why:** printing as given keeps the computation line verifiable; rounding to 0,94 would make "€ 834,74 × 0,94" not equal € 787,90.

## Known Stubs

None.

## Self-Check: PASSED
- Files exist: leaseRecipients.ts, belgianFormat.ts, indexationEmail.ts and the three new test files.
- Commits present: 75dcaee, 1eb1714, 6825ca0, 09ccdd8, d3da767.
