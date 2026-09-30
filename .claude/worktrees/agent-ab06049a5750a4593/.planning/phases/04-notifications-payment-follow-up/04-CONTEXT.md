# Phase 4: Notifications & Payment Follow-Up - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the existing payment follow-up engine to log all communications, ensure SMTP and SMS delivery works end-to-end with per-landlord SMTP support, and provide a basic communications history dashboard. Requirements: NTF-01 through NTF-07, I18N-02.

</domain>

<decisions>
## Implementation Decisions

### Communication Logging (NTF-06)
- **D-01:** Log ALL communications sent through the system (payment reminders, indexation notifications, landlord reports, consent expiry warnings) — not just payment reminders
- **D-02:** Logging is centralized in `queueEmail` and `queueSms` functions — callers don't need to log separately. Each call inserts into the `communications` table automatically.
- **D-03:** Delivery status tracking is fire-and-forget: log as "queued" when enqueued, update to "sent" when the worker processes it. No webhook-based bounce/delivery tracking for launch.
- **D-04:** Communications table already has `leaseId` — use it to link back to the related lease. No additional `paymentId` column needed.

### Communications Dashboard
- **D-05:** Build a basic dashboard page with its own sidebar nav item ("Communications")
- **D-06:** Page shows a table with metadata (type, recipient, date, status) and expandable rows to view full subject + body content
- **D-07:** Filtering by property and tenant (plus communication type). No date range or channel filters for launch.

### SMTP Configuration (NTF-07)
- **D-08:** Per-landlord SMTP settings — landlords CAN configure their own SMTP server for white-label sending
- **D-09:** Optional with platform fallback — if landlord hasn't configured SMTP, emails send from the platform's default SMTP (env vars: SMTP_HOST, etc.)
- **D-10:** SMTP settings configured in the existing Settings page, new "Email Settings" section with fields: host, port, username, password, from address, plus a "Send test email" button
- **D-11:** SMTP passwords encrypted in database using AES-256 with AUTH_SECRET as key. Decrypted at send time.

### Reminder Timing
- **D-12:** Reminders send on any of the 3 daily checks (00:00, 10:00, 17:00) when the daysPastDue threshold is crossed — no batching to a specific time
- **D-13:** No weekend or Belgian public holiday skipping — reminders send anytime
- **D-14:** Automatic monthly payment record creation is out of scope for this phase — separate concern

### SMS Delivery (NTF-04)
- **D-15:** OVH is the recommended/documented SMS provider for Belgian landlords
- **D-16:** SMS consent is landlord's responsibility — no in-app tenant opt-in flow. Document this clearly in settings UI.
- **D-17:** SMS provider configuration remains platform-wide via env vars (SMS_PROVIDER, OVH_* credentials). Landlords toggle SMS on/off in their follow-up settings.

### Claude's Discretion
- Database schema for per-landlord SMTP settings table
- AES-256 encryption/decryption implementation details
- Communications dashboard component structure and i18n keys
- "Send test email" implementation approach
- How to wire centralized logging into existing queueEmail/queueSms without breaking current callers

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — NTF-01 through NTF-07, I18N-02 requirement definitions

### Prior Phase Context
- `.planning/phases/02-payment-processing-webhooks/02-CONTEXT.md` — D-01 through D-17: payment collection model, webhook handling, bank monitoring. Deferred items: "Payment reminder escalation — Phase 4", "SMS delivery — Phase 4", "Email template customization per reminder level — Phase 4"

### Existing Services (fully implemented)
- `apps/api/src/services/paymentFollowUp.ts` — 3-tier escalation (friendly/formal/final), template rendering per tenant language, interest calculation, late fees, SMS sending, PDF attachment on final
- `apps/api/src/services/landlordReport.ts` — Report generation and email rendering
- `apps/api/src/services/indexationEmail.ts` — Indexation email templates (Phase 3)

### Workers (already wired)
- `apps/api/src/jobs/paymentCheckWorker.ts` — 3x daily cron, Phase A (overdue reminders) fully implemented with DB queries + sendReminder calls + paymentReminders recording
- `apps/api/src/jobs/emailQueueWorker.ts` — Email queue with rate limiting, BullMQ worker
- `apps/api/src/jobs/smsQueueWorker.ts` — SMS queue with rate limiting, BullMQ worker

### Infrastructure
- `apps/api/src/lib/email.ts` — sendEmail, renderTemplate
- `apps/api/src/lib/sms.ts` — SMS provider abstraction (Twilio, MessageBird, OVH, console)
- `packages/db/src/schema/communications.ts` — Communications table schema (exists, not yet written to)

### Templates & Constants
- `packages/shared/src/constants/index.ts` — REMINDER_DEFAULTS, DEFAULT_EMAIL_TEMPLATES, DEFAULT_SMS_TEMPLATES, BALANCE_CHECK_CRON

### Settings
- `apps/api/src/routes/settings.ts` — Payment follow-up settings CRUD (already wired to DB)
- `apps/web/app/(dashboard)/settings/page.tsx` — Settings dashboard page

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `queueEmail` / `queueSms` — Central points for adding communication logging (D-02). Both accept options and return job IDs.
- `communications` table — Full schema already defined with channel, type, status, recipient, subject, body, externalId, metadata, timestamps. Ready to write to.
- `paymentFollowUp.ts` — Complete 3-tier escalation with language-aware template selection. Already calls queueEmail + queueSms. No changes needed to follow-up logic itself.
- `paymentCheckWorker.ts` — Already queries overdue payments, builds OverduePayment objects, calls determineReminderLevel + sendReminder, records to paymentReminders table. Fully functional.
- Settings page has an existing pattern for tabbed/sectioned configuration.

### Established Patterns
- Email sending: `sendEmail(options)` via nodemailer transport created from env vars
- Queue pattern: BullMQ with connection pooling, rate limiting, retry with exponential backoff
- Auth: `getRequiredUserId(c)` for ownership filtering
- Route pattern: Hono router + Zod validation + DB query + JSON response
- i18n: `apps/web/messages/{locale}/common.json` for all 4 languages

### Integration Points
- `queueEmail` in emailQueueWorker.ts — wrap to add communications logging
- `queueSms` in smsQueueWorker.ts — wrap to add communications logging
- `sendEmail` in lib/email.ts — modify to support per-landlord SMTP transport selection
- Settings page — add SMTP configuration section
- Dashboard sidebar — add "Communications" nav item
- New API route needed for communications list/filter endpoint

</code_context>

<specifics>
## Specific Ideas

- Per-landlord SMTP is important for white-label sending — landlords want emails to come from their own domain
- OVH SMS specifically called out as the recommended provider for Belgian market
- Communications dashboard should be its own sidebar item, not buried in settings
- The "Send test email" button for SMTP validation is a specific UX requirement

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-notifications-payment-follow-up*
*Context gathered: 2026-03-23*
