---
status: partial
phase: 06-smovin-import-beta
source: [06-VERIFICATION.md]
started: 2026-03-28T11:00:00Z
updated: 2026-03-28T11:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end import flow
expected: Credentials accepted, properties discovered, property selection shown, import completes with count summary
result: [pending]

### 2. API credential isolation
expected: Session response contains no credentialEmail, credentialPassword, or IV/tag fields
result: [pending]

### 3. DB credential cleanup after import
expected: importSessions row shows credential_email IS NULL, credential_password IS NULL after successful import
result: [pending]

### 4. Real-time progress updates
expected: Log messages append as scraping proceeds; progress bar advances; no stale/frozen UI
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
