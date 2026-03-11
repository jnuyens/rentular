import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  boolean,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const tenants = mysqlTable("tenants", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  language: mysqlEnum("language", ["nl", "fr", "de", "en"])
    .default("nl")
    .notNull(),
  // Belgian-specific
  nationalRegister: varchar("national_register", { length: 20 }), // Rijksregisternummer
  iban: varchar("iban", { length: 34 }),
  // GoCardless
  gocardlessCustomerId: varchar("gocardless_customer_id", { length: 255 }),
  gocardlessMandateId: varchar("gocardless_mandate_id", { length: 255 }),
  // Metadata
  notes: text("notes"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
