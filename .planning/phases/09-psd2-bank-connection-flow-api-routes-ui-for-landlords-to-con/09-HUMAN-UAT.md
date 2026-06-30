---
status: partial
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
source: [09-05-PLAN.md, 09-VALIDATION.md]
started: 2026-06-30
updated: 2026-06-30
environment: production
note: "Pre-release — all manual verification is done against the production deployment (Phase 10 / m1 Hetzner), not localhost. Run after Phase 10 deploy."
---

## Current Test

[awaiting production deploy (Phase 10) — then human testing against prod]

## Tests

### 1. Empty state + disclosures
expected: /dashboard/bank-connections empty state shows €4/account/month Ibanity disclosure, ToS link, and Connect button.
result: [pending]

### 2. Connect wizard
expected: Connect flow shows pricing + ToS notice; institution picker lists all 6 BE banks (Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan).
result: [pending]

### 3. Authorization redirect + callback
expected: Selecting Belfius → Connect redirects to authorization.myponto.com; completing sandbox/prod auth lands on /dashboard/bank-connections/[id]?connected=1 with success message.
result: [pending]

### 4. Detail page accuracy
expected: Detail shows institutionName="Belfius", status="Active", consentExpiresAt sourced from the provider (NOT a hardcoded +90 days).
result: [pending]

### 5. Sync + rate-limit
expected: "Sync now" → toast "Sync started"; repeat within 60s → toast "Sync rate-limited".
result: [pending]

### 6. Encrypted statements
expected: bank_statements rows for the connection exist with encrypted counterparty columns (counterpartyNameEncrypted ≠ plaintext).
result: [pending]

### 7. Renew consent
expected: "Renew consent" redirects to a Ponto authorization URL with a fresh state JWT param.
result: [pending]

### 8. Revoke
expected: Revoke → AlertDialog → confirm → status "Revoked"; connection hidden from active list; bank_statements rows retained in DB.
result: [pending]

### 9. Locale parity (NL/FR/DE)
expected: Every /dashboard/bank-connections/* page renders translated strings in NL, FR, DE — no raw translation keys visible.
result: [pending]

### 10. Role gating
expected: A non-owner (manager) user does NOT see the Bank Connections sidebar entry.
result: [pending]

### 11. Localized renewal email
expected: A connection with consentExpiresAt = now()+7d triggers Phase C → renewal-warning email delivered in the landlord's locale with the correct localized subject.
result: [pending]

### 12. Legal copy
expected: /terms shows the translated "Bank Account Connections (PSD2)" clause; /privacy lists the Ibanity SA/NV processor row.
result: [pending]

### 13. Schema idempotency (prod DB)
expected: `pnpm --filter @rentular/db db:push` against the real DB reports "no changes to apply" (Plan 05 changed zero schema files).
result: [pending]

## Summary

total: 13
passed: 0
issues: 0
pending: 13
skipped: 0
blocked: 0

## Gaps

(none recorded — verification deferred to post-deploy, not failed)
