---
phase: 04-notifications-payment-follow-up
plan: 02
subsystem: api
tags: [smtp, nodemailer, encryption, bullmq, communications, sms-templates]

# Dependency graph
requires:
  - phase: 04-notifications-payment-follow-up
    provides: "smtpSettings schema, AES-256-GCM encrypt/decrypt, CommunicationMeta in queueEmail/queueSms"
provides:
  - "Per-landlord SMTP transport cache with 30-min TTL and cache invalidation"
  - "SMTP settings CRUD API (GET/PUT/DELETE /smtp, POST /smtp/test) with AES-256-GCM encrypted passwords"
  - "Communications resend endpoint wired to queueEmail/queueSms with CommunicationMeta"
  - "Communications send endpoint with tenant lookup from lease via leaseTenants join"
  - "Communications list endpoint with propertyId and tenantId filter parameters"
  - "SMS template fields (smsFriendlyMessage, smsFormalMessage, smsFinalMessage) in payment-follow-up settings API"
affects: [04-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Per-landlord SMTP transport cache with TTL-based expiry and cache invalidation on settings change"]

key-files:
  created:
    - apps/api/src/lib/routeAuth.ts
  modified:
    - apps/api/src/lib/email.ts
    - apps/api/src/routes/settings.ts
    - apps/api/src/routes/communications.ts
    - apps/api/src/jobs/emailQueueWorker.ts

key-decisions:
  - "SMTP transport cache stores transport + fromAddress/fromName together to avoid extra DB query on cache hit"
  - "ownerId passed through email queue job data (not just CommunicationMeta) so worker can select per-landlord SMTP transport"
  - "Communications send endpoint removes manual db.insert, relying on queueEmail/queueSms auto-logging from Plan 01"

patterns-established:
  - "Per-landlord SMTP: getTransportForOwner(ownerId) returns {transport, fromAddress, fromName} with fallback to default"
  - "Transport cache invalidation: clearTransportCache(ownerId) called after PUT/DELETE /smtp"

requirements-completed: [NTF-05, NTF-07]

# Metrics
duration: 4min
completed: 2026-03-23
---

# Phase 04 Plan 02: Per-Landlord SMTP and Communications Wiring Summary

**Per-landlord SMTP transport with encrypted credentials and 30-min cache, SMTP settings CRUD API, communications resend/send wired to email/SMS queues, SMS template fields in payment-follow-up API**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T09:15:17Z
- **Completed:** 2026-03-23T09:19:17Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built per-landlord SMTP transport cache with 30-min TTL, automatic password decryption, and cache invalidation
- Added complete SMTP settings CRUD API (GET with masked password, PUT with AES-256-GCM encryption, POST /test with verification, DELETE)
- Wired communications resend endpoint to re-queue via queueEmail/queueSms with full CommunicationMeta
- Wired communications send endpoint with tenant lookup from lease via leaseTenants join table
- Added propertyId and tenantId filter parameters to communications list endpoint
- Exposed SMS template fields (smsFriendlyMessage, smsFormalMessage, smsFinalMessage) in payment-follow-up settings GET/PUT API

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-landlord SMTP transport cache, SMTP settings API, SMS template fields** - `3d73060` (feat)
2. **Task 2: Wire communications resend/send endpoints to use queues** - `40ba8c8` (feat)

## Files Created/Modified
- `apps/api/src/lib/routeAuth.ts` - Auth middleware with requireAuth and getRequiredUserId (blocking dependency)
- `apps/api/src/lib/email.ts` - Per-landlord SMTP transport cache, getTransportForOwner, clearTransportCache, sendEmail with ownerId
- `apps/api/src/routes/settings.ts` - SMTP settings CRUD endpoints, SMS template fields in payment-follow-up API
- `apps/api/src/routes/communications.ts` - Resend via queues, send with tenant lookup, propertyId/tenantId filters
- `apps/api/src/jobs/emailQueueWorker.ts` - Pass ownerId through job data for per-landlord SMTP transport selection

## Decisions Made
- SMTP transport cache stores transport + fromAddress/fromName together to avoid an extra DB query on cache hit (plan suggested querying DB for fromAddress even on cache hit)
- ownerId is passed through the BullMQ job data (alongside communicationId) so the email worker can select the correct SMTP transport at send time
- Communications send endpoint removes the manual db.insert placeholder, relying entirely on queueEmail/queueSms auto-logging from Plan 01's CommunicationMeta pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created missing routeAuth.ts file**
- **Found during:** Task 1 (settings.ts and communications.ts import routeAuth)
- **Issue:** `apps/api/src/lib/routeAuth.ts` was imported by multiple route files but never committed to the repository. It existed only in the main source working directory as an untracked file.
- **Fix:** Created routeAuth.ts with requireAuth middleware and getRequiredUserId function matching the implementation in the main source.
- **Files created:** apps/api/src/lib/routeAuth.ts
- **Verification:** ESM build succeeds
- **Committed in:** 3d73060 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for compilation. The file was already expected by all route modules but was never tracked in git.

## Issues Encountered
- Pre-existing DTS build error in `apps/api/src/index.ts` line 96 (Drizzle ORM union type issue with `db.execute(sql)`) causes `pnpm build --filter=@rentular/api` to fail during DTS generation. The ESM runtime build succeeds. This is not related to Plan 02 changes and exists across many files in the codebase.

## User Setup Required
None - no external service configuration required. SMTP settings are configured by landlords through the API at runtime.

## Next Phase Readiness
- Per-landlord SMTP transport ready for email delivery in Plan 03 dashboard
- SMTP settings API ready for frontend form integration
- Communications resend/send endpoints ready for dashboard action buttons
- SMS template fields exposed for frontend template editor

## Self-Check: PASSED

- All created files exist (routeAuth.ts)
- All modified files exist (email.ts, settings.ts, communications.ts, emailQueueWorker.ts)
- Both commits verified (3d73060, 40ba8c8)
- ESM build succeeds (194.83 KB)
- All acceptance criteria spot checks passed

---
*Phase: 04-notifications-payment-follow-up*
*Completed: 2026-03-23*
