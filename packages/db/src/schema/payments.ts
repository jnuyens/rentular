import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  mysqlEnum,
} from "drizzle-orm/mysql-core";
import { leases } from "./leases";

export const payments = mysqlTable("payments", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  leaseId: varchar("lease_id", { length: 36 })
    .notNull()
    .references(() => leases.id),
  status: mysqlEnum("status", [
    "pending",
    "processing",
    "paid",
    "failed",
    "cancelled",
    "refunded",
  ])
    .default("pending")
    .notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  method: mysqlEnum("method", [
    "gocardless",
    "bank_transfer",
    "cash",
    "other",
  ]).notNull(),
  // Belgian structured communication: +++xxx/xxxx/xxxxx+++
  structuredCommunication: varchar("structured_communication", { length: 20 }),
  // GoCardless reference
  gocardlessPaymentId: varchar("gocardless_payment_id", { length: 255 }),
  // Breakdown
  rentAmount: decimal("rent_amount", { precision: 10, scale: 2 }),
  chargesAmount: decimal("charges_amount", { precision: 10, scale: 2 }),
  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const paymentReminders = mysqlTable("payment_reminders", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  paymentId: varchar("payment_id", { length: 36 })
    .notNull()
    .references(() => payments.id),
  type: mysqlEnum("type", ["friendly", "formal", "final"]).notNull(),
  channel: mysqlEnum("channel", ["email", "sms", "letter"]).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  notes: text("notes"),
});
