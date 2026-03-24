import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

let db: any = null;
let propertiesTable: any = null;
let pmTable: any = null;
let eq: any = null;
let and: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  propertiesTable = dbMod.properties;
  pmTable = dbMod.propertyManagers;
  const orm = require("drizzle-orm");
  eq = orm.eq;
  and = orm.and;
} catch {
  console.log("[PropertyManagers] Database unavailable");
}

function getRequiredUserId(c: any): string {
  const userId = c.get("userId");
  if (!userId) {
    throw new Error("Authenticated user is required");
  }
  return userId;
}

export const propertyManagersRouter = new Hono();

// Migration endpoint: populate propertyManagers with owner records for existing properties
// Must be called once per user after deploy to backfill existing properties (Pitfall 1 from research)
propertyManagersRouter.post("/migrate-owners", async (c) => {
  const userId = getRequiredUserId(c);

  if (!db || !propertiesTable || !pmTable) {
    return c.json({ error: "Database unavailable" }, 503);
  }

  // Get all properties owned by this user that don't have an owner record in propertyManagers
  const ownedProperties = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.ownerId, userId));

  let migrated = 0;
  for (const prop of ownedProperties) {
    const existing = await db
      .select()
      .from(pmTable)
      .where(
        and(
          eq(pmTable.propertyId, prop.id),
          eq(pmTable.userId, userId)
        )
      );

    if (existing.length === 0) {
      await db.insert(pmTable).values({
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
  // Phase 5: implement property manager roles
  return c.json({ data: [] });
});

// List all properties the current user has access to (via ownership or manager role)
propertyManagersRouter.get("/my-properties", async (c) => {
  // Phase 5: implement property manager roles
  return c.json({ data: [] });
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
    const data = c.req.valid("json");
    // Phase 5: implement property manager roles
    return c.json({ data, message: "Invitation sent" }, 201);
  }
);

// Accept an invitation
propertyManagersRouter.post("/:id/accept", async (c) => {
  const id = c.req.param("id");
  // Phase 5: implement property manager roles
  return c.json({ message: "Invitation accepted" });
});

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
    const data = c.req.valid("json");
    // Phase 5: implement property manager roles
    return c.json({ data, message: "Role updated" });
  }
);

// Remove a manager from a property
propertyManagersRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // Phase 5: implement property manager roles
  return c.json({ message: "Manager removed" });
});
