---
status: partial
phase: 03-rent-indexation
source: [03-VERIFICATION.md]
started: 2026-03-23T00:00:00Z
updated: 2026-03-23T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Override note appears in delivered email body
expected: Email body contains "The indexed rent would be X, but your landlord has set it to Y." text in tenant's language when overrideNewRent < calculatedNewRent
result: [pending]

### 2. Upcoming endpoint shows EPC-restricted estimates
expected: GET /upcoming returns leases with correct estimatedNewRent with EPC restrictions applied, not the stale currentMonthlyRent, when health index data is present in DB
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
