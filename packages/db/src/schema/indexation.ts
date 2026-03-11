import {
  mysqlTable,
  varchar,
  timestamp,
  date,
  decimal,
  mysqlEnum,
} from "drizzle-orm/mysql-core";
import { leases } from "./leases";

// Store health index values from Statbel
export const healthIndexValues = mysqlTable("health_index_values", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  year: varchar("year", { length: 4 }).notNull(),
  month: varchar("month", { length: 2 }).notNull(),
  value: decimal("value", { precision: 8, scale: 2 }).notNull(),
  source: varchar("source", { length: 50 }).default("statbel").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

// Record of each indexation applied to a lease
export const indexationRecords = mysqlTable("indexation_records", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  leaseId: varchar("lease_id", { length: 36 })
    .notNull()
    .references(() => leases.id),
  effectiveDate: date("effective_date").notNull(),
  previousRent: decimal("previous_rent", { precision: 10, scale: 2 }).notNull(),
  newRent: decimal("new_rent", { precision: 10, scale: 2 }).notNull(),
  baseIndex: decimal("base_index", { precision: 8, scale: 2 }).notNull(),
  currentIndex: decimal("current_index", { precision: 8, scale: 2 }).notNull(),
  status: mysqlEnum("status", [
    "calculated",
    "notified",
    "applied",
    "disputed",
  ])
    .default("calculated")
    .notNull(),
  // Letter sent to tenant
  notificationSentAt: timestamp("notification_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
