---
quick_id: 261107-rpl
status: complete
completed: 2026-11-08
commits:
  - 1ff5afe feat(261107-rpl): schema for inbound messages and per-contract reply tokens
  - b484fc8 feat(261107-rpl): opaque per-contract reply token and address
  - ea049d5 feat(261107-rpl): tenant contract emails carry the contract reply address
  - c433137 feat(261107-rpl): small MIME parser for inbound replies
  - e946542 feat(261107-rpl): inbound tenant replies filed on the contract and forwarded
  - f62959a feat(261107-rpl): contract history returns tenant replies with their direction
  - f5fc4ce feat(261107-rpl): tenant replies in the contract communication page
  - 81cdf11 feat(261107-rpl): Cloudflare email worker for reply addresses
key-files:
  created:
    - packages/db/src/schema/leaseReplyTokens.ts
    - apps/api/src/lib/replyAddress.ts
    - apps/api/src/lib/mimeParse.ts
    - apps/api/src/services/inboundEmail.ts
    - apps/api/src/routes/inbound.ts
    - infra/cloudflare/inbound-email/{wrangler.toml,tsconfig.json,README.md,src/index.ts,src/cloudflare.d.ts}
    - .planning/quick/261107-rpl-tenant-reply-address/prod-ddl.sql
  modified:
    - packages/db/src/schema/communications.ts
    - packages/db/src/schema/index.ts
    - apps/api/src/lib/email.ts
    - apps/api/src/lib/communicationLog.ts
    - apps/api/src/lib/csrfPolicy.ts
    - apps/api/src/jobs/emailQueueWorker.ts
    - apps/api/src/services/leaseCommunications.ts
    - apps/api/src/index.ts
    - apps/web/app/(dashboard)/leases/[id]/page.tsx
    - apps/web/messages/{en,nl,fr,de}/common.json
    - .env.example
---

# Quick Task 261107-rpl: Reply address per contract

Tenant emails about a contract now carry `Reply-To: reply+<token>.<msg>@rentular.com`. A Cloudflare Email Worker posts replies to the API. The API files each reply on the contract as an inbound message and forwards it to the property's managers, with Reply-To set to the tenant.

## Required deploy order

1. Back up the prod database.
2. Apply `.planning/quick/261107-rpl-tenant-reply-address/prod-ddl.sql`. It adds `tenant_reply` to `communications.type`, adds `communications.direction` (default `outbound`) and creates `lease_reply_tokens`. **This has to happen before the code goes out.** Drizzle selects `direction` on every communications read, so code without the column breaks the history page and the communications list. If the FK is rejected (errno 150), rerun the CREATE TABLE without the CONSTRAINT line.
3. Deploy the code: build web, then `pm2 restart` web and api. Leave `INBOUND_*` unset for now and nothing visible changes: no Reply-To, and the inbound endpoint answers 404.
4. Generate two secrets (`openssl rand -hex 32` twice). In the API `.env` on m1, set `INBOUND_REPLY_SECRET=<secret A>` and `INBOUND_WEBHOOK_SECRET=<secret B>`. Optionally set `INBOUND_FALLBACK_TO`, which defaults to `ADMIN_EMAIL`. `INBOUND_REPLY_DOMAIN` defaults to `rentular.com`. Restart the api.
   - Check from outside: `curl -s -o /dev/null -w '%{http_code}' -X POST https://www.rentular.com/api/v1/inbound/email` should print 401. A 404 means the secret is not loaded, and a Caddy error means the route is not proxied.
   - Caddy may cap request bodies. Allow at least 12 MB on `/api/v1/inbound/*`.
5. Do the Cloudflare steps below.
6. Test: send yourself a reminder or custom message on a test contract. Reply to it with an attachment. The reply should appear on `/leases/<id>` as "Antwoord van huurder", and the managers should get the forward with Reply-To set to you. Then send a mail to `whatever@rentular.com` and check it still arrives at jnuyens@gmail.com.

Steps 4 and 5 can happen in either order. Until the worker is live, replies to `reply+` addresses fall into today's catch-all and still reach the Gmail inbox, just not the contract.

## Cloudflare steps (not done, nothing was deployed or changed)

1. `cd infra/cloudflare/inbound-email`
2. `npx wrangler login` (with the account that owns rentular.com).
3. Check the `[vars]` in `wrangler.toml`: `API_URL = "https://www.rentular.com"` and `FALLBACK_FORWARD = "jnuyens@gmail.com"`. The fallback must be a verified destination in Email Routing, and it already is.
4. `npx wrangler deploy`
5. `npx wrangler secret put INBOUND_WEBHOOK_SECRET` and paste secret B.
6. In the dashboard, go to rentular.com, then Email, Email Routing, Routing rules. Edit the **Catch-all address** rule: set the action to "Send to a Worker" and the destination to `rentular-inbound-email`. Save. Leave existing custom address rules alone.
7. To roll back, set the catch-all back to "Send to an email" with jnuyens@gmail.com.

The worker forwards any non-`reply+` address to the fallback, and also forwards `reply+` mail there when it is over 10 MB, when the API is unreachable, after 25 s without an answer, or on any non-2xx answer. It never rejects mail.

## What was built

- **Token** (`lib/replyAddress.ts`): HMAC-SHA256 (`INBOUND_REPLY_SECRET`) over the lease id and a generation number, first 20 base32 characters (100 bits). It is stored in `lease_reply_tokens` and created on the lease's first tenant email. To resolve a token, the row must exist and not be revoked, and the token must equal the HMAC of that lease, so tokens edited by hand or written straight into the table do not route. A revoked token gets the next generation on the next email. The `.<msg>` part holds the first 8 hex characters of the outgoing communication id. The local part is at most 37 characters (the limit is 64).
- **Outgoing** (`queueEmail`): every email with a lease whose type is not a landlord type (`landlord_notification`, `landlord_report`, `indexation_alert`) gets the Reply-To and `Message-ID: <communication-id@rentular.com>`. Both are stored in `metadata.replyTo` and `metadata.messageId`. This covers reminders, indexation letters, custom messages and resends, which get fresh headers. From is unchanged. Without the secret, or when the token table cannot be reached, the email goes out as before.
- **Inbound** (`POST /api/v1/inbound/email`): public, outside requireAuth, and exempt from CSRF like the webhooks. The secret is compared as sha256 digests with timingSafeEqual. The body limit is 12 MB, there is an in-memory limit of 120 calls per minute per client IP, and the endpoint answers 404 while unconfigured. The service (`services/inboundEmail.ts`):
  - Finds the token in the envelope recipient, Delivered-To, X-Original-To, To or Cc.
  - For an unknown or revoked token: mails `INBOUND_FALLBACK_TO`/`ADMIN_EMAIL` with the original attached as `original.eml`, files nothing and answers 200.
  - For a duplicate Message-ID on the same lease: answers 200 with no new row.
  - Otherwise stores a `tenant_reply` row (inbound, status `delivered`) with the sender as recipient name and email. The body is the text part, or the html converted to text, with quoted history trimmed (EN/NL/FR/DE markers and trailing `>` blocks). The full text goes in `metadata.fullText` when trimmed. Metadata also holds from, to, cc, messageId, inReplyTo, matchedCommunicationId (from the address tag, then In-Reply-To, then References), the attachment list without content, the spam and auth headers, senderKnown, auto and envelopeFrom.
  - senderKnown is true when the sender is one of the lease's tenants, or was the recipient or a CC of the matched message.
  - Auto-replies and bounces are filed with `auto: true` and not forwarded. They are recognised by: Auto-Submitted not `no`; Precedence bulk/junk/list/auto_reply; the X-Autoreply, X-Autorespond and X-Auto-Response-Suppress headers; multipart/report; an empty envelope sender; mailer-daemon, postmaster or noreply senders.
  - The forward goes to `getLandlordNotificationRecipients` (to + cc) through the platform transport (Rentular sender). It has Reply-To set to the tenant and In-Reply-To set to the tenant's Message-ID. The subject is `Re: <subject>` with `[Property]` in front if missing. The header is in the owner's language, links to `/leases/<id>`, and adds a warning line for unknown senders. Attachments are included up to 10 MB in total, and anything left over is listed by name. The forward is logged as `landlord_notification`, `kind: tenant_reply_forward`. If the forward fails, the API answers 502 and the worker delivers the raw message to the fallback. The inbound row stays.
- **MIME parsing**: `lib/mimeParse.ts` is written in-house (see deviations).
- **History**: past items carry `direction`, `senderKnown`, `auto`, `attachments` and `matchedCommunicationId`. The 7-day counter counts outbound tenant messages only.
- **Web**: replies sit in the tenant section with an incoming icon, a blue left border, "Van:" with the sender, attachment names, a "Onbekende afzender" badge with an explanation line, an automatic-reply note and the status "Ontvangen". The kind filter offers "Antwoord van huurder" once there is a reply. The forward shows in "Meldingen aan jou" as "Antwoord van huurder, doorgestuurd naar jou". Strings are in EN/NL/FR/DE.

## Verification (observed)

- `apps/api`: `npx vitest run` gave 67 files and 584 tests passed. `npx tsc --noEmit -p .` reported no errors.
- `apps/web`: `npx tsc --noEmit -p .` reported no errors. `pnpm build` (placeholder DB_PASSWORD and AUTH_SECRET) succeeded.
- Worker: `tsc --noEmit -p infra/cloudflare/inbound-email` (root TypeScript, local runtime type stubs) reported no errors.
- New tests:
  - `replyAddress.test.ts`: stable, unique, round trip, tampered, revoked and next generation, 64-character limit, off without a secret.
  - `emailQueueReplyTo.test.ts`: reminder, indexation and custom get the header; off means no header; landlord types get none; resends get fresh headers.
  - `mimeParse.test.ts`.
  - `inboundEmail.test.ts`: known tenant stored and forwarded to + cc with Reply-To; unknown sender warned; CC'd lawyer counts as known; auto-reply and MAILER-DAEMON not forwarded; duplicate ignored; unknown token goes to fallback; In-Reply-To and the tag both link; 502 on a failed forward; 10 MB attachment cap.
  - `routes/__tests__/inbound.test.ts`: 401, 404 when off, envelope passed through, 502/500, rate limit.
  - `leaseCommunications.test.ts`: inbound rows in past with direction; the counter SQL filters on outbound.
- Not verified: anything live. That covers MariaDB (the `JSON_UNQUOTE(JSON_EXTRACT(...))` dedupe and the `LIKE` tag lookup), SMTP delivery of the forward with attachments, Cloudflare (that `forward()` works after `raw` was read, and the real envelope values), the Caddy body limit and real-world MIME from Gmail, Outlook and Apple Mail. All of these get exercised in deploy step 6.

## Deviations

1. **[Rule 3] No `postal-mime` or `mailparser`.** Neither is in the lockfile or the offline store, and package installs are not something to do unattended. The API uses a small in-house parser (`lib/mimeParse.ts`). The worker has no dependencies at all because it does not parse: it posts the raw message. Cost if wrong: an exotic message (unusual charset, broken multipart) is filed with poor text. The forward still carries what was parsed, and nothing is lost.
2. **[Rule 2] A forward failure answers 502** so the worker hands the raw message to the fallback address, and unknown tokens are only answered with 200 after the fallback mail went out. Cost if wrong: a manager can get the reply twice (once from the fallback after a partial SMTP failure).
3. **[Rule 2] CSRF exemption for `/api/v1/inbound/`**, which has no browser Origin and authenticates with the shared secret. Cost if wrong: none for cookie users. The path has no cookie-authenticated behaviour.
4. **Tenant section renamed** from "Verzonden" to "Met de huurder" (EN "With the tenant", FR "Avec le locataire", DE "Mit dem Mieter"). Replies now live there, and "Sent" over a received message would read wrong. Cost if wrong: a label change.
5. **Dependencies installed in the worktree** with `pnpm install --frozen-lockfile --offline` (lockfile only, nothing added).

## Threat flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-public-endpoint | apps/api/src/routes/inbound.ts | Unauthenticated POST accepting up to 12 MB of attacker-controlled MIME. Guarded by a shared secret in constant time, a body limit and a per-IP rate limit; 404 while unconfigured. |
| threat_flag: spoofing | apps/api/src/services/inboundEmail.ts | Anyone who knows a reply address can write into a contract's history and to its managers. Mitigated by senderKnown with a visible warning, spam verdict headers kept, and revocable tokens. |
