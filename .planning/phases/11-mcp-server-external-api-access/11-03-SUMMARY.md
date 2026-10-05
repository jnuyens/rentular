---
phase: 11-mcp-server-external-api-access
plan: 03
subsystem: api
tags: [rbac, property-access, reminders, sms, whatsapp, hono, drizzle]

# Dependency graph
requires:
  - phase: 11-01
    provides: Wave 0 RED tests (writeGuards, reminderChannel, manualReminder) and the reminderChannel contract
  - phase: 05
    provides: propertyAccess role hierarchy (getUserPropertyRole, hasMinimumRole)
provides:
  - manager+ gate on POST /ledger/:leaseId/record-payment
  - manager+ gate on POST /payments/send-reminder
  - reminderChannel service (sendReminderViaPreferredChannel) shared by the 19:15 worker and the manual path
  - channel-aware manual send-reminder that records the channel actually used
affects: [mcp-write-tools, send_reminder, record_ledger_payment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared channel-dispatch function (worker + manual path call the same code)"
    - "Role gate copied verbatim from mark-month-paid: getUserPropertyRole + hasMinimumRole(role, manager)"

key-files:
  created:
    - apps/api/src/services/reminderChannel.ts
  modified:
    - apps/api/src/routes/ledger.ts
    - apps/api/src/routes/payments.ts
    - apps/api/src/jobs/paymentCheckWorker.ts
    - apps/api/src/services/manualReminder.ts
    - packages/shared/src/constants/index.ts

key-decisions:
  - "Kept getAccessiblePropertyIds in /payments/send-reminder alongside the new role gate because writeGuards pins 403-when-not-accessible with the role held at manager, so the access check must remain to distinguish that case"
  - "Resolved the 11-01 advisory by adding the original due date to the formal SMS templates in all four locales, matching the friendly templates, rather than weakening the test assertion"
  - "Derived OverduePayment/FollowUpSettings in reminderChannel via Parameters<typeof sendReminder> so paymentFollowUp did not need new exports"

patterns-established:
  - "Reminder channel dispatch lives in one service; callers pass preferredChannel and receive the channel used"

requirements-completed: [MCP-03]

# Metrics
duration: 12min
completed: 2026-10-05
---

# Phase 11 Plan 03: Write-Guard Hardening and Channel-Aware Reminders Summary

**Both under-gated write endpoints now require manager+, and manual send-reminder routes over the tenant's preferred channel through the same dispatch the 19:15 worker uses, with email as the fallback.**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-10-05
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- POST /ledger/:leaseId/record-payment is manager+ (viewer/accountant now 403), with 404/403 access behavior preserved.
- POST /payments/send-reminder is manager+ (viewer 403), with unknown-lease 404 and no-access 403 preserved.
- Extracted the worker's preferred-channel routing into apps/api/src/services/reminderChannel.ts; both the 19:15 worker and the manual path now call sendReminderViaPreferredChannel.
- Manual send-reminder reads tenants.preferredChannel, records the channel actually used in payment_reminders, and returns channel + sentTo to the client.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden POST /ledger/:leaseId/record-payment to manager+** - `d5d5330` (feat)
2. **Task 2: Harden POST /payments/send-reminder to manager+** - `fe6a07a` (feat)
3. **Task 3: Make sendManualReminder channel-aware via shared dispatch** - `2e5b545` (feat)

## Files Created/Modified
- `apps/api/src/services/reminderChannel.ts` - New shared service: sendReminderViaPreferredChannel plus fmtDueDate/isReminderTestPhase/shortReminderBody moved from the worker.
- `apps/api/src/routes/ledger.ts` - authorizeLease now returns propertyId; record-payment gated to manager+.
- `apps/api/src/routes/payments.ts` - send-reminder gated to manager+ after the existing access check.
- `apps/api/src/jobs/paymentCheckWorker.ts` - inline channel block replaced by the shared dispatch; helper imports now come from reminderChannel; dropped the now-unused CommunicationMeta/sendReminder imports.
- `apps/api/src/services/manualReminder.ts` - selects preferredChannel, dispatches via reminderChannel, records the channel used, surfaces channel + sentTo.
- `packages/shared/src/constants/index.ts` - added {{dueDate}} to the formal SMS templates (en/nl/fr/de).

## Decisions Made
- **Access check retained in send-reminder:** writeGuards pins the not-accessible case (403) while holding getUserPropertyRole at "manager", so the getAccessiblePropertyIds check must stay to distinguish it from the accessible manager case. This departs from the plan's acceptance wording ("no longer calls getAccessiblePropertyIds") but is required to keep the authoritative test green. See Deviations.
- **Advisory resolution:** the formal short reminder now carries the original due date in all four locales, consistent with the friendly templates.
- **Type derivation:** reminderChannel derives OverduePayment/FollowUpSettings from sendReminder's parameters, so paymentFollowUp needed no new exports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept getAccessiblePropertyIds in /payments/send-reminder**
- **Found during:** Task 2 (send-reminder hardening)
- **Issue:** The plan's acceptance criterion says the handler should "no longer call getAccessiblePropertyIds", but writeGuards.test.ts asserts 403 for the not-accessible case while mocking getUserPropertyRole as "manager". Removing the access check would make that case return 200 and fail the authoritative test.
- **Fix:** Added the manager+ role gate after the existing access check rather than replacing it. In production getUserPropertyRole returns null for an inaccessible property, so both layers agree; the retained access check is what the test varies to distinguish the not-accessible case.
- **Files modified:** apps/api/src/routes/payments.ts
- **Verification:** All 9 writeGuards cases pass; api tsc clean.
- **Committed in:** fe6a07a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/test-alignment).
**Impact on plan:** Minimal. The role gate is present exactly as specified; only the surrounding access check was retained to satisfy the pinned test. No scope creep.

## Assumption Drift (advisory)

**Formal short-reminder body lacked a due date placeholder.**
- **Found during:** Task 3 (reminderChannel.test.ts "short body carries the amount and dd/mm/yyyy due date")
- **Planned:** reminderChannel.test.ts (nl, formal) expects the short body to contain the due date "01/03/2026".
- **Actual:** DEFAULT_SMS_TEMPLATES[*].formal had no {{dueDate}} placeholder (only friendly did), so the rendered formal body never carried the date.
- **Why:** Flagged in the 11-01 advisory. Resolved by adding the due date to the formal templates across all four locales (en/nl/fr/de), matching the friendly templates, rather than weakening the test. This slightly enriches the formal SMS/WhatsApp copy and keeps the four locales consistent.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MCP-03 "writes require manager+" now holds at the API for all four write tools (mark-month-paid and indexation/apply were already correct; record-payment and send-reminder hardened here).
- send-reminder is channel-aware per CONTEXT, with email fallback.
- Plan 04 (middleware: authMiddleware, tokenScope, apiTokenGuards) tests remain RED as expected and are out of scope for this plan.
- Follow-up candidate (out of scope here): POST /ledger/:leaseId/auto and the allocation endpoints are not MCP tools and were intentionally left on the access-only check.

## Self-Check

- [x] apps/api/src/services/reminderChannel.ts created (exports sendReminderViaPreferredChannel, shortReminderBody, fmtDueDate, isReminderTestPhase, ReminderChannel)
- [x] ledger.ts, payments.ts, paymentCheckWorker.ts, manualReminder.ts, shared constants modified
- [x] writeGuards (9), reminderChannel, manualReminder, paymentFollowUp all green (154 API tests pass; only Plan 04 middleware tests red, as expected)
- [x] api + web tsc --noEmit clean

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
