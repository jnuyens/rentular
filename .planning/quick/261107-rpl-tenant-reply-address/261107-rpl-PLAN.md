---
quick_id: 261107-rpl
type: quick
autonomous: true
---

# Quick Task 261107-rpl: Reply address per contract, tenant replies reach the manager and the contract history

## Why

Tenants reply to reminder and indexation emails. Today the From is noreply@rentular.com, and anything sent to @rentular.com lands in the Cloudflare Email Routing catch-all, which forwards to the owner's Gmail with no link to the contract. Replies (excuses, "I paid", lawyer letters) must reach the people who manage the property and must be part of the contract's communication history (built in 261105-com: apps/api/src/services/leaseCommunications.ts, apps/web/app/(dashboard)/leases/[id]/page.tsx).

## Design

- Outgoing: every email to a tenant that concerns a contract keeps From "Rentular <noreply@rentular.com>" (EMAIL_FROM), and gets `Reply-To: reply+<token>@rentular.com` (domain from env INBOUND_REPLY_DOMAIN, default rentular.com; feature off when INBOUND_REPLY_SECRET is unset, so self-hosters keep plain behaviour). The token is short, opaque, and stable per lease: a base32 HMAC (INBOUND_REPLY_SECRET) over the lease id, plus a lookup table `lease_reply_tokens` (token unique, lease_id, created_at), so the token itself carries no readable data and can be rotated. Max local-part length 64. Optionally add a second token form per communication (`reply+<leaseToken>.<commShort>`) so a reply can be linked to the exact message it answers; fall back to In-Reply-To / References matching against stored Message-IDs (store the outgoing Message-ID in communications.external_id or metadata.messageId when nodemailer returns it).
- The stored body in communications is unchanged; add metadata.replyTo.
- Inbound: a Cloudflare Email Worker in `infra/cloudflare/inbound-email/` (wrangler.toml + src/index.ts, TypeScript, no extra deps beyond `postal-mime`). On message: if the recipient local part starts with `reply+`, read the raw message (cap 10 MB), POST it to `${API_URL}/api/v1/inbound/email` with header `X-Inbound-Secret: <INBOUND_WEBHOOK_SECRET>` (worker secret), and do NOT forward it elsewhere; if the API answers non-2xx, `message.setReject` is NOT used, instead forward to the fallback address (env FALLBACK_FORWARD) so nothing is lost. Any other recipient: `message.forward(FALLBACK_FORWARD)` (keeps today's catch-all behaviour). README with deploy steps: `wrangler deploy`, `wrangler secret put INBOUND_WEBHOOK_SECRET`, then in Cloudflare Email Routing point the catch-all to the worker. Do not deploy it.
- API `POST /api/v1/inbound/email` (public, no auth middleware, constant-time secret check, body size limit 12 MB, rate limit): parse the raw MIME (use `mailparser` or `postal-mime`, already a dep? check; add the smallest one), resolve the token to the lease, then:
  1. Store a communications row: new column `direction` enum('outbound','inbound') default 'outbound'; type 'tenant_reply'; channel 'email'; owner_id of the lease; lease_id; recipient_name/email = the sender (name, address); subject; body = plain text (html converted to text if no text part, quoted history trimmed is optional but keep the full text in metadata.fullText if trimmed); status 'delivered'; metadata: from, to, cc, messageId, inReplyTo, matched communication id (from In-Reply-To or the token's comm part), attachments list (name, size, type) without storing content, spam verdict headers if present, and senderKnown (true if the from address matches a tenant email of the lease or the lease CC list).
  2. Forward to the managers: recipients from getLandlordNotificationRecipients(lease.propertyId, ownerEmail) (to + cc). Send via the normal email path with From "Rentular <noreply@rentular.com>", Reply-To the original sender (so the manager answers the tenant directly), subject `Re: <original subject>` prefixed with the property name if missing, body: a short header in the owner's language (who replied, which contract, link to /leases/<id>, a warning line if the sender is not a known tenant address), then the tenant's text; attachments forwarded as attachments (cap total 10 MB). Log this forward as type landlord_notification with metadata.kind 'tenant_reply_forward'.
  3. Unknown or invalid token: store nothing per lease; forward the raw message to FALLBACK owner address (env INBOUND_FALLBACK_TO, else ADMIN email) and return 200 so the worker does not retry. Duplicate Message-ID for the same lease: return 200, no new row.
  4. Auto-replies and bounces (Auto-Submitted header not 'no', Precedence bulk/auto_reply, MAILER-DAEMON, empty From): store with metadata.auto=true but do NOT forward to the managers.
- Web: in the contract communication history, inbound messages show as "Antwoord van huurder" (EN "Reply from tenant", FR "Réponse du locataire", DE "Antwort des Mieters") with an incoming icon, the sender, the text, attachment names, and an "unknown sender" badge when senderKnown is false. Counter of messages in the last 7 days counts outbound only. Add a filter option for replies. All strings EN/NL/FR/DE with proper accents, human tone, no dashes.
- Settings: none needed now; document env vars in .env.example (INBOUND_REPLY_SECRET, INBOUND_REPLY_DOMAIN, INBOUND_WEBHOOK_SECRET, INBOUND_FALLBACK_TO).

## Schema

- communications: add `direction` enum('outbound','inbound') NOT NULL DEFAULT 'outbound'; add 'tenant_reply' to the type enum (keep every existing value, including landlord_notification and due_date_sms).
- New table lease_reply_tokens (id varchar(36) pk, lease_id varchar(36) not null index, token varchar(40) not null unique, created_at timestamp default current_timestamp, revoked_at timestamp null).
- Write the prod DDL to `.planning/quick/261107-rpl-tenant-reply-address/prod-ddl.sql`. Never run db:generate. Code must not break if INBOUND_REPLY_SECRET is unset (no Reply-To, no token table access).

## Tests

- Token: stable per lease, unique, resolves back, rejects tampered tokens, local part <= 64.
- Outgoing reminder/indexation/custom email gets the Reply-To when enabled, none when disabled; landlord emails do not get the tenant reply address.
- Inbound route: bad secret 401; valid reply from a known tenant stores an inbound row with lease_id and forwards to manager to + cc with Reply-To = sender; unknown sender is stored with senderKnown false and forwarded with a warning; auto-reply stored, not forwarded; duplicate Message-ID ignored; unknown token goes to fallback; In-Reply-To links to the original communication.
- Lease communications endpoint returns inbound rows in "past" with direction.

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed); the worker type-checks (`npx tsc --noEmit` in its folder, or skip with a note if wrangler types cannot be installed offline).
- No em-dashes or en-dashes; no Co-Authored-By lines. Never deploy, never touch prod, never send messages, never run db:generate, never change Cloudflare.
