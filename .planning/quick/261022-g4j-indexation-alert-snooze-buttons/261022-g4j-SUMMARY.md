---
phase: quick-261022-g4j
plan: 01
subsystem: api / indexation alerts
tags: [indexation, email, magic-link, snooze]
requires: [indexation alert digest, landlord-action public mount, AUTH_SECRET]
provides: [leases.indexation_snoozed_until, indexation snooze token, HTML digest, GET /api/v1/landlord-action/indexation/:token]
affects: [runIndexationAlerts, indexation apply handler, email queue]
tech-stack:
  added: []
  patterns: [signed one-click link with kind discriminator, pure renderer with caller-signed URLs]
key-files:
  created:
    - apps/api/src/lib/indexationSnoozeToken.ts
    - apps/api/src/lib/__tests__/indexationSnoozeToken.test.ts
    - apps/api/src/routes/__tests__/landlordActionsSnooze.test.ts
  modified:
    - packages/db/src/schema/leases.ts
    - apps/api/src/lib/landlordActionToken.ts
    - apps/api/src/lib/__tests__/landlordActionToken.test.ts
    - apps/api/src/lib/email.ts
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/services/indexationCalc.ts
    - apps/api/src/services/indexationAlerts.ts
    - apps/api/src/services/__tests__/indexationAlerts.test.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/routes/__tests__/indexation.test.ts
    - apps/api/src/routes/landlordActions.ts
decisions:
  - Snooze tokens carry kind "indexation-snooze"; the payment verifier rejects any token with a kind, so the two link families cannot be swapped.
  - A set indexationSnoozedUntil overrides the anniversary dedup in both directions (skip while in the future, due again on or after the date).
  - Sending the digest or applying the indexation clears the snooze.
metrics:
  completed: 2026-10-22
  tasks: 3
---

# Quick 261022-g4j: Indexation alert snooze buttons Summary

The daily indexation digest now goes out as HTML with an "open indexation" button and three snooze buttons per lease (next month, in 3 months, next yearly indexation) in EN/NL/FR/DE, backed by a signed 90-day snooze token, a public confirmation route and a new `leases.indexation_snoozed_until` column that `isAlertDue` honours.

## Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | b0905b8 | Schema column, snooze token with cross-rejection, snoozeUntil / nextAnniversaryAfter, isAlertDue snooze rule, snooze cleared on send and apply |
| 2 | 9494f29 | EmailOptions.html through the queue to nodemailer, HTML digest with buttons, snooze links as text lines, per-recipient signing in runIndexationAlerts |
| 3 | e1e4c04 | Public GET /indexation/:token route with localized confirmation, route tests |

## Production deploy notes

Schema change, run on prod MariaDB before or with the deploy (`db:generate` was deliberately NOT run because the Drizzle baseline is stale):

```sql
ALTER TABLE leases ADD COLUMN indexation_snoozed_until DATE NULL AFTER indexation_alert_sent_for;
```

Full public snooze path: `/api/v1/landlord-action/indexation/:token` (links are built as `${WEB_URL}/api/v1/landlord-action/indexation/<token>`, same host pattern as the late-payment links; the mount in apps/api/src/index.ts is unchanged).

## Verification (observed output)

- `pnpm --filter @rentular/api exec vitest run indexationSnoozeToken landlordActionToken indexationAlerts routes/__tests__/indexation`: 4 files, 49 tests passed (after Task 1).
- `pnpm --filter @rentular/api exec vitest run indexationAlerts email`: 4 files, 69 tests passed (after Task 2).
- `pnpm --filter @rentular/api exec vitest run landlordActionsSnooze`: 8 tests passed.
- `pnpm --filter @rentular/api test`: 44 files, 395 tests passed.
- `TZ=UTC pnpm --filter @rentular/api test`: 44 files, 395 tests passed.
- `npx tsc --noEmit -p apps/api`: no output, exit 0.
- `git status --porcelain apps/web`: empty (web untouched).
- No added line in the diff contains an en or em dash (pre-existing ones elsewhere in the repo were left alone).
- Not verified: a real email rendered in a mail client, and a real click against prod. No DB was touched and nothing was deployed.

## Deviations from Plan

1. **[Rule 1 - Bug] indexationAlerts test mock needed localYmd.** The existing test mocks `../indexationCalc` with only `computeIndexationCore`; since indexationAlerts now imports `localYmd`, the mock got an inline `localYmd` with the same implementation. Commit b0905b8.
2. **[Rule 2] `normaliseSnoozeLang` exported from indexationSnoozeToken.** Used both by the verifier and by runIndexationAlerts to pick the recipient language, instead of duplicating the normalisation. renderDigest now receives the normalised language (same result as before for `nl-BE`-style locales).
3. **Language lookup uses `Object.hasOwn`** in renderDigest so a locale string can never resolve to an Object prototype key.
4. **Signing failure handling.** The plan text said a signing failure "counts as failed" but also "render without snoozeUrls". I logged `[IndexationAlert] Could not sign snooze links for user ...` and sent the digest without snooze buttons, without incrementing `summary.failed`, since the digest itself still goes out.
5. **Route test mocks** also stub `../../jobs/emailQueueWorker` and `sendEmail` in `../../lib/email` (indexationAlerts is now imported by the route module), and the fake db exposes a few extra table proxies.
6. **Dash characters in a test regex.** The new route test initially contained literal dash characters inside `/[...]/`; replaced with `–—` escapes before commit.

## Threat model

All `mitigate` items applied: HS256 pinned with requireAuthSecret, 90d expiry, kind/snooze/leaseId validated (T-g4j-01); mutual rejection tested both directions (T-g4j-02); leaseId only from the signed payload and the only write is `indexation_snoozed_until` + `updatedAt` (T-g4j-03); escapeHtml on all digest text and hrefs, esc() on the confirmation page, tested with a `Flat <b>1</b> & co` label (T-g4j-05). No new surface beyond the planned public route.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/api/src/lib/indexationSnoozeToken.ts, apps/api/src/lib/__tests__/indexationSnoozeToken.test.ts, apps/api/src/routes/__tests__/landlordActionsSnooze.test.ts
- FOUND commits: b0905b8, 9494f29, e1e4c04
