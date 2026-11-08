import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@rentular/db", () => ({ getDb: () => null, leaseReplyTokens: { token: "token", leaseId: "lease_id", revokedAt: "revoked_at", id: "id" } }));

import {
  buildReplyAddress,
  computeLeaseToken,
  parseReplyAddress,
  isReplyAddressEnabled,
  getLeaseReplyToken,
  resolveLeaseReplyToken,
  LEASE_TOKEN_LENGTH,
} from "../replyAddress";

const LEASE_A = "167863a8-e57e-45c6-ad5a-dc9e16c65e9d";
const LEASE_B = "267863a8-e57e-45c6-ad5a-dc9e16c65e9d";

type Row = { id: string; leaseId: string; token: string; revokedAt: Date | null };

/** Tiny fake of the drizzle calls replyAddress makes, keyed on the where value. */
function fakeDb(rows: Row[]) {
  const pick = (cond: unknown) => {
    const s = JSON.stringify(cond);
    return rows.filter((r) => s.includes(`"${r.token}"`) || s.includes(`"${r.leaseId}"`));
  };
  const chain = (cond: unknown) => {
    const result = pick(cond);
    const p = Promise.resolve(result) as Promise<Row[]> & { limit: (n: number) => Promise<Row[]> };
    p.limit = (n: number) => Promise.resolve(result.slice(0, n));
    return p;
  };
  return {
    select: () => ({ from: () => ({ where: (cond: unknown) => chain(cond) }) }),
    insert: () => ({
      values: async (v: { id: string; leaseId: string; token: string }) => {
        rows.push({ ...v, revokedAt: null });
      },
    }),
  } as never;
}

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ value }),
  and: (...parts: unknown[]) => ({ parts }),
  isNull: () => ({ isNull: true }),
}));

describe("reply address", () => {
  const prev = process.env.INBOUND_REPLY_SECRET;
  beforeEach(() => {
    process.env.INBOUND_REPLY_SECRET = "test-secret";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.INBOUND_REPLY_SECRET;
    else process.env.INBOUND_REPLY_SECRET = prev;
  });

  it("is stable per lease and different between leases", () => {
    expect(computeLeaseToken(LEASE_A)).toBe(computeLeaseToken(LEASE_A));
    expect(computeLeaseToken(LEASE_A)).not.toBe(computeLeaseToken(LEASE_B));
    expect(computeLeaseToken(LEASE_A, 1)).not.toBe(computeLeaseToken(LEASE_A, 0));
    expect(computeLeaseToken(LEASE_A)).toMatch(/^[a-z2-7]{20}$/);
  });

  it("carries no part of the lease id", () => {
    const token = computeLeaseToken(LEASE_A);
    expect(LEASE_A.replace(/-/g, "")).not.toContain(token.slice(0, 6));
  });

  it("keeps the local part within 64 characters and parses back", () => {
    const token = computeLeaseToken(LEASE_A);
    const addr = buildReplyAddress(token, "a1b2c3d4-0000-4000-8000-000000000000", "rentular.com");
    expect(addr).toBe(`reply+${token}.a1b2c3d4@rentular.com`);
    expect(addr.split("@")[0].length).toBeLessThanOrEqual(64);
    expect(parseReplyAddress(addr, "rentular.com")).toEqual({ leaseToken: token, messageTag: "a1b2c3d4" });
    expect(parseReplyAddress(`Reply+${token.toUpperCase()}@Rentular.com`)).toEqual({ leaseToken: token, messageTag: null });
  });

  it("rejects addresses that are not ours", () => {
    const token = computeLeaseToken(LEASE_A);
    expect(parseReplyAddress(`noreply@rentular.com`)).toBeNull();
    expect(parseReplyAddress(`reply+${token}@other.com`, "rentular.com")).toBeNull();
    expect(parseReplyAddress(`reply+${token.slice(1)}@rentular.com`)).toBeNull();
    expect(parseReplyAddress(`reply+${token}.abc@rentular.com`)).toBeNull();
    expect(parseReplyAddress(`reply+${token.slice(0, -1)}1@rentular.com`)).toBeNull();
  });

  it("is off without a secret", async () => {
    delete process.env.INBOUND_REPLY_SECRET;
    expect(isReplyAddressEnabled()).toBe(false);
    expect(await getLeaseReplyToken(LEASE_A, fakeDb([]))).toBeNull();
  });

  it("creates the token once and resolves it back to the lease", async () => {
    const rows: Row[] = [];
    const db = fakeDb(rows);
    const t1 = await getLeaseReplyToken(LEASE_A, db);
    const t2 = await getLeaseReplyToken(LEASE_A, db);
    expect(t1).toBe(t2);
    expect(rows).toHaveLength(1);
    expect(t1).toHaveLength(LEASE_TOKEN_LENGTH);
    expect(await resolveLeaseReplyToken(t1!, db)).toBe(LEASE_A);
  });

  it("rejects a tampered token, an unknown token and a revoked one", async () => {
    const token = computeLeaseToken(LEASE_A);
    const flipped = (token[0] === "a" ? "b" : "a") + token.slice(1);
    // A row whose token is not the HMAC of its lease (written by hand) does not route.
    const rows: Row[] = [
      { id: "1", leaseId: LEASE_A, token, revokedAt: null },
      { id: "2", leaseId: LEASE_B, token: flipped, revokedAt: null },
    ];
    expect(await resolveLeaseReplyToken(flipped, fakeDb(rows))).toBeNull();
    expect(await resolveLeaseReplyToken(computeLeaseToken(LEASE_B, 5), fakeDb(rows))).toBeNull();
    rows[0].revokedAt = new Date();
    expect(await resolveLeaseReplyToken(token, fakeDb(rows))).toBeNull();
  });

  it("issues the next generation after a revoke", async () => {
    const rows: Row[] = [{ id: "1", leaseId: LEASE_A, token: computeLeaseToken(LEASE_A), revokedAt: new Date() }];
    const db = fakeDb(rows);
    const fresh = await getLeaseReplyToken(LEASE_A, db);
    expect(fresh).toBe(computeLeaseToken(LEASE_A, 1));
    expect(await resolveLeaseReplyToken(fresh!, db)).toBe(LEASE_A);
  });
});
