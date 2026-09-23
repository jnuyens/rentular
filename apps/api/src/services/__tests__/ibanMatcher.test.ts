/**
 * Tests for the IBAN auto-assign matcher decision logic:
 *   - a known IBAN mapping to one active lease auto-assigns
 *   - a known IBAN mapping to several leases disambiguates by amount, and only
 *     assigns when exactly one lease's expected amount matches (the
 *     parent-paying-two-student-rooms case)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findCandidateLeasesByIban = vi.fn();
const assignStatementToLease = vi.fn(async () => ({
  paymentId: "pay",
  created: false,
}));

vi.mock("../tenantBankAccounts", () => ({
  normalizeIban: (v: string) => (v || "").replace(/\s+/g, "").toUpperCase(),
  findCandidateLeasesByIban: (...a: unknown[]) =>
    findCandidateLeasesByIban(...a),
}));
vi.mock("../reconciliationAssign", () => ({
  assignStatementToLease: (...a: unknown[]) => assignStatementToLease(...a),
}));
// Always decrypt to the same known IBAN; candidate lookup is mocked anyway.
vi.mock("../../lib/bankTransactionView", () => ({
  decryptOrNull: () => "BE68539007547034",
}));

const bankStatements = { __t: "bank_statements" };
const payments = { __t: "payments" };

let statements: Array<Record<string, unknown>> = [];

const fakeDb = {
  select: () => ({
    from: (t: unknown) => ({
      where: () => {
        if (t === bankStatements) return Promise.resolve(statements);
        // payments "oldest pending" query: no pending -> falls back to rent.
        return { orderBy: () => ({ limit: () => Promise.resolve([]) }) };
      },
    }),
  }),
};

vi.mock("@rentular/db", () => ({
  getDb: () => fakeDb,
  bankStatements,
  payments,
}));

function stmt(amount: string) {
  return {
    id: "stmt-1",
    amount,
    bookingDate: "2026-08-04",
    externalTransactionId: "ext-1",
    counterpartyIbanEncrypted: null,
    counterpartyIbanIv: null,
    counterpartyIbanAuthTag: null,
    matchStatus: "unmatched",
  };
}

async function run() {
  const { autoAssignByIban } = await import("../ibanMatcher");
  return autoAssignByIban(fakeDb as never, "owner-1", "conn-1");
}

beforeEach(() => {
  vi.resetModules();
  findCandidateLeasesByIban.mockReset();
  assignStatementToLease.mockClear();
  statements = [];
});

describe("autoAssignByIban", () => {
  it("assigns when the IBAN maps to exactly one active lease", async () => {
    statements = [stmt("500.00")];
    findCandidateLeasesByIban.mockResolvedValue([
      { leaseId: "L1", monthlyRent: "500.00" },
    ]);
    const n = await run();
    expect(n).toBe(1);
    expect(assignStatementToLease).toHaveBeenCalledTimes(1);
    expect(assignStatementToLease.mock.calls[0][2]).toBe("L1");
  });

  it("disambiguates by amount when the IBAN maps to several leases", async () => {
    statements = [stmt("500.00")];
    findCandidateLeasesByIban.mockResolvedValue([
      { leaseId: "L1", monthlyRent: "500.00" },
      { leaseId: "L2", monthlyRent: "700.00" },
    ]);
    const n = await run();
    expect(n).toBe(1);
    expect(assignStatementToLease).toHaveBeenCalledTimes(1);
    expect(assignStatementToLease.mock.calls[0][2]).toBe("L1");
  });

  it("does NOT assign when several leases match the same amount (ambiguous)", async () => {
    statements = [stmt("500.00")];
    findCandidateLeasesByIban.mockResolvedValue([
      { leaseId: "L1", monthlyRent: "500.00" },
      { leaseId: "L2", monthlyRent: "500.00" },
    ]);
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).not.toHaveBeenCalled();
  });

  it("skips debits (outgoing) entirely", async () => {
    statements = [stmt("-500.00")];
    findCandidateLeasesByIban.mockResolvedValue([
      { leaseId: "L1", monthlyRent: "500.00" },
    ]);
    const n = await run();
    expect(n).toBe(0);
    expect(findCandidateLeasesByIban).not.toHaveBeenCalled();
  });
});
