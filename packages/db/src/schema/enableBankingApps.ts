import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

// A landlord's own Enable Banking application (restricted mode: the landlord
// registers the app and links their own accounts in the Enable Banking Control
// Panel). The RSA private key is stored AES-256-GCM encrypted with
// apps/api/src/lib/encryption.ts and never leaves the API.
export const enableBankingApps = mysqlTable("enable_banking_apps", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id),
  applicationId: varchar("application_id", { length: 64 }).notNull(),
  privateKeyEncrypted: text("private_key_encrypted").notNull(),
  privateKeyIv: varchar("private_key_iv", { length: 64 }).notNull(),
  privateKeyAuthTag: varchar("private_key_auth_tag", { length: 64 }).notNull(),
  environment: mysqlEnum("environment", ["production", "sandbox"])
    .default("production")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastError: text("last_error"),
});
