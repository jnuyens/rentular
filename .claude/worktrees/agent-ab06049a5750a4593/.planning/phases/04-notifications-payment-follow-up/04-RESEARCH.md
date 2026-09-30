# Phase 4: Notifications & Payment Follow-Up - Research

**Researched:** 2026-03-23
**Domain:** Email/SMS delivery pipeline, communications logging, per-landlord SMTP, dashboard UI
**Confidence:** HIGH

## Summary

Phase 4 wires together the existing payment follow-up engine with centralized communications logging, adds per-landlord SMTP support for white-label email sending, and builds a communications history dashboard. The core escalation logic (`paymentFollowUp.ts`), queue workers (`emailQueueWorker.ts`, `smsQueueWorker.ts`), and payment check cron (`paymentCheckWorker.ts`) are **already fully implemented**. The `communications` table schema exists but is never written to. The `communicationsRouter` API routes exist with list, detail, resend, and send endpoints but use placeholder logic.

The primary work is: (1) inject communication logging into `queueEmail` and `queueSms` so every outgoing message is recorded automatically, (2) update `sendEmail` in `lib/email.ts` to support per-landlord SMTP transport selection, (3) create a new `smtpSettings` database table with AES-256-GCM encrypted passwords, (4) add SMTP settings UI to the existing Settings page, (5) build the Communications dashboard page with its own sidebar nav item, (6) complete the resend and custom-send endpoints in `communicationsRouter`, and (7) add all i18n keys in 4 languages.

**Primary recommendation:** Modify `queueEmail` and `queueSms` to accept optional metadata (ownerId, leaseId, type, recipientName) and insert into the `communications` table at queue time. Update all existing callers to pass this metadata. Create per-landlord SMTP transporter cache keyed by ownerId with lazy creation and TTL-based expiry.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Log ALL communications sent through the system (payment reminders, indexation notifications, landlord reports, consent expiry warnings) -- not just payment reminders
- **D-02:** Logging is centralized in `queueEmail` and `queueSms` functions -- callers don't need to log separately. Each call inserts into the `communications` table automatically.
- **D-03:** Delivery status tracking is fire-and-forget: log as "queued" when enqueued, update to "sent" when the worker processes it. No webhook-based bounce/delivery tracking for launch.
- **D-04:** Communications table already has `leaseId` -- use it to link back to the related lease. No additional `paymentId` column needed.
- **D-05:** Build a basic dashboard page with its own sidebar nav item ("Communications")
- **D-06:** Page shows a table with metadata (type, recipient, date, status) and expandable rows to view full subject + body content
- **D-07:** Filtering by property and tenant (plus communication type). No date range or channel filters for launch.
- **D-08:** Per-landlord SMTP settings -- landlords CAN configure their own SMTP server for white-label sending
- **D-09:** Optional with platform fallback -- if landlord hasn't configured SMTP, emails send from the platform's default SMTP (env vars: SMTP_HOST, etc.)
- **D-10:** SMTP settings configured in the existing Settings page, new "Email Settings" section with fields: host, port, username, password, from address, plus a "Send test email" button
- **D-11:** SMTP passwords encrypted in database using AES-256 with AUTH_SECRET as key. Decrypted at send time.
- **D-12:** Reminders send on any of the 3 daily checks (00:00, 10:00, 17:00) when the daysPastDue threshold is crossed -- no batching to a specific time
- **D-13:** No weekend or Belgian public holiday skipping -- reminders send anytime
- **D-14:** Automatic monthly payment record creation is out of scope for this phase -- separate concern
- **D-15:** OVH is the recommended/documented SMS provider for Belgian landlords
- **D-16:** SMS consent is landlord's responsibility -- no in-app tenant opt-in flow. Document this clearly in settings UI.
- **D-17:** SMS provider configuration remains platform-wide via env vars (SMS_PROVIDER, OVH_* credentials). Landlords toggle SMS on/off in their follow-up settings.

### Claude's Discretion
- Database schema for per-landlord SMTP settings table
- AES-256 encryption/decryption implementation details
- Communications dashboard component structure and i18n keys
- "Send test email" implementation approach
- How to wire centralized logging into existing queueEmail/queueSms without breaking current callers

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NTF-01 | System sends automated friendly payment reminder email when rent is overdue | Already implemented in `paymentFollowUp.ts` + `paymentCheckWorker.ts`. Needs communications logging wired in. |
| NTF-02 | System sends formal payment reminder email after configurable grace period | Already implemented. Same logging integration needed. |
| NTF-03 | System sends final payment reminder email before escalation | Already implemented with PDF attachment. Same logging integration needed. |
| NTF-04 | System sends SMS payment reminders at each reminder level | Already implemented in `paymentFollowUp.ts` lines 224-237. Needs `queueSms` logging wired. |
| NTF-05 | Landlord can customize email/SMS templates per language and per reminder level | Settings page already has per-language template editing (4 langs x 3 levels). Backend settings route already saves/loads templates. Verify SMS template editing exists. |
| NTF-06 | System logs all sent communications with delivery status | Core work: inject logging into `queueEmail`/`queueSms`, update worker to set "sent" status, complete `communicationsRouter` endpoints, build dashboard UI. |
| NTF-07 | Email delivery works with domain-specific SMTP configuration | New: `smtpSettings` table, AES-256-GCM encryption, per-landlord transport in `sendEmail`, settings UI section, test email endpoint. |
| I18N-02 | Notification templates support all four languages | Already implemented: `DEFAULT_EMAIL_TEMPLATES` and `DEFAULT_SMS_TEMPLATES` in `packages/shared/src/constants/index.ts` for EN/NL/FR/DE. Settings page has per-language template tabs. |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nodemailer | 6.9.x | SMTP email sending | Already in project, handles transport creation |
| BullMQ | 5.25.x | Redis-backed job queue | Already handles email/SMS queueing with rate limiting |
| Node.js crypto | built-in | AES-256-GCM encryption for SMTP passwords | No external dependency needed; built into Node.js 20 |
| Drizzle ORM | 0.36.x | Database schema + queries | Already used throughout project |
| next-intl | 3.24.x | i18n for dashboard UI | Already used for all frontend translations |
| Lucide React | 0.468.x | Icons for dashboard | Already used in sidebar and settings |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 3.24.x | Request validation | SMTP settings input validation |
| @hono/zod-validator | 0.4.x | Route-level validation | New SMTP settings endpoints |
| @tanstack/react-query | 5.62.x | Client data fetching | Communications dashboard data loading |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node.js crypto (AES-256-GCM) | `@aws-sdk/client-kms` | KMS is overkill for single-VPS deployment; built-in crypto is sufficient |
| Per-request nodemailer transport | Transport pooling library | Nodemailer already supports connection pooling per transport; a lightweight cache by ownerId is sufficient |

## Architecture Patterns

### Integration Points Map
```
Callers of queueEmail:                    Callers of queueSms:
  paymentFollowUp.ts (3 levels)             paymentFollowUp.ts (3 levels)
  indexation.ts (apply indexation)
  support.ts (support chat)
  landlordReportWorker.ts (uses sendEmail directly!)
  paymentCheckWorker.ts (uses sendEmail for consent warnings!)

Communications flow:
  caller -> queueEmail(opts, meta) -> INSERT communications (status=queued)
                                   -> emailQueue.add(jobId)
  emailWorker processes job        -> UPDATE communications (status=sent)
  on failure                       -> UPDATE communications (status=failed, errorMessage)
```

### Pattern 1: Centralized Communication Logging (D-02)
**What:** Modify `queueEmail` and `queueSms` signatures to accept optional communication metadata. When metadata is present, insert a `communications` record before adding to the BullMQ queue. Store the communications record ID in the job data so the worker can update status.
**When to use:** Every outgoing email and SMS.
**Example:**
```typescript
// Extended queueEmail signature
interface CommunicationMeta {
  ownerId: string;
  leaseId?: string;
  type: CommunicationType; // from communications schema enum
  recipientName: string;
}

export async function queueEmail(
  options: EmailOptions,
  opts?: { priority?: number; delay?: number },
  meta?: CommunicationMeta
): Promise<string> {
  let communicationId: string | undefined;

  if (meta) {
    communicationId = crypto.randomUUID();
    const db = getDb();
    await db.insert(communications).values({
      id: communicationId,
      ownerId: meta.ownerId,
      leaseId: meta.leaseId || null,
      channel: "email",
      type: meta.type,
      recipientName: meta.recipientName,
      recipientEmail: options.to,
      subject: options.subject,
      body: options.body,
      status: "queued",
    });
  }

  const job = await emailQueue.add("send-email", {
    ...options,
    communicationId, // Pass to worker for status update
  }, {
    priority: opts?.priority,
    delay: opts?.delay,
  });

  // Store job ID as externalId
  if (communicationId) {
    const db = getDb();
    await db.update(communications)
      .set({ externalId: job.id })
      .where(eq(communications.id, communicationId));
  }

  return job.id!;
}
```

### Pattern 2: Per-Landlord SMTP Transport Cache
**What:** Create a transport cache keyed by ownerId. On each email send, check if the owner has custom SMTP settings. If yes, retrieve or create a cached nodemailer transport. If no, use the default platform transport.
**When to use:** In the email queue worker, before calling `sendEmail`.
**Example:**
```typescript
// lib/email.ts - extended
import { createTransport, type Transporter } from "nodemailer";

// Default platform transport
const defaultTransporter = createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
});

// Cache for per-landlord transports (ownerId -> { transport, createdAt })
const transportCache = new Map<string, { transport: Transporter; createdAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function getTransportForOwner(ownerId?: string): Promise<{
  transport: Transporter;
  fromAddress: string;
}> {
  if (!ownerId) {
    return {
      transport: defaultTransporter,
      fromAddress: process.env.EMAIL_FROM || "noreply@rentular.com",
    };
  }

  // Check cache
  const cached = transportCache.get(ownerId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    // Look up fromAddress from DB (or cache it too)
    return { transport: cached.transport, fromAddress: /* from settings */ };
  }

  // Look up SMTP settings from DB
  const db = getDb();
  const settings = await db.select().from(smtpSettings)
    .where(eq(smtpSettings.ownerId, ownerId))
    .limit(1);

  if (!settings[0]) {
    return {
      transport: defaultTransporter,
      fromAddress: process.env.EMAIL_FROM || "noreply@rentular.com",
    };
  }

  // Decrypt password and create transport
  const password = decrypt(settings[0].passwordEncrypted, settings[0].passwordIv);
  const transport = createTransport({
    host: settings[0].host,
    port: settings[0].port,
    secure: settings[0].port === 465,
    auth: { user: settings[0].username, pass: password },
  });

  transportCache.set(ownerId, { transport, createdAt: Date.now() });
  return { transport, fromAddress: settings[0].fromAddress };
}
```

### Pattern 3: AES-256-GCM Encryption for SMTP Passwords (D-11)
**What:** Use Node.js built-in `crypto` module with AES-256-GCM. Derive a 32-byte key from AUTH_SECRET using HKDF. Store IV and auth tag alongside ciphertext.
**Example:**
```typescript
// lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Derive a 32-byte key from AUTH_SECRET
function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "";
  // SHA-256 produces exactly 32 bytes
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decrypt(encrypted: string, iv: string, tag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

### Anti-Patterns to Avoid
- **Creating a new nodemailer transport per email:** Wastes resources. Use a transport cache with TTL instead.
- **Logging communications outside queueEmail/queueSms:** Violates D-02. All logging must be centralized in the queue functions.
- **Storing SMTP passwords in plaintext:** Security risk. Must use AES-256-GCM encryption (D-11).
- **Blocking the queue worker on DB insert:** Communications logging at queue time (not worker time) means the insert happens synchronously before the job is added, not in the hot path of the worker.
- **Breaking existing callers:** `queueEmail` and `queueSms` must remain backward-compatible. The `meta` parameter should be optional; calls without metadata still work but won't log to communications.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery | Custom SMTP client | nodemailer `createTransport` | Handles TLS negotiation, auth, connection pooling |
| Encryption | Custom AES wrapper | Node.js `crypto` with `aes-256-gcm` | Battle-tested, GCM provides authenticated encryption |
| Job queue | Custom retry/scheduling | BullMQ (already used) | Handles retries, rate limiting, cron scheduling |
| i18n | Manual string interpolation | next-intl (already used) | Pluralization, formatting, SSR support |

**Key insight:** Almost everything needed is already implemented or available through existing dependencies. The work is integration and wiring, not building new systems.

## Common Pitfalls

### Pitfall 1: Breaking existing callers of queueEmail/queueSms
**What goes wrong:** Adding required parameters to `queueEmail` breaks all 4+ callers across the codebase.
**Why it happens:** The function signature change is not backward-compatible.
**How to avoid:** Make the `meta` parameter optional (third argument). Existing callers continue to work without changes; update them one by one to pass metadata.
**Warning signs:** TypeScript compilation errors after changing the signature.

### Pitfall 2: landlordReportWorker and paymentCheckWorker use sendEmail directly
**What goes wrong:** These two workers call `sendEmail` directly (not `queueEmail`), so their emails bypass the communication logging.
**Why it happens:** They were written before the queue abstraction existed, or for different reasons (landlord reports go to the landlord, not tenant).
**How to avoid:** Update `landlordReportWorker.ts` line 167 to use `queueEmail` instead of `sendEmail`. Update `paymentCheckWorker.ts` line 378 (consent expiry warning) similarly. Both should pass communication metadata.
**Warning signs:** Landlord report and consent expiry emails don't appear in the communications log.

### Pitfall 3: SMTP transport creation errors failing silently
**What goes wrong:** Invalid SMTP credentials cause the transport to be created but fail on first `sendMail` call, crashing the worker.
**Why it happens:** `createTransport` doesn't verify credentials; `sendMail` does.
**How to avoid:** The "Send test email" button (D-10) must actually call `transport.verify()` to validate the connection before saving settings. In the worker, catch transport errors per-email and update the communication status to "failed".
**Warning signs:** All emails for a landlord start failing after they save bad SMTP settings.

### Pitfall 4: AUTH_SECRET rotation breaks all encrypted SMTP passwords
**What goes wrong:** If AUTH_SECRET changes, all AES-256-GCM encrypted passwords become undecryptable.
**Why it happens:** The encryption key is derived from AUTH_SECRET.
**How to avoid:** Document this clearly. In practice, AUTH_SECRET rarely changes. If it must change, a migration script would need to re-encrypt all passwords with the new key (decrypt with old, encrypt with new).
**Warning signs:** All per-landlord SMTP emails start failing after an AUTH_SECRET rotation.

### Pitfall 5: Communications table missing indexes for dashboard queries
**What goes wrong:** Dashboard queries filtering by property/tenant become slow as the table grows.
**Why it happens:** The existing schema has indexes on `ownerId` and `leaseId` but filtering by property or tenant requires joining through leases.
**How to avoid:** The existing indexes on `ownerId` and `leaseId` are sufficient for launch. Property/tenant filtering works through the lease join. The table will need a composite index later if it grows large.
**Warning signs:** Slow dashboard loading for landlords with many communications.

### Pitfall 6: Race condition between queue insert and communications insert
**What goes wrong:** If the BullMQ job completes before the communications record is inserted, the worker can't update the status.
**Why it happens:** The communications insert happens in `queueEmail`, and the job is processed nearly instantly.
**How to avoid:** Insert the communications record BEFORE adding the job to the queue. Pass the `communicationId` in the job data. The worker looks it up and updates status.
**Warning signs:** Communications stuck in "queued" status even though the email was sent.

## Code Examples

### Database Schema: SMTP Settings Table
```typescript
// packages/db/src/schema/smtpSettings.ts
import { mysqlTable, varchar, int, text, boolean, timestamp } from "drizzle-orm/mysql-core";
import { users } from "./users";

export const smtpSettings = mysqlTable("smtp_settings", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id),
  host: varchar("host", { length: 255 }).notNull(),
  port: int("port").notNull().default(587),
  username: varchar("username", { length: 255 }).notNull(),
  // AES-256-GCM encrypted password fields
  passwordEncrypted: text("password_encrypted").notNull(),
  passwordIv: varchar("password_iv", { length: 24 }).notNull(), // base64 12-byte IV
  passwordTag: varchar("password_tag", { length: 24 }).notNull(), // base64 16-byte tag
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  // Verification status
  verified: boolean("verified").default(false).notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### Worker Status Update Pattern
```typescript
// In emailQueueWorker.ts worker handler
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { to, subject, body, attachments, communicationId, ownerId } = job.data;

    try {
      // Get transport (per-landlord or default)
      const { transport, fromAddress } = await getTransportForOwner(ownerId);

      await transport.sendMail({
        from: fromAddress,
        to,
        subject,
        text: body,
        attachments,
      });

      // Update communication status to "sent"
      if (communicationId) {
        const db = getDb();
        await db.update(communications)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(communications.id, communicationId));
      }
    } catch (err) {
      // Update communication status to "failed"
      if (communicationId) {
        const db = getDb();
        await db.update(communications)
          .set({
            status: "failed",
            errorMessage: String(err),
          })
          .where(eq(communications.id, communicationId));
      }
      throw err; // Re-throw for BullMQ retry
    }
  },
  { connection, concurrency: 1, limiter: { max: MAX_EMAILS_PER_MINUTE, duration: 60000 } }
);
```

### Navigation Update
```typescript
// apps/web/app/(dashboard)/layout.tsx - add Communications to navigationItems
import { MessageSquare } from "lucide-react"; // or Mail icon

const navigationItems = [
  { key: "properties" as const, href: "/properties", icon: Building2 },
  { key: "tenants" as const, href: "/tenants", icon: Users },
  { key: "leases" as const, href: "/leases", icon: FileText },
  { key: "payments" as const, href: "/payments", icon: CreditCard },
  { key: "indexation" as const, href: "/indexation", icon: TrendingUp },
  { key: "communications" as const, href: "/communications", icon: MessageSquare }, // NEW
  { key: "maintenance" as const, href: "/maintenance", icon: Wrench },
  { key: "settings" as const, href: "/settings", icon: Settings },
];
```

### Callers That Need Metadata Updates
```
File                              Current call                         Metadata to add
-------                           --------                             --------
services/paymentFollowUp.ts:221   queueEmail(emailOptions)            { ownerId, leaseId, type: "payment_reminder_{level}", recipientName: tenantName }
services/paymentFollowUp.ts:233   queueSms({to, body})                { ownerId, leaseId, type: "payment_reminder_{level}", recipientName: tenantName }
routes/indexation.ts:937          queueEmail({to, subject, body})     { ownerId, leaseId, type: "indexation_notification", recipientName: tenantName }
routes/support.ts:67              queueEmail({to, subject, body})     { ownerId, type: "other", recipientName: "Support" }
jobs/landlordReportWorker.ts:167  sendEmail(email) -> queueEmail      { ownerId, type: "landlord_report", recipientName: ownerName }
jobs/paymentCheckWorker.ts:378    sendEmail({to, subject, body})      { ownerId: conn.ownerId, type: "other", recipientName: ownerName }
```

### Send Test Email Endpoint
```typescript
// In settings router
settingsRouter.post("/smtp/test", zValidator("json", z.object({
  host: z.string(),
  port: z.number(),
  username: z.string(),
  password: z.string(),
  fromAddress: z.string().email(),
})), async (c) => {
  const data = c.req.valid("json");
  const ownerId = getRequiredUserId(c);

  const transport = createTransport({
    host: data.host,
    port: data.port,
    secure: data.port === 465,
    auth: { user: data.username, pass: data.password },
  });

  try {
    await transport.verify(); // Validates connection + auth
    // Optionally send a real test email to the landlord
    const owner = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
    if (owner[0]?.email) {
      await transport.sendMail({
        from: data.fromAddress,
        to: owner[0].email,
        subject: "Rentular SMTP Test",
        text: "This is a test email from Rentular to verify your SMTP settings are working correctly.",
      });
    }
    return c.json({ success: true, message: "SMTP connection verified and test email sent" });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 400);
  } finally {
    transport.close();
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sendEmail` called directly | `queueEmail` via BullMQ | Phase 2 | Most callers already use queue; landlordReportWorker and paymentCheckWorker still call sendEmail directly |
| No communications logging | `communications` table schema exists | Phase 1 | Schema defined but never written to; routes have placeholder logic |
| Single SMTP config | Per-landlord SMTP (this phase) | Phase 4 | Requires new table, encryption, transport cache |

**Deprecated/outdated:**
- `sendEmail` direct calls from workers: Should be replaced with `queueEmail` for consistent logging

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test framework detected in project |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NTF-01 | Friendly reminder email sent when overdue | manual-only | Manual: create overdue payment, trigger cron, verify email in Mailpit | N/A |
| NTF-02 | Formal reminder email sent after grace period | manual-only | Manual: same as above with longer overdue | N/A |
| NTF-03 | Final reminder email with PDF | manual-only | Manual: same as above with final threshold | N/A |
| NTF-04 | SMS sent at each level | manual-only | Manual: enable SMS in settings, verify console provider output | N/A |
| NTF-05 | Template customization per language/level | manual-only | Manual: edit templates in Settings, trigger reminder, verify content | N/A |
| NTF-06 | All communications logged with status | manual-only | Manual: send any communication, check Communications dashboard | N/A |
| NTF-07 | Per-landlord SMTP works | manual-only | Manual: configure SMTP in Settings, use "Send test email" button | N/A |
| I18N-02 | Templates in all 4 languages | manual-only | Manual: verify DEFAULT_EMAIL_TEMPLATES and DEFAULT_SMS_TEMPLATES have all 4 | N/A |

**Justification for manual-only:** No test framework exists in the project. All requirements involve end-to-end flows (email sending, queue processing, SMTP connection) that require infrastructure (Redis, MySQL, SMTP server). Phase 4 is integration work, not algorithmically testable logic.

### Sampling Rate
- **Per task commit:** Manual verification that the API starts without errors: `cd apps/api && pnpm build`
- **Per wave merge:** Build check + manual smoke test of the specific feature
- **Phase gate:** Full manual verification of all 5 success criteria

### Wave 0 Gaps
- No test framework to set up
- Manual testing via Mailpit (SMTP capture) is the primary verification method

## Open Questions

1. **SMS template editing in Settings UI**
   - What we know: Backend stores SMS templates (`smsFriendlyMessage`, `smsFormalMessage`, `smsFinalMessage` in `paymentFollowUpSettings`). Settings route already handles save/load. Default templates exist in 4 languages.
   - What's unclear: The current Settings page UI may or may not have SMS template editing fields. Need to verify during implementation.
   - Recommendation: Check the full Settings page component. If SMS template fields are missing, add them alongside the email template tabs.

2. **Communications table `type` enum coverage**
   - What we know: The enum includes `payment_reminder_friendly`, `payment_reminder_formal`, `payment_reminder_final`, `indexation_notification`, `landlord_report`, `custom`, `welcome`, `lease_renewal`, `lease_termination`, `other`.
   - What's unclear: Consent expiry warnings and support chat emails don't have a specific type.
   - Recommendation: Use `other` for consent expiry warnings and support emails. The existing enum is sufficient.

3. **Communications dashboard property/tenant filtering (D-07)**
   - What we know: Communications table links to leaseId. To filter by property, need to join `leases` -> `properties`. To filter by tenant, need to join `leases` -> `leaseTenants` -> `tenants`.
   - What's unclear: Whether to add propertyId/tenantId directly to the communications table for query efficiency.
   - Recommendation: Do NOT add extra columns. Join through leaseId. For the API endpoint, accept `propertyId` and `tenantId` as query params and use subqueries to find matching leaseIds.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `apps/api/src/services/paymentFollowUp.ts` -- full escalation engine
- Codebase analysis: `apps/api/src/jobs/emailQueueWorker.ts` -- queue implementation
- Codebase analysis: `apps/api/src/jobs/smsQueueWorker.ts` -- SMS queue implementation
- Codebase analysis: `apps/api/src/jobs/paymentCheckWorker.ts` -- 3x daily cron
- Codebase analysis: `apps/api/src/lib/email.ts` -- current single-transport sendEmail
- Codebase analysis: `apps/api/src/lib/sms.ts` -- multi-provider SMS abstraction
- Codebase analysis: `packages/db/src/schema/communications.ts` -- existing schema
- Codebase analysis: `apps/api/src/routes/communications.ts` -- existing placeholder endpoints
- Codebase analysis: `apps/api/src/routes/settings.ts` -- existing settings CRUD
- Codebase analysis: `packages/shared/src/constants/index.ts` -- templates in 4 languages
- Node.js crypto documentation -- AES-256-GCM built-in support

### Secondary (MEDIUM confidence)
- [Nodemailer SMTP transport docs](https://nodemailer.com/smtp) -- transport creation, verify(), pooled connections
- [AES-256-GCM gist](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81) -- encryption pattern reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in the project
- Architecture: HIGH -- integration patterns derived from existing code analysis
- Pitfalls: HIGH -- identified from concrete code paths (direct sendEmail calls, caller compatibility)
- Encryption: HIGH -- Node.js crypto AES-256-GCM is well-documented and stable

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable -- no external API changes expected)
