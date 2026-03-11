import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { jwtDecrypt } from "jose";
import { hkdf } from "@panva/hkdf";

const AUTH_SECRET = process.env.AUTH_SECRET || "";
const COOKIE_NAME = "__Secure-authjs.session-token";

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
async function decodeToken(token: string, cookieName: string): Promise<any | null> {
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

// Upsert user in DB
let db: any = null;
let usersTable: any = null;
let eq: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  usersTable = dbMod.users;
  eq = require("drizzle-orm").eq;
} catch {
  console.log("[Auth] Database unavailable for user upsert");
}

async function ensureUser(payload: any): Promise<string> {
  const jwtUserId = payload.sub || payload.id || crypto.randomUUID();
  if (!db || !usersTable) return jwtUserId;

  try {
    // First try to find user by email (NextAuth may use a different ID in the JWT vs DB)
    if (payload.email) {
      const byEmail = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, payload.email));

      if (byEmail.length > 0) {
        return byEmail[0].id;
      }
    }

    // Try by JWT sub ID
    const byId = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, jwtUserId));

    if (byId.length > 0) {
      return byId[0].id;
    }

    // User doesn't exist at all - create them
    await db.insert(usersTable).values({
      id: jwtUserId,
      name: payload.name || null,
      email: payload.email || `${jwtUserId}@unknown`,
      image: payload.picture || null,
    });
    console.log(`[Auth] Created user ${jwtUserId} (${payload.email})`);
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
      c.set("userEmail", payload.email);
      c.set("userName", payload.name);
    }
  }

  // Default to null if no auth (routes can check)
  if (!c.get("userId")) {
    c.set("userId", null);
  }

  await next();
}
