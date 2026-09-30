---
phase: "08"
plan: "03"
status: complete
started: 2026-04-04T00:00:00.000Z
completed: 2026-04-04T00:00:00.000Z
---

# Plan 08-03 Summary

## What was built
Payment method integration on lease forms and SEPA mandate display on tenant profiles.

## Tasks completed
1. Added PaymentMethodRadioGroup to lease create/edit form, payment method column to table, mandate setup/cancel actions to lease dropdown, paymentMethod included in form submission
2. Added SEPA Mandate column to tenant table showing badge or "No mandate", Setup Mandate action in dropdown, MandateSetupModal with tenant pre-fill

## Key files
### Modified
- apps/web/app/(dashboard)/leases/page.tsx (PaymentMethodRadioGroup, mandate actions, payment column)
- apps/web/app/(dashboard)/tenants/page.tsx (SEPA Mandate column, mandate setup action)
- apps/web/messages/{en,nl,fr,de}/common.json (lease and tenant mandate i18n keys)

## Decisions
- Replaced standalone bankAccountId select with PaymentMethodRadioGroup that handles bank selection internally
- Mandate status fetched on edit to show live status from GoCardless API
- Actions migrated from inline buttons to DropdownMenu for cleaner UI with more options

## Issues
None

## Self-Check: PASSED
