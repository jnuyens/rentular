/**
 * Wave 0 RED test (API-01, T-11-01) for the personal-access-token service.
 *
 * Pins the secure contract for apps/api/src/lib/apiTokens.ts (implemented in
 * Plan 02): a minted token is stored only as a peppered SHA-256 hash, the
 * plaintext is returned once and never persisted or echoed in the public
 * record, lookups are scoped to non-revoked rows, and revoke/touch are scoped
 * to the owner and fail safe.
 *
 * Expected RED until Plan 02 lands ../apiTokens. The module is loaded through a
 * non-literal specifier so tsc stays green before the file exists; at runtime
 * the import rejects (module missing) and every case fails, which is correct
 * for this foundation plan.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const eqMock = vi.fn((col: string, val: unknown) => ({ op: "eq", col, val }));
const andMock = vi.fn((...conds: unknown[]) => ({ op: "and", conds }));
const orMock = vi.fn((...conds: unknown[]) => ({ op: "or", conds }));
const isNullMock = vi.fn((col: string) => ({ op: "isNull", col }));
const gtMock = vi.fn((col: string, val: unknown) => ({ op: "gt", col, val }));
const ltMock = vi.fn((col: string, val: unknown) => ({ op: "lt", col, val }));
const sqlMock = vi.fn((..._args: unknown[]) => ({ op: "sql" }));

const inserted: Array<Record<string, unknown>> = [];
let resultQueue: unknown[][] = [];
let rejectNext = false;

function nextResult(): unknown[] {
  return resultQueue.length ? (resultQueue.shift() as unknown[]) : [];
}

function chainable(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        if (rejectNext) {
          rejectNext = false;
          const r = Promise.reject(new Error("db down"));
          return r.then.bind(r);
        }
        const r = Promise.resolve(nextResult());
        return r.then.bind(r);
      }
      if (prop === "catch" || prop === "finally") {
        const r = Promise.resolve(nextResult());
        return (r as any)[prop].bind(r);
      }
      if (prop === "values") {
        return (v: Record<string, unknown>) => {
          inserted.push(v);
          return chainable();
        };
      }
      return () => chainable();
    },
  });
}

vi.mock("@rentular/db", () => {
  const apiTokens = {
    id: "id",
    userId: "user_id",
    name: "name",
    tokenHash: "token_hash",
    scope: "scope",
    expiresAt: "expires_at",
    lastUsedAt: "last_used_at",
    revokedAt: "revoked_at",
    createdAt: "created_at",
    __table: "api_tokens",
  };
  const fakeDb = {
    select: () => chainable(),
    insert: () => chainable(),
    update: () => chainable(),
    delete: () => chainable(),
  };
  return { apiTokens, getDb: vi.fn(() => fakeDb) };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => eqMock(col, val),
  and: (...conds: unknown[]) => andMock(...conds),
  or: (...conds: unknown[]) => orMock(...conds),
  isNull: (col: string) => isNullMock(col),
  gt: (col: string, val: unknown) => gtMock(col, val),
  lt: (col: string, val: unknown) => ltMock(col, val),
  sql: (...args: unknown[]) => sqlMock(...args),
}));

// Non-literal specifier: tsc cannot resolve it, so `lint` stays green before
// Plan 02 creates the module. At runtime this rejects until the file exists.
const apiTokensSpec: string = "../apiTokens";
async function loadApiTokens(): Promise<any> {
  return import(apiTokensSpec);
}

beforeEach(() => {
  vi.resetModules();
  eqMock.mockClear();
  andMock.mockClear();
  orMock.mockClear();
  isNullMock.mockClear();
  gtMock.mockClear();
  ltMock.mockClear();
  sqlMock.mockClear();
  inserted.length = 0;
  resultQueue = [];
  rejectNext = false;
  process.env.API_TOKEN_PEPPER = "0123456789abcdef0123456789abcdef"; // 32 chars
});

describe("apiTokens service — mint / hash (API-01, T-11-01)", () => {
  it("mintRawToken returns an rtl_ prefixed 47-char token and each call differs", async () => {
    const { mintRawToken } = await loadApiTokens();
    const a = mintRawToken();
    const b = mintRawToken();
    expect(a.startsWith("rtl_")).toBe(true);
    expect(a).toHaveLength(47); // 4 prefix + 43 base64url chars
    expect(a).not.toBe(b);
  });

  it("hashToken returns 64 lowercase hex, is deterministic, and changes with the pepper", async () => {
    const { hashToken } = await loadApiTokens();
    const raw = "rtl_example_raw_token_value";
    const h1 = hashToken(raw);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).toBe(h1);
    process.env.API_TOKEN_PEPPER = "ffffffffffffffffffffffffffffffff";
    expect(hashToken(raw)).not.toBe(h1);
  });

  it("requireApiTokenPepper fails closed when the pepper is unset or too short", async () => {
    const { requireApiTokenPepper } = await loadApiTokens();
    delete process.env.API_TOKEN_PEPPER;
    expect(() => requireApiTokenPepper()).toThrow();
    process.env.API_TOKEN_PEPPER = "tooshort"; // 8 chars < 16
    expect(() => requireApiTokenPepper()).toThrow();
    process.env.API_TOKEN_PEPPER = "0123456789abcdef0123456789abcdef";
    expect(typeof requireApiTokenPepper()).toBe("string");
  });
});

describe("apiTokens service — persistence excludes plaintext (API-01, T-11-01)", () => {
  it("mintToken stores only the hash and never returns tokenHash or plaintext in the record", async () => {
    const { mintToken, hashToken } = await loadApiTokens();
    const { token, record } = await mintToken({
      userId: "user-A",
      name: "Claude",
      scope: "write",
    });
    expect(token.startsWith("rtl_")).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.tokenHash).toBe(hashToken(token));
    expect(inserted[0]!.scope).toBe("write");
    expect(inserted[0]!.expiresAt ?? null).toBeNull();
    // The public record must never carry the hash or the plaintext.
    expect(Object.prototype.hasOwnProperty.call(record, "tokenHash")).toBe(false);
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.scope).toBe("write");
  });

  it("mintToken sets expiresAt roughly now + N days when expiresInDays is given", async () => {
    const { mintToken } = await loadApiTokens();
    const before = Date.now();
    await mintToken({ userId: "user-A", name: "Claude", scope: "read", expiresInDays: 90 });
    const stored = inserted[0]!.expiresAt;
    const ms = stored instanceof Date ? stored.getTime() : new Date(String(stored)).getTime();
    const expected = before + 90 * 86_400_000;
    expect(Math.abs(ms - expected)).toBeLessThan(5 * 60_000); // within 5 minutes
  });
});

describe("apiTokens service — lookup / revoke / touch scoping", () => {
  it("findActiveTokenByHash filters on token_hash and revoked_at IS NULL and returns null when absent", async () => {
    const { findActiveTokenByHash } = await loadApiTokens();
    resultQueue = [[]]; // no row
    const result = await findActiveTokenByHash("deadbeef");
    expect(result).toBeNull();
    expect(eqMock.mock.calls.some(([col]) => col === "token_hash")).toBe(true);
    expect(isNullMock.mock.calls.some(([col]) => col === "revoked_at")).toBe(true);
  });

  it("revokeToken scopes the update by user_id and returns false when nothing was affected", async () => {
    const { revokeToken } = await loadApiTokens();
    resultQueue = [[{ affectedRows: 0 }]];
    const ok = await revokeToken("user-A", "tok-9");
    expect(ok).toBe(false);
    expect(eqMock.mock.calls.some(([col, val]) => col === "user_id" && val === "user-A")).toBe(true);
  });

  it("touchLastUsed throttles on last_used_at and never throws even if the db rejects", async () => {
    const { touchLastUsed } = await loadApiTokens();
    rejectNext = true;
    await expect(touchLastUsed("tok-1")).resolves.not.toThrow();
    const touchedLastUsed =
      orMock.mock.calls.some((c) => JSON.stringify(c).includes("last_used_at")) ||
      ltMock.mock.calls.some(([col]) => col === "last_used_at") ||
      isNullMock.mock.calls.some(([col]) => col === "last_used_at");
    expect(touchedLastUsed).toBe(true);
  });
});
