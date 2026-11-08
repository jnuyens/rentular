# Inbound email worker

Cloudflare Email Worker for the rentular.com catch-all.

- `reply+<token>@rentular.com`: the raw message (up to 10 MB) is posted to
  `POST ${API_URL}/api/v1/inbound/email` with the header `X-Inbound-Secret`.
  The API files the reply on the contract and passes it on to the property's
  managers. If the API answers anything other than 2xx, or cannot be reached
  within 25 seconds, the message goes to `FALLBACK_FORWARD` instead.
- Any other address: forwarded to `FALLBACK_FORWARD`, as the catch-all does today.

No dependencies. `src/cloudflare.d.ts` declares the few runtime types used, so
`npx tsc --noEmit -p .` works offline.

## Deploy

1. Pick a long random secret, for example `openssl rand -hex 32`.
2. On the API host, set in `.env`:
   - `INBOUND_WEBHOOK_SECRET=<that secret>`
   - `INBOUND_REPLY_SECRET=<another random secret>` (signs the reply tokens; turns the Reply-To on)
   - optional `INBOUND_REPLY_DOMAIN=rentular.com`, `INBOUND_FALLBACK_TO=<address>`
   Then restart the API.
3. In this folder:
   ```sh
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put INBOUND_WEBHOOK_SECRET   # paste the same secret
   ```
   `FALLBACK_FORWARD` must be a verified destination address in Email Routing
   (jnuyens@gmail.com already is).
4. In the Cloudflare dashboard: rentular.com, Email, Email Routing, Routing
   rules. Edit the Catch-all address rule: action "Send to a Worker",
   destination `rentular-inbound-email`. Save. Leave explicit custom address
   rules (if any) as they are; they keep working.
5. Test: reply to a reminder sent after step 2 and check that the reply shows
   on the contract page and reaches the managers. Send a mail to
   `test@rentular.com` and check that it still arrives at the fallback.

To roll back, set the catch-all action back to "Send to an email" with the
old destination. Replies to reply+ addresses then land in that mailbox again.

## Notes

- The worker reads `message.raw` before it may call `message.forward()`.
  Cloudflare allows forwarding after reading the body; check it once with the
  API stopped (step 5 with the API down should still deliver to the fallback).
- `message.setReject` is never used, so a sender never gets a bounce from us.
