/**
 * Phase 09 Plan 03 Task 1 — Bank statement importer.
 *
 * Receives a batch of provider-agnostic IncomingTransaction[] (from
 * PontoConnectProvider.getTransactions, see apps/api/src/lib/bankAccountData.ts)
 * and persists each row into the bank_statements audit table with:
 *
 *   - counterparty name (PII) → AES-256-GCM ciphertext triplet
 *   - counterparty IBAN (PII) → AES-256-GCM ciphertext triplet
 *   - rawPayload (full provider payload) → AES-256-GCM ciphertext triplet
 *   - structured communication normalized to digits-only (matches
 *     transactionMatcher.ts:38 comparison format)
 *
 * Dedup safety net (RESEARCH Pattern 3): the schema defines a UNIQUE index on
 * (connectionId, externalTransactionId) — duplicate inserts raise MySQL's
 * 1062 / ER_DUP_ENTRY which we swallow per-row. This guards against provider
 * replays and against the worker re-running a window during recovery.
 *
 * Per-row try/catch is used intentionally (NOT a batch INSERT) so one
 * duplicate cannot abort an entire batch — matches the existing
 * transactionMatcher.ts inner-loop pattern.
 */

import { randomUUID } from "crypto";
import { getDb, bankStatements } from "@rentular/db";
import { encrypt } from "../lib/encryption";
import type { IncomingTransaction } from "../lib/bankAccountData";

export interface ImportedStatement {
  id: string;
  externalTransactionId: string;
  amount: number;
  bookingDate: string;
  structuredCommunicationDigits: string | null;
  debtorName: string | null;
  debtorIban: string | null;
}

export interface ImportResult {
  inserted: ImportedStatement[];
  skippedDuplicates: number;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err) return false;
  // mysql2 surfaces ER_DUP_ENTRY both as `.code === "ER_DUP_ENTRY"` and as a
  // message that includes "Duplicate entry"; accept either to be defensive.
  const e = err as { code?: string; message?: string };
  if (e.code === "ER_DUP_ENTRY") return true;
  if (typeof e.message === "string" && e.message.includes("Duplicate entry")) {
    return true;
  }
  return false;
}

function normalizeStructuredCommunication(
  remittance: string | undefined,
): string | null {
  if (!remittance) return null;
  const digits = remittance.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

export async function importBankStatements(
  connectionId: string,
  transactions: IncomingTransaction[],
): Promise<ImportResult> {
  if (transactions.length === 0) {
    return { inserted: [], skippedDuplicates: 0 };
  }

  const db = getDb();
  const inserted: ImportedStatement[] = [];
  let skippedDuplicates = 0;

  for (const tx of transactions) {
    const id = randomUUID();
    // Encrypt each PII field separately (auditable encrypt() call per field).
    // T-09-03-04: counterparty name + IBAN + raw payload are all PII at rest.
    const counterpartyName = encrypt(tx.debtorName ?? "");
    const counterpartyIban = encrypt(tx.debtorIban ?? "");
    const rawPayload = encrypt(JSON.stringify(tx));
    const structuredCommunication = normalizeStructuredCommunication(
      tx.remittanceStructured,
    );

    const row = {
      id,
      connectionId,
      externalTransactionId: tx.transactionId,
      amount: String(tx.amount) as unknown as string, // drizzle decimal expects string
      currency: tx.currency || "EUR",
      // booking_date is a DATE column (YYYY-MM-DD); provider sends a full ISO
      // datetime (e.g. 2026-06-25T20:26:28.000Z) which MySQL rejects for DATE.
      bookingDate: tx.bookingDate.slice(0, 10),
      valueDate: null,
      counterpartyNameEncrypted: counterpartyName.encrypted,
      counterpartyNameIv: counterpartyName.iv,
      counterpartyNameAuthTag: counterpartyName.tag,
      counterpartyIbanEncrypted: counterpartyIban.encrypted,
      counterpartyIbanIv: counterpartyIban.iv,
      counterpartyIbanAuthTag: counterpartyIban.tag,
      structuredCommunication,
      unstructuredCommunication: tx.remittanceUnstructured ?? null,
      rawPayloadEncrypted: rawPayload.encrypted,
      rawPayloadIv: rawPayload.iv,
      rawPayloadAuthTag: rawPayload.tag,
      matchedPaymentId: null,
      matchStatus: "unmatched" as const,
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).insert(bankStatements).values(row);
      inserted.push({
        id,
        externalTransactionId: tx.transactionId,
        amount: tx.amount,
        bookingDate: tx.bookingDate,
        structuredCommunicationDigits: structuredCommunication,
        debtorName: tx.debtorName ?? null,
        debtorIban: tx.debtorIban ?? null,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        skippedDuplicates += 1;
        console.log(
          `[BankStatementImporter] Skipping duplicate transaction ${tx.transactionId} for connection ${connectionId}`,
        );
        continue;
      }
      console.error(
        `[BankStatementImporter] Failed to insert transaction ${tx.transactionId} for connection ${connectionId}:`,
        err,
      );
      throw err;
    }
  }

  console.log(
    `[BankStatementImporter] Connection ${connectionId}: inserted ${inserted.length}, skippedDuplicates ${skippedDuplicates}`,
  );

  return { inserted, skippedDuplicates };
}
