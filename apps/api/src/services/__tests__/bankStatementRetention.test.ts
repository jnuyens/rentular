/**
 * Phase 09 Plan 05 Task 3 — bankStatementRetention tests (BANK-RETENTION).
 *
 * Verifies:
 *  - the hard-delete cutoff respects BANK_STATEMENTS_RETENTION_DAYS (T-09-05-01)
 *  - the default retention is 2555 days (7 years, Belgian tax law) when unset
 *  - deleteExpiredBankStatements returns the driver-reported affectedRows count
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---------------------------------------------------------------

let deleteResult: unknown = [{ affectedRows: 0 }];
const whereMock = vi.fn(() => Promise.resolve(deleteResult));
const deleteMock = vi.fn(() => ({ where: whereMock }));

vi.mock("@rentular/db", () => ({
  bankStatements: { importedAt: "imported_at" },
  getDb: vi.fn(() => ({ delete: deleteMock })),
}));

vi.mock("drizzle-orm", () => ({
  lt: vi.fn(() => "LT_CONDITION"),
}));

import {
  getRetentionThreshold,
  deleteExpiredBankStatements,
} from "../bankStatementRetention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("BANK-RETENTION: bankStatementRetention", () => {
  const ORIGINAL = process.env.BANK_STATEMENTS_RETENTION_DAYS;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteResult = [{ affectedRows: 0 }];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.BANK_STATEMENTS_RETENTION_DAYS;
    } else {
      process.env.BANK_STATEMENTS_RETENTION_DAYS = ORIGINAL;
    }
  });

  it("cutoff respects BANK_STATEMENTS_RETENTION_DAYS", () => {
    process.env.BANK_STATEMENTS_RETENTION_DAYS = "10";
    const cutoff = getRetentionThreshold();
    const expected = Date.now() - 10 * DAY_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
  });

  it("defaults to 2555 days when env unset", () => {
    delete process.env.BANK_STATEMENTS_RETENTION_DAYS;
    const cutoff = getRetentionThreshold();
    const expected = Date.now() - 2555 * DAY_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
  });

  it("deleteExpiredBankStatements returns affected rows count", async () => {
    deleteResult = [{ affectedRows: 5 }];
    const result = await deleteExpiredBankStatements();
    expect(result.deleted).toBe(5);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("returns deleted 0 when no rows are older than the threshold", async () => {
    deleteResult = [{ affectedRows: 0 }];
    const result = await deleteExpiredBankStatements();
    expect(result.deleted).toBe(0);
  });
});
