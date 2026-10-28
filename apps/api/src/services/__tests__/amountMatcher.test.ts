/**
 * Tests for the unique-amount auto-assign matcher decision logic:
 *   - a unique amount with one lease due in the window assigns and learns the
 *     sender account
 *   - two leases with the same rent due in the window: no assign
 *   - two unmatched transfers of the same amount in the window: no assign
 *   - a known tenant IBAN is left to the IBAN pass
 *   - a transfer from the owner's own account is skipped
 *   - pending rent due outside the window: no assign
 *   - debits are ignored
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findCandidateLeasesByIban = vi.fn<
  (...a: unknown[]) => Promise<Array<{ leaseId: string; monthlyRent: string }>>
>(async () => []);
const learnTenantAccountFromStatement = vi.fn<
  (...a: unknown[]) => Promise<void>
>(async () => undefined);
const assignStatementToLease = vi.fn<
  (...a: unknown[]) => Promise<{ paymentId: string; created: boolean } | null>
>(async () => ({ paymentId: "pay", created: false }));
const expectedAmountsForLease = vi.fn<
  (db: unknown, leaseId: string, monthlyRent: string) => Promise<number[]>
>(async (_db, _leaseId, monthlyRent) => [Number(monthlyRent)]);

vi.mock("../tenantBankAccounts", () => ({
  normalizeIban: (v: string | null | undefined) =>
    (v || "").replace(/\s+/g, "").toUpperCase(),
  findCandidateLeasesByIban: (...a: unknown[]) =>
    findCandidateLeasesByIban(...a),
  learnTenantAccountFromStatement: (...a: unknown[]) =>
    learnTenantAccountFromStatement(...a),
}));
vi.mock("../reconciliationAssign", () => ({
  assignStatementToLease: (...a: unknown[]) => assignStatementToLease(...a),
}));
vi.mock("../ibanMatcher", () => ({
  expectedAmountsForLease: (db: unknown, leaseId: string, monthlyRent: string) =>
    expectedAmountsForLease(db, leaseId, monthlyRent),
}));
// The "encrypted" field holds the plaintext IBAN in these tests.
vi.mock("../../lib/bankTransactionView", () => ({
  decryptOrNull: (enc: string | null, iv: string | null, tag: string | null) =>
    enc && iv && tag ? enc : null,
}));

const bankStatements = {
  __t: "bank_statements",
  id: "id",
  connectionId: "connectionId",
  matchStatus: "matchStatus",
  amount: "amount",
  bookingDate: "bookingDate",
  counterpartyIbanEncrypted: "counterpartyIbanEncrypted",
  counterpartyIbanIv: "counterpartyIbanIv",
  counterpartyIbanAuthTag: "counterpartyIbanAuthTag",
};
const bankConnections = {
  __t: "bank_connections",
  id: "id",
  ownerId: "ownerId",
  iban: "iban",
};
const bankAccounts = { __t: "bank_accounts", ownerId: "ownerId", iban: "iban" };
const leases = {
  __t: "leases",
  id: "id",
  ownerId: "ownerId",
  status: "status",
  monthlyRent: "monthlyRent",
};
const payments = {
  __t: "payments",
  leaseId: "leaseId",
  status: "status",
  dueDate: "dueDate",
  notes: "notes",
  amount: "amount",
};

type Row = Record<string, unknown>;

let connectionStatements: Row[] = [];
let ownerStatements: Row[] | null = null;
let ownIbanRows: Array<{ iban: string | null }> = [];
let ownAccountRows: Array<{ iban: string }> = [];
let pendingRows: Array<{
  leaseId: string;
  monthlyRent: string;
  dueDate: string;
  notes: string | null;
}> = [];

function rowsFor(t: unknown, joined: unknown): unknown[] {
  if (t === bankStatements && joined === bankConnections) {
    return ownerStatements ?? connectionStatements;
  }
  if (t === bankStatements) return connectionStatements;
  if (t === bankConnections) return ownIbanRows;
  if (t === bankAccounts) return ownAccountRows;
  if (t === payments && joined === leases) return pendingRows;
  return [];
}

function chain(t: unknown) {
  return {
    where: () => Promise.resolve(rowsFor(t, null)),
    innerJoin: (t2: unknown) => ({
      where: () => Promise.resolve(rowsFor(t, t2)),
    }),
  };
}

const fakeDb = {
  select: () => ({ from: (t: unknown) => chain(t) }),
};

vi.mock("@rentular/db", () => ({
  getDb: () => fakeDb,
  bankStatements,
  bankConnections,
  bankAccounts,
  leases,
  payments,
  rentDeductions: { __t: "rent_deductions" },
  rentFreePeriods: { __t: "rent_free_periods" },
}));

function stmt(
  id: string,
  amount: string,
  iban: string | null,
  bookingDate = "2026-10-27",
): Row {
  return {
    id,
    amount,
    bookingDate,
    externalTransactionId: `ext-${id}`,
    counterpartyIbanEncrypted: iban,
    counterpartyIbanIv: iban ? "x" : null,
    counterpartyIbanAuthTag: iban ? "x" : null,
    counterpartyNameEncrypted: null,
    counterpartyNameIv: null,
    counterpartyNameAuthTag: null,
    matchStatus: "unmatched",
  };
}

function rent(leaseId: string, monthlyRent: string, dueDate: string) {
  return { leaseId, monthlyRent, dueDate, notes: null };
}

async function run() {
  const { autoAssignByAmount } = await import("../amountMatcher");
  return autoAssignByAmount(fakeDb as never, "owner-1", "conn-1");
}

beforeEach(() => {
  vi.resetModules();
  findCandidateLeasesByIban.mockClear();
  learnTenantAccountFromStatement.mockClear();
  assignStatementToLease.mockClear();
  expectedAmountsForLease.mockClear();
  connectionStatements = [];
  ownerStatements = null;
  ownIbanRows = [];
  ownAccountRows = [];
  pendingRows = [];
});

describe("autoAssignByAmount", () => {
  it("assigns a unique amount and learns the sender account", async () => {
    const s = stmt("1", "499.00", "BE11000000000011");
    connectionStatements = [s];
    pendingRows = [rent("L1", "499.00", "2026-11-01")];
    const n = await run();
    expect(n).toBe(1);
    expect(assignStatementToLease).toHaveBeenCalledTimes(1);
    expect(assignStatementToLease.mock.calls[0]![2]).toBe("L1");
    expect(assignStatementToLease.mock.calls[0]![3]).toContain(
      "Auto-assigned by unique amount from bank transfer ext-1",
    );
    expect(learnTenantAccountFromStatement).toHaveBeenCalledTimes(1);
    expect(learnTenantAccountFromStatement.mock.calls[0]![1]).toMatchObject({
      leaseId: "L1",
      statement: s,
    });
  });

  it("does not assign when two leases have the same rent due in the window", async () => {
    connectionStatements = [stmt("1", "499.00", "BE11000000000011")];
    pendingRows = [
      rent("L1", "499.00", "2026-11-01"),
      rent("L2", "499.00", "2026-11-05"),
    ];
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).not.toHaveBeenCalled();
    expect(learnTenantAccountFromStatement).not.toHaveBeenCalled();
  });

  it("does not assign when two unmatched transfers share the amount in the window", async () => {
    connectionStatements = [
      stmt("1", "499.00", "BE11000000000011"),
      stmt("2", "499.00", null, "2026-10-29"),
    ];
    ownerStatements = [
      ...connectionStatements,
      stmt("3", "499.00", "BE22000000000022", "2026-10-20"),
    ];
    pendingRows = [rent("L1", "499.00", "2026-11-01")];
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).not.toHaveBeenCalled();
  });

  it("skips a known tenant IBAN", async () => {
    connectionStatements = [stmt("1", "499.00", "BE11000000000011")];
    pendingRows = [rent("L1", "499.00", "2026-11-01")];
    findCandidateLeasesByIban.mockResolvedValueOnce([
      { leaseId: "L9", monthlyRent: "499.00" },
    ]);
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).not.toHaveBeenCalled();
    expect(expectedAmountsForLease).not.toHaveBeenCalled();
  });

  it("skips the owner's own IBAN", async () => {
    connectionStatements = [
      stmt("1", "499.00", "BE11000000000011"),
      stmt("2", "499.00", "BE33000000000033"),
    ];
    ownIbanRows = [{ iban: "BE11 0000 0000 0011" }];
    ownAccountRows = [{ iban: "be33000000000033" }];
    pendingRows = [rent("L1", "499.00", "2026-11-01")];
    const n = await run();
    expect(n).toBe(0);
    expect(findCandidateLeasesByIban).not.toHaveBeenCalled();
    expect(assignStatementToLease).not.toHaveBeenCalled();
  });

  it("does not assign when the only pending rent is due outside the window", async () => {
    // Booking 2026-10-27 gives the window 2026-09-12 to 2026-12-01.
    connectionStatements = [stmt("1", "499.00", "BE11000000000011")];
    pendingRows = [rent("L1", "499.00", "2026-12-15")];
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).not.toHaveBeenCalled();
    expect(expectedAmountsForLease).not.toHaveBeenCalled();
  });

  it("ignores debits", async () => {
    connectionStatements = [stmt("1", "-499.00", "BE11000000000011")];
    pendingRows = [rent("L1", "499.00", "2026-11-01")];
    const n = await run();
    expect(n).toBe(0);
    expect(findCandidateLeasesByIban).not.toHaveBeenCalled();
    expect(expectedAmountsForLease).not.toHaveBeenCalled();
    expect(assignStatementToLease).not.toHaveBeenCalled();
  });
});
