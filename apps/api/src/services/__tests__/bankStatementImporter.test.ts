/**
 * Phase 09 Plan 03 Task 1 — bankStatementImporter tests.
 *
 * Verifies:
 *  - counterparty name is encrypted at rest (T-09-03-04)
 *  - duplicate externalTransactionId is dedup-safe via the MySQL UNIQUE
 *    constraint on (connectionId, externalTransactionId) — second insert
 *    raises ER_DUP_ENTRY (1062) and is swallowed (T-09-03-04 + RESEARCH
 *    Pattern 3 dedup-on-import safety net).
 *  - Belgian structured communication is normalized to a digits-only string
 *    so the existing transactionMatcher.ts (digits-only comparison) picks
 *    them up downstream.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingTransaction } from "../../lib/bankAccountData";

// --- Mocks ---------------------------------------------------------------

// Capture per-row insert values so we can assert encryption/normalization shape.
type InsertCall = Record<string, unknown>;

const insertCalls: InsertCall[] = [];
let nextInsertError: { code?: string; message: string } | null = null;

vi.mock("@rentular/db", () => {
  const bankStatements = { __table: "bank_statements" };
  return {
    bankStatements,
    getDb: vi.fn(() => ({
      insert: (_table: unknown) => ({
        values: async (row: InsertCall) => {
          insertCalls.push(row);
          if (nextInsertError) {
            const err = new Error(nextInsertError.message) as Error & {
              code?: string;
            };
            err.code = nextInsertError.code;
            nextInsertError = null;
            throw err;
          }
          return [{ insertId: 1 }];
        },
      }),
    })),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

// --- Helpers -------------------------------------------------------------

function buildTransaction(
  overrides: Partial<IncomingTransaction> = {},
): IncomingTransaction {
  return {
    transactionId: "tx-001",
    amount: 850.0,
    currency: "EUR",
    bookingDate: "2026-05-01",
    remittanceStructured: "+++001/2345/67890+++",
    remittanceUnstructured: undefined,
    debtorName: "Jan Janssens",
    debtorIban: "BE71096123456769",
    ...overrides,
  };
}

beforeEach(() => {
  insertCalls.length = 0;
  nextInsertError = null;
  process.env.AUTH_SECRET = "test-secret-for-bank-statement-importer";
});

describe("Phase 09-03 / bankStatementImporter", () => {
  it("encrypts counterpartyName at rest (T-09-03-04)", async () => {
    const { importBankStatements } = await import("../bankStatementImporter");
    const { inserted } = await importBankStatements("conn-1", [
      buildTransaction({ debtorName: "Jan Janssens" }),
    ]);

    expect(inserted).toHaveLength(1);
    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0]!;

    // Plaintext name must never appear in the encrypted ciphertext column.
    expect(row.counterpartyNameEncrypted).toBeTypeOf("string");
    expect(row.counterpartyNameEncrypted).not.toBe("Jan Janssens");
    expect(String(row.counterpartyNameEncrypted).length).toBeGreaterThan(0);
    expect(String(row.counterpartyNameIv).length).toBeGreaterThan(0);
    expect(String(row.counterpartyNameAuthTag).length).toBeGreaterThan(0);

    // Raw payload is also encrypted and never null (schema constraint).
    expect(row.rawPayloadEncrypted).toBeTypeOf("string");
    expect(row.rawPayloadEncrypted).not.toContain("Jan Janssens");
    expect(String(row.rawPayloadEncrypted).length).toBeGreaterThan(0);
    expect(String(row.rawPayloadIv).length).toBeGreaterThan(0);
    expect(String(row.rawPayloadAuthTag).length).toBeGreaterThan(0);
  });

  it("dedups on duplicate externalTransactionId via ER_DUP_ENTRY (Pattern 3)", async () => {
    const { importBankStatements } = await import("../bankStatementImporter");

    // First call succeeds normally; second call raises ER_DUP_ENTRY.
    const tx1 = buildTransaction({ transactionId: "dup-001" });
    const tx2 = buildTransaction({ transactionId: "dup-001" });

    // Arm an error for the SECOND insert.
    const originalInsertCallsLength = 0;
    const { getDb } = await import("@rentular/db");
    // Patch the mock to throw on the 2nd call.
    let callCount = 0;
    (getDb as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      insert: (_table: unknown) => ({
        values: async (row: InsertCall) => {
          insertCalls.push(row);
          callCount += 1;
          if (callCount === 2) {
            const err = new Error(
              "ER_DUP_ENTRY: Duplicate entry for key 'bank_statements_conn_tx_uniq'",
            ) as Error & { code?: string };
            err.code = "ER_DUP_ENTRY";
            throw err;
          }
          return [{ insertId: 1 }];
        },
      }),
    }));

    const result = await importBankStatements("conn-1", [tx1, tx2]);
    expect(result.inserted).toHaveLength(1);
    expect(result.skippedDuplicates).toBe(1);
    // 2 attempts, 1 success
    expect(insertCalls.length - originalInsertCallsLength).toBe(2);
  });

  it("normalizes structured communication to digits-only string", async () => {
    const { importBankStatements } = await import("../bankStatementImporter");

    // Reset getDb mock back to default behavior (insertCalls already cleared
    // by beforeEach; mock is re-resolved at module level above).
    const { getDb } = await import("@rentular/db");
    (getDb as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      insert: (_table: unknown) => ({
        values: async (row: InsertCall) => {
          insertCalls.push(row);
          return [{ insertId: 1 }];
        },
      }),
    }));

    await importBankStatements("conn-1", [
      buildTransaction({
        transactionId: "tx-norm",
        remittanceStructured: "+++001/2345/67890+++",
      }),
    ]);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.structuredCommunication).toBe("001234567890");
  });
});
