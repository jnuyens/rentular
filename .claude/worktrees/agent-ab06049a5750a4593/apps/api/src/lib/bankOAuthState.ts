/**
 * JWT helper for OAuth state tokens used by Phase 9 bank-connection flow.
 *
 * The state token is the CSRF + replay defense on the Ponto Connect OAuth
 * callback (T-09-02-01, T-09-02-06). It MUST be signed with AUTH_SECRET and
 * carry a short TTL so that:
 *   - the redirect attacker cannot forge a callback (HS256 signature gate)
 *   - a replay attack is bounded by the 10-minute exp window
 *   - each consent request gets a unique nonce
 *
 * The token is consumed by the callback route handler (Plan 03 Task 2).
 */

import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

const ALG = "HS256";
const TTL = "10m";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) {
    console.log(
      "[BankOAuthState] WARNING: AUTH_SECRET is empty; OAuth state tokens are not secure"
    );
  }
  return new TextEncoder().encode(secret);
}

export interface OAuthStatePayload {
  ownerId: string;
  institutionId?: string;
  connectionId?: string;
  nonce: string;
}

/**
 * Sign an OAuth state JWT. A fresh UUID nonce is stamped on every call so
 * that two simultaneous consent requests by the same owner do not produce
 * identical state tokens.
 */
export async function signOAuthState(
  payload: Omit<OAuthStatePayload, "nonce">
): Promise<string> {
  const fullPayload: OAuthStatePayload = {
    ...payload,
    nonce: randomUUID(),
  };
  return new SignJWT({ ...fullPayload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(getSecret());
}

/**
 * Verify an OAuth state JWT. Throws if the signature is invalid, the token
 * is expired, or the alg header does not match HS256.
 */
export async function verifyOAuthState(
  token: string
): Promise<OAuthStatePayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: [ALG],
  });
  return {
    ownerId: String(payload.ownerId),
    institutionId: payload.institutionId
      ? String(payload.institutionId)
      : undefined,
    connectionId: payload.connectionId
      ? String(payload.connectionId)
      : undefined,
    nonce: String(payload.nonce),
  };
}
