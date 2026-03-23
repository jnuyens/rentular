---
status: partial
phase: 04-notifications-payment-follow-up
source: [04-VERIFICATION.md]
started: "2026-03-24T00:00:00Z"
updated: "2026-03-24T00:00:00Z"
---

## Current Test

[awaiting human testing]

## Tests

### 1. Trigger a payment reminder cycle end-to-end
expected: When a payment is marked overdue in the DB, the paymentCheckWorker fires queueEmail/queueSms, the communications table receives a 'queued' record, and the worker updates it to 'sent'.
result: [pending]

### 2. Send a test email from the SMTP settings form
expected: Fill in valid SMTP credentials, click 'Send test email', receive a confirmation and an actual email in the specified mailbox.
result: [pending]

### 3. Save custom SMTP settings and verify they are used for tenant emails
expected: After saving SMTP settings for a landlord, trigger a payment reminder; the email should be sent via the custom SMTP server, not the platform default.
result: [pending]

### 4. Visit /communications in the dashboard
expected: Page loads, renders table header (Type, Channel, Recipient, Subject, Date, Status), shows empty state if no data, filter dropdowns work.
result: [pending]

### 5. Expand a table row on the Communications page
expected: Clicking a row expands it inline to show the full subject and message body.
result: [pending]

### 6. Edit SMS templates in Settings > Follow-up tab
expected: Friendly/formal/final SMS template textareas visible alongside email templates, editable per language, saved correctly.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
