/**
 * Per-contract reply address for tenant email: reply+<token>[.<msg>]@domain.
 *
 * The token is an HMAC (INBOUND_REPLY_SECRET) over the lease id, in lowercase
 * base32, so it is stable per lease and carries no readable data. The
 * lease_reply_tokens table maps it back to the lease, which also makes a token
 * revocable: a revoked token no longer routes, and the next outgoing email gets
 * a fresh one (HMAC over the lease id and the next generation number).
 *
 * The optional ".<msg>" part is the first 8 characters of the outgoing
 * communication id, so a reply can be linked to the exact message it answers.
 *
 * The feature is off when INBOUND_REPLY_SECRET is unset: no Reply-To header
 * and no access to the token table, so self-hosted setups keep plain mail.
 */
import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, leaseReplyTokens } from "@rentular/db";

type Db = ReturnType<typeof getDb>;

export const REPLY_PREFIX = "reply+";
export const LEASE_TOKEN_LENGTH = 20; // 100 bits
export const MESSAGE_TAG_LENGTH = 8;
const MAX_LOCAL_PART = 64;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function isReplyAddressEnabled(): boolean {
  return !!process.env.INBOUND_REPLY_SECRET;
}

export function replyDomain(): string {
  return (process.env.INBOUND_REPLY_DOMAIN || "rentular.com").trim().toLowerCase();
}

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The token of a lease for a generation (0 unless earlier tokens were revoked). */
export function computeLeaseToken(leaseId: string, generation = 0, secret = process.env.INBOUND_REPLY_SECRET || ""): string {
  if (!secret) throw new Error("INBOUND_REPLY_SECRET is not set");
  const mac = crypto.createHmac("sha256", secret).update(`lease-reply:${leaseId}:${generation}`).digest();
  return base32(mac).slice(0, LEASE_TOKEN_LENGTH);
}

/** reply+<token>[.<msg>]@domain. The local part stays within 64 characters. */
export function buildReplyAddress(leaseToken: string, communicationId?: string | null, domain = replyDomain()): string {
  const tag = communicationId
    ? communicationId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, MESSAGE_TAG_LENGTH)
    : "";
  const local = `${REPLY_PREFIX}${leaseToken}${tag ? `.${tag}` : ""}`;
  if (local.length > MAX_LOCAL_PART) throw new Error("reply address local part too long");
  return `${local}@${domain}`;
}

export interface ParsedReplyAddress {
  leaseToken: string;
  messageTag: string | null;
}

/**
 * Read the token out of a reply address. Returns null for anything that is not
 * exactly our format (wrong prefix, wrong characters or length, other domain
 * when a domain is given).
 */
export function parseReplyAddress(address: string | null | undefined, domain?: string): ParsedReplyAddress | null {
  if (!address) return null;
  const clean = address.trim().toLowerCase().replace(/^<|>$/g, "");
  const at = clean.lastIndexOf("@");
  if (at <= 0) return null;
  const local = clean.slice(0, at);
  const host = clean.slice(at + 1);
  if (domain && host !== domain.toLowerCase()) return null;
  if (local.length > MAX_LOCAL_PART || !local.startsWith(REPLY_PREFIX)) return null;
  const m = /^([a-z2-7]+)(?:\.([a-z0-9]+))?$/.exec(local.slice(REPLY_PREFIX.length));
  if (!m || m[1].length !== LEASE_TOKEN_LENGTH) return null;
  if (m[2] && m[2].length !== MESSAGE_TAG_LENGTH) return null;
  return { leaseToken: m[1], messageTag: m[2] ?? null };
}

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * The live token of a lease, created on first use. Returns null when the
 * feature is off or the table cannot be reached (the email then goes out
 * without a Reply-To rather than not at all).
 */
export async function getLeaseReplyToken(leaseId: string, db: Db = getDb()): Promise<string | null> {
  if (!isReplyAddressEnabled()) return null;
  try {
    const rows = await db
      .select({ token: leaseReplyTokens.token, revokedAt: leaseReplyTokens.revokedAt })
      .from(leaseReplyTokens)
      .where(eq(leaseReplyTokens.leaseId, leaseId));
    const live = rows.find((r) => !r.revokedAt);
    if (live) return live.token;
    const token = computeLeaseToken(leaseId, rows.length);
    try {
      await db.insert(leaseReplyTokens).values({ id: crypto.randomUUID(), leaseId, token });
    } catch (err) {
      // Two emails for the same lease at once: the other insert won, same token.
      const again = await db
        .select({ token: leaseReplyTokens.token })
        .from(leaseReplyTokens)
        .where(and(eq(leaseReplyTokens.token, token), isNull(leaseReplyTokens.revokedAt)))
        .limit(1);
      if (!again[0]) throw err;
    }
    return token;
  } catch (err) {
    console.error(`[ReplyAddress] could not get the reply token for lease ${leaseId}:`, err);
    return null;
  }
}

/**
 * Resolve a token to its lease. The row must exist and not be revoked, and the
 * token must be the HMAC of that lease for one of its generations, so a token
 * that was edited by hand or written straight into the table does not route.
 */
export async function resolveLeaseReplyToken(token: string, db: Db = getDb()): Promise<string | null> {
  if (!isReplyAddressEnabled()) return null;
  if (!/^[a-z2-7]+$/.test(token) || token.length !== LEASE_TOKEN_LENGTH) return null;
  const row = (
    await db
      .select({ leaseId: leaseReplyTokens.leaseId, revokedAt: leaseReplyTokens.revokedAt })
      .from(leaseReplyTokens)
      .where(eq(leaseReplyTokens.token, token))
      .limit(1)
  )[0];
  if (!row || row.revokedAt) return null;
  const generations = await db
    .select({ id: leaseReplyTokens.id })
    .from(leaseReplyTokens)
    .where(eq(leaseReplyTokens.leaseId, row.leaseId));
  for (let g = 0; g < Math.max(1, generations.length); g++) {
    if (sameToken(computeLeaseToken(row.leaseId, g), token)) return row.leaseId;
  }
  return null;
}

/**
 * Reply-To address and Message-ID for an outgoing tenant email of a lease, or
 * null when the feature is off or no token could be had.
 */
export async function replyHeadersFor(
  leaseId: string,
  communicationId: string,
  db?: Db,
): Promise<{ replyTo: string; messageId: string } | null> {
  const token = await getLeaseReplyToken(leaseId, db);
  if (!token) return null;
  return {
    replyTo: buildReplyAddress(token, communicationId),
    messageId: `<${communicationId}@${replyDomain()}>`,
  };
}
