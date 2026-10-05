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

// Audit log for Bearer-authenticated API calls, modelled on the communications
// insert-a-row pattern. Args are redacted before insert so no secret or token
// value lands in the log (T-11-05, T-11-09).
export const apiToolCalls = mysqlTable(
  "api_tool_calls",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id),
    tokenId: varchar("token_id", { length: 36 }),
    tool: varchar("tool", { length: 80 }).notNull(),
    args: json("args"),
    status: mysqlEnum("status", ["ok", "error", "forbidden"]).notNull(),
    httpStatus: varchar("http_status", { length: 3 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("api_tool_calls_user_idx").on(table.userId),
    tokenIdx: index("api_tool_calls_token_idx").on(table.tokenId),
  }),
);
