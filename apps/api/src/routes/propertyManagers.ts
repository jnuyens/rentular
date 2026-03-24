import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { getDb, propertyManagers, properties, users } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  hasMinimumRole,
  getUserPropertyRole,
  getAccessiblePropertyIds,
} from "../lib/propertyAccess";
import { queueEmail } from "../jobs/emailQueueWorker";

export const propertyManagersRouter = new Hono();

// Migration endpoint: populate propertyManagers with owner records for existing properties
// Must be called once per user after deploy to backfill existing properties (Pitfall 1 from research)
propertyManagersRouter.post("/migrate-owners", async (c) => {
  const userId = getRequiredUserId(c);
  const db = getDb();

  // Get all properties owned by this user that don't have an owner record in propertyManagers
  const ownedProperties = await db
    .select()
    .from(properties)
    .where(eq(properties.ownerId, userId));

  let migrated = 0;
  for (const prop of ownedProperties) {
    const existing = await db
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, prop.id),
          eq(propertyManagers.userId, userId)
        )
      );

    if (existing.length === 0) {
      await db.insert(propertyManagers).values({
        id: crypto.randomUUID(),
        propertyId: prop.id,
        userId: userId,
        role: "owner",
        invitedBy: null,
        acceptedAt: new Date(),
        invitedAt: new Date(),
      });
      migrated++;
    }
  }

  return c.json({
    message: `Migrated ${migrated} properties`,
    migrated,
    total: ownedProperties.length,
  });
});

// List managers for a property
propertyManagersRouter.get("/", async (c) => {
  const propertyId = c.req.query("propertyId");
  if (!propertyId) {
    return c.json({ error: "propertyId is required" }, 400);
  }

  const userId = getRequiredUserId(c);
  const db = getDb();

  // Check user has co_owner+ access to the property
  const userRole = await getUserPropertyRole(userId, propertyId);
  if (!userRole || !hasMinimumRole(userRole, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Query all managers for this property
  const managers = await db
    .select()
    .from(propertyManagers)
    .where(eq(propertyManagers.propertyId, propertyId));

  // Enrich with user info
  const data = await Promise.all(
    managers.map(async (m) => {
      let user: { name: string | null; email: string } | null = null;
      if (m.userId) {
        const userResult = await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, m.userId));
        user = userResult[0] || null;
      }
      return {
        id: m.id,
        propertyId: m.propertyId,
        userId: m.userId,
        role: m.role,
        invitedBy: m.invitedBy,
        invitedAt: m.invitedAt,
        acceptedAt: m.acceptedAt,
        invitationEmail: m.invitationEmail,
        user: user || { name: null, email: m.invitationEmail || "" },
      };
    })
  );

  return c.json({ data });
});

// List all properties the current user has access to (via ownership or manager role)
propertyManagersRouter.get("/my-properties", async (c) => {
  const userId = getRequiredUserId(c);
  const db = getDb();

  // Get all accepted property manager records for this user
  const managed = await db
    .select()
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.userId, userId),
        isNotNull(propertyManagers.acceptedAt)
      )
    );

  if (managed.length === 0) {
    return c.json({ data: [] });
  }

  // Get the corresponding properties
  const propertyIds = managed.map((m) => m.propertyId);
  const allProperties = await db.select().from(properties);
  const accessibleProperties = allProperties.filter((p) =>
    propertyIds.includes(p.id)
  );

  // Build role map
  const roleMap = new Map(managed.map((m) => [m.propertyId, m.role]));

  const data = accessibleProperties.map((prop) => ({
    ...prop,
    role: roleMap.get(prop.id) || "viewer",
  }));

  return c.json({ data });
});

// Fetch invitation details by token (read-only, does NOT consume the token)
// Placed BEFORE /:id pattern to avoid route conflicts
propertyManagersRouter.get("/invitation", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "Token required" }, 400);

  const db = getDb();
  const invitation = await db
    .select()
    .from(propertyManagers)
    .where(eq(propertyManagers.invitationToken, token));

  if (!invitation[0]) return c.json({ error: "Invitation not found" }, 404);

  const record = invitation[0];
  if (record.invitationExpiresAt && record.invitationExpiresAt < new Date()) {
    return c.json({ error: "Invitation has expired" }, 410);
  }
  if (record.acceptedAt) {
    return c.json({ error: "Invitation already accepted" }, 409);
  }

  // Fetch property name
  const prop = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.id, record.propertyId));
  const propertyName = prop[0]?.name || "Unknown property";

  // Fetch inviter name
  let inviterName = "A property owner";
  if (record.invitedBy) {
    const inviter = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, record.invitedBy));
    inviterName = inviter[0]?.name || "A property owner";
  }

  return c.json({
    data: {
      propertyName,
      role: record.role,
      inviterName,
      invitationEmail: record.invitationEmail,
    },
  });
});

// Invite a user to manage a property
propertyManagersRouter.post(
  "/invite",
  zValidator(
    "json",
    z.object({
      propertyId: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(["co_owner", "manager", "accountant", "viewer"]),
    })
  ),
  async (c) => {
    const { propertyId, email, role } = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const db = getDb();

    // Check user has co_owner+ access
    const userRole = await getUserPropertyRole(userId, propertyId);
    if (!userRole || !hasMinimumRole(userRole, "co_owner")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    // Prevent inviting yourself
    const callerUser = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (callerUser[0]?.email.toLowerCase() === email.toLowerCase()) {
      return c.json({ error: "Cannot invite yourself" }, 400);
    }

    // Look up invitee by email
    const invitee = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    // D-12: Check if invitee already has a record for this property
    const existingRecords = await db
      .select()
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.propertyId, propertyId),
          eq(propertyManagers.invitationEmail, email)
        )
      );

    if (existingRecords[0]) {
      // D-12: Overwrite role in place
      await db
        .update(propertyManagers)
        .set({ role, invitedBy: userId, invitedAt: new Date() })
        .where(eq(propertyManagers.id, existingRecords[0].id));

      // Send role change email
      const prop = await db
        .select({ name: properties.name })
        .from(properties)
        .where(eq(properties.id, propertyId));
      const propertyName = prop[0]?.name || "A property";

      const inviterUser = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId));
      const inviterName = inviterUser[0]?.name || "A property owner";

      await queueEmail({
        to: email,
        subject: "Your role has been updated on Rentular",
        body: `Hi,\n\n${inviterName} has updated your role for ${propertyName} to ${role}.\n\nLog in to Rentular to see your updated access.\n\nBest regards,\nRentular`,
      });

      return c.json({ message: "Role updated", id: existingRecords[0].id });
    }

    // New invitation
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // D-03: 90 days
    const id = crypto.randomUUID();

    await db.insert(propertyManagers).values({
      id,
      propertyId,
      userId: invitee[0]?.id || null,
      role,
      invitedBy: userId,
      invitedAt: new Date(),
      acceptedAt: null,
      invitationToken: token,
      invitationExpiresAt: expiresAt,
      invitationEmail: email,
    });

    // Build accept URL
    const webUrl = process.env.WEB_URL || "http://localhost:3000";
    const acceptUrl = `${webUrl}/invite/accept?token=${token}`;

    // Look up property name and inviter name for the email
    const prop = await db
      .select({ name: properties.name })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const propertyName = prop[0]?.name || "a property";

    const inviterUser = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    const inviterName = inviterUser[0]?.name || "A property owner";

    // Look up property owner for ownerId in meta
    const propOwner = await db
      .select({ ownerId: properties.ownerId })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const ownerId = propOwner[0]?.ownerId || userId;

    const roleName = role.replace("_", " ");

    // Send invitation email
    await queueEmail(
      {
        to: email,
        subject: `${inviterName} invited you to manage a property on Rentular`,
        body: `You have been invited\n\n${inviterName} has invited you to manage ${propertyName} as ${roleName}.\n\nClick the link below to accept the invitation:\n${acceptUrl}\n\nThis invitation expires in 90 days. If you did not expect this invitation, you can safely ignore this email.\n\nBest regards,\nRentular`,
      },
      undefined,
      {
        ownerId,
        type: "other",
        recipientName: email,
      }
    );

    return c.json({ message: "Invitation sent", id }, 201);
  }
);

// Accept an invitation by token
propertyManagersRouter.post(
  "/accept",
  zValidator(
    "json",
    z.object({
      token: z.string().uuid(),
    })
  ),
  async (c) => {
    const { token } = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const db = getDb();

    // Look up the invitation by token
    const invitation = await db
      .select()
      .from(propertyManagers)
      .where(eq(propertyManagers.invitationToken, token));

    if (!invitation[0]) {
      return c.json({ error: "Invitation not found" }, 404);
    }

    const record = invitation[0];
    if (
      record.invitationExpiresAt &&
      record.invitationExpiresAt < new Date()
    ) {
      return c.json({ error: "Invitation has expired" }, 410);
    }
    if (record.acceptedAt) {
      return c.json({ error: "Invitation already accepted" }, 409);
    }

    // Accept the invitation
    await db
      .update(propertyManagers)
      .set({
        userId: userId,
        acceptedAt: new Date(),
        invitationToken: null,
      })
      .where(eq(propertyManagers.id, record.id));

    // D-01: After successful accept, auto-accept ALL other pending invitations for this user's email
    const currentUser = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (currentUser[0]?.email) {
      await db
        .update(propertyManagers)
        .set({
          userId: userId,
          acceptedAt: new Date(),
          invitationToken: null,
        })
        .where(
          and(
            eq(propertyManagers.invitationEmail, currentUser[0].email),
            isNull(propertyManagers.userId),
            isNull(propertyManagers.acceptedAt)
          )
        );
    }

    return c.json({
      message: "Invitation accepted",
      propertyId: record.propertyId,
      role: record.role,
    });
  }
);

// Decline an invitation by token
propertyManagersRouter.post(
  "/decline",
  zValidator(
    "json",
    z.object({
      token: z.string().uuid(),
    })
  ),
  async (c) => {
    const { token } = c.req.valid("json");
    const db = getDb();

    // Look up the invitation by token
    const invitation = await db
      .select()
      .from(propertyManagers)
      .where(eq(propertyManagers.invitationToken, token));

    if (!invitation[0]) {
      return c.json({ error: "Invitation not found" }, 404);
    }

    const record = invitation[0];
    if (
      record.invitationExpiresAt &&
      record.invitationExpiresAt < new Date()
    ) {
      return c.json({ error: "Invitation has expired" }, 410);
    }

    // Delete the pending record
    await db
      .delete(propertyManagers)
      .where(eq(propertyManagers.id, record.id));

    return c.json({ message: "Invitation declined" });
  }
);

// Update a manager's role
propertyManagersRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      role: z.enum(["co_owner", "manager", "accountant", "viewer"]),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { role } = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const db = getDb();

    // Look up the manager record
    const managerRecords = await db
      .select()
      .from(propertyManagers)
      .where(eq(propertyManagers.id, id));

    if (!managerRecords[0]) {
      return c.json({ error: "Manager not found" }, 404);
    }

    const record = managerRecords[0];

    // Check caller has co_owner+ access to the manager's property
    const callerRole = await getUserPropertyRole(userId, record.propertyId);
    if (!callerRole || !hasMinimumRole(callerRole, "co_owner")) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    // Prevent changing the original owner's role
    if (record.role === "owner") {
      return c.json({ error: "Cannot change the property owner's role" }, 403);
    }

    // Update the role
    await db
      .update(propertyManagers)
      .set({ role })
      .where(eq(propertyManagers.id, id));

    // D-11: Send notification email if manager has a userId
    if (record.userId) {
      const managerUser = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, record.userId));

      if (managerUser[0]) {
        const prop = await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, record.propertyId));
        const propertyName = prop[0]?.name || "a property";

        await queueEmail({
          to: managerUser[0].email,
          subject: "Your role has been updated on Rentular",
          body: `Hi${managerUser[0].name ? ` ${managerUser[0].name}` : ""},\n\nYour role for ${propertyName} has been changed to ${role.replace("_", " ")}.\n\nLog in to Rentular to see your updated access.\n\nBest regards,\nRentular`,
        });
      }
    }

    // Fetch updated record
    const updated = await db
      .select()
      .from(propertyManagers)
      .where(eq(propertyManagers.id, id));

    return c.json({ message: "Role updated", data: updated[0] });
  }
);

// Remove a manager from a property
propertyManagersRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getRequiredUserId(c);
  const db = getDb();

  // Look up the manager record
  const managerRecords = await db
    .select()
    .from(propertyManagers)
    .where(eq(propertyManagers.id, id));

  if (!managerRecords[0]) {
    return c.json({ error: "Manager not found" }, 404);
  }

  const record = managerRecords[0];

  // Check caller has co_owner+ access
  const callerRole = await getUserPropertyRole(userId, record.propertyId);
  if (!callerRole || !hasMinimumRole(callerRole, "co_owner")) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Prevent removing the original owner
  if (record.role === "owner") {
    return c.json({ error: "Cannot remove the property owner" }, 403);
  }

  // D-11: Send revocation notification if manager has a userId
  if (record.userId) {
    const managerUser = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, record.userId));

    if (managerUser[0]) {
      const prop = await db
        .select({ name: properties.name })
        .from(properties)
        .where(eq(properties.id, record.propertyId));
      const propertyName = prop[0]?.name || "a property";

      await queueEmail({
        to: managerUser[0].email,
        subject: "Your access has been revoked on Rentular",
        body: `Hi${managerUser[0].name ? ` ${managerUser[0].name}` : ""},\n\nYour access to ${propertyName} has been revoked.\n\nIf you believe this was a mistake, please contact the property owner.\n\nBest regards,\nRentular`,
      });
    }
  }

  // Delete the record
  await db.delete(propertyManagers).where(eq(propertyManagers.id, id));

  return c.json({ message: "Manager removed" });
});
