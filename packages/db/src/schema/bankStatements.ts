import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
  decimal,
  date,
} from "drizzle-orm/mysql-core";
import { bankConnections } from "./bankConnections";
import { payments } from "./payments";

// Phase 9: provider-agnostic audit table of every raw bank transaction line
// fetched from a connected bank (Ponto, GoCardless BAD, Enable Banking, …).
// Counterparty PII and the full raw payload are encrypted at rest using
// apps/api/src/lib/encryption.ts (AES-256-GCM → { encrypted, iv, tag }).
export const bankStatements = mysqlTable(
  "bank_statements",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    connectionId: varchar("connection_id", { length: 36 })
      .notNull()
      .references(() => bankConnections.id),
    // Provider-issued unique transaction id (UUID for Ponto, varies per provider).
    // Combined with connectionId forms the dedup key (uniqueIndex below).
    externalTransactionId: varchar("external_transaction_id", { length: 255 }).notNull(),
    // Positive = credit, negative = debit. decimal(12,2) matches payments.amount precedent
    // but wider precision because bank statements include large/historical sums.
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR").notNull(),
    // YYYY-MM-DD; matches IncomingTransaction.bookingDate (apps/api/src/lib/bankAccountData.ts).
    bookingDate: date("booking_date").notNull(),
    // Some providers expose only one date; valueDate is nullable.
    valueDate: date("value_date"),
    // Counterparty name (PII) — encrypted via lib/encryption.ts triplet.
    counterpartyNameEncrypted: text("counterparty_name_encrypted"),
    counterpartyNameIv: varchar("counterparty_name_iv", { length: 64 }),
    counterpartyNameAuthTag: varchar("counterparty_name_auth_tag", { length: 64 }),
    // Counterparty IBAN (PII) — encrypted via lib/encryption.ts triplet.
    counterpartyIbanEncrypted: text("counterparty_iban_encrypted"),
    counterpartyIbanIv: varchar("counterparty_iban_iv", { length: 64 }),
    counterpartyIbanAuthTag: varchar("counterparty_iban_auth_tag", { length: 64 }),
    // Digits-only normalized structured communication, matches
    // apps/api/src/services/transactionMatcher.ts:38 lookup format.
    structuredCommunication: varchar("structured_communication", { length: 50 }),
    unstructuredCommunication: text("unstructured_communication"),
    // Full provider payload (encrypted) for audit / dispute trail.
    rawPayloadEncrypted: text("raw_payload_encrypted").notNull(),
    rawPayloadIv: varchar("raw_payload_iv", { length: 64 }).notNull(),
    rawPayloadAuthTag: varchar("raw_payload_auth_tag", { length: 64 }).notNull(),
    // Match outcome — populated by transactionMatcher.
    matchedPaymentId: varchar("matched_payment_id", { length: 36 }).references(
      () => payments.id,
    ),
    matchStatus: mysqlEnum("match_status", [
      "unmatched",
      "matched",
      "mismatched_amount",
      "ignored",
    ])
      .default("unmatched")
      .notNull(),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
    matchedAt: timestamp("matched_at"),
  },
  (table) => ({
    // Dedup safety net: provider may resend a transaction; second insert
    // returns MySQL 1062 which the importer (Plan 03) handles as no-op.
    connTxUniq: uniqueIndex("bank_statements_conn_tx_uniq").on(
      table.connectionId,
      table.externalTransactionId,
    ),
    connDateIdx: index("bank_statements_conn_date_idx").on(
      table.connectionId,
      table.bookingDate,
    ),
    matchStatusIdx: index("bank_statements_match_status_idx").on(table.matchStatus),
  }),
);
