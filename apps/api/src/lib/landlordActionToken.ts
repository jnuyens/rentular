/**
 * Signed one-click "magic link" tokens for the late-payment landlord email.
 *
 * Each link carries an HS256 JWT (signed with AUTH_SECRET) encoding the action
 * and the target payment, with a 21-day TTL. The links are the authentication:
 * no login is needed. Actions are idempotent (mark paid, acknowledge, remind,
 * turn off) so a replayed link within its TTL does no harm.
 */

import { SignJWT, jwtVerify } from "jose";
import { requireAuthSecret } from "./authSecret";

const ALG = "HS256";
const TTL = "21d";

export type LandlordAction = "paid" | "wait" | "remind" | "off";

const ACTIONS: LandlordAction[] = ["paid", "wait", "remind", "off"];

function getSecret(): Uint8Array {
  return new TextEncoder().encode(requireAuthSecret());
}

export async function signLandlordActionToken(
  action: LandlordAction,
  paymentId: string,
): Promise<string> {
  return new SignJWT({ action, paymentId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(getSecret());
}

export async function verifyLandlordActionToken(
  token: string,
): Promise<{ action: LandlordAction; paymentId: string }> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
  const action = payload.action as LandlordAction;
  if (!ACTIONS.includes(action)) {
    throw new Error("Invalid action");
  }
  return { action, paymentId: String(payload.paymentId) };
}
