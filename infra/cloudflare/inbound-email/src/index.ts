/**
 * Cloudflare Email Worker for the rentular.com catch-all.
 *
 * reply+<token>@rentular.com: the raw message is posted to the Rentular API,
 * which files it on the contract and passes it on to the managers. When the
 * API does not answer 2xx (down, timeout, forward failed), the message is
 * forwarded to FALLBACK_FORWARD instead, so nothing is lost.
 *
 * Every other address keeps the old catch-all behaviour: forward to
 * FALLBACK_FORWARD.
 */

export interface Env {
  /** Base URL of the site, e.g. https://rentular.com (the API lives under /api/v1). */
  API_URL: string;
  /** Verified destination address in Email Routing. */
  FALLBACK_FORWARD: string;
  /** Shared secret, set with `wrangler secret put INBOUND_WEBHOOK_SECRET`. */
  INBOUND_WEBHOOK_SECRET: string;
}

const MAX_RAW_BYTES = 10 * 1024 * 1024;
const API_TIMEOUT_MS = 25_000;

export function isReplyAddress(address: string): boolean {
  return address.trim().toLowerCase().startsWith("reply+");
}

async function postToApi(message: ForwardableEmailMessage, env: Env): Promise<boolean> {
  if (!env.API_URL || !env.INBOUND_WEBHOOK_SECRET) return false;
  const raw = await new Response(message.raw).arrayBuffer();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.API_URL.replace(/\/$/, "")}/api/v1/inbound/email`, {
      method: "POST",
      headers: {
        "content-type": "message/rfc822",
        "x-inbound-secret": env.INBOUND_WEBHOOK_SECRET,
        "x-inbound-recipient": message.to,
        "x-inbound-sender": message.from,
      },
      body: raw,
      signal: controller.signal,
    });
    if (!res.ok) console.log(`inbound API answered ${res.status} for ${message.to}`);
    return res.ok;
  } catch (err) {
    console.log(`inbound API unreachable for ${message.to}: ${String(err)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!isReplyAddress(message.to)) {
      await message.forward(env.FALLBACK_FORWARD);
      return;
    }
    if (message.rawSize > MAX_RAW_BYTES) {
      console.log(`reply to ${message.to} is ${message.rawSize} bytes, forwarding to the fallback`);
      await message.forward(env.FALLBACK_FORWARD);
      return;
    }
    const delivered = await postToApi(message, env);
    if (!delivered) await message.forward(env.FALLBACK_FORWARD);
  },
};
