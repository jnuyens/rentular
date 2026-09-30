import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  json,
  index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const importSessions = mysqlTable(
  "import_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id),
    status: mysqlEnum("status", [
      "pending",
      "discovering",
      "discovered",
      "importing",
      "completed",
      "failed",
    ])
      .default("pending")
      .notNull(),
    // Encrypted Smovin credentials (AES-256-GCM via encryption.ts)
    credentialEmail: text("credential_email"),
    credentialEmailIv: varchar("credential_email_iv", { length: 50 }),
    credentialEmailTag: varchar("credential_email_tag", { length: 50 }),
    credentialPassword: text("credential_password"),
    credentialPasswordIv: varchar("credential_password_iv", { length: 50 }),
    credentialPasswordTag: varchar("credential_password_tag", { length: 50 }),
    // Progress tracking (JSON: { step, message, current, total })
    progress: json("progress"),
    // Discovered data from Smovin (JSON: array of properties with nested tenants/leases/payments)
    discoveredData: json("discovered_data"),
    // User's selection of which properties to import (JSON: array of property indices)
    selectedProperties: json("selected_properties"),
    // Import results (JSON: { properties: N, tenants: N, leases: N, payments: N, skipped: N })
    importedCounts: json("imported_counts"),
    errorMessage: text("error_message"),
    // BullMQ job IDs
    discoveryJobId: varchar("discovery_job_id", { length: 100 }),
    importJobId: varchar("import_job_id", { length: 100 }),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("import_sessions_user_idx").on(table.userId),
  }),
);
