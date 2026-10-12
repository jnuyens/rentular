/**
 * Tests for the IBAN auto-assign matcher decision logic:
 *   - a known IBAN mapping to one active lease auto-assigns
 *   - a known IBAN mapping to several leases disambiguates by amount, and only
 *     assigns when exactly one lease's expected amount matches (the
 *     parent-paying-two-student-rooms case)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findCandidateLeasesByIban = vi.fn<
  (...a: unknown[]) => Promise<Array<{ leaseId: string; monthlyRent: string }>>
>();
const assignStatementToLease = vi.fn<
  (...a: unknown[]) => Promise<{ paymentId: string; created: boolean } | null>
>(async () => ({ paymentId: "pay", created: false }));

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
const rentDeductions = { __t: "rent_deductions" };

let statements: Array<Record<string, unknown>> = [];

const fakeDb = {
  select: () => ({
    from: (t: unknown) => ({
      where: () => {
        if (t === bankStatements) return Promise.resolve(statements);
        if (t === rentDeductions) return Promise.resolve([]);
        // payments "pending rows" query: none pending -> falls back to rent.
        return { orderBy: () => Promise.resolve([]) };
      },
    }),
  }),
};

vi.mock("@rentular/db", () => ({
  getDb: () => fakeDb,
  bankStatements,
  payments,
  rentDeductions,
  rentFreePeriods: { __t: "rent_free_periods" },
  leases: { __t: "leases" },
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

  it("does not count a transfer that fits no pending payment", async () => {
    statements = [stmt("250.00")];
    findCandidateLeasesByIban.mockResolvedValue([
      { leaseId: "L1", monthlyRent: "500.00" },
    ]);
    assignStatementToLease.mockResolvedValueOnce(null);
    const n = await run();
    expect(n).toBe(0);
    expect(assignStatementToLease).toHaveBeenCalledTimes(1);
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
