import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  int,
  mysqlEnum,
  boolean,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { properties } from "./properties";

export const leases = mysqlTable("leases", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  propertyId: varchar("property_id", { length: 36 })
    .notNull()
    .references(() => properties.id),
  type: mysqlEnum("type", [
    "residential_short",
    "residential_long",
    "residential_lifetime",
    "student",
    "commercial",
  ]).notNull(),
  region: mysqlEnum("region", ["flanders", "wallonia", "brussels"]).notNull(),
  status: mysqlEnum("status", ["draft", "active", "terminated", "expired"])
    .default("draft")
    .notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  // Financial
  monthlyRent: decimal("monthly_rent", { precision: 10, scale: 2 }).notNull(),
  monthlyCharges: decimal("monthly_charges", { precision: 10, scale: 2 })
    .default("0.00")
    .notNull(),
  chargesType: mysqlEnum("charges_type", ["fixed", "provision"])
    .default("fixed")
    .notNull(),
  deposit: decimal("deposit", { precision: 10, scale: 2 }).default("0.00"),
  depositAccount: varchar("deposit_account", { length: 34 }), // Blocked IBAN
  // Payment
  paymentDay: int("payment_day").default(1).notNull(), // Day of month
  paymentMethod: mysqlEnum("payment_method", [
    "gocardless",
    "bank_transfer",
    "manual",
  ])
    .default("bank_transfer")
    .notNull(),
  structuredCommunication: varchar("structured_communication", { length: 20 }), // +++xxx/xxxx/xxxxx+++
  // Indexation
  indexationEnabled: boolean("indexation_enabled").default(true).notNull(),
  indexationBaseMonth: varchar("indexation_base_month", { length: 7 }), // YYYY-MM
  indexationBaseIndex: decimal("indexation_base_index", {
    precision: 8,
    scale: 2,
  }),
  currentMonthlyRent: decimal("current_monthly_rent", {
    precision: 10,
    scale: 2,
  }),
  lastIndexationDate: date("last_indexation_date"),
  // Late payment administrative fee (per contract)
  latePaymentFeeEnabled: boolean("late_payment_fee_enabled").default(false).notNull(),
  latePaymentFeeAmount: decimal("late_payment_fee_amount", { precision: 10, scale: 2 }).default("15.00"),
  latePaymentFeeEnforcement: mysqlEnum("late_payment_fee_enforcement", [
    "soft",   // Waived if tenant pays within 7 days of the fee notice
    "strict", // Once charged, the fee and any interest remain due regardless
  ]).default("soft").notNull(),
  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Many-to-many: a lease can have multiple tenants (co-tenants)
export const leaseTenants = mysqlTable("lease_tenants", {
  leaseId: varchar("lease_id", { length: 36 })
    .notNull()
    .references(() => leases.id),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
});
