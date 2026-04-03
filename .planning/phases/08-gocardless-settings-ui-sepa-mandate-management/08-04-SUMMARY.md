---
phase: "08"
plan: "04"
status: complete
started: 2026-04-04T00:00:00.000Z
completed: 2026-04-04T00:00:00.000Z
---

# Plan 08-04 Summary

## What was built
Onboarding wizard step 4 integration with MandateSetupModal and comprehensive i18n audit.

## Tasks completed
1. Integrated MandateSetupModal into onboarding wizard step 4 with "Setup SEPA Mandate" button, success state with green check, and skip note. Removed hardcoded English text.
2. Human verification checkpoint (see below)

## Key files
### Modified
- apps/web/app/onboarding/page.tsx (MandateSetupModal integration, removed hardcoded text)
- apps/web/messages/{en,nl,fr,de}/common.json (onboarding mandate keys)

## i18n Audit
All GoCardless/mandate i18n keys verified across 4 locales:
- settings section: 17 GoCardless-related keys
- mandates section: 36 keys including nested status object
- leases section: 9 payment method keys
- tenants section: 3 mandate keys
- onboarding section: 5 mandate keys
- nav section: 1 mandates key

## Decisions
- Used native button element in onboarding (not shadcn Button) to match existing onboarding pattern
- Mandate setup is optional in onboarding flow -- does not block wizard completion

## Issues
None

## Self-Check: PASSED
