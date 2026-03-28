import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";

let db: ReturnType<typeof import("@rentular/db").getDb> | null = null;
let usersTable: typeof import("@rentular/db").users | null = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  usersTable = dbMod.users;
} catch {
  console.log("[Auth] Database unavailable for onboarding endpoints");
}

export const authRouter = new Hono();

const MIN_PASSWORD_LENGTH = 12;

// Register a new user with email/password
authRouter.post(
  "/register",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
      name: z.string().optional(),
    })
  ),
  async (c) => {
    const { email, password, name } = c.req.valid("json");
    // TODO:
    // 1. Check if email already exists
    // 2. Hash password with bcrypt
    // 3. Create user record
    // 4. Send verification email
    return c.json({ message: "Account created" }, 201);
  }
);

// Request password reset
authRouter.post(
  "/forgot-password",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
    })
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    // TODO:
    // 1. Find user by email
    // 2. Generate reset token (crypto.randomUUID)
    // 3. Store in passwordResetTokens with 1-hour expiry
    // 4. Send email with reset link
    // Always return success (don't leak whether email exists)
    return c.json({ message: "If an account exists, a reset link has been sent" });
  }
);

// Reset password with token
authRouter.post(
  "/reset-password",
  zValidator(
    "json",
    z.object({
      token: z.string(),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    })
  ),
  async (c) => {
    const { token, password } = c.req.valid("json");
    // TODO:
    // 1. Find token in passwordResetTokens, check not expired
    // 2. Hash new password with bcrypt
    // 3. Update user's passwordHash
    // 4. Delete the used token
    return c.json({ message: "Password updated" });
  }
);

// Change email address (authenticated)
authRouter.put(
  "/email",
  zValidator(
    "json",
    z.object({
      newEmail: z.string().email(),
      password: z.string().min(1, "Current password required"),
    })
  ),
  async (c) => {
    const { newEmail, password } = c.req.valid("json");
    // TODO:
    // 1. Verify current password
    // 2. Check new email isn't already taken
    // 3. Update email, set emailVerified=null
    // 4. Send verification email to new address
    return c.json({ message: "Email updated. Please verify your new email address." });
  }
);

// Change password (authenticated)
authRouter.put(
  "/password",
  zValidator(
    "json",
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    })
  ),
  async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    // TODO:
    // 1. Verify current password
    // 2. Hash new password with bcrypt
    // 3. Update user's passwordHash
    return c.json({ message: "Password changed" });
  }
);

// GET /onboarding - Get onboarding status
authRouter.get("/onboarding", async (c) => {
  const userId = c.get("userId") as string | null;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  if (!db || !usersTable) return c.json({ error: "Database unavailable" }, 503);

  const result = await db
    .select({
      onboardingStep: usersTable.onboardingStep,
      onboardingComplete: usersTable.onboardingComplete,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!result[0]) return c.json({ error: "User not found" }, 404);

  return c.json(result[0]);
});

// PATCH /onboarding - Update onboarding progress
authRouter.patch("/onboarding", async (c) => {
  const userId = c.get("userId") as string | null;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  if (!db || !usersTable) return c.json({ error: "Database unavailable" }, 503);

  const body = await c.req.json();
  const { step, complete } = body;

  const updates: Record<string, number | boolean> = {};
  if (typeof step === "number" && step >= 1 && step <= 4) {
    updates.onboardingStep = step;
  }
  if (typeof complete === "boolean") {
    updates.onboardingComplete = complete;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

  return c.json({ success: true, ...updates });
});
