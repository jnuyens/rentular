import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  index,
} from "drizzle-orm/mysql-core";
import { payments } from "./payments";
import { leases } from "./leases";
import { users } from "./users";

/**
 * A single allocation of (part of) a payment to one rent period.
 *
 * The rent ledger for a lease is: rent periods (monthly charges) on one side,
 * received payments on the other, and these allocations linking portions of
 * payments to periods. A payment can be split across several periods, and a
 * period can be covered by several partial payments, so reconciliation is exact
 * rather than a one-payment-per-month heuristic.
 */
export const paymentAllocations = mysqlTable(
  "payment_allocations",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    paymentId: varchar("payment_id", { length: 36 })
      .notNull()
      .references(() => payments.id),
    leaseId: varchar("lease_id", { length: 36 })
      .notNull()
      .references(() => leases.id),
    // The rent period this portion is assigned to: "YYYY-MM" plus its due date.
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    periodDueDate: date("period_due_date", { mode: "string" }).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    note: text("note"),
    // Null = created automatically (auto-reconcile); otherwise the user's id.
    createdBy: varchar("created_by", { length: 255 }).references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leasePeriodIdx: index("pa_lease_period_idx").on(table.leaseId, table.periodMonth),
    paymentIdx: index("pa_payment_idx").on(table.paymentId),
  }),
);
