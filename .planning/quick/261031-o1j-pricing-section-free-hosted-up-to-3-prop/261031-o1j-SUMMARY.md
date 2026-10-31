---
phase: quick-261031-o1j
plan: 01
subsystem: web/marketing
tags: [pricing, i18n, marketing]
requires: []
provides: [static three-card pricing section]
affects: [apps/web/app/(marketing)/page.tsx, apps/web/messages/*/common.json]
tech-stack:
  added: []
  patterns: [static marketing content via next-intl keys]
key-files:
  created: []
  modified:
    - apps/web/app/(marketing)/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json
decisions:
  - NL subtitle uses formal "u" ("laat ons het voor u hosten") to match surrounding NL marketing copy
  - Pricing cards are static; marketing page no longer calls /api/v1/stripe/plans
metrics:
  tasks: 2
  files: 5
  completed: 2026-10-31
---

# Quick 261031-o1j: Pricing section (Free / Unlimited / Self-host) Summary

The marketing page pricing section now shows three static cards: Free (€0, hosted by us, up to 3 properties), Unlimited (€19 per month excl. VAT, highlighted with `border-2 border-primary`), and Self-host (€0, open source AGPL-3.0, "View on GitHub" opening https://github.com/jnuyens/rentular in a new tab with `rel="noopener noreferrer"`). All copy is translated in EN, NL, FR and DE. The Stripe plans fetch, the `Plan` interface, the stale Starter/Standard/Professional fallback and the unused React hooks import were removed.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Pricing card strings in 4 locales, drop pricingPerLease/pricingCta | c228cc2 |
| 2 | Static three-card pricing section in page.tsx | 5d022b3 |

## Verification (observed)

- Pricing key lists in the `marketing` namespace are identical across en/nl/fr/de (21 keys, no pricingPerLease, no pricingCta).
- `pnpm --filter=api test -- i18n-completeness`: 1 file, 7 tests passed.
- `apps/web: npx tsc --noEmit -p .`: exit 0.
- page.tsx: no matches for stripe/plans, pricingPerLease, pricingCta, useEffect, interface Plan; GitHub URL count 1; noopener noreferrer count 1.
- Added lines with em or en dashes since base fabcb16: 0.
- `git diff --stat fabcb16 HEAD` touches only the 5 planned files.
- Not verified: visual rendering in a browser (no deploy, no dev server run).

## Deviations from Plan

None. One self-inflicted slip got fixed before commit: the scripted page rewrite first left behind stale closing tags from the old map, which were removed before typecheck and commit.

Note on prettier: `prettier --check` flags page.tsx, but only for two `<Image>` blocks that were already unformatted at base; the new pricing markup is formatted.

## Known Stubs

None. The 3-property limit on the Free plan is advertised but not enforced; enforcement was explicitly out of scope.

## Self-Check: PASSED

- FOUND: apps/web/app/(marketing)/page.tsx, all 4 common.json files
- FOUND: commits c228cc2, 5d022b3
