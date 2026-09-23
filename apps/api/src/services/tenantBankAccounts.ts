import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  getDb,
  tenantBankAccounts,
  tenants,
  leases,
  leaseTenants,
} from "@rentular/db";
import { decryptOrNull, type StatementRow } from "../lib/bankTransactionView";

type Db = ReturnType<typeof getDb>;

/** Strip spaces and uppercase so IBANs compare and store consistently. */
export function normalizeIban(v: string | null | undefined): string {
  return (v || "").replace(/\s+/g, "").toUpperCase();
}

/** All account IBANs belonging to an owner's tenants (normalized, deduped). */
export async function getOwnerTenantIbans(
  db: Db,
  ownerId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ iban: tenantBankAccounts.iban })
    .from(tenantBankAccounts)
    .innerJoin(tenants, eq(tenants.id, tenantBankAccounts.tenantId))
    .where(eq(tenants.ownerId, ownerId));
  // Include the legacy single-column IBAN as a safety net during/after backfill.
  const legacy = await db
    .select({ iban: tenants.iban })
    .from(tenants)
    .where(eq(tenants.ownerId, ownerId));
  return new Set(
    [...rows, ...legacy]
      .map((r) => normalizeIban(r.iban))
      .filter((v) => v.length > 0),
  );
}

/** Active leases whose tenants have paid from this IBAN (deduped by lease). */
export async function findCandidateLeasesByIban(
  db: Db,
  ownerId: string,
  iban: string,
): Promise<Array<{ leaseId: string; monthlyRent: string }>> {
  const norm = normalizeIban(iban);
  if (!norm) return [];
  const rows = await db
    .select({ leaseId: leases.id, monthlyRent: leases.monthlyRent })
    .from(tenantBankAccounts)
    .innerJoin(
      leaseTenants,
      eq(leaseTenants.tenantId, tenantBankAccounts.tenantId),
    )
    .innerJoin(leases, eq(leases.id, leaseTenants.leaseId))
    .where(
      and(
        eq(tenantBankAccounts.iban, norm),
        eq(leases.ownerId, ownerId),
        eq(leases.status, "active"),
      ),
    );
  const byLease = new Map<string, { leaseId: string; monthlyRent: string }>();
  for (const r of rows) byLease.set(r.leaseId, r);
  return [...byLease.values()];
}

/** Add an IBAN to a tenant if they don't already have it. */
async function addTenantIbanIfNew(
  db: Db,
  tenantId: string,
  iban: string,
): Promise<boolean> {
  const norm = normalizeIban(iban);
  if (!norm) return false;
  const existing = await db
    .select({ id: tenantBankAccounts.id })
    .from(tenantBankAccounts)
    .where(
      and(
        eq(tenantBankAccounts.tenantId, tenantId),
        eq(tenantBankAccounts.iban, norm),
      ),
    )
    .limit(1);
  if (existing[0]) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(tenantBankAccounts).values({
    id: randomUUID(),
    tenantId,
    iban: norm,
    label: null,
    createdAt: new Date(),
  });
  return true;
}

/**
 * Learn the sender's account from a manual assignment: attach the statement's
 * counterparty IBAN to the lease's tenant, so future transfers from that IBAN
 * auto-assign. When the lease has several tenants, pick the one whose name
 * matches the counterparty name; otherwise the primary tenant.
 */
export async function learnTenantAccountFromStatement(
  db: Db,
  opts: { leaseId: string; statement: StatementRow },
): Promise<void> {
  const iban = normalizeIban(
    decryptOrNull(
      opts.statement.counterpartyIbanEncrypted,
      opts.statement.counterpartyIbanIv,
      opts.statement.counterpartyIbanAuthTag,
    ),
  );
  if (!iban) return;

  const counterpartyName = (
    decryptOrNull(
      opts.statement.counterpartyNameEncrypted,
      opts.statement.counterpartyNameIv,
      opts.statement.counterpartyNameAuthTag,
    ) || ""
  ).toLowerCase();

  const rows = await db
    .select({
      id: tenants.id,
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      isPrimary: leaseTenants.isPrimary,
    })
    .from(leaseTenants)
    .innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
    .where(eq(leaseTenants.leaseId, opts.leaseId));

  if (rows.length === 0) return;

  let picked = rows[0];
  if (rows.length > 1) {
    const nameMatch = counterpartyName
      ? rows.find(
          (r) =>
            (r.lastName &&
              counterpartyName.includes(r.lastName.toLowerCase())) ||
            (r.firstName &&
              counterpartyName.includes(r.firstName.toLowerCase())),
        )
      : undefined;
    picked = nameMatch || rows.find((r) => r.isPrimary) || rows[0];
  }

  await addTenantIbanIfNew(db, picked!.id, iban);
}
