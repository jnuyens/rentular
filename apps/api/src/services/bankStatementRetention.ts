import { lt } from "drizzle-orm";
import { getDb, bankStatements } from "@rentular/db";

// Phase 9 (BANK-RETENTION): GDPR / Belgian-tax-law retention for bank_statements.
// Default 2555 days = 7 years (Belgian commercial bookkeeping retention).
// Configurable via BANK_STATEMENTS_RETENTION_DAYS (T-09-05-01: default is safe;
// only an explicit env override can shorten the window).
const DEFAULT_RETENTION_DAYS = 2555;
const DAY_MS = 24 * 60 * 60 * 1000;

// Returns the cutoff Date; rows imported strictly before it are eligible for
// hard deletion. Read at call time so the env var can be changed without a
// process restart.
export function getRetentionThreshold(): Date {
  const days = Number(process.env.BANK_STATEMENTS_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  return new Date(Date.now() - safeDays * DAY_MS);
}

// Hard-deletes bank_statements rows older than the retention threshold.
// Returns the number of deleted rows and the cutoff used (logged for audit —
// T-09-05-04 accepts aggregate-only logging for v1).
export async function deleteExpiredBankStatements(): Promise<{
  deleted: number;
  cutoff: Date;
}> {
  const db = getDb();
  const cutoff = getRetentionThreshold();

  const result = await db
    .delete(bankStatements)
    .where(lt(bankStatements.importedAt, cutoff));

  // mysql2 returns [ResultSetHeader, undefined]; ResultSetHeader.affectedRows
  // carries the deleted count. Stay defensive across driver result shapes.
  const deleted = Array.isArray(result)
    ? (result[0] as { affectedRows?: number })?.affectedRows ?? 0
    : (result as { rowsAffected?: number; affectedRows?: number }).rowsAffected ??
      (result as { affectedRows?: number }).affectedRows ??
      0;

  console.log(
    `[BankStatementRetention] Deleted ${deleted} bank_statements rows imported before ${cutoff.toISOString()}`
  );

  return { deleted, cutoff };
}
