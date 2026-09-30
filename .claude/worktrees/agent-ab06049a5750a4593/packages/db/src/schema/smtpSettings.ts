import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  boolean,
  int,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

// Per-landlord SMTP configuration for custom email sending
// Password is stored encrypted with AES-256-GCM (see apps/api/src/lib/encryption.ts)
export const smtpSettings = mysqlTable("smtp_settings", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id),
  host: varchar("host", { length: 255 }).notNull(),
  port: int("port").default(587).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  // AES-256-GCM encrypted password fields
  passwordEncrypted: text("password_encrypted").notNull(),
  passwordIv: varchar("password_iv", { length: 24 }).notNull(), // base64-encoded 12-byte IV
  passwordTag: varchar("password_tag", { length: 24 }).notNull(), // base64-encoded 16-byte auth tag
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  verified: boolean("verified").default(false).notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
