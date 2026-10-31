---
created: 2026-10-31T16:56:31.531Z
title: Align billing and limits with the new public pricing
area: api
files:
  - apps/api/src/routes/stripe.ts
  - apps/web/app/(marketing)/page.tsx
  - apps/web/messages/{en,nl,fr,de}/common.json (marketing.pricing*, bankConnectionsClause, pricingDisclosure)
---

## Problem

Since 2026-10-31 rentular.com shows the new pricing: hosted Gratis (up to 3 properties, all features except SMS), hosted Onbeperkt (EUR 19/month excl. VAT, unlimited properties, SMS included within fair-use limits, supports the development team), self-hosting free (AGPL, footnote). Automatic bank tracking is a paid extra: 5 euro per monitored bank account per month. The app does not match this yet:

1. Stripe still has the old Starter/Standard/Professional products and checkout (stripe.ts PLANS, STRIPE_PRICE_* on m1).
2. The 3-property limit for free hosted accounts is not enforced.
3. SMS is not restricted to Onbeperkt and has no fair-use limit.
4. Bank tracking (Ponto) is not billed by Rentular.
5. The terms clause bankConnectionsClause and the pricingDisclosure notice on the Bank Connections pages say Ibanity bills up to EUR 4 per account directly and Rentular gets nothing. That contradicts the 5 euro Rentular extra.

## Solution

- One Stripe product "Onbeperkt" at EUR 19/month excl. VAT, plus a per-account bank tracking item at 5 euro/month (quantity or metered). Changing the Stripe account needs the owner's go-ahead at execution time.
- Plan check helper (subscription active or not) used by: property create (block the 4th property on free, clear message with upgrade link), SMS sending and the SMS channel option (Onbeperkt only, fair-use limit value to be decided by the owner), bank connection create (needs the paid extra).
- Rewrite bankConnectionsClause and pricingDisclosure in EN/NL/FR/DE; the owner must approve the wording before deploy.
- Self-hosted installs must keep working without any limits (e.g. limits only active when billing is configured).
