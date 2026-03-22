import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const bankConnections = mysqlTable("bank_connections", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  provider: mysqlEnum("provider", ["gocardless_bad", "ponto", "enable_banking"])
    .notNull(),
  externalRequisitionId: varchar("external_requisition_id", { length: 255 }),
  externalAccountId: varchar("external_account_id", { length: 255 }),
  institutionId: varchar("institution_id", { length: 255 }).notNull(),
  institutionName: varchar("institution_name", { length: 255 }),
  iban: varchar("iban", { length: 34 }),
  status: mysqlEnum("status", ["pending", "active", "expired", "revoked", "error"])
    .default("pending").notNull(),
  consentExpiresAt: timestamp("consent_expires_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncCursor: varchar("last_sync_cursor", { length: 255 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("bank_connections_owner_idx").on(table.ownerId),
  statusIdx: index("bank_connections_status_idx").on(table.status),
}));
