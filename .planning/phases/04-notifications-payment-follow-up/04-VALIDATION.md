---
phase: 4
slug: notifications-payment-follow-up
status: audited
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
audited: 2026-04-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None installed |
| **Config file** | None |
| **Quick run command** | `pnpm build --filter=api` (TypeScript compilation only) |
| **Full suite command** | `pnpm build` (full monorepo build) |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm build --filter=api`
- **After every plan wave:** Run `pnpm build`
- **Before `/gsd:verify-work`:** Full build must pass
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | NTF-01, NTF-06 | build | `pnpm build --filter=@rentular/db` | N/A | ✅ green (compile) |
| 04-01-02 | 01 | 1 | NTF-06 | build | `pnpm build --filter=api` | N/A | ✅ green (compile) |
| 04-01-03 | 01 | 1 | NTF-01, NTF-02, NTF-03, NTF-04 | build | `pnpm build --filter=api` | N/A | ✅ green (compile) |
| 04-02-01 | 02 | 2 | NTF-05, NTF-07 | build | `pnpm build --filter=api` | N/A | ✅ green (compile) |
| 04-02-02 | 02 | 2 | NTF-06 | build | `pnpm build --filter=api` | N/A | ✅ green (compile) |
| 04-03-01 | 03 | 3 | NTF-06 | build | `pnpm build` | N/A | ✅ green (compile) |
| 04-03-02 | 03 | 3 | NTF-05 | build | `pnpm build` | N/A | ✅ green (compile) |
| 04-03-03 | 03 | 3 | I18N-02 | build | `pnpm build` | N/A | ✅ green (compile) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No test framework is installed in this project. Wave 0 would require:

- [ ] Install vitest as test framework (`pnpm add -D vitest` in `apps/api`)
- [ ] Create `apps/api/vitest.config.ts` configuration
- [ ] Create test utilities/fixtures for mocking DB, BullMQ, and nodemailer
- [ ] Add `"test": "vitest run"` script to `apps/api/package.json`

*Note: No test framework exists in any package. All verification during execution was TypeScript compilation only.*

---

## Per-Requirement Coverage

| Requirement | Description | Plans | Verified By | Coverage |
|-------------|-------------|-------|-------------|----------|
| NTF-01 | Friendly payment reminder email | 01 | Build + manual | PARTIAL |
| NTF-02 | Formal payment reminder email | 01 | Build + manual | PARTIAL |
| NTF-03 | Final payment reminder email | 01 | Build + manual | PARTIAL |
| NTF-04 | SMS payment reminders | 01 | Build + manual | PARTIAL |
| NTF-05 | Customizable templates per language | 02, 03 | Build + manual | PARTIAL |
| NTF-06 | Communications logging with status | 01, 02, 03 | Build + manual | PARTIAL |
| NTF-07 | Domain-specific SMTP configuration | 02 | Build + manual | PARTIAL |
| I18N-02 | Notification templates in 4 languages | 03 | Build + manual | PARTIAL |

All requirements are PARTIAL: TypeScript compilation confirms type safety and interface contracts, but no runtime behavioral tests exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Friendly reminder email sent when rent overdue | NTF-01 | No test framework; requires BullMQ + DB mock | Trigger overdue payment, check communications table for queued record |
| Formal reminder email after grace period | NTF-02 | No test framework; requires BullMQ + DB mock | Verify paymentCheckWorker schedules formal level after grace days |
| Final reminder before escalation | NTF-03 | No test framework; requires BullMQ + DB mock | Verify paymentCheckWorker schedules final level |
| SMS reminders at each level | NTF-04 | No test framework; requires BullMQ + SMS mock | Trigger reminder with SMS enabled, verify queueSms called with CommunicationMeta |
| Template customization per language | NTF-05 | No test framework; requires API route testing | PUT /settings/payment-follow-up with smsFriendlyMessage, GET to verify persistence |
| Communications logged with delivery status | NTF-06 | No test framework; requires DB assertions | Send email via queueEmail with meta, verify communications record status transitions (queued -> sent/failed) |
| Per-landlord SMTP transport selection | NTF-07 | No test framework; requires nodemailer mock | Save SMTP settings, send email, verify transport uses custom host |
| AES-256-GCM encrypt/decrypt round-trip | NTF-07 | No test framework | Call encrypt() then decrypt(), verify plaintext matches |
| SMTP settings CRUD with masked password | NTF-07 | No test framework; requires API route testing | PUT /smtp, GET /smtp (verify hasPassword: true, no raw password), DELETE /smtp |
| Communications resend via queue | NTF-06 | No test framework | POST /communications/:id/resend for failed record, verify new queued record |
| Communications send with tenant lookup | NTF-06 | No test framework | POST /communications/send with leaseId, verify tenant resolved and queued |
| i18n keys present in all 4 languages | I18N-02 | No test framework | Compare communications.* keys across en/nl/fr/de JSON files |
| Communications dashboard renders | NTF-06 | Frontend; no test framework | Visit /communications, verify table loads with filters |
| Email Settings tab with SMTP form | NTF-07 | Frontend; no test framework | Visit /settings, click Email Settings tab, verify SMTP form fields |
| SMS template fields in follow-up tab | NTF-05 | Frontend; no test framework | Visit /settings follow-up tab, verify SMS template fields present |

---

## Implementation Artifact Verification

All implementation files confirmed present (2026-04-04):

| File | Status | Purpose |
|------|--------|---------|
| `packages/db/src/schema/smtpSettings.ts` | EXISTS | SMTP settings table with AES-256-GCM encrypted password fields |
| `apps/api/src/lib/encryption.ts` | EXISTS | AES-256-GCM encrypt/decrypt utilities |
| `apps/api/src/jobs/emailQueueWorker.ts` | EXISTS | CommunicationMeta interface, auto-logging in queueEmail |
| `apps/api/src/jobs/smsQueueWorker.ts` | EXISTS | Auto-logging in queueSms |
| `apps/api/src/services/paymentFollowUp.ts` | EXISTS | sendReminder with ownerId and CommunicationMeta |
| `apps/api/src/routes/indexation.ts` | EXISTS | queueEmail with indexation_notification type |
| `apps/api/src/routes/settings.ts` | EXISTS | SMTP CRUD API, SMS template fields |
| `apps/api/src/routes/communications.ts` | EXISTS | Resend/send wired to queues, propertyId/tenantId filters |
| `apps/api/src/jobs/landlordReportWorker.ts` | EXISTS | Replaced sendEmail with queueEmail |
| `apps/api/src/jobs/paymentCheckWorker.ts` | EXISTS | Replaced sendEmail with queueEmail, passes ownerId |
| `apps/api/src/lib/email.ts` | EXISTS | Per-landlord SMTP transport cache, getTransportForOwner |
| `apps/web/app/(dashboard)/communications/page.tsx` | EXISTS | Communications dashboard page |
| `apps/web/app/(dashboard)/settings/page.tsx` | EXISTS | Email Settings tab, SMS templates |
| `apps/web/messages/en/common.json` | EXISTS | English i18n keys (7 communications refs) |
| `apps/web/messages/nl/common.json` | EXISTS | Dutch i18n keys (2 communications refs) |
| `apps/web/messages/fr/common.json` | EXISTS | French i18n keys (6 communications refs) |
| `apps/web/messages/de/common.json` | EXISTS | German i18n keys (2 communications refs) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (TypeScript compilation)
- [x] Sampling continuity: build runs after every task
- [ ] Wave 0 covers all MISSING references (no test framework installed)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** partial 2026-04-04

---

## Validation Audit 2026-04-04

| Metric | Count |
|--------|-------|
| Requirements audited | 8 |
| Gaps found | 8 (all MISSING automated behavioral tests) |
| Resolved | 0 |
| Escalated to manual-only | 15 (all behaviors) |
| Compile-verified | 8/8 requirements |
| Files confirmed present | 17/17 |

### Root Cause

No test framework (vitest, jest, etc.) is installed in any package of the monorepo. All Phase 4 verification was TypeScript compilation only (`pnpm build`). Behavioral verification requires:
1. Installing a test framework
2. Mocking infrastructure (BullMQ, MySQL/Drizzle, nodemailer, Redis)
3. Writing unit tests for encryption, queue workers, SMTP transport
4. Writing integration tests for API routes

### Recommendation

Install vitest in `apps/api` and create focused unit tests for the highest-risk behaviors:
1. **encryption.ts** -- encrypt/decrypt round-trip (pure function, no mocks needed)
2. **emailQueueWorker.ts** -- CommunicationMeta logging (requires DB mock)
3. **email.ts** -- getTransportForOwner fallback logic (requires DB + nodemailer mock)
4. **i18n completeness** -- automated key comparison across 4 language files
