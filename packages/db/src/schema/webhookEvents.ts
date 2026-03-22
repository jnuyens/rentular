import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  json,
  index,
} from "drizzle-orm/mysql-core";

export const webhookEvents = mysqlTable("webhook_events", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  eventId: varchar("event_id", { length: 255 }).notNull().unique(),
  resourceType: varchar("resource_type", { length: 50 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  resourceId: varchar("resource_id", { length: 255 }),
  payload: json("payload").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "processed", "failed", "skipped"])
    .default("pending").notNull(),
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
}, (table) => ({
  eventIdIdx: index("webhook_events_event_id_idx").on(table.eventId),
  resourceIdx: index("webhook_events_resource_idx").on(table.resourceType, table.resourceId),
  statusIdx: index("webhook_events_status_idx").on(table.status),
  receivedAtIdx: index("webhook_events_received_at_idx").on(table.receivedAt),
}));
