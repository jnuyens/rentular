# Phase 4: Notifications & Payment Follow-Up - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 04-notifications-payment-follow-up
**Areas discussed:** Communication logging, SMTP configuration, Reminder timing, SMS delivery

---

## Communication Logging

### What should be logged?

| Option | Description | Selected |
|--------|-------------|----------|
| Log everything | Every email and SMS sent through the system | ✓ |
| Payment reminders only | Only log the 3-tier payment follow-up emails/SMS | |
| You decide | Claude picks | |

**User's choice:** Log everything
**Notes:** Full audit trail for all communications

### Delivery status tracking?

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget with queue status | Log as queued, update to sent when processed. No bounce tracking. | ✓ |
| Full delivery tracking | SMTP webhooks + SMS delivery receipts for real-time status | |
| You decide | Claude picks | |

**User's choice:** Fire-and-forget with queue status

### Dashboard visibility?

| Option | Description | Selected |
|--------|-------------|----------|
| API endpoint only | Build API, defer dashboard UI to Phase 7 | |
| API + basic dashboard page | Also build a table view in the dashboard | ✓ |
| You decide | Claude picks | |

**User's choice:** API + basic dashboard page

### Dashboard filtering?

| Option | Description | Selected |
|--------|-------------|----------|
| By property and tenant | Filter by property, tenant, and type | ✓ |
| Full filtering | Property, tenant, type, channel, status, date range | |
| You decide | Claude picks | |

**User's choice:** By property and tenant

### Logging wiring?

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized in queue functions | Wrap queueEmail/queueSms to auto-log | ✓ |
| Per-caller logging | Each service logs its own communications | |
| You decide | Claude picks | |

**User's choice:** Centralized in queue functions

### Content display?

| Option | Description | Selected |
|--------|-------------|----------|
| Metadata + expandable body | Table with summary, click to expand full content | ✓ |
| Metadata only | Just summary info | |
| Full content inline | Subject and body preview in table rows | |

**User's choice:** Metadata + expandable body

### Entity linking?

| Option | Description | Selected |
|--------|-------------|----------|
| Link to lease | Use existing leaseId in communications table | ✓ |
| Link to lease + payment | Add paymentId column too | |
| You decide | Claude picks | |

**User's choice:** Link to lease

### Navigation placement?

| Option | Description | Selected |
|--------|-------------|----------|
| Own sidebar item | Dedicated "Communications" in sidebar | ✓ |
| Tab on Settings page | Group with notification settings | |
| Tab on each lease page | Per-lease communications only | |

**User's choice:** Own sidebar item

---

## SMTP Configuration

### SMTP model?

| Option | Description | Selected |
|--------|-------------|----------|
| Single SMTP via env vars | Platform-wide config, all emails from one domain | |
| Per-landlord SMTP settings | Landlords configure their own SMTP for white-label | ✓ |
| You decide | Claude picks | |

**User's choice:** Per-landlord SMTP settings

### Fallback behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| Optional with platform fallback | Landlord CAN configure, falls back to platform SMTP | ✓ |
| Required for sending | MUST configure before emails work | |
| You decide | Claude picks | |

**User's choice:** Optional with platform fallback

### Configuration location?

| Option | Description | Selected |
|--------|-------------|----------|
| Settings page, new SMTP section | Add to existing settings with host/port/user/pass/from + test button | ✓ |
| Separate email configuration page | Dedicated page | |
| You decide | Claude picks | |

**User's choice:** Settings page, new SMTP section

### Credential storage?

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypted in database | AES-256 using AUTH_SECRET | ✓ |
| Plain text in database | Simpler but less secure | |
| You decide | Claude picks | |

**User's choice:** Encrypted in database

---

## Reminder Timing

### When to send?

| Option | Description | Selected |
|--------|-------------|----------|
| Send on any check that crosses threshold | Current 3x daily behavior, immediate on threshold | ✓ |
| Batch at morning check only | Only send at 10:00, avoid midnight emails | |
| You decide | Claude picks | |

**User's choice:** Send on any check that crosses threshold

### Weekend/holiday handling?

| Option | Description | Selected |
|--------|-------------|----------|
| Send anytime | No day-of-week restrictions | ✓ |
| Skip weekends, send next business day | Hold until Monday | |
| You decide | Claude picks | |

**User's choice:** Send anytime

### Auto-create monthly payments?

| Option | Description | Selected |
|--------|-------------|----------|
| No, separate concern | Out of scope for this phase | ✓ |
| Yes, auto-create monthly payments | Bundle with follow-up worker | |
| You decide | Claude picks | |

**User's choice:** No, separate concern

---

## SMS Delivery

### Default provider?

| Option | Description | Selected |
|--------|-------------|----------|
| OVH | Popular in Belgium/Europe, competitive pricing | ✓ |
| Twilio | Global leader, more expensive for EU | |
| MessageBird (Bird) | European company, good Belgian coverage | |
| You decide | Claude picks | |

**User's choice:** OVH

### Consent mechanism?

| Option | Description | Selected |
|--------|-------------|----------|
| Landlord responsibility | No in-app opt-in flow, landlord responsible for agreement | ✓ |
| Tenant opt-in required | Explicit tenant consent via link/portal | |
| You decide | Claude picks | |

**User's choice:** Landlord responsibility

### SMS config scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Platform-wide via env vars | Single provider config, landlords toggle on/off | ✓ |
| Per-landlord SMS config | Landlords configure own SMS credentials | |
| You decide | Claude picks | |

**User's choice:** Platform-wide via env vars

---

## Claude's Discretion

- Database schema for per-landlord SMTP settings table
- AES-256 encryption/decryption implementation details
- Communications dashboard component structure and i18n keys
- "Send test email" implementation approach
- How to wire centralized logging into existing queueEmail/queueSms

## Deferred Ideas

None — discussion stayed within phase scope
