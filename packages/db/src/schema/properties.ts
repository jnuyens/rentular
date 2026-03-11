import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  boolean,
  json,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const properties = mysqlTable("properties", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(), // UUID
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", [
    "apartment",
    "house",
    "studio",
    "commercial",
    "garage",
    "other",
  ]).notNull(),
  // Address
  street: varchar("street", { length: 255 }).notNull(),
  streetNumber: varchar("street_number", { length: 20 }).notNull(),
  box: varchar("box", { length: 20 }),
  postalCode: varchar("postal_code", { length: 10 }).notNull(),
  city: varchar("city", { length: 255 }).notNull(),
  country: varchar("country", { length: 2 }).notNull().default("BE"),
  // Belgian-specific
  cadastralReference: varchar("cadastral_reference", { length: 100 }),
  epcScore: varchar("epc_score", { length: 10 }), // Energy Performance Certificate
  epcCertificateNumber: varchar("epc_certificate_number", { length: 100 }),
  // Metadata
  notes: text("notes"),
  metadata: json("metadata"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
