import {
  mysqlTable,
  varchar,
  char,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

// Personal Access Tokens for the external API. Only the SHA-256+pepper hash is
// stored here; the plaintext rtl_ token is shown to the user exactly once and
// is never persisted (T-11-01). The unique hash index gives O(1) verification
// on the Bearer path (RESEARCH Pattern 1).
export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    scope: mysqlEnum("scope", ["read", "write"]).notNull().default("read"),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("api_tokens_hash_idx").on(table.tokenHash),
    userIdx: index("api_tokens_user_idx").on(table.userId),
  }),
);
