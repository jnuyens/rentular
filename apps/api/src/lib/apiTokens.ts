/**
 * Personal Access Token service.
 *
 * A minted token is stored only as a peppered SHA-256 hash; the plaintext rtl_
 * value is returned to the caller exactly once and is never persisted, selected
 * again, or logged (T-11-01). Verification is an O(1) lookup on the UNIQUE
 * token_hash index (RESEARCH Pattern 1), with a constant-time final compare to
 * close any residual timing side channel (T-11-12).
 *
 * The server pepper lives only in process env (API_TOKEN_PEPPER), so a stolen
 * DB dump without the pepper yields no usable tokens (T-11-01b). The pepper is
 * read lazily on each call and fails closed, so the API still boots when PATs
 * are unused but refuses to mint or verify with a weak or empty pepper.
 */

import {
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { eq, and, or, isNull, gt, lt, desc } from "drizzle-orm";
import { getDb, apiTokens } from "@rentular/db";
import { API_TOKEN_PREFIX } from "@rentular/shared";
import type { ApiTokenScope, ApiTokenPublic } from "@rentular/shared";

const MIN_PEPPER_LENGTH = 16;
const TOUCH_THROTTLE_MS = 3_600_000; // update last_used_at at most once per hour

// Row shape returned from Drizzle for the private token columns.
interface TokenRow {
  id: string;
  name?: string;
  scope: ApiTokenScope;
  tokenHash?: string;
  createdAt?: Date | string | null;
  expiresAt?: Date | string | null;
  lastUsedAt?: Date | string | null;
}

// Fail closed: a dedicated env var (not HKDF from AUTH_SECRET) so the pepper can
// be rotated independently of session encryption. Evaluated lazily on each call.
export function requireApiTokenPepper(): string {
  const pepper = process.env.API_TOKEN_PEPPER || "";
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(
      "API_TOKEN_PEPPER must be set and at least 16 characters; refusing to mint or verify API tokens with a weak or empty pepper.",
    );
  }
  return pepper;
}

export function mintRawToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256")
    .update(requireApiTokenPepper())
    .update(raw)
    .digest("hex");
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toPublic(row: TokenRow): ApiTokenPublic {
  return {
    id: row.id,
    name: row.name ?? "",
    scope: row.scope,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    expiresAt: toIso(row.expiresAt),
    lastUsedAt: toIso(row.lastUsedAt),
  };
}

export async function mintToken(input: {
  userId: string;
  name: string;
  scope: ApiTokenScope;
  expiresInDays?: number;
}): Promise<{ token: string; record: ApiTokenPublic }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw new Error("Token name must be between 1 and 120 characters");
  }
  if (input.scope !== "read" && input.scope !== "write") {
    throw new Error("Token scope must be 'read' or 'write'");
  }

  const token = mintRawToken();
  const id = randomUUID();
  const now = new Date();
  const expiresAt =
    input.expiresInDays === undefined
      ? null
      : new Date(now.getTime() + input.expiresInDays * 86_400_000);

  await getDb()
    .insert(apiTokens)
    .values({
      id,
      userId: input.userId,
      name,
      tokenHash: hashToken(token),
      scope: input.scope,
      expiresAt,
    });

  const record: ApiTokenPublic = {
    id,
    name,
    scope: input.scope,
    createdAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    lastUsedAt: null,
  };

  return { token, record };
}

export async function findActiveTokenByHash(
  hash: string,
): Promise<{ id: string; userId: string; scope: ApiTokenScope } | null> {
  const rows = (await getDb()
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      scope: apiTokens.scope,
      tokenHash: apiTokens.tokenHash,
    })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, hash),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1)) as Array<{
    id: string;
    userId: string;
    scope: ApiTokenScope;
    tokenHash: string;
  }>;

  const row = rows[0];
  if (!row) return null;

  // Defensive constant-time compare even though the index lookup was exact.
  const stored = Buffer.from(row.tokenHash);
  const candidate = Buffer.from(hash);
  if (
    stored.length !== candidate.length ||
    !timingSafeEqual(stored, candidate)
  ) {
    return null;
  }

  return { id: row.id, userId: row.userId, scope: row.scope };
}

export async function listTokens(userId: string): Promise<ApiTokenPublic[]> {
  const rows = (await getDb()
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      scope: apiTokens.scope,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt))) as TokenRow[];

  return rows.map(toPublic);
}

export async function revokeToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const result = (await getDb()
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )) as Array<{ affectedRows?: number }>;

  return (result?.[0]?.affectedRows ?? 0) > 0;
}

// Fire-and-forget (RESEARCH Pattern 3): callers do not await the result on the
// request path, and a failed timestamp write never fails the request. Throttled
// to at most one write per hour per token.
export function touchLastUsed(tokenId: string): Promise<void> {
  const cutoff = new Date(Date.now() - TOUCH_THROTTLE_MS);
  return Promise.resolve(
    getDb()
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, cutoff)),
        ),
      ),
  )
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error("[ApiTokens] lastUsedAt update failed:", err);
    });
}
