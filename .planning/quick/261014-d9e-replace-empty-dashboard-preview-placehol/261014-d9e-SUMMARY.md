---
phase: quick-261014-d9e
plan: 01
subsystem: web/marketing
tags: [marketing, homepage, i18n, ui, indexation]
requires: []
provides: [DashboardPreview component (indexation mock), marketing.preview i18n keys]
affects: [apps/web/app/(marketing)/page.tsx]
tech-stack:
  added: []
  patterns: [static decorative mock with aria-hidden, nested next-intl namespace]
key-files:
  created:
    - apps/web/components/marketing/DashboardPreview.tsx
  modified:
    - apps/web/app/(marketing)/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
decisions:
  - Hero mock shows the rent indexation page (key selling point) instead of a generic dashboard, per mid-task direction change
  - Mock wording is copied from the real indexation namespace into marketing.preview (with proper accents) so the mock stays self-contained
  - Sample leases are one year old so current rent equals base rent and the formula base rent * new index / base index holds visibly
metrics:
  completed: 2026-10-14
  tasks: 2
  files: 6
---

# Quick 261014-d9e: Replace empty dashboard preview placeholder Summary

The grey "Dashboard Preview" box in the marketing hero is now a static, translated Tailwind mock of the Rentular rent indexation page.

## What the mock shows

- Sidebar (sm and up): Rentular brand, Properties, Contracts, Payments, Indexation (active, `bg-primary/10 text-primary`).
- Header copied from the real indexation page: "Rent Indexation", subtitle "Automatic rent adjustments based on the health index", and a "Calculate new rents" button (md and up).
- Summary tiles: current health index 136,58 (Source: Statbel), 2 leases ready to apply, 3 leases upcoming (third tile hidden on phones).
- Table with 4 invented Belgian leases:

| Property | Rent | Base index | New index | Anniversary | Status |
|---|---|---|---|---|---|
| Kerkstraat 12, Gent | € 1.150,00 → € 1.177,55 | 133,18 | 136,37 | 15/09/2026 | Ready to apply |
| Bondgenotenlaan 3, Leuven | € 785,00 → € 803,65 | 133,41 | 136,58 | 01/10/2026 | Ready to apply |
| Rue de la Loi 45, Bruxelles | € 1.480,00 → € 1.515,45 | 133,18 | 136,37 | 01/09/2026 | Letter sent |
| Meir 88, Antwerpen | € 920,00 → € 941,80 | 132,95 | 136,10 | 01/08/2026 | Applied |

  New rent is computed in the component as base rent * new index / base index, rounded to cents. Index values are plausible 2025/2026 gezondheidsindex figures (base 2013 = 100). Badges: amber (ready), blue (letter sent), green (applied).
- Responsive: index columns appear only at lg, anniversary from md, sidebar from sm. On phones only property, rent (wraps onto two lines) and status remain; text cells truncate and badges wrap, so there is no horizontal scroll.
- Wrapper is `aria-hidden="true"`.
- `marketing.preview` has 23 keys (appName plus 22 labels) in en, nl, fr, de. The generic-dashboard keys (overview, stat tiles, recent payments, payment statuses) were removed.

## Verification (observed)

- Key check script: en/nl/fr/de ok, 23 keys each, same key set, no dash characters, no unused keys, no undefined keys used by the component.
- Plan grep checks: placeholder text gone from page.tsx, `<DashboardPreview` present, aria-hidden and `useTranslations("marketing.preview")` present, no em/en dashes in the component.
- `pnpm --filter @rentular/web exec tsc --noEmit -p .`: exit 0.
- `pnpm --filter @rentular/web build`: without env, it compiles and type-checks but fails at "Collecting page data" for /indexation with `DB_PASSWORD must be set` (worktree has no .env; existing fail-closed check, unrelated). With dummy `DB_PASSWORD` and `AUTH_SECRET`, a clean build exits 0. It prints a "Failed to copy traced files ... (marketing)/page_client-reference-manifest.js" standalone warning. I checked this by building with the original base page.tsx: the same warning appears there, so it predates this change.
- Not verified: visual rendering in a browser at each breakpoint (no dev server or screenshot run). Column widths were sized by calculation against the max-w-3xl frame. Not deployed.

## Deviations from Plan

- **Direction change mid-task (from orchestrator):** the mock shows the indexation page instead of the generic dashboard (stat tiles plus recent payments). It was done as a follow-up commit on top of the generic version.
- Three commits instead of the single commit in the plan's success criteria (per-task commits, then the follow-up).
- Ran `pnpm install --frozen-lockfile` in the worktree (node_modules was missing).

## Commits

- 6f2ccc1 feat(261014-d9e): add dashboard preview labels in en, nl, fr, de
- c1690d8 feat(261014-d9e): replace empty dashboard preview with static mock
- 3779d20 feat(261014-d9e): show the indexation page in the homepage preview mock

## Known Stubs

None. The sample leases are intentionally static decorative data.

## Self-Check: PASSED
