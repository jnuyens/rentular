import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  json,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { leases } from "./leases";

// Full communications history: every email, SMS, and letter sent through the system
export const communications = mysqlTable("communications", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  // Who sent it (the landlord/owner)
  ownerId: varchar("owner_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  // Related lease (optional — some communications are property-wide)
  leaseId: varchar("lease_id", { length: 36 })
    .references(() => leases.id),
  // Channel
  channel: mysqlEnum("channel", ["email", "sms", "letter"]).notNull(),
  // Type of communication
  type: mysqlEnum("type", [
    "payment_reminder_friendly",
    "payment_reminder_formal",
    "payment_reminder_final",
    "indexation_notification",
    "landlord_report",
    "custom",           // Manual message sent by landlord
    "welcome",          // New tenant welcome
    "lease_renewal",
    "lease_termination",
    "other",
  ]).notNull(),
  // Recipient info
  recipientName: varchar("recipient_name", { length: 255 }).notNull(),
  recipientEmail: varchar("recipient_email", { length: 255 }),
  recipientPhone: varchar("recipient_phone", { length: 50 }),
  // Content
  subject: varchar("subject", { length: 500 }), // For emails
  body: text("body").notNull(),
  // Status
  status: mysqlEnum("status", [
    "queued",
    "sent",
    "delivered",
    "failed",
    "bounced",
  ])
    .default("queued")
    .notNull(),
  // External reference (email queue job ID, SMS provider message ID, etc.)
  externalId: varchar("external_id", { length: 255 }),
  errorMessage: text("error_message"),
  // Metadata (attachments list, template variables used, etc.)
  metadata: json("metadata"),
  // Timestamps
  queuedAt: timestamp("queued_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
