import {
  mysqlTable,
  varchar,
  timestamp,
  boolean,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

// Landlord bank accounts for receiving rent payments
export const bankAccounts = mysqlTable("bank_accounts", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  label: varchar("label", { length: 255 }).notNull(), // e.g. "Main account", "Savings"
  iban: varchar("iban", { length: 34 }).notNull(),
  bic: varchar("bic", { length: 11 }),
  holderName: varchar("holder_name", { length: 255 }).notNull(),
  bankName: varchar("bank_name", { length: 255 }),
  isDefault: boolean("is_default").default(false).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
