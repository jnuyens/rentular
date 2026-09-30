import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  int,
  boolean,
  index,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { properties } from "./properties";
import { leases } from "./leases";

export const maintenanceTasks = mysqlTable("maintenance_tasks", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  propertyId: varchar("property_id", { length: 36 })
    .notNull()
    .references(() => properties.id),
  leaseId: varchar("lease_id", { length: 36 })
    .references(() => leases.id),
  type: varchar("type", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  intervalMonths: int("interval_months").notNull().default(12),
  lastCompleted: date("last_completed"),
  nextDue: date("next_due").notNull(),
  autoEmail: boolean("auto_email").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("maintenance_owner_idx").on(table.ownerId),
  propertyIdx: index("maintenance_property_idx").on(table.propertyId),
  nextDueIdx: index("maintenance_next_due_idx").on(table.nextDue),
}));
