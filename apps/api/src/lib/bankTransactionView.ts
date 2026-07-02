/**
 * Bank transactions viewer + reconciliation — shared read/serialization helpers.
 *
 * Used by:
 *   - routes/bankConnections.ts  (GET /:id/transactions — per-connection table)
 *   - routes/bankTransactions.ts (GET / global list + assign/approve/ignore/undo)
 *
 * Responsibilities:
 *   - Decrypt counterparty name + IBAN server-side (AES-256-GCM triplets via
 *     lib/encryption.ts) so the API never returns ciphertext or tokens.
 *   - Resolve the compact linkedPayment { id, leaseId, amount, dueDate,
 *     leaseLabel } for matched statements, reusing the property/tenant label
 *     shape the web already builds (property name — tenant names).
 *   - Enforce ownership: a statement belongs to the caller iff its parent
 *     bank_connections.owner_id === userId.
 */

import { eq, and, inArray } from "drizzle-orm";
import type { getDb } from "@rentular/db";
import {
  bankStatements,
  bankConnections,
  payments,
  leases,
  leaseTenants,
  properties,
  tenants,
} from "@rentular/db";
import { decrypt } from "./encryption";

type Db = ReturnType<typeof getDb>;

export interface LinkedPayment {
  id: string;
  leaseId: string;
  amount: number;
  dueDate: string | null;
  leaseLabel: string;
}

export interface ConnectionSummary {
  id: string;
  institutionName: string | null;
  iban: string | null;
}

export interface TransactionRow {
  id: string;
  bookingDate: string | null;
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  structuredCommunication: string | null;
  unstructuredCommunication: string | null;
  matchStatus: string;
  matchedPaymentId: string | null;
  matchedAt: string | null;
  linkedPayment: LinkedPayment | null;
  connection?: ConnectionSummary;
}

// bank_statements row as returned by a `select().from(bankStatements)`.
export type StatementRow = typeof bankStatements.$inferSelect;

/**
 * Decrypt an AES-256-GCM triplet. Returns null when the column is empty, when
 * the stored plaintext was empty (importer encrypts `debtorName ?? ""`), or
 * when decryption fails (wrong key / tampered) — never throws to the caller.
 */
function decryptOrNull(
  encrypted: string | null,
  iv: string | null,
  tag: string | null,
): string | null {
  if (!encrypted || !iv || !tag) return null;
  try {
    const plain = decrypt(encrypted, iv, tag);
    return plain.length > 0 ? plain : null;
  } catch (err) {
    console.error("[BankTransactions] Failed to decrypt counterparty field:", err);
    return null;
  }
}

/**
 * Normalize a DATE/DATETIME value (drizzle may return a Date or a string) to a
 * `YYYY-MM-DD` string. Uses UTC slicing so a stored midnight date does not
 * shift a day across timezones.
 */
function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value);
  return str.length >= 10 ? str.slice(0, 10) : str;
}

function toIsoDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Build "Property name — Tenant A, Tenant B" labels for a set of lease ids,
 * mirroring the label shape the web assembles on the payments page
 * (property.name + "First Last" joined by ", ").
 */
export async function buildLeaseLabels(
  db: Db,
  leaseIds: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const uniqueIds = [...new Set(leaseIds)];
  if (uniqueIds.length === 0) return labels;

  const leaseRows = await db
    .select({
      id: leases.id,
      propertyName: properties.name,
    })
    .from(leases)
    .innerJoin(properties, eq(leases.propertyId, properties.id))
    .where(inArray(leases.id, uniqueIds));

  const tenantRows = await db
    .select({
      leaseId: leaseTenants.leaseId,
      firstName: tenants.firstName,
      lastName: tenants.lastName,
    })
    .from(leaseTenants)
    .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
    .where(inArray(leaseTenants.leaseId, uniqueIds));

  const tenantsByLease = new Map<string, string[]>();
  for (const row of tenantRows) {
    const list = tenantsByLease.get(row.leaseId) ?? [];
    list.push(`${row.firstName} ${row.lastName}`.trim());
    tenantsByLease.set(row.leaseId, list);
  }

  for (const lease of leaseRows) {
    const names = tenantsByLease.get(lease.id) ?? [];
    const label = names.length > 0
      ? `${lease.propertyName} — ${names.join(", ")}`
      : lease.propertyName;
    labels.set(lease.id, label);
  }

  return labels;
}

/**
 * Serialize raw bank_statements rows into API TransactionRow objects, resolving
 * linkedPayment for matched rows and (optionally) attaching a connection
 * summary for the global view.
 */
export async function buildTransactionRows(
  db: Db,
  statements: StatementRow[],
  options: { connectionMap?: Map<string, ConnectionSummary> } = {},
): Promise<TransactionRow[]> {
  const paymentIds = statements
    .map((s) => s.matchedPaymentId)
    .filter((id): id is string => Boolean(id));

  const paymentMap = new Map<
    string,
    { id: string; leaseId: string; amount: string; dueDate: unknown }
  >();
  let leaseLabels = new Map<string, string>();

  if (paymentIds.length > 0) {
    const paymentRows = await db
      .select({
        id: payments.id,
        leaseId: payments.leaseId,
        amount: payments.amount,
        dueDate: payments.dueDate,
      })
      .from(payments)
      .where(inArray(payments.id, [...new Set(paymentIds)]));
    for (const p of paymentRows) paymentMap.set(p.id, p);
    leaseLabels = await buildLeaseLabels(
      db,
      paymentRows.map((p) => p.leaseId),
    );
  }

  return statements.map((s) => {
    let linkedPayment: LinkedPayment | null = null;
    if (s.matchedPaymentId && paymentMap.has(s.matchedPaymentId)) {
      const p = paymentMap.get(s.matchedPaymentId)!;
      linkedPayment = {
        id: p.id,
        leaseId: p.leaseId,
        amount: Number(p.amount),
        dueDate: toIsoDate(p.dueDate),
        leaseLabel: leaseLabels.get(p.leaseId) ?? p.leaseId,
      };
    }

    const row: TransactionRow = {
      id: s.id,
      bookingDate: toIsoDate(s.bookingDate),
      amount: Number(s.amount),
      currency: s.currency,
      counterpartyName: decryptOrNull(
        s.counterpartyNameEncrypted,
        s.counterpartyNameIv,
        s.counterpartyNameAuthTag,
      ),
      counterpartyIban: decryptOrNull(
        s.counterpartyIbanEncrypted,
        s.counterpartyIbanIv,
        s.counterpartyIbanAuthTag,
      ),
      structuredCommunication: s.structuredCommunication,
      unstructuredCommunication: s.unstructuredCommunication,
      matchStatus: s.matchStatus,
      matchedPaymentId: s.matchedPaymentId,
      matchedAt: toIsoDateTime(s.matchedAt),
      linkedPayment,
    };

    if (options.connectionMap) {
      row.connection = options.connectionMap.get(s.connectionId) ?? {
        id: s.connectionId,
        institutionName: null,
        iban: null,
      };
    }

    return row;
  });
}

/**
 * Fetch a statement together with its parent connection, scoped to the owner.
 * Returns null when the statement does not exist or is not owned by userId —
 * the single ownership gate reused by every mutation endpoint.
 */
export async function getOwnedStatement(
  db: Db,
  statementId: string,
  userId: string,
): Promise<{ statement: StatementRow; connection: ConnectionSummary } | null> {
  const rows = await db
    .select({
      statement: bankStatements,
      connectionId: bankConnections.id,
      institutionName: bankConnections.institutionName,
      iban: bankConnections.iban,
    })
    .from(bankStatements)
    .innerJoin(
      bankConnections,
      eq(bankStatements.connectionId, bankConnections.id),
    )
    .where(
      and(
        eq(bankStatements.id, statementId),
        eq(bankConnections.ownerId, userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    statement: row.statement,
    connection: {
      id: row.connectionId,
      institutionName: row.institutionName,
      iban: row.iban,
    },
  };
}
