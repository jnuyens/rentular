import {
  mysqlTable,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";
import { tenants } from "./tenants";

/**
 * Bank accounts a tenant pays rent from. A tenant can have several (e.g. a
 * parent's account plus the student's own). IBANs are stored normalized
 * (uppercase, no spaces) so the reconciliation matcher can look them up
 * directly. Plaintext, consistent with the existing tenants.iban column.
 */
export const tenantBankAccounts = mysqlTable(
  "tenant_bank_accounts",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    tenantId: varchar("tenant_id", { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    iban: varchar("iban", { length: 34 }).notNull(),
    label: varchar("label", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("tenant_bank_accounts_tenant_idx").on(table.tenantId),
    ibanIdx: index("tenant_bank_accounts_iban_idx").on(table.iban),
  }),
);
