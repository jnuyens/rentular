/**
 * Signed one-click snooze links for the daily indexation digest.
 *
 * Each link carries an HS256 JWT (signed with AUTH_SECRET) naming the lease,
 * the snooze option and the language of the confirmation page, with a 90-day
 * TTL. The link is the authentication: no login is needed. The action is
 * idempotent (it only stamps the snooze date), so a replayed link does no harm.
 *
 * The payload carries kind "indexation-snooze" so these tokens can never be
 * mistaken for a late-payment action token, and the other way round.
 */

import { SignJWT, jwtVerify } from "jose";
import { requireAuthSecret } from "./authSecret";

const ALG = "HS256";
const TTL = "90d";
const KIND = "indexation-snooze";

export type SnoozeOption = "1m" | "3m" | "yearly";
export const SNOOZE_OPTIONS: SnoozeOption[] = ["1m", "3m", "yearly"];

export type SnoozeLang = "en" | "nl" | "fr" | "de";
const LANGS: SnoozeLang[] = ["en", "nl", "fr", "de"];

export interface IndexationSnoozePayload {
  kind: "indexation-snooze";
  leaseId: string;
  snooze: SnoozeOption;
  lang: SnoozeLang;
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(requireAuthSecret());
}

/** Two-letter language for the confirmation page, English when unknown. */
export function normaliseSnoozeLang(lang: unknown): SnoozeLang {
  const key = typeof lang === "string" ? lang.slice(0, 2).toLowerCase() : "";
  return (LANGS as string[]).includes(key) ? (key as SnoozeLang) : "en";
}

export async function signIndexationSnoozeToken(input: {
  leaseId: string;
  snooze: SnoozeOption;
  lang: string;
}): Promise<string> {
  return new SignJWT({
    kind: KIND,
    leaseId: input.leaseId,
    snooze: input.snooze,
    lang: normaliseSnoozeLang(input.lang),
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(getSecret());
}

export async function verifyIndexationSnoozeToken(token: string): Promise<IndexationSnoozePayload> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
  if (payload.kind !== KIND) throw new Error("Invalid token kind");
  const snooze = payload.snooze as SnoozeOption;
  if (!SNOOZE_OPTIONS.includes(snooze)) throw new Error("Invalid snooze");
  const leaseId = payload.leaseId;
  if (typeof leaseId !== "string" || leaseId.length === 0) throw new Error("Invalid lease");
  return { kind: KIND, leaseId, snooze, lang: normaliseSnoozeLang(payload.lang) };
}
