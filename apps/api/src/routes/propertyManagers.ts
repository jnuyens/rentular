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
