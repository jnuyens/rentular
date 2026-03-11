import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

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
