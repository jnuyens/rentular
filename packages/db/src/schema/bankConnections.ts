import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  index,
  json,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const bankConnections = mysqlTable("bank_connections", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  provider: mysqlEnum("provider", ["gocardless_bad", "ponto", "enable_banking"])
    .notNull(),
  // Which Ponto application a connection belongs to (individual -> ppm,
  // company -> cpm). Set at connect time; null for non-Ponto providers.
  pontoModel: mysqlEnum("ponto_model", ["ppm", "cpm"]),
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
  // Phase 9: AES-256-GCM encrypted OAuth tokens (Ponto). Reuses apps/api/src/lib/encryption.ts
  // helper which returns { encrypted, iv, tag } base64 triplets — three columns per secret.
  encryptedAccessToken: text("encrypted_access_token"),
  tokenIv: varchar("token_iv", { length: 64 }),
  tokenAuthTag: varchar("token_auth_tag", { length: 64 }),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  refreshTokenIv: varchar("refresh_token_iv", { length: 64 }),
  refreshTokenAuthTag: varchar("refresh_token_auth_tag", { length: 64 }),
  // Phase 9: provider-specific metadata (Ponto: organisation_id, integration_id, account_ids[])
  providerMetadata: json("provider_metadata"),
  // Phase 9: ISO-3166 alpha-2 country code; defaults to BE for current launch market
  country: varchar("country", { length: 2 }).default("BE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("bank_connections_owner_idx").on(table.ownerId),
  statusIdx: index("bank_connections_status_idx").on(table.status),
}));
