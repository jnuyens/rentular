import {
  mysqlTable,
  varchar,
  timestamp,
  mysqlEnum,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { users } from "./users";
import { properties } from "./properties";

// Multi-user access to properties: allows multiple people to administer one or more properties
export const propertyManagers = mysqlTable(
  "property_managers",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    propertyId: varchar("property_id", { length: 36 })
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", [
      "owner",      // Full control, can add/remove managers
      "co_owner",   // Same as owner but cannot remove the original owner
      "manager",    // Can manage leases, tenants, payments, costs
      "accountant", // Read-only + payment and cost management
      "viewer",     // Read-only access
    ]).notNull(),
    invitedBy: varchar("invited_by", { length: 255 })
      .references(() => users.id),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    // Invitation fields: allow inviting users who may not have an account yet
    invitationToken: varchar("invitation_token", { length: 36 }),
    invitationExpiresAt: timestamp("invitation_expires_at"),
    invitationEmail: varchar("invitation_email", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Each user can only have one role per property
    uniqueUserProperty: uniqueIndex("unique_user_property").on(
      table.propertyId,
      table.userId
    ),
    // Each invitation token must be unique for lookup
    uniqueInvitationToken: uniqueIndex("unique_invitation_token").on(
      table.invitationToken
    ),
    // Prevent duplicate invitations to the same email for the same property
    uniquePropertyEmail: uniqueIndex("unique_property_email").on(
      table.propertyId,
      table.invitationEmail
    ),
  })
);
