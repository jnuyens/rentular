import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const propertyManagersRouter = new Hono();

// List managers for a property
propertyManagersRouter.get("/", async (c) => {
  const propertyId = c.req.query("propertyId");
  if (!propertyId) {
    return c.json({ error: "propertyId is required" }, 400);
  }
  // TODO: Query propertyManagers + join users for name/email, verify caller has access
  return c.json({ data: [] });
});

// List all properties the current user has access to (via ownership or manager role)
propertyManagersRouter.get("/my-properties", async (c) => {
  // TODO: Query properties where ownerId = auth user
  //       UNION propertyManagers where userId = auth user and acceptedAt is not null
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
    // TODO:
    // 1. Verify caller is owner or co_owner of the property
    // 2. Find or create user by email
    // 3. Insert into propertyManagers with acceptedAt = null
    // 4. Send invitation email
    return c.json({ data, message: "Invitation sent" }, 201);
  }
);

// Accept an invitation
propertyManagersRouter.post("/:id/accept", async (c) => {
  const id = c.req.param("id");
  // TODO: Set acceptedAt = now(), verify the invitation belongs to auth user
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
    // TODO: Verify caller is owner/co_owner, cannot change original owner's role
    return c.json({ data, message: "Role updated" });
  }
);

// Remove a manager from a property
propertyManagersRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Verify caller is owner/co_owner, cannot remove original owner
  return c.json({ message: "Manager removed" });
});
