---
phase: 04-notifications-payment-follow-up
plan: 01
subsystem: api
tags: [aes-256-gcm, encryption, bullmq, communications, smtp, drizzle]

# Dependency graph
requires:
  - phase: 02-payment-processing
    provides: "BullMQ email/SMS queue workers, paymentCheckWorker, landlordReportWorker"
  - phase: 01-backend-hardening
    provides: "Communications table schema, paymentFollowUpSettings schema"
provides:
  - "smtpSettings Drizzle table schema with AES-256-GCM encrypted password fields"
  - "AES-256-GCM encrypt/decrypt utility library"
  - "CommunicationMeta interface for automatic communication logging"
  - "queueEmail/queueSms auto-log to communications table when meta provided"
  - "All email/SMS callers pass CommunicationMeta for centralized logging"
affects: [04-02-PLAN, 04-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["CommunicationMeta metadata pattern for centralized logging via queue functions"]

key-files:
  created:
    - packages/db/src/schema/smtpSettings.ts
    - apps/api/src/lib/encryption.ts
  modified:
    - packages/db/src/schema/index.ts
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/jobs/smsQueueWorker.ts
    - apps/api/src/services/paymentFollowUp.ts
    - apps/api/src/routes/indexation.ts
    - apps/api/src/jobs/landlordReportWorker.ts
    - apps/api/src/jobs/paymentCheckWorker.ts

key-decisions:
  - "CommunicationMeta is optional third parameter on queueEmail/queueSms for backward compatibility"
  - "Support chat endpoint skipped for communication logging (no authenticated user, ownerId is NOT NULL)"
  - "Direct sendEmail calls replaced with queueEmail in landlordReportWorker and paymentCheckWorker"

patterns-established:
  - "CommunicationMeta pattern: callers pass {ownerId, leaseId?, type, recipientName} to queue functions for automatic communications logging"
  - "Queue-level logging: communications record inserted at queue time (status:queued), updated by worker (status:sent/failed)"

requirements-completed: [NTF-01, NTF-02, NTF-03, NTF-04, NTF-06]

# Metrics
duration: 5min
completed: 2026-03-23
---

# Phase 04 Plan 01: Communications Logging Foundation Summary

**SMTP settings schema with AES-256-GCM encrypted passwords, centralized communications logging via CommunicationMeta in queueEmail/queueSms, all 5 callers updated**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-23T09:06:03Z
- **Completed:** 2026-03-23T09:11:09Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Created smtpSettings Drizzle table schema with AES-256-GCM encrypted password fields (iv, tag, ciphertext)
- Built encrypt/decrypt utility library using Node.js crypto with AUTH_SECRET-derived key
- Added CommunicationMeta interface and automatic communications table logging in queueEmail/queueSms
- Updated all 5 email/SMS callers to pass metadata: paymentFollowUp, paymentCheckWorker, landlordReportWorker, indexation, and support (support skipped due to no auth)
- Replaced direct sendEmail calls in landlordReportWorker and paymentCheckWorker with queueEmail for centralized logging

## Task Commits

Each task was committed atomically:

1. **Task 1: SMTP settings schema and AES-256-GCM encryption library** - `5c5449e` (feat)
2. **Task 2: Add CommunicationMeta support to queueEmail and queueSms workers** - `d3a024d` (feat)
3. **Task 3: Update all callers to pass CommunicationMeta and replace direct sendEmail calls** - `cfac97b` (feat)

## Files Created/Modified
- `packages/db/src/schema/smtpSettings.ts` - SMTP settings table with AES-256-GCM encrypted password fields
- `packages/db/src/schema/index.ts` - Added smtpSettings re-export
- `apps/api/src/lib/encryption.ts` - AES-256-GCM encrypt/decrypt utility using AUTH_SECRET
- `apps/api/src/jobs/emailQueueWorker.ts` - CommunicationMeta interface, queueEmail with auto-logging, worker status updates
- `apps/api/src/jobs/smsQueueWorker.ts` - queueSms with auto-logging, worker status updates
- `apps/api/src/services/paymentFollowUp.ts` - sendReminder accepts ownerId, passes CommunicationMeta to queueEmail/queueSms
- `apps/api/src/routes/indexation.ts` - queueEmail call passes CommunicationMeta (type: indexation_notification)
- `apps/api/src/jobs/landlordReportWorker.ts` - Replaced sendEmail with queueEmail + CommunicationMeta (type: landlord_report)
- `apps/api/src/jobs/paymentCheckWorker.ts` - Replaced sendEmail with queueEmail + CommunicationMeta for consent expiry, passes ownerId to sendReminder

## Decisions Made
- CommunicationMeta is an optional third parameter on queueEmail/queueSms, maintaining full backward compatibility for callers that don't need logging
- Support chat endpoint (support.ts) was NOT updated with CommunicationMeta because it's a public endpoint with no authenticated user, and the communications table requires a non-null ownerId
- Direct sendEmail calls in landlordReportWorker and paymentCheckWorker were replaced with queueEmail to centralize all email sending through the queue with logging

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Skipped CommunicationMeta for support.ts**
- **Found during:** Task 3 (Update all callers)
- **Issue:** Plan assumed support.ts has getRequiredUserId(c) but the support chat endpoint is public with no authentication -- no ownerId is available, and communications.ownerId is NOT NULL
- **Fix:** Skipped adding CommunicationMeta to support.ts. The queueEmail call still works without meta (backward compatible). Support emails go to the support team, not to tenants, so they don't need communication logging.
- **Files modified:** None (no change needed)
- **Verification:** API builds cleanly

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor -- support chat is a system notification to the support team, not a landlord-to-tenant communication, so omitting it from the communications log is correct.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- smtpSettings schema ready for Plan 02 (per-landlord SMTP configuration)
- CommunicationMeta logging pattern established for any future email/SMS callers
- All queue workers automatically log to communications table when metadata is provided

## Self-Check: PASSED

- All created files exist (smtpSettings.ts, encryption.ts)
- All 3 commits verified (5c5449e, d3a024d, cfac97b)
- All acceptance criteria spot checks passed (12/12)
- API build succeeds

---
*Phase: 04-notifications-payment-follow-up*
*Completed: 2026-03-23*
