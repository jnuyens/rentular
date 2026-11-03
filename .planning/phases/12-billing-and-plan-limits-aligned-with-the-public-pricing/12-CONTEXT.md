# Phase 12: Billing and plan limits aligned with the public pricing - Context

**Gathered:** 2026-11-04
**Status:** Ready for planning
**Source todo:** `.planning/todos/pending/2026-10-31-align-billing-and-limits-with-new-pricing.md`

<domain>
## Phase Boundary

Make the hosted product charge and limit exactly what the public pricing on rentular.com promises (live since 2026-10-31, `apps/web/app/(marketing)/page.tsx`, `marketing.pricing*` keys):

- **Gratis**: hosted, up to 3 properties, all features except SMS.
- **Onbeperkt**: EUR 19/month excl. VAT, unlimited properties, SMS included within a fair-use limit.
- **Bank tracking** (Ponto bank connections): paid extra, 5 euro per monitored bank account per month, excl. VAT.
- **Self-hosted**: free, AGPL, no limits at all.

Out of scope: changing the marketing page layout (already done), GoCardless SEPA collection, new features.
</domain>

<decisions>
## Implementation Decisions (locked by the owner on 2026-11-04)

### Existing accounts
- The owner's account is exempt from every limit and charge (jnuyens@gmail.com, user id a1e2c837-8130-438a-9a12-c285dda5cf27 on prod). Make exemption a per-user flag (e.g. `users.billing_exempt`), not a hardcoded id, so more accounts can be marked later.
- All other hosted accounts over 3 properties keep all their data (never delete or hide anything) but cannot add another property until they subscribe to Onbeperkt.

### SMS
- SMS only on Onbeperkt (and exempt accounts).
- Fair-use limit: **50 SMS per calendar month** per landlord account, counted on actually sent SMS. At the limit, sending stops with a clear message; the reminder falls back to the other channels (email/WhatsApp) instead of failing silently.
- Free accounts must not be able to pick SMS as a usable channel (show it disabled with an upgrade hint).

### Bank tracking extra
- Available on **both** plans: a free account can buy bank tracking as its only paid item.
- 5 euro per monitored bank account per month, **excl. VAT** (same as the 19 euro plan).
- Billed by Rentular through Stripe (quantity on a subscription item that follows the number of active monitored accounts; adding/removing a bank connection updates the quantity).
- The public footnote must say excl. VAT: NL "5 euro per opgevolgd rekeningnummer per maand, excl. btw" (and EN/FR/DE equivalents).

### Stripe
- Replace Starter/Standard/Professional (apps/api/src/routes/stripe.ts PLANS, STRIPE_PRICE_* env on m1) with one product "Onbeperkt" (EUR 19/month excl. VAT) and one per-account bank tracking price (5 euro/month excl. VAT).
- Creating or changing products/prices in the live Stripe account is an outward action: the executor prepares it, the owner confirms before anything is created in Stripe. Prefer test mode first.

### Legal text
- Rewrite `bankConnectionsClause` (terms) and `pricingDisclosure` (Bank Connections pages) in EN/NL/FR/DE: Rentular bills the bank tracking extra (5 euro per monitored account per month excl. VAT); the separate PSD2 service relationship with the licensed AIS provider stays described as it is.
- The owner must approve the final wording before deploy (checkpoint).

### Self-hosted
- When billing is not configured (no STRIPE_SECRET_KEY), no limits or charges apply anywhere.

### Claude's Discretion
- Where the plan check helper lives and how it caches subscription state.
- UI placement of upgrade hints and the billing/subscription page details.
- How SMS usage is counted (communications log vs counter table), as long as it is per calendar month in the account's timezone.
</decisions>

<specifics>
## Specific Ideas

- Standing project rules: no em/en-dashes anywhere, no Co-Authored-By lines, human-sounding copy, all UI in EN/NL/FR/DE, back up the prod DB before deploys or data changes, never run `db:generate` (Drizzle baseline is stale: use manual ALTER/`db:push`-style DDL on prod).
- Testing happens in production (pre-release), with confirmation before outward actions.
</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/2026-10-31-align-billing-and-limits-with-new-pricing.md`
- `apps/api/src/routes/stripe.ts`
- `apps/web/app/(marketing)/page.tsx` and `apps/web/messages/{en,nl,fr,de}/common.json` (marketing.pricing*, bankConnectionsClause, pricingDisclosure)
</canonical_refs>

<decisions_round2>
## Additional decisions (owner, 2026-11-04, after research)

- **VAT:** one fixed 21% Belgian VAT tax rate applied to every Rentular invoice (no Stripe Tax for now; revisit when customers outside Belgium appear).
- **Cancelling Onbeperkt:** stops at the end of the paid period (cancel_at_period_end), then the account drops to Gratis. No prorated refunds.
- **SMS fallback:** when SMS is not allowed (free plan or the 50/month limit is reached), the reminder goes out by WhatsApp; if the tenant has no WhatsApp number or the bridge is unavailable, by email. Never fail silently.
- **Stripe key:** the first plan starts with a checkpoint where the owner verifies the existing m1 STRIPE_SECRET_KEY ("mk_" prefix) in the Stripe dashboard (valid? live or test?) before anything is created in Stripe. Billing only switches on when the key AND both new price ids are configured.
- **Existing data (checked on prod 2026-11-04):** only the owner's account has more than 3 properties (12) and the only bank connection (1 active). Other accounts have 0 or 1 property. Nothing to grandfather; the owner is exempt via users.billing_exempt.
- **Translations:** the bankConnections namespace is still English in nl/fr/de for most keys; translating the keys touched by this phase (pricingDisclosure and the new billing strings) is in scope, the rest of that namespace may be translated in the same pass since all UI must exist in EN/NL/FR/DE.
- **Public SMS footnote:** may mention the number: NL "(**) Tot 50 sms per maand." (and EN/FR/DE).
</decisions_round2>
