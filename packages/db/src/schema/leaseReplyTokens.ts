import { mysqlTable, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/mysql-core";
import { leases } from "./leases";

// Opaque token in a contract's reply address (reply+<token>@domain). The token
// carries no readable data; this table maps it back to the lease. A revoked
// token stops routing and the lease gets a new one on the next outgoing email.
export const leaseReplyTokens = mysqlTable(
  "lease_reply_tokens",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    leaseId: varchar("lease_id", { length: 36 })
      .notNull()
      .references(() => leases.id),
    token: varchar("token", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    leaseIdx: index("lease_reply_tokens_lease_idx").on(table.leaseId),
    tokenUnique: uniqueIndex("lease_reply_tokens_token_unique").on(table.token),
  }),
);
