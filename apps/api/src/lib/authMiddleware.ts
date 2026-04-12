import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { JWTPayload, jwtDecrypt } from "jose";
import { hkdf } from "@panva/hkdf";
import { eq } from "drizzle-orm";
import { getDb, users } from "@rentular/db";
import { notifyNewUserSignup } from "./adminNotify";

const AUTH_SECRET = process.env.AUTH_SECRET || "";
const COOKIE_NAME = "__Secure-authjs.session-token";
const db = getDb();

// Derive the encryption key exactly as Auth.js does
// See: @auth/core/jwt.js getDerivedEncryptionKey()
async function getDerivedEncryptionKey(secret: string, salt: string): Promise<Uint8Array> {
  // Auth.js uses A256CBC-HS512 which needs a 64-byte key
  return await hkdf(
    "sha256",
    secret,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
}

// Decode the NextAuth JWT from the cookie
async function decodeToken(token: string, cookieName: string): Promise<JWTPayload | null> {
  if (!AUTH_SECRET) {
    return null;
  }

  try {
    // salt = cookie name (same as Auth.js)
    const encryptionSecret = await getDerivedEncryptionKey(AUTH_SECRET, cookieName);
    const { payload } = await jwtDecrypt(token, encryptionSecret, {
      clockTolerance: 15,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256CBC-HS512", "A256GCM"],
    });
    return payload;
  } catch (err) {
    console.error("[Auth] Failed to decode token:", err);
    return null;
  }
}

async function ensureUser(payload: JWTPayload): Promise<string> {
  const jwtUserId =
    typeof payload.sub === "string"
      ? payload.sub
      : typeof payload.id === "string"
        ? payload.id
        : crypto.randomUUID();
  const email = typeof payload.email === "string" ? payload.email : null;
  const name = typeof payload.name === "string" ? payload.name : null;
  const image = typeof payload.picture === "string" ? payload.picture : null;

  try {
    // First try to find user by email (NextAuth may use a different ID in the JWT vs DB)
    if (email) {
      const byEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, email));

      if (byEmail.length > 0) {
        return byEmail[0].id;
      }
    }

    // Try by JWT sub ID
    const byId = await db
      .select()
      .from(users)
      .where(eq(users.id, jwtUserId));

    if (byId.length > 0) {
      return byId[0].id;
    }

    // User doesn't exist at all - create them
    await db.insert(users).values({
      id: jwtUserId,
      name,
      email: email || `${jwtUserId}@unknown`,
      image,
    });
    console.log(`[Auth] Created user ${jwtUserId} (${email})`);
    notifyNewUserSignup(email || `${jwtUserId}@unknown`, name || undefined, "oauth");
    return jwtUserId;
  } catch (err) {
    console.error("[Auth] User upsert failed:", err);
  }

  return jwtUserId;
}

// Hono middleware: extract user from NextAuth JWT cookie
export async function authMiddleware(c: Context, next: Next) {
  const secureCookie = getCookie(c, COOKIE_NAME);
  const plainCookie = getCookie(c, "authjs.session-token");
  const token = secureCookie || plainCookie;
  const cookieName = secureCookie ? COOKIE_NAME : "authjs.session-token";

  if (token) {
    const payload = await decodeToken(token, cookieName);
    if (payload) {
      const userId = await ensureUser(payload);
      c.set("userId", userId);
      c.set("userEmail", typeof payload.email === "string" ? payload.email : null);
      c.set("userName", typeof payload.name === "string" ? payload.name : null);
    }
  }

  // Default to null if no auth (routes can check)
  if (!c.get("userId")) {
    c.set("userId", null);
  }

  await next();
}
