import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  mysqlEnum,
  boolean,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { properties } from "./properties";
import { leases } from "./leases";

// Property costs / expenses tracked by the landlord
export const costs = mysqlTable("costs", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  propertyId: varchar("property_id", { length: 36 })
    .references(() => properties.id),
  leaseId: varchar("lease_id", { length: 36 })
    .references(() => leases.id),
  category: mysqlEnum("category", [
    "maintenance",
    "repair",
    "insurance",
    "tax",
    "management_fee",
    "utility",
    "legal",
    "renovation",
    "other",
  ]).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  date: date("date").notNull(),
  // Whether this cost is recharged to the tenant
  rechargedToTenant: boolean("recharged_to_tenant").default(false).notNull(),
  // Supporting document reference (invoice number, receipt, etc.)
  reference: varchar("reference", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Rent-free periods (e.g. first month free, renovation period, goodwill gesture)
export const rentFreePeriods = mysqlTable("rent_free_periods", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  leaseId: varchar("lease_id", { length: 36 })
    .notNull()
    .references(() => leases.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  // Whether charges (provisions/fixed) are also waived during this period
  waiveCharges: boolean("waive_charges").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rent deductions (temporary or permanent reductions)
export const rentDeductions = mysqlTable("rent_deductions", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  leaseId: varchar("lease_id", { length: 36 })
    .notNull()
    .references(() => leases.id),
  type: mysqlEnum("type", [
    "temporary",  // Applies only during a date range
    "permanent",  // Applies from startDate until lease ends or deduction is removed
  ]).notNull(),
  // Fixed amount deducted from monthly rent
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),  // Required for temporary, null for permanent
  reason: varchar("reason", { length: 500 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
