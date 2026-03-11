import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  mysqlEnum,
  boolean,
  int,
} from "drizzle-orm/mysql-core";
import { leases } from "./leases";
import { users } from "./users";

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
  // Late payment administrative fee & interest charged on this payment
  latePaymentFee: decimal("late_payment_fee", { precision: 10, scale: 2 }).default("0.00"),
  interestCharged: decimal("interest_charged", { precision: 10, scale: 2 }).default("0.00"),
  feeWaivedAt: date("fee_waived_at"), // If soft enforcement and tenant paid within grace period
  // Non-rent payment: mark incoming payments as not rent-related (e.g. deposit refund, utility reimbursement)
  isIgnored: boolean("is_ignored").default(false).notNull(),
  ignoreReason: text("ignore_reason"),
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

// Per-owner settings for automated payment follow-up
export const paymentFollowUpSettings = mysqlTable("payment_follow_up_settings", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id),
  // Enable/disable automated follow-up
  enabled: boolean("enabled").default(true).notNull(),
  // Escalation delays (days after due date)
  friendlyReminderDays: int("friendly_reminder_days").default(0).notNull(),
  formalReminderDays: int("formal_reminder_days").default(3).notNull(),
  finalReminderDays: int("final_reminder_days").default(6).notNull(),
  // Interest on late payments
  interestEnabled: boolean("interest_enabled").default(false).notNull(),
  annualInterestRate: decimal("annual_interest_rate", { precision: 5, scale: 2 }).default("3.75"),
  // Configurable email templates (support placeholders: {{tenantName}}, {{amount}}, {{dueDate}}, {{propertyName}}, {{daysPastDue}}, {{interestAmount}}, {{adminFee}}, {{totalOwed}}, {{ownerName}})
  friendlySubject: varchar("friendly_subject", { length: 500 }).default("Friendly reminder: rent payment due"),
  friendlyBody: text("friendly_body"),
  formalSubject: varchar("formal_subject", { length: 500 }).default("Payment overdue - action required"),
  formalBody: text("formal_body"),
  finalSubject: varchar("final_subject", { length: 500 }).default("Final notice: overdue rent payment"),
  finalBody: text("final_body"),
  // Landlord payment overview report settings
  landlordReportEnabled: boolean("landlord_report_enabled").default(true).notNull(),
  landlordReportDays: varchar("landlord_report_days", { length: 50 }).default("3,7,15,28"),
  landlordReportSkipIfAllPaid: boolean("landlord_report_skip_if_all_paid").default(false).notNull(),
  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

